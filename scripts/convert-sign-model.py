#!/usr/bin/env python3
"""Convert the pinned ASL alphabet classifier to a local int8 ONNX model.

Source: https://huggingface.co/prithivMLmods/Alphabet-Sign-Language-Detection
Base:   google/siglip2-base-patch16-224 (SiglipForImageClassification, 26 labels A-Z)
License: Apache-2.0

This script runs once, at development/build time. The shipped desktop app never
downloads a model and never calls a network API.

Setup (Python 3.12+):
    python3 -m venv build/sign-venv
    build/sign-venv/bin/pip install torch transformers onnx onnxruntime pillow
    build/sign-venv/bin/python scripts/convert-sign-model.py

Output:
    models/sign/model.onnx   int8, ~100 MB
    models/sign/labels.json  ["A", ..., "Z"]
    models/sign/model.json   provenance, preprocessing, SHA-256
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
from pathlib import Path

MODEL_ID = "prithivMLmods/Alphabet-Sign-Language-Detection"
REVISION = "84e5004b2603413b02d673faa30874fee132384a"
INPUT_SIZE = 224
# SiglipImageProcessor in the repository: rescale 1/255, mean/std 0.5.
IMAGE_MEAN = [0.5, 0.5, 0.5]
IMAGE_STD = [0.5, 0.5, 0.5]


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def labels_from_config(model) -> list[str]:
    id2label = model.config.id2label
    if not id2label:
        raise SystemExit("Model config has no id2label mapping")
    ordered = sorted(((int(k), str(v)) for k, v in id2label.items()))
    labels = [label for _, label in ordered]
    if len(labels) != 26 or labels != [chr(ord("A") + i) for i in range(26)]:
        print(f"[warn] unexpected label set: {labels[:5]}... ({len(labels)} labels)")
    return labels


def preprocess(path: Path) -> "torch.Tensor":
    """Match SiglipImageProcessor: resize 224 bilinear, /255, normalize 0.5."""
    import numpy as np
    import torch
    from PIL import Image

    image = Image.open(path).convert("RGB").resize((INPUT_SIZE, INPUT_SIZE), Image.Resampling.BILINEAR)
    array = np.asarray(image, dtype=np.float32) / 255.0
    array = (array - np.asarray(IMAGE_MEAN, dtype=np.float32)) / np.asarray(IMAGE_STD, dtype=np.float32)
    array = np.transpose(array, (2, 0, 1))
    return torch.from_numpy(array).unsqueeze(0)


def top_k(logits, labels: list[str], k: int = 5):
    import numpy as np

    values = np.asarray(logits).reshape(-1)
    order = np.argsort(values)[::-1][:k]
    return [(labels[int(i)], float(values[int(i)])) for i in order]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-id", default=MODEL_ID)
    parser.add_argument("--revision", default=REVISION)
    parser.add_argument("--output", type=Path, default=Path("models/sign"))
    parser.add_argument("--keep-fp32", action="store_true", help="keep the unquantized ONNX file")
    parser.add_argument("--sample-image", type=Path, help="optional local image for a sanity check")
    args = parser.parse_args()

    args.output.mkdir(parents=True, exist_ok=True)
    fp32_path = args.output / "model-fp32.onnx"
    int8_path = args.output / "model.onnx"

    import numpy as np
    import onnxruntime as ort
    import torch
    from transformers import AutoModelForImageClassification

    print(f"[1/4] loading {args.model_id} @ {args.revision[:12]} ...")
    model = AutoModelForImageClassification.from_pretrained(
        args.model_id,
        revision=args.revision,
        token=False,
    )
    model.eval()
    labels = labels_from_config(model)
    print(f"      {sum(p.numel() for p in model.parameters()):,} parameters, {len(labels)} labels")

    class LogitsOnly(torch.nn.Module):
        def __init__(self, inner):
            super().__init__()
            self.inner = inner

        def forward(self, pixel_values):
            out = self.inner(pixel_values=pixel_values, return_dict=False)
            if isinstance(out, (tuple, list)):
                return out[0]
            return out.logits

    wrapper = LogitsOnly(model).eval()
    dummy = torch.randn(1, 3, INPUT_SIZE, INPUT_SIZE, dtype=torch.float32)

    print("[2/4] exporting ONNX (opset 17) ...")
    export_kwargs = dict(
        input_names=["pixel_values"],
        output_names=["logits"],
        dynamic_axes={"pixel_values": {0: "batch"}, "logits": {0: "batch"}},
        opset_version=17,
        do_constant_folding=True,
    )
    try:
        torch.onnx.export(wrapper, (dummy,), fp32_path, dynamo=False, **export_kwargs)
    except TypeError:
        # Some torch releases no longer expose the legacy exporter flag.
        torch.onnx.export(wrapper, (dummy,), fp32_path, **export_kwargs)

    with torch.no_grad():
        torch_logits = wrapper(dummy).cpu().numpy()
    sess = ort.InferenceSession(str(fp32_path), providers=["CPUExecutionProvider"])
    input_name = sess.get_inputs()[0].name
    onnx_logits = sess.run(None, {input_name: dummy.numpy()})[0]
    delta = float(np.max(np.abs(torch_logits - onnx_logits)))
    print(f"      fp32 export parity: max |delta| = {delta:.6f}")

    if args.sample_image:
        tensor = preprocess(args.sample_image)
        with torch.no_grad():
            expected = wrapper(tensor).cpu().numpy()
        print(f"      torch top-5: {top_k(expected, labels)}")

    print("[3/4] quantizing weights to int8 ...")
    from onnxruntime.quantization import QuantType, quantize_dynamic

    quantize_dynamic(
        model_input=str(fp32_path),
        model_output=str(int8_path),
        weight_type=QuantType.QInt8,
        use_external_data_format=False,
    )
    sess_int8 = ort.InferenceSession(str(int8_path), providers=["CPUExecutionProvider"])
    int8_logits = sess_int8.run(None, {input_name: dummy.numpy()})[0]
    int8_delta = float(np.max(np.abs(torch_logits - int8_logits)))
    a = np.asarray(torch_logits).reshape(-1)
    b = np.asarray(int8_logits).reshape(-1)
    cosine = float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-9))
    print(f"      int8 vs fp32: max |delta| = {int8_delta:.4f}, cosine = {cosine:.5f}")
    print(f"      torch labels: {top_k(torch_logits, labels, 3)}")
    print(f"      int8  labels: {top_k(int8_logits, labels, 3)}")

    if args.sample_image:
        tensor = preprocess(args.sample_image)
        int8_sample = sess_int8.run(None, {input_name: tensor.numpy()})[0]
        print(f"      int8 top-5:  {top_k(int8_sample, labels)}")

    print("[4/4] writing metadata ...")
    digest = sha256(int8_path)
    (args.output / "labels.json").write_text(json.dumps(labels, indent=2) + "\n", encoding="utf-8")
    metadata = {
        "source": f"https://huggingface.co/{args.model_id}",
        "revision": args.revision,
        "license": "Apache-2.0",
        "architecture": "SiglipForImageClassification",
        "base_model": "google/siglip2-base-patch16-224",
        "quantization": "int8 dynamic (MatMul weights)",
        "input": {
            "name": input_name,
            "shape": [1, 3, INPUT_SIZE, INPUT_SIZE],
            "layout": "NCHW",
            "resize": "bilinear",
            "rescale": 0.00392156862745098,
            "mean": IMAGE_MEAN,
            "std": IMAGE_STD,
            "formula": "(pixel / 127.5) - 1",
        },
        "labels": labels,
        "sha256": digest,
        "sizeBytes": int8_path.stat().st_size,
    }
    (args.output / "model.json").write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")

    if not args.keep_fp32:
        fp32_path.unlink(missing_ok=True)
        shutil.rmtree(args.output / "model-fp32.onnx.data", ignore_errors=True)

    print(f"\nDone: {int8_path} ({int8_path.stat().st_size / 1_048_576:.1f} MB)")
    print(f"SHA-256: {digest}")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(130)
