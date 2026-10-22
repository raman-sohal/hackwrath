// Test-fixture generator, not shipped with the app.
// Converts the first Y4M frame from the fake-camera fixture into a short
// H.264 MP4 so the video-import E2E test has a real local file to decode.
//
// Usage: swift scripts/make-test-video.swift build/sign-a.y4m build/sign-a.mp4

import AVFoundation
import CoreVideo
import Foundation

let args = CommandLine.arguments
guard args.count == 3 else {
  fputs("usage: make-test-video.swift <input.y4m> <output.mp4>\n", stderr)
  exit(2)
}

let inputURL = URL(fileURLWithPath: args[1])
let outputURL = URL(fileURLWithPath: args[2])
let data = try Data(contentsOf: inputURL)
var offset = 0

func readLine() -> String? {
  guard let newline = data[offset...].firstIndex(of: 0x0A) else { return nil }
  let line = String(data: data[offset..<newline], encoding: .utf8)
  offset = newline + 1
  return line
}

guard let header = readLine() else {
  fputs("missing Y4M header\n", stderr)
  exit(1)
}

var width = 0
var height = 0
var fps = 30
for part in header.split(separator: " ") {
  if part.hasPrefix("W") { width = Int(part.dropFirst()) ?? 0 }
  if part.hasPrefix("H") { height = Int(part.dropFirst()) ?? 0 }
  if part.hasPrefix("F") {
    let value = part.dropFirst().split(separator: ":").first ?? "30"
    fps = Int(value) ?? 30
  }
}
guard width > 0, height > 0, width % 2 == 0, height % 2 == 0 else {
  fputs("unsupported Y4M dimensions\n", stderr)
  exit(1)
}

let frameMarker = Data("FRAME\n".utf8)
guard let markerRange = data.range(of: frameMarker, in: offset..<data.count) else {
  fputs("no Y4M frame found\n", stderr)
  exit(1)
}
offset = markerRange.upperBound

let ySize = width * height
let chromaSize = (width / 2) * (height / 2)
guard offset + ySize + chromaSize * 2 <= data.count else {
  fputs("truncated Y4M frame\n", stderr)
  exit(1)
}

let yPlane = [UInt8](data[offset..<(offset + ySize)])
offset += ySize
let uPlane = [UInt8](data[offset..<(offset + chromaSize)])
offset += chromaSize
let vPlane = [UInt8](data[offset..<(offset + chromaSize)])

try? FileManager.default.removeItem(at: outputURL)
let writer = try AVAssetWriter(outputURL: outputURL, fileType: .mp4)
let settings: [String: Any] = [
  AVVideoCodecKey: AVVideoCodecType.h264,
  AVVideoWidthKey: width,
  AVVideoHeightKey: height,
  AVVideoCompressionPropertiesKey: [
    AVVideoAverageBitRateKey: 900_000,
    AVVideoProfileLevelKey: AVVideoProfileLevelH264MainAutoLevel
  ]
]
let input = AVAssetWriterInput(mediaType: .video, outputSettings: settings)
input.expectsMediaDataInRealTime = false
let adaptor = AVAssetWriterInputPixelBufferAdaptor(
  assetWriterInput: input,
  sourcePixelBufferAttributes: [
    kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
    kCVPixelBufferWidthKey as String: width,
    kCVPixelBufferHeightKey as String: height
  ]
)
guard writer.canAdd(input) else {
  fputs("cannot add video input\n", stderr)
  exit(1)
}
writer.add(input)
guard writer.startWriting() else {
  fputs("could not start writer: \(writer.error?.localizedDescription ?? "unknown")\n", stderr)
  exit(1)
}
writer.startSession(atSourceTime: .zero)

let chromaWidth = width / 2
func clamp(_ value: Double) -> UInt8 { UInt8(max(0, min(255, value))) }

// Hold the same hand frame for two seconds (60 frames at 30 fps).
let frameCount = max(1, fps * 2)
for frameIndex in 0..<frameCount {
  while !input.isReadyForMoreMediaData { usleep(1000) }
  guard let pool = adaptor.pixelBufferPool else {
    fputs("no pixel buffer pool\n", stderr)
    exit(1)
  }
  var buffer: CVPixelBuffer?
  CVPixelBufferPoolCreatePixelBuffer(nil, pool, &buffer)
  guard let pixelBuffer = buffer else {
    fputs("could not allocate pixel buffer\n", stderr)
    exit(1)
  }
  CVPixelBufferLockBaseAddress(pixelBuffer, [])
  let base = CVPixelBufferGetBaseAddress(pixelBuffer)!.assumingMemoryBound(to: UInt8.self)
  let stride = CVPixelBufferGetBytesPerRow(pixelBuffer)
  for y in 0..<height {
    for x in 0..<width {
      let luma = Double(yPlane[y * width + x])
      let u = Double(uPlane[(y / 2) * chromaWidth + (x / 2)]) - 128
      let v = Double(vPlane[(y / 2) * chromaWidth + (x / 2)]) - 128
      let r = clamp(luma + 1.402 * v)
      let g = clamp(luma - 0.344136 * u - 0.714136 * v)
      let b = clamp(luma + 1.772 * u)
      let target = base + y * stride + x * 4
      target[0] = b
      target[1] = g
      target[2] = r
      target[3] = 255
    }
  }
  CVPixelBufferUnlockBaseAddress(pixelBuffer, [])
  let time = CMTime(value: Int64(frameIndex), timescale: CMTimeScale(fps))
  guard adaptor.append(pixelBuffer, withPresentationTime: time) else {
    fputs("could not append frame\n", stderr)
    exit(1)
  }
}

input.markAsFinished()
let semaphore = DispatchSemaphore(value: 0)
writer.finishWriting { semaphore.signal() }
semaphore.wait()
guard writer.status == .completed else {
  fputs("writer failed: \(writer.error?.localizedDescription ?? "unknown")\n", stderr)
  exit(1)
}
print("wrote \(outputURL.path) (\(width)x\(height), \(frameCount) frames, \(fps) fps)")
