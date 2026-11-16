// Cut silences (0.10.96): the options the engine gets, the preview's columns, a part turned around, what the preview says.
const test = require("node:test");
const assert = require("node:assert");
const SP = require("../panel/silenceplan.js");

const base = { mode: "offmic", method: "auto", db: "-30", pacing: "measured", minSilence: "0.87", minSpeech: "0.15", before: "0.15", after: "0.22",
  sensitivity: "3", short: false, shortMin: "0.25", shortMax: "0.5", fillers: false, range: "selection", action: "remove" };

test("the options are read as the engine wants them, and a wrong number is said before anything runs", () => {
  const o = SP.readOptions(base).opts;
  assert.deepStrictEqual(o, { mode: "offmic", method: "auto", pacing: "measured", sensitivity: 3, short: false, fillers: false, action: "remove",
    range: "selection", threshold: null });
  assert.strictEqual(SP.readOptions({ ...base, mode: "ai" }).opts.method, "ai");                  // takes need the words
  assert.strictEqual(SP.readOptions({ ...base, fillers: true }).opts.fillers, false);            // no words, no hesitation sounds
  assert.strictEqual(SP.readOptions({ ...base, method: "ai", fillers: true }).opts.fillers, true);
  const m = SP.readOptions({ ...base, method: "manual", db: " -27,5 " }).opts;
  assert.strictEqual(m.threshold, -27.5);
  assert.match(SP.readOptions({ ...base, method: "manual", db: "" }).error, /Type a number for the dB threshold/);
  assert.match(SP.readOptions({ ...base, method: "manual", db: "-5" }).error, /between -80 and -10/);
  const c = SP.readOptions({ ...base, pacing: "custom", minSilence: "0.4", minSpeech: "0.2", before: "0.05", after: "0.1" }).opts;
  assert.deepStrictEqual([c.min_silence, c.min_speech, c.before, c.after], [0.4, 0.2, 0.05, 0.1]);
  assert.match(SP.readOptions({ ...base, pacing: "custom", minSilence: "abc" }).error, /minimum silence/);
  const s = SP.readOptions({ ...base, short: true }).opts;
  assert.deepStrictEqual([s.short, s.short_min, s.short_max], [true, 0.25, 0.5]);
  assert.match(SP.readOptions({ ...base, short: true, shortMin: "0.6", shortMax: "0.3" }).error, /smaller one/);
  // the numbers of the presets are the engine's (silence.PACING)
  const fs = require("fs");
  const py = fs.readFileSync(require("path").join(__dirname, "..", "engine", "asistent", "silence.py"), "utf8");
  for (const [name, p] of Object.entries(SP.PACING)) {
    const m2 = new RegExp(`"${name}": \\{"min_silence": ([\\d.]+), "min_speech": ([\\d.]+), "before": ([\\d.]+), "after": ([\\d.]+), "short": (True|False)\\}`).exec(py);
    assert.ok(m2, name);
    assert.deepStrictEqual([Number(m2[1]), Number(m2[2]), Number(m2[3]), Number(m2[4]), m2[5] === "True"], [p.min_silence, p.min_speech, p.before, p.after, p.short]);
  }
});

test("the payload carries the options, the editor's choices and the tracks; the range stays in the panel", () => {
  const o = SP.readOptions({ ...base, method: "manual", db: "-28", short: true, range: "inout", action: "mute" }).opts;
  const p = SP.payloadOptions(o, { preview: true, overrides: [{ start: 1, end: 2, cut: false }], listen: [0] });
  assert.deepStrictEqual(p, { mode: "offmic", method: "manual", threshold: -28, pacing: "measured", sensitivity: 3, short: true, fillers: false,
    action: "mute", short_min: 0.25, short_max: 0.5, overrides: [{ start: 1, end: 2, cut: false }], listen: [0], preview: true });
  assert.ok(!("range" in p) && !("preview" in SP.payloadOptions(o)) && !("overrides" in SP.payloadOptions(o, { overrides: [] })));
  const a = { layout: [{ kind: "video", track: 0, path: "/a", start: 0, end: 10 }], items: [{ track: 0, path: "/a", at: 0 }] };
  assert.strictEqual(SP.signature(a), SP.signature(JSON.parse(JSON.stringify(a))));
  assert.notStrictEqual(SP.signature(a), SP.signature({ ...a, layout: [{ ...a.layout[0], end: 11 }] }));
});

