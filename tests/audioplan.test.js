// node --test tests/audioplan.test.js
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { sideOf, forceFor, engineJobs, routeFor, levelTargets, routeLine, limiterState, dynValue, LIMITER_DB } = require("../panel/audioplan.js");

const out = (route, gain) => ({ route, gain_db: gain, lufs: -30, result_lufs: -17, result_peak_db: -8 });

test("Asistent's side clips are recognised by name, the original file is not", () => {
  assert.strictEqual(sideOf("C0738 L 3.84-13.28"), "L");
  assert.strictEqual(sideOf("C0738 R 3.84-13.28"), "R");
  assert.strictEqual(sideOf("C0738.MP4"), null);
  assert.strictEqual(sideOf("Interview L"), null);
});

test("what the engine is asked: every stereo clip split, a clip that is already one side keeps it", () => {
  assert.strictEqual(forceFor({}, null), "split_all");                // the one main button
  assert.strictEqual(forceFor({}, "phrases"), "split_all");
  assert.strictEqual(forceFor({}, "split"), "split_all");
  assert.strictEqual(forceFor({}, "split_rl"), "split_all");
  assert.strictEqual(forceFor({}, "none"), "none");
  assert.strictEqual(forceFor({}, "use_right"), "use_right");
  assert.strictEqual(forceFor({ side: "R" }, null), "use_right");      // second press: no new copies
  assert.strictEqual(forceFor({ route: "LL" }, "split"), "use_left");  // a Fill effect from before stays
});

test("routing follows the engine's answer; refused splits and level-only clips are not routed", () => {
  assert.strictEqual(routeFor({}, { action: "split" }, null), "split");
  assert.strictEqual(routeFor({}, { action: "split" }, "split_rl"), "split_rl");
  assert.strictEqual(routeFor({}, { action: "use_left" }, null), "use_left");   // sound only in L: no empty R track
  assert.strictEqual(routeFor({}, { action: "none" }, null), null);             // identical channels: left as is
  assert.strictEqual(routeFor({}, { action: "ask" }, null), null);
  assert.strictEqual(routeFor({ side: "L" }, { action: "use_left" }, null), null);
  assert.strictEqual(routeFor({ route: "RR" }, { action: "use_right" }, null), null);
  assert.strictEqual(routeFor({}, { error: "x" }, null), null);
});

test("levels go to the clips where the host put the sides", () => {
  const split = { it: { name: "C0738.MP4", track: 0, start: 34.9 }, res: { action: "split", outputs: [out("LL", 3), out("RR", 5)] },
    routed: { ok: true, status: "done", upperSide: "L", lowerSide: "R", upper: { track: 0, start: 34.9 }, lower: { track: 2, start: 34.9 } } };
  const rl = { it: { name: "b", track: 1, start: 50 }, res: { action: "split", outputs: [out("LL", 1), out("RR", 2)] },
    routed: { ok: true, status: "done", upperSide: "R", lowerSide: "L", upper: { track: 1, start: 50 }, lower: { track: 2, start: 50 } } };
  const lone = { it: { name: "c", track: 0, start: 60 }, res: { action: "use_right", outputs: [out("RR", 4)] },
    routed: { ok: true, status: "done", upperSide: "R", lowerSide: null, upper: { track: 0, start: 60 }, lower: null } };
  const asis = { it: { name: "d", track: 0, start: 70 }, res: { action: "none", outputs: [out("as_is", -2)] }, routed: null };
  const again = { it: { name: "C0738 R 3.84-13.28", side: "R", track: 2, start: 34.9 }, res: { action: "use_right", outputs: [out("RR", 5)] }, routed: null };
  const failed = { it: { name: "e", track: 0, start: 80 }, res: { action: "split", outputs: [out("LL", 1), out("RR", 1)] }, routed: { ok: false, msg: "no free track" } };
  const ask = { it: { name: "f", track: 0, start: 90 }, res: { action: "ask", outputs: [] }, routed: null };
  const t = levelTargets([split, rl, lone, asis, again, failed, ask]);
  assert.deepStrictEqual(t.map((x) => [x.track, x.start, x.out.route, x.out.gain_db]), [
    [0, 34.9, "LL", 3], [2, 34.9, "RR", 5],
    [1, 50, "RR", 2], [2, 50, "LL", 1],
    [0, 60, "RR", 4],
    [0, 70, "as_is", -2],
    [2, 34.9, "RR", 5],
  ]);
});

test("the report says where each side went and whether it is linked", () => {
  assert.match(routeLine({ ok: true, status: "done", upperSide: "L", lowerSide: "R", upper: { track: 0 }, lower: { track: 1 }, linked: true }),
    /L\/L on A1, R\/R on A2 .*linked to the picture/);
  assert.match(routeLine({ ok: true, status: "done", upperSide: "L", lowerSide: "R", upper: { track: 0 }, lower: { track: 1 }, linked: false, relinked: 1 }),
    /NOT linked/);
  assert.match(routeLine({ ok: false, msg: "no free audio track below A1" }), /^Not split: no free/);
  assert.strictEqual(routeLine(null), null);
});

