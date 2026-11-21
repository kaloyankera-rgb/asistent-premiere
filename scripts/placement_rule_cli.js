#!/usr/bin/env node
// Dev only: a tiny JSON command line over panel/placementplan.js, so scripts/placement_replay.py runs the very same rule code
// that the panel runs. Reads one JSON object from stdin, writes one JSON result to stdout.
//   {op: "moments", graphics, zoomTimes, cap}                  -> momentsPerLine
//   {op: "chins", frameSets: [[[faces per frame]]]}            -> shotChin of each frame set (null: no face)
//   {op: "planLanes", graphics, shots, perLine, lane, frame, opts} -> planLanes (perLine: {graphic id: [{t, faces, text, own}]})
//   {op: "plan", graphics, shots, facesPerShot, frame}         -> plan() (ReShape's own rule, for comparisons)
const path = require("node:path");
const P = require(path.join(__dirname, "..", "panel", "placementplan.js"));

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => { raw += c; });
process.stdin.on("end", () => {
  const q = JSON.parse(raw);
  let out;
  if (q.op === "moments") out = P.momentsPerLine(q.graphics, q.zoomTimes || [], q.cap === undefined ? 240 : q.cap);
  else if (q.op === "chins") out = q.frameSets.map((fs) => P.shotChin(fs));
  else if (q.op === "planLanes") out = P.planLanes(q.graphics, q.shots, q.perLine || {}, q.lane, q.frame || 1 / 30, q.opts || {});
  else if (q.op === "plan") out = P.plan(q.graphics, q.shots, q.facesPerShot, undefined, q.frame || 1 / 30);
  else throw new Error("unknown op " + q.op);
  process.stdout.write(JSON.stringify(out));
});