const result = { t_start: 10, t_end: 70, before_s: 60, action: "remove", method: "auto", env: { hop: 0.05, db: Array.from({ length: 1200 }, (_, i) => (i < 400 ? -20 : i < 800 ? -45 : -70)) },
  regions: [{ start: 30, end: 50, kind: "offmic", cut: true, flag: false, text: "a voice 12 dB under the main voice" },
    { start: 50, end: 68, kind: "silence", cut: true, flag: false, text: "silence" },
    { start: 68.2, end: 69.5, kind: "offmic", cut: false, flag: true, text: "a voice 7 dB under the main voice: kept, not sure" }],
  speech: { listened: [{ name: "lav.wav", track: 1, floor: -63, main: -22.3, open: -46 }] }, suggest_db: -30, tracks: [0, 1] };

test("the waveform: columns of the view, coloured by the part that fills them; zoom and scroll stay inside the recording", () => {
  const v = SP.view(result, 1, undefined);
  assert.deepStrictEqual([v.from, v.to, v.zoom], [10, 70, 1]);
  const cols = SP.columns(result, result.regions, v, 60);                                        // one column per second
  assert.strictEqual(cols.length, 60);
  assert.deepStrictEqual([cols[0].kind, cols[0].region, cols[0].cut], ["keep", -1, false]);
  assert.deepStrictEqual([cols[25].kind, cols[25].region, cols[25].cut], ["offmic", 0, true]);
  assert.deepStrictEqual([cols[45].kind, cols[45].region], ["silence", 1]);
  assert.deepStrictEqual([cols[58].kind, cols[58].flag, cols[58].cut], ["offmic", true, false]);   // 68.2-69.5 fills most of 68-69
  assert.ok(cols[0].h > cols[25].h && cols[25].h > cols[45].h && cols[45].h >= 0.03);             // the level is the bar's height
  const z = SP.zoomed(result, v, 2, 68);                                                          // around the part just touched
  assert.deepStrictEqual([z.zoom, z.from, z.to], [2, 40, 70]);                                    // clamped at the end
  assert.strictEqual(SP.zoomed(result, v, 0.5).zoom, 1);                                          // never wider than everything
  const left = SP.scrolled(result, z, -1);
  assert.deepStrictEqual([left.from, left.to], [25, 55]);
  assert.strictEqual(SP.scrolled(result, left, -5).from, 10);
  // a part that fills less than a third of a column leaves it as kept (zoom in to see it)
  const tiny = [{ start: 20, end: 20.2, kind: "short", cut: true, flag: false }];
  assert.strictEqual(SP.columns(result, tiny, v, 60)[10].kind, "keep");
  assert.strictEqual(SP.columns(result, tiny, SP.view(result, 32, 19.5), 60)[17].kind, "short");
});

test("a part turned around is the editor's choice: it goes to the engine, and the preview's numbers follow", () => {
  let regions = result.regions.map((r) => ({ ...r }));
  assert.deepStrictEqual(SP.overridesOf(regions), []);
  const t0 = SP.totals(regions);
  assert.deepStrictEqual([t0.cut, t0.count, t0.flagged, t0.restored], [38, 2, 1, 0]);
  regions = SP.toggled(regions, 0);                                                               // keep the off-mic part
  regions = SP.toggled(regions, 2);                                                               // cut the one that was not sure
  assert.deepStrictEqual(SP.overridesOf(regions), [{ start: 30, end: 50, cut: false }, { start: 68.2, end: 69.5, cut: true }]);
  const t1 = SP.totals(regions);
  assert.strictEqual(t1.count, 2);
  assert.ok(Math.abs(t1.cut - 19.3) < 1e-9 && t1.flagged === 0 && t1.restored === 1);
  assert.strictEqual(result.regions[0].cut, true);                                               // the engine's plan is not changed in place
  const lines = SP.describePreview(result, regions).map((l) => l.text).join("\n");
  assert.match(lines, /1:00 → 0:40 \(−32 %\): 2 parts go, 19\.3 s\./);
  assert.match(lines, /silence 18\.0 s · off-mic voice 1\.3 s/);
  assert.match(lines, /1 kept by you/);
  const before = SP.describePreview(result, result.regions).map((l) => l.text).join("\n");
  assert.match(before, /1 part is not sure and kept \(yellow\): tap one to cut it\./);
  assert.match(SP.describePreview({ ...result, action: "mute" }, result.regions)[0].text, /2 parts, 38\.0 s \(63 %\): sound muted, timing unchanged\./);
  assert.strictEqual(SP.describeRegion(regions[0]), "0:30–0:50 (20 s) · a voice 12 dB under the main voice · stays (your choice)");
  assert.match(SP.micLines(result)[0].text, /^A2 lav\.wav: noise -63 dB, main voice -22\.3 dB, speech from -46 dB\.$/);
  assert.match(SP.describePreview({ ...result, method: "ai", speech: { asr: false, note: "No speech model on this computer." } }, [])[1].text, /No speech model/);
});