test("no Fill effect is ever added any more (user, 2026-11-03), and nothing is removed or muted by the panel", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "panel", "premiere-audio.js"), "utf8");
  assert.doesNotMatch(src, /RE\.fill|RE\.swap|createCloneTrackItemAction|createEffect\("(Fill|Swap)/);                  // no routing effects
  assert.deepStrictEqual([...src.matchAll(/createEffect\("([^"]+)"/g)].map((m) => m[1]), ["Dynamics"]);   // the only effect it adds
  assert.doesNotMatch(src, /createRemoveItemsAction|setMute|createSetDisabledAction/);
  const host = fs.readFileSync(path.join(__dirname, "..", "host", "host.jsx"), "utf8");
  const route = host.slice(host.indexOf("function as_route_one"), host.indexOf("function as_audio_route"));
  assert.doesNotMatch(route, /\.remove\(|setMute|Fill/);
  assert.match(route, /overwriteClip\(low, at\)[\s\S]*overwriteClip\(up, at\)/);   // the lower side first
  assert.match(host, /createSubClip\(name, c\.inPoint\.ticks, c\.outPoint\.ticks, 0, 0, 1\)/);   // audio only
});

test("both sides of a split clip are measured as one pair, so a second press sets the same levels", () => {
  const L = { path: "/m/C0731.MP4", start: 11.8785, end: 19.2859, inPt: 6.373, outPt: 13.78, side: "L" };
  const R = { ...L, side: "R" };
  const other = { path: "/m/C0733.MP4", start: 23.7, end: 31.5, inPt: 1.7, outPt: 9.5 };
  const lone = { ...L, path: "/m/C0738.MP4", side: "R" };
  const { jobs, index } = engineJobs([L, R, other, lone], null);
  assert.deepStrictEqual(jobs.map((j) => [j.path, j.force]), [["/m/C0731.MP4", "split_all"], ["/m/C0733.MP4", "split_all"], ["/m/C0738.MP4", "use_right"]]);
  assert.deepStrictEqual(index, [0, 0, 1, 2]);
  // and the pair's two outputs go to the two sides
  const res = { action: "split", outputs: [out("LL", -4.0), out("RR", -4.8)] };
  const t = levelTargets([{ it: { ...L, track: 0, name: "C0731 L 6.37-13.78" }, res, routed: null },
    { it: { ...R, track: 1, name: "C0731 R 6.37-13.78" }, res, routed: null }]);
  assert.deepStrictEqual(t.map((x) => [x.track, x.out.route, x.out.gain_db]), [[0, "LL", -4.0], [1, "RR", -4.8]]);
});

test("an older Fill-effect split pair is measured as a pair too, and never split again", () => {
  const LL = { path: "/m/C0733.MP4", start: 23.7, end: 31.5, inPt: 1.7, outPt: 9.5, route: "LL" };
  const RR = { ...LL, route: "RR" };
  const { jobs, index } = engineJobs([LL, RR], null);
  assert.deepStrictEqual(jobs.map((j) => j.force), ["split_all"]);
  assert.deepStrictEqual(index, [0, 0]);
  assert.strictEqual(routeFor(LL, { action: "split" }, null), null);
});

test("host.jsx starts with a UTF-8 BOM: $.evalFile reads a file without one as Mac Roman (Cyrillic came out garbled)", () => {
  const buf = fs.readFileSync(path.join(__dirname, "..", "host", "host.jsx"));
  assert.deepStrictEqual([...buf.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
});

test("Dynamics' limiter: -6 dB is 0.9 in its normalised scale (the default -1 dB is 0.98333)", () => {
  assert.strictEqual(LIMITER_DB, -6);
  assert.ok(Math.abs(dynValue(-6) - 0.9) < 1e-12);
  assert.ok(Math.abs(dynValue(-1) - 0.9833333) < 1e-6);
});

test("what happens to Dynamics already on a clip: reused, never doubled, somebody else's settings left alone", () => {
  const dflt = { "AutoGate Enabled": 0, "Compressor Enabled": 0, "Expander Enabled": 0, "Limiter Enabled": 0, "Limiter Threshold": 0.98333 };
  assert.deepStrictEqual(limiterState([]), { state: "add" });
  assert.deepStrictEqual(limiterState([{ params: dflt }]), { state: "configure" });            // untouched Dynamics: only the limiter
  assert.deepStrictEqual(limiterState([{ params: { ...dflt, "Limiter Enabled": 1, "Limiter Threshold": 0.9 } }]), { state: "ok" });   // second press
  assert.strictEqual(limiterState([{ params: { ...dflt, "Limiter Enabled": 1, "Limiter Threshold": 0.95 } }]).state, "foreign");
  assert.match(limiterState([{ params: { ...dflt, "Limiter Enabled": 1, "Limiter Threshold": 0.95 } }]).why, /-3\.0 dB/);
  assert.strictEqual(limiterState([{ params: { ...dflt, "Compressor Enabled": 1 } }]).state, "foreign");
  assert.strictEqual(limiterState([{ params: dflt }, { params: dflt }]).state, "foreign");
});

test("the limiter is switched on with a read-back, in the clip's single Dynamics", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "panel", "premiere-audio.js"), "utf8");
  assert.match(src, /"Limiter Enabled"\]\.createKeyframe\(1\)/);
  assert.match(src, /"Limiter Threshold"\]\.createKeyframe\(dynValue\(LIMITER_DB\)\)/);
  assert.match(src, /const st = back \? limiterState\(\[\{ params: back\.values \}\]\)/);       // verified after the write
});
