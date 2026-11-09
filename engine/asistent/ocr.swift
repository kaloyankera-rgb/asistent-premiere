// Asistent: text lines in still images with the Mac's own text recognition (Vision), for Move off faces: where a subtitle
// graphic's text really is on screen (Premiere does not tell a script, docs/NATIVE_GRAPHICS.md). Local only.
// usage: asistent-ocr <image> [<image> ...]  ->  one JSON array per image on its own line:
//   [{"text": "...", "x": 0.1, "y": 0.7, "w": 0.8, "h": 0.04, "confidence": 0.9}]  (fractions, top-left origin)
import Foundation
import Vision
import AppKit

func lines(_ path: String) -> [[String: Any]] {
    guard let img = NSImage(contentsOfFile: path),
          let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else { return [] }
    let req = VNRecognizeTextRequest()
    req.recognitionLevel = .accurate
    req.usesLanguageCorrection = false
    req.recognitionLanguages = ["bg-BG", "ru-RU", "en-US"]
    let handler = VNImageRequestHandler(cgImage: cg, options: [:])
    try? handler.perform([req])
    var out: [[String: Any]] = []
    for obs in req.results ?? [] {
        guard let best = obs.topCandidates(1).first else { continue }
        let b = obs.boundingBox                                    // normalized, origin bottom-left
        out.append(["text": best.string, "x": b.minX, "y": 1.0 - b.maxY, "w": b.width, "h": b.height,
                    "confidence": Double(best.confidence)])
    }
    return out
}

for path in CommandLine.arguments.dropFirst() {
    let data = try! JSONSerialization.data(withJSONObject: lines(path), options: [])
    print(String(data: data, encoding: .utf8)!)
}
