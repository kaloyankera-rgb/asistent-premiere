// Timeline labels (TODO I7, 0.10.34): which name each track gets.
const test = require("node:test");
const assert = require("node:assert");
const T = require("../panel/tracknames.js");

const cam = (folder, n) => Array.from({ length: n }, (_, i) => `/shoot/${folder}/C${100 + i}.MP4`);
const A = cam("kam1", 3);
const B = cam("kam2", 3);
const lav = ["/shoot/zoom/ZOOM0001.WAV", "/shoot/zoom/ZOOM0002.WAV"];

function sync() {                           // what Sync builds: one camera per video track, their sound and the lav
  return {
    video: [{ index: 0, name: "Video 1", paths: A }, { index: 1, name: "Video 2", paths: B }, { index: 2, name: "Video 3", paths: [] }],
    audio: [{ index: 0, name: "Audio 1", paths: lav }, { index: 1, name: "Audio 2", paths: A }, { index: 2, name: "Audio 3", paths: B }],
    caption: [{ index: 0, name: "Subtitle" }, { index: 1, name: "Subtitle" }],
  };
}

test("a SYNC sequence: POV 1 / POV 2 by track order, their sound, the lav as Mic 1, Asistent's captions", () => {
  const p = T.plan(sync(), { bg: 0, en: 1 });
  assert.deepStrictEqual(p.renames.map((r) => `${r.kind}${r.index + 1} ${r.to}`),
    ["video1 POV 1", "video2 POV 2", "audio1 Mic 1", "audio2 POV 1 audio", "audio3 POV 2 audio", "caption1 Subtitles BG", "caption2 Subtitles EN"]);
  assert.deepStrictEqual(p.cameras.map((c) => [c.pov, c.index]), [[1, 0], [2, 1]]);
  assert.strictEqual(p.kept.length, 0);
});

test("the editor's own names stay; Asistent's earlier names are renumbered", () => {
  const t = sync();
  t.video[0].name = "Wide";
  t.video[1].name = "POV 7";
  t.audio[0].name = "Lav Ivan";
  const p = T.plan(t, {});
  assert.deepStrictEqual(p.renames.map((r) => `${r.from} → ${r.to}`), ["POV 7 → POV 2", "Audio 2 → POV 1 audio", "Audio 3 → POV 2 audio"]);
  assert.deepStrictEqual(p.kept.map((k) => k.name), ["Wide", "Lav Ivan"]);
  assert.match(T.describe(p).join("\n"), /"Wide" kept: named by the editor \(would be POV 1\)/);
});

test("B-roll from several folders and graphics are not cameras; their sound is not a microphone", () => {
  const broll = ["/a/x.mp4", "/b/y.mp4"];
  const t = {
    video: [{ index: 0, name: "Video 1", paths: A }, { index: 1, name: "Video 2", paths: broll }, { index: 2, name: "Video 3", paths: [] }],
    audio: [{ index: 0, name: "Audio 1", paths: A }, { index: 1, name: "Audio 2", paths: [broll[0]] }],
    caption: [],
  };
  const p = T.plan(t, {});
  assert.deepStrictEqual(p.renames.map((r) => r.to), ["POV 1", "POV 1 audio"]);
  assert.deepStrictEqual(p.kept.map((k) => `${k.kind}${k.index + 1}`), ["video2", "audio2"]);
});

test("a single-folder video track without its sound anywhere (B-roll) is not a camera", () => {
  const t = { video: [{ index: 0, name: "Video 1", paths: A }, { index: 1, name: "Video 2", paths: cam("drone", 2) }],
    audio: [{ index: 0, name: "Audio 1", paths: A }], caption: [] };
  assert.deepStrictEqual(T.plan(t, {}).renames.map((r) => r.to), ["POV 1", "POV 1 audio"]);
});

test("one camera's sound on two tracks (the L/R split), mixed audio kept, captions only Asistent's own", () => {
  const t = sync();
  t.audio.push({ index: 3, name: "Audio 4", paths: [A[0]] });
  t.audio.push({ index: 4, name: "Audio 5", paths: [A[0], B[0]] });
  const p = T.plan(t, { bg: 1 });
  assert.ok(p.renames.some((r) => r.index === 3 && r.to === "POV 1 audio 2"));
  assert.ok(p.kept.some((k) => k.index === 4 && /several/.test(k.why)));
  assert.deepStrictEqual(p.renames.filter((r) => r.kind === "caption").map((r) => [r.index, r.to]), [[1, "Subtitles BG"]]);
});

test("a second press changes nothing; Put names back restores only names still as Asistent left them", () => {
  const t = sync();
  const p = T.plan(t, { bg: 0 });
  for (const r of p.renames) t[r.kind].find((x) => x.index === r.index).name = r.to;
  assert.strictEqual(T.plan(t, { bg: 0 }).renames.length, 0);
  t.video[1].name = "Close";                                  // the editor renamed POV 2 since
  const back = T.restore(p.renames, t);
  assert.ok(!back.some((r) => r.kind === "video" && r.index === 1));
  assert.ok(back.some((r) => r.kind === "video" && r.index === 0 && r.to === "Video 1"));
  assert.ok(back.some((r) => r.kind === "caption" && r.to === "Subtitle"));
});

test("Premiere's 16 label colours", () => {
  assert.strictEqual(T.COLORS.length, 16);
  assert.strictEqual(T.COLORS[1], "Iris");
});

test("NEW TEST's SYNC – кам2 (2026-11-10): a stray file on the camera track, Fix audio's L/R copies as new files", () => {
  const k2 = cam("кам2", 12);
  const k1 = cam("кам1", 14);
  const splitL = (ps) => ps.map((p) => p.replace(".MP4", " L.wav"));
  const t = {
    video: [{ index: 0, name: "Video 1", paths: [...k2, "/render/b809237b/x.mov"] }, { index: 1, name: "Video 2", paths: k1 },
      { index: 4, name: "Asistent subtitles", paths: [] }],
    audio: [{ index: 0, name: "Audio 1", paths: [k2[3], ...splitL([k2[3], k2[3]])] },
      { index: 1, name: "Audio 2", paths: [...splitL(k1), ...k2.slice(0, 2)] },
      { index: 2, name: "Audio 3", paths: k1.map((p) => p.replace(".MP4", " R.wav")) }],
    caption: [],
  };
  const p = T.plan(t, {});
  assert.deepStrictEqual(p.renames.map((r) => `${r.kind}${r.index + 1} ${r.to}`),
    ["video1 POV 1", "video2 POV 2", "audio1 POV 1 audio", "audio2 POV 2 audio", "audio3 POV 2 audio 2"]);
});

test("two cameras in one folder (BUG-011): their own files decide, the folder alone does not", () => {
  const both = cam("dcim", 6);
  const t = { video: [{ index: 0, name: "Video 1", paths: both.slice(0, 3) }, { index: 1, name: "Video 2", paths: both.slice(3) }],
    audio: [{ index: 0, name: "Audio 1", paths: both.slice(0, 3) }, { index: 1, name: "Audio 2", paths: both.slice(3) },
      { index: 2, name: "Audio 3", paths: ["/x/dcim/other.wav"] }], caption: [] };
  const p = T.plan(t, {});
  assert.deepStrictEqual(p.renames.map((r) => r.to), ["POV 1", "POV 2", "POV 1 audio", "POV 2 audio", "Mic 1"]);
});
