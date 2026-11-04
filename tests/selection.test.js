// node --test tests/selection.test.js
// Which timeline clips count as selected (premiere.js readTimeline) and what Exposure ±0.5 changes, with a fake Premiere: after Sync every cut lines up on
// all tracks, and a clip matched by its time alone also selected the clips above and below it (the user, 2026-11-04:
// Auto color on the POV on V1 went onto the switched-off POV on V2).
const test = require("node:test");
const assert = require("node:assert");
const Module = require("node:module");

const logged = [];
const fakePpro = {
  TickTime: {}, Constants: { ContentType: { MEDIA: 1 }, TrackItemType: { CLIP: 1 } },
  ClipProjectItem: { cast: (raw) => raw },
  SequenceEditor: { getEditor: () => ({}) },
};
const recorded = [];
const fakeEngine = { log: (level, msg) => logged.push(msg), managedCheck: async () => ({ owned: false }),
  managedRecord: async (key, snap, values) => recorded.push(values) };
const load = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "premierepro") return fakePpro;
  if (request === "./engine.js" && parent && /premiere(-color)?\.js$/.test(parent.filename)) return fakeEngine;
  return load.call(this, request, parent, isMain);
};
const P = require("../panel/premiere.js");
const PC = require("../panel/premiere-color.js");
Module._load = load;

// a track item as Premiere 26.0.2 hands it out; `video` items have the video transition action, audio ones do not
function item(kind, track, name, start, end, { selected = false, disabled = false, trackIndex = true } = {}) {
  const ti = {
    getStartTime: async () => ({ seconds: start }), getEndTime: async () => ({ seconds: end }),
    getInPoint: async () => ({ seconds: 0 }), getOutPoint: async () => ({ seconds: end - start }),
    getName: async () => name, getSpeed: async () => 1, isDisabled: async () => disabled, getIsSelected: async () => false,
    getProjectItem: async () => ({ name, getContentType: async () => 1, isOffline: async () => false, getMediaFilePath: async () => `/m/${name}` }),
  };
  if (trackIndex) ti.getTrackIndex = async () => track;
  if (kind === "video") ti.createAddVideoTransitionAction = () => ({});
  return { kind, track, ti, selected };
}

function project(parts) {
  const tracks = { video: [], audio: [] };
  for (const p of parts) (tracks[p.kind][p.track] = tracks[p.kind][p.track] || []).push(p.ti);
  const trackObj = (list) => ({ getTrackItems: async () => list || [], isMuted: async () => false });
  const sequence = {
    getVideoTrackCount: async () => tracks.video.length, getAudioTrackCount: async () => tracks.audio.length,
    getVideoTrack: async (i) => trackObj(tracks.video[i]), getAudioTrack: async (i) => trackObj(tracks.audio[i]),
    getSelection: async () => ({ getTrackItems: async () => parts.filter((p) => p.selected).map((p) => p.ti) }),
  };
  return { getActiveSequence: async () => sequence };
}

const chosen = async (parts) => (await P.readTimeline(project(parts))).items.filter((x) => x.selected).map((x) => `${x.kind[0]}${x.track + 1} ${x.name}`);

test("a clip on V1 selects only itself, not the clip with the same cut on V2", async () => {
  const parts = [item("video", 0, "fx31028.MP4", 0, 4.4, { selected: true }), item("video", 1, "C0728.MP4", 0, 4.4, { disabled: true }),
    item("audio", 0, "C0728 L.wav", 0, 4.4), item("audio", 1, "C0728 R.wav", 0, 4.4)];
  assert.deepStrictEqual(await chosen(parts), ["v1 fx31028.MP4"]);
});

test("an audio clip on A1 selects only itself, not the microphones on A2 and A3 cut at the same place", async () => {
  const parts = [item("audio", 0, "C0728 L.wav", 0, 4.4, { selected: true }), item("audio", 1, "C0728 L.wav", 0, 4.4),
    item("audio", 2, "C0728 R.wav", 0, 4.4)];
  assert.deepStrictEqual(await chosen(parts), ["a1 C0728 L.wav"]);
});

test("everything selected on purpose is still selected", async () => {
  const parts = [item("video", 0, "fx31028.MP4", 0, 4.4, { selected: true }), item("video", 1, "C0728.MP4", 0, 4.4, { selected: true }),
    item("video", 0, "fx31032.MP4", 4.4, 9, { selected: true })];
  assert.deepStrictEqual(await chosen(parts), ["v1 fx31028.MP4", "v1 fx31032.MP4", "v2 C0728.MP4"]);
});

