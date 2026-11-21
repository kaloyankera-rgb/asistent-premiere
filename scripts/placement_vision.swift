// Dev only (scripts/measure_style.py placement): what Apple Vision sees in still frames besides text: faces, hands, human
// rectangles and objectness-based salient objects. Boxes only, numbers only, nothing leaves the computer.
// usage: placement-vision <image> [<image> ...]  ->  one JSON object per image on its own line:
//   {"faces": [[x,y,w,h]], "hands": [[x,y,w,h,mean joint confidence,joints seen]], "humans": [[x,y,w,h]], "salient": [[x,y,w,h]]}   (fractions, top-left origin)
import Foundation
import Vision
import AppKit

func box(_ b: CGRect) -> [Double] { [Double(b.minX), Double(1.0 - b.maxY), Double(b.width), Double(b.height)] }

func look(_ path: String) -> [String: Any] {
    var out: [String: Any] = ["faces": [[Double]](), "hands": [[Double]](), "humans": [[Double]](), "salient": [[Double]]()]
    guard let img = NSImage(contentsOfFile: path),
          let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else { return out }
    let faceReq = VNDetectFaceRectanglesRequest()
    let handReq = VNDetectHumanHandPoseRequest()
    handReq.maximumHandCount = 4
    let humanReq = VNDetectHumanRectanglesRequest()
    humanReq.upperBodyOnly = false
    let salReq = VNGenerateObjectnessBasedSaliencyImageRequest()
    let handler = VNImageRequestHandler(cgImage: cg, options: [:])
    try? handler.perform([faceReq, handReq, humanReq, salReq])
    out["faces"] = (faceReq.results ?? []).map { box($0.boundingBox) }
    var hands: [[Double]] = []
    for h in handReq.results ?? [] {
        guard let pts = try? h.recognizedPoints(.all) else { continue }
        let good = pts.values.filter { $0.confidence > 0.3 }
        if good.count < 5 { continue }
        let xs = good.map { Double($0.location.x) }, ys = good.map { Double($0.location.y) }
        let x0 = xs.min()!, x1 = xs.max()!, y0 = ys.min()!, y1 = ys.max()!
        let conf = good.map { Double($0.confidence) }.reduce(0, +) / Double(good.count)
        hands.append([x0, 1.0 - y1, x1 - x0, y1 - y0, conf, Double(good.count)])    // box, mean joint confidence, joints seen (of 21)
    }
    out["hands"] = hands
    out["humans"] = (humanReq.results ?? []).map { box($0.boundingBox) }
    if let s = salReq.results?.first as? VNSaliencyImageObservation {
        out["salient"] = (s.salientObjects ?? []).map { box($0.boundingBox) }
    }
    return out
}

for path in CommandLine.arguments.dropFirst() {
    let data = try! JSONSerialization.data(withJSONObject: look(path), options: [])
    print(String(data: data, encoding: .utf8)!)
}
