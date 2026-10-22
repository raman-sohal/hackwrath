# Sign model

This directory contains the on-device ASL fingerspelling classifier used by
EchoClass.

| File | Purpose |
|---|---|
| `model.onnx` | int8 ONNX export of `prithivMLmods/Alphabet-Sign-Language-Detection` (82.6 MB) |
| `labels.json` | 26 output labels, `A`–`Z` |
| `model.json` | Source revision, preprocessing, quantization and SHA-256 provenance |

- Source: <https://huggingface.co/prithivMLmods/Alphabet-Sign-Language-Detection>
- Revision: `84e5004b2603413b02d673faa30874fee132384a`
- Base architecture: `google/siglip2-base-patch16-224` (`SiglipForImageClassification`)
- Licence: Apache-2.0 (model card)
- Input: 224×224 RGB, NCHW float32, `(pixel / 127.5) - 1`
- Output: 26 logits, softmaxed in the app
- SHA-256: `22efbe5e390bbbca1f3c6be528a7d8e583a7740abed1613c5187a1d32d6a2045`

## Regenerate

The original repository ships PyTorch safetensors only. Convert it once:

```bash
python3 -m venv build/sign-venv
build/sign-venv/bin/pip install torch transformers onnx onnxruntime pillow
build/sign-venv/bin/python scripts/convert-sign-model.py
```

The converter downloads the pinned revision, exports ONNX (opset 17), applies
dynamic int8 weight quantization, validates ONNX vs PyTorch, and writes the
three files above. It needs network access **at conversion time only**.

`model.onnx` is generated and therefore gitignored. The app never downloads a
model at runtime; packaging copies this directory into `Resources/models/sign`.

## Scope

This is a **static fingerspelling A–Z classifier** trained on single images. It
does not understand motion, ASL grammar, facial expression, or continuous
signing. It can confuse similar hand shapes. The UI states this explicitly and
requires the user to confirm the built word before adding it to a transcript.