test("without a track index (older Premiere) the clip is still found by its name and time, and the log says so", async () => {
  logged.length = 0;
  const parts = [item("video", 0, "fx31028.MP4", 0, 4.4, { selected: true, trackIndex: false }), item("video", 1, "C0728.MP4", 0, 4.4)];
  assert.deepStrictEqual(await chosen(parts), ["v1 fx31028.MP4"]);
  assert.ok(logged.some((m) => /selection: 1 in the list, 1 selected parts: V1 fx31028\.MP4 \[list, track unknown/.test(m)));
});

test("colour leaves a switched-off clip alone, and says so when it was the only one", async () => {
  const both = [item("video", 0, "fx31028.MP4", 0, 4.4, { selected: true }), item("video", 1, "C0728.MP4", 0, 4.4, { selected: true, disabled: true })];
  const sel = await PC.readVideoSelection(project(both));
  assert.deepStrictEqual(sel.clips.map((c) => c.name), ["fx31028.MP4"]);
  assert.deepStrictEqual(sel.off, ["C0728.MP4"]);
  const off = [item("video", 1, "C0728.MP4", 0, 4.4, { selected: true, disabled: true })];
  await assert.rejects(PC.readVideoSelection(project(off)), /C0728\.MP4 is switched off/);
});

// a Lumetri the editor set by hand (Exposure, Tint, Saturation), as in the user's MASTERHAUS screenshot of 2026-11-04
function lumetriClip(values, { keyframed = false } = {}) {
  const param = (displayName) => {
    const p = { displayName, v: values[displayName] ?? (displayName === "Saturation" ? 100 : 0),
      getStartValue: async () => ({ value: p.v }), isTimeVarying: async () => keyframed && displayName === "Exposure",
      createKeyframe: (v) => v, createSetValueAction: (v) => () => { p.v = v; } };
    return p;
  };
  const ps = ["Exposure", "Contrast", "Temperature", "Tint", "Saturation"].map(param);
  const comp = { getMatchName: async () => "AE.ADBE Lumetri", getParamCount: async () => ps.length, getParam: async (i) => ps[i] };
  const chain = { getComponentCount: async () => 1, getComponentAtIndex: async () => comp };
  const clip = { name: "fx31028.MP4", path: "/m/fx31028.MP4", inPt: 0, outPt: 4.4, ti: { getComponentChain: async () => chain } };
  return { clip, ps: Object.fromEntries(ps.map((p) => [p.displayName, p])) };
}
const runs = { lockedAccess: (f) => f(), executeTransaction: (build) => { build({ addAction: (a) => a() }); return true; } };

test("±0.5 moves only Exposure in the editor's own Lumetri and does not make it Asistent's", async () => {
  recorded.length = 0;
  const { clip, ps } = lumetriClip({ Exposure: 0.5, Tint: -1, Saturation: 111 });
  const r = await PC.nudgeExposure(runs, [clip], 0.5);
  assert.strictEqual(ps.Exposure.v, 1);
  assert.deepStrictEqual([ps.Tint.v, ps.Saturation.v, ps.Temperature.v], [-1, 111, 0]);
  assert.strictEqual(r.steps, 1);
  assert.match(r.results[0].line, /Exposure \+0\.5 → \+1 \(in your own Lumetri/);
  assert.deepStrictEqual(recorded, []);                                       // Auto color still never touches it
  await PC.nudgeExposure(runs, [clip], -0.5);
  await PC.nudgeExposure(runs, [clip], -0.5);
  assert.strictEqual(ps.Exposure.v, 0);
});

test("±0.5 leaves a keyframed Exposure in the editor's Lumetri alone", async () => {
  const { clip, ps } = lumetriClip({ Exposure: 0.5, Saturation: 111 }, { keyframed: true });
  const r = await PC.nudgeExposure(runs, [clip], 0.5);
  assert.strictEqual(ps.Exposure.v, 0.5);
  assert.ok(r.results[0].skipped && /keyframes/.test(r.results[0].line));
});

test("Auto color still refuses the editor's own Lumetri", async () => {
  const { clip } = lumetriClip({ Exposure: 0.5, Tint: -1, Saturation: 111 });
  assert.deepStrictEqual(await PC.lumetriState(clip), { lumetri: "manual", current: { exposure: 0.5, temperature: 0, tint: -1, contrast: 0, saturation: 111 } });
});
