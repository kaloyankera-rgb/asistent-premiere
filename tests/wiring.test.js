// node --test tests/wiring.test.js
// The panel has no DOM in tests, so the wiring is checked on the source: only the audio buttons may start
// Fix audio (0.9.9 and earlier ran it from the probe and the import buttons too).
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const panel = path.join(__dirname, "..", "panel");
const html = fs.readFileSync(path.join(panel, "index.html"), "utf8");
const main = fs.readFileSync(path.join(panel, "main.js"), "utf8");

function audioBlock() {
  const start = html.indexOf('<div class="card" id="secAudio">');
  const end = html.indexOf('<div class="card"', start + 1);
  assert.ok(start > 0 && end > start, "section AUDIO not found");
  return html.slice(start, end);
}

test("data-force only on buttons of the audio section", () => {
  const all = html.match(/<div[^>]*class="btn[^"]*"[^>]*data-force=/g) || [];
  const inAudio = audioBlock().match(/<div[^>]*class="btn[^"]*"[^>]*data-force=/g) || [];
  assert.ok(all.length > 0);
  assert.strictEqual(all.length, inAudio.length);
});

test("onAudio is bound only to the audio buttons", () => {
  const binds = main.split("\n").filter((l) => /querySelectorAll\(/.test(l) && /onAudio\(/.test(l));
  assert.strictEqual(binds.length, 1);
  assert.match(binds[0], /querySelectorAll\("\.btn\.small\[data-force\]"\)/);
});

test("the probe and import buttons have their own handlers", () => {
  for (const id of ["probe", "importToggle", "importFolder"]) {
    assert.match(html, new RegExp(`<div id="${id}" class="btn[^"]*"(?![^>]*data-force)`));
    assert.match(main, new RegExp(`onTap\\(\\$\\("${id}"\\)`));
  }
});

test("every press but Cancel goes through onTap (logged, ignored while the panel moves)", () => {
  const direct = main.split("\n").filter((l) => /addEventListener\("click"/.test(l));
  assert.deepStrictEqual(direct.map((l) => l.trim().slice(0, 40)), [
    'button.addEventListener("click", () => {',         // onTap: acts on the press, the click only when no press came
    '$("toast").addEventListener("click", () ',          // only hides the toast: not an action, nothing to log or guard
  ]);
});

test("the probe asks under its own button, not at the top of the panel", () => {
  const ask = main.slice(main.indexOf("function onProbeAsk"), main.indexOf("const STATE_BG"));
  assert.doesNotMatch(ask, /finish\(/);
  assert.match(ask, /insertBefore\(box, row\.nextSibling\)/);
});

test("every panel module that is required is packed into the .ccx", () => {
  const pack = fs.readFileSync(path.join(__dirname, "..", "scripts", "package_ccx.sh"), "utf8");
  const zipped = new Set((pack.match(/zip -q -r -X "\$OUT" ([^)]*)\)/) || ["", ""])[1].split(/\s+/));
  for (const f of fs.readdirSync(panel).filter((n) => n.endsWith(".js"))) {
    const src = fs.readFileSync(path.join(panel, f), "utf8");
    for (const m of src.matchAll(/require\("\.\/([^"]+)"\)/g)) assert.ok(zipped.has(m[1]), `${f} needs ${m[1]}, not packed`);
  }
});

test("the re-check after the step back is sent as final (C0739 12:58 regression)", () => {
  const color = fs.readFileSync(path.join(panel, "premiere-color.js"), "utf8");
  assert.match(color, /const chk2 = [^\n]*checkWithRetry\([^\n]*, true\)\)/);
  assert.match(fs.readFileSync(path.join(panel, "engine.js"), "utf8"), /"\/color\/check", \{[^}]*final/);
});

test("a white refine that would write the same sliders is skipped (fx39026 16:24 regression)", () => {
  const color = fs.readFileSync(path.join(panel, "premiere-color.js"), "utf8");
  assert.match(color, /Math\.abs\(temp - pl\.values\.temperature\) >= 0\.5 \|\| Math\.abs\(tint - pl\.values\.tint\) >= 0\.5/);
  assert.match(color, /pl\.lines\.push\(`result: \$\{finalLine\(chk\)\}`\)/);           // always one result line
  const main = fs.readFileSync(path.join(panel, "main.js"), "utf8");
  assert.doesNotMatch(main, /undo with Cmd\/Ctrl\+Z, press Auto color/);                   // ownership: no Undo needed
});

test("Shot Match writes only the components the engine changed, into new or Asistent-owned Lumetri", () => {
  const color = fs.readFileSync(path.join(panel, "premiere-color.js"), "utf8");
  const apply = color.slice(color.indexOf("async function applyShotMatch"), color.indexOf("const NAMES ="));
  assert.match(apply, /for \(const k of e\.r\.changed \|\| \[\]\) values\[k\] = e\.r\.proposal\[k\];/);
  assert.match(apply, /t = await target\(e\.clip\)/);                 // the manual-grade guard of Auto color
  assert.match(apply, /engine\.shotMatchCheck\(jobId, pl\.before, after/);   // checked on Premiere's frame
  assert.match(html, /<div id="shotmatch" class="btn small"[^>]*>Match POVs<\/div>/);
});

test("the subtitle section has its own buttons: no data-force, pressed through onTap, model download never automatic", () => {
  for (const id of ["subtitles", "subtitleDownload"]) {
    assert.match(html, new RegExp(`<div id="${id}" class="btn[^"]*"(?![^>]*data-force)`));
    assert.match(main, new RegExp(`onTap\\(\\$\\("${id}"\\)`));
  }
  // the 3 GB download is started only by onSubtitleDownload (the button names the size), never by onSubtitles
  assert.strictEqual((main.match(/engine\.downloadSubtitleModel\(\)/g) || []).length, 1);
  const download = main.slice(main.indexOf("async function onSubtitleDownload"), main.indexOf("// ---------------------------------------------------------------- colour"));
  assert.match(download, /engine\.downloadSubtitleModel\(\)/);
  assert.match(html, /Download the model \(about 3\.1 GB\)/);
});

test("the subtitle press ends with placing the captions; the only removal is Asistent's own earlier caption lines", () => {
  const fs = require("node:fs");
  const read = (f) => fs.readFileSync(`${__dirname}/../panel/${f}`, "utf8");
  const main = read("main.js");
  assert.match(main, /premiereCaptions\.place\(/);
  // the permanent rule: nothing removed or muted, except (0.9.97, the user's request, tested in NEW TEST) the lines of the caption
  // pair Asistent placed itself and nobody changed; the test bridge (test projects only) may probe it
  for (const f of fs.readdirSync(`${__dirname}/../panel`).filter((x) => x.endsWith(".js") && !["premiere-captions.js", "devbridge.js"].includes(x))) {
    assert.doesNotMatch(read(f), /createRemoveItemsAction|createRemoveItemAction|setMute|createSetDisabledAction/, `${f} must not remove or mute (permanent rule)`);
  }
  const cap = read("premiere-captions.js");
  assert.doesNotMatch(cap, /createRemoveItemAction|setMute|createSetDisabledAction/);
  assert.strictEqual(cap.match(/createRemoveItemsAction/g).length, 1);
  const rm = cap.slice(cap.indexOf("async function removeLines"), cap.indexOf("async function place("));
  assert.match(rm, /createRemoveItemsAction\(sel, false, ppro\.Constants\.MediaType\.ANY\)/);
  assert.match(rm, /getCaptionTrack\(i\)/);                                         // caption tracks only
  assert.strictEqual(cap.match(/await removeLines\(/g).length, 1);                    // one caller: place()
  const place = cap.slice(cap.indexOf("async function place("), cap.indexOf("async function placeGraphics("));
  assert.match(place, /const old = \[plan\.findOwn\(sig, now\), ownEnglish && plan\.findOwn\(sig\.english, now\)\]/);   // read again
  assert.ok(place.indexOf("removeLines(project") > place.indexOf("engine.recordCaptions("));          // after the new pair is in place
});

test("the corrections box exists, are saved before a run and sent with it", () => {
  const fs = require("node:fs");
  const html = fs.readFileSync(`${__dirname}/../panel/index.html`, "utf8");
  const main = fs.readFileSync(`${__dirname}/../panel/main.js`, "utf8");
  const sub = fs.readFileSync(`${__dirname}/../panel/premiere-subtitles.js`, "utf8");
  assert.doesNotMatch(html, /id="speaker"/);
  assert.match(html, /<textarea id="notes"/);
  assert.match(main, /saveSubtitleSettings\(project\.path\)/);
  assert.match(main, /readInput\(project, \[\], \$\("notes"\)\.value\)/);
  assert.match(sub, /text: notes/);
});

test("every button has a tooltip: in the HTML and every button made in code (2026-11-03)", () => {
  const buttons = html.match(/<div[^>]*class="btn[^"]*"[^>]*>/g) || [];
  assert.ok(buttons.length > 15);
  for (const b of buttons) assert.match(b, /data-tip="[^"]{8,}"/, `no tooltip: ${b}`);
  // buttons made in code go through button(cls, label, help, fn): an own button (div.btn) is made only inside it
  assert.strictEqual((main.match(/el\("div", `btn /g) || []).length, 1);
  assert.doesNotMatch(main, /el\("button"|createElement\("button"\)/);
  assert.match(main, /function button\(cls, label, help, fn\) \{\n  const b = el\("div", `btn \$\{cls\}`, label\);\n  b\.setAttribute\("data-tip", help\);/);
  for (const m of main.matchAll(/button\("small", [^,]+, "([^"]*)"/g)) assert.ok(m[1].length >= 8, m[0]);
});

test("the report and the pictures live in their own views; the main view keeps summary, decisions, links", () => {
  for (const id of ["paneTools", "paneLog", "panePreview", "details", "previews", "actions", "summary", "history"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  const tools = html.slice(html.indexOf('id="paneTools"'), html.indexOf('id="paneLog"'));
  assert.doesNotMatch(tools, /id="details"|id="previews"/);
  // pictures are made only for Before / after, never inside the report blocks
  assert.strictEqual((main.match(/createElement\("img"\)/g) || []).length, 1);
  assert.match(main.slice(main.indexOf("function previewBlock")), /^function previewBlock[\s\S]*?createElement\("img"\)/);
});

test("COLOR: the separate buttons run the same analysis and the same apply as Auto Color, only the part differs", () => {
  for (const id of ["color", "colorWhite", "colorExposure", "shotmatch", "probe"]) {
    assert.match(html, new RegExp(`<div id="${id}" class="btn`));
    assert.match(main, new RegExp(`onTap\\(\\$\\("${id}"\\)`));
  }
  assert.match(main, /onTap\(\$\("color"\), \(\) => onColor\(null\)\)/);
  assert.match(main, /onTap\(\$\("colorWhite"\), \(\) => onColor\("white"\)\)/);
  assert.match(main, /onTap\(\$\("colorExposure"\), \(\) => onColor\("exposure"\)\)/);
  // one analysis function, one apply function: a part only narrows the plans
  assert.strictEqual((main.match(/engine\.startColor\(/g) || []).length, 1);
  assert.strictEqual((main.match(/premiereColor\.apply\(/g) || []).length, 1);
  assert.match(main, /plansFor\(colorState\.sel\.clips, colorState\.results, level, colorState\.part\)/);
  // contrast and saturation have no single-clip algorithm: no button for them, they stay inside Match POVs
  assert.doesNotMatch(html, /id="color(Contrast|Saturation)"/);
});

test("ROUGH CUT: the source sequence is only read; the result is imported as a new sequence and checked", () => {
  const rough = fs.readFileSync(path.join(panel, "premiere-roughcut.js"), "utf8");
  assert.match(html, /<div id="rough" class="btn action" data-tip="[^"]+">Rough cut<\/div>/);
  assert.match(main, /onTap\(\$\("rough"\), onRoughCut\)/);
  assert.match(rough, /project\.importFiles\(\[result\.xml\]/);
  assert.match(rough, /verify\(result\.check, got\)/);
  assert.doesNotMatch(rough, /createRemove|removeItem|deleteSequence|createSetInPoint|createSetOutPoint|createOverwrite|createInsert/);
  assert.match(fs.readFileSync(path.join(__dirname, "..", "scripts", "package_ccx.sh"), "utf8"), /roughcutplan\.js premiere-roughcut\.js/);
});

test("SUBTITLES: the caption editor is a hidden tab that appears after a run; Apply goes through onTap and re-runs with a new track allowed", () => {
  const main = fs.readFileSync(path.join(__dirname, "..", "panel", "main.js"), "utf8");
  const html = fs.readFileSync(path.join(__dirname, "..", "panel", "index.html"), "utf8");
  assert.match(html, /<div id="tabCaptions" class="btn tab" data-tab="paneCaptions"[^>]*hidden>Captions<\/div>/);
  assert.match(html, /<div id="paneCaptions" class="pane" hidden>/);
  assert.match(main, /onTap\(\$\("captionApply"\), onCaptionApply\)/);
  assert.match(main, /onSubtitles\(\{ again: true \}\)/);
  assert.match(main, /renderCaptionEditor\(result\)/);
});

test("SUBTITLES: the panel puts a caption track (restyled all at once in Properties, the user 2026-11-04); the graphics way stays tested code", () => {
  const cap = fs.readFileSync(path.join(panel, "premiere-captions.js"), "utf8");
  const host = fs.readFileSync(path.join(__dirname, "..", "host", "host.jsx"), "utf8");
  const place = cap.slice(cap.indexOf("async function place("), cap.indexOf("async function placeGraphics("));
  assert.match(place, /engine\.placeCaptions\(/);
  assert.doesNotMatch(place, /placeGraphics/);
  assert.match(cap, /async function placeGraphics\([\s\S]*engine\.placeGraphics\(/);
  assert.match(host, /if \(name === "graphics"\) return as_graphics/);
  assert.doesNotMatch(host.slice(host.indexOf("function as_graphics"), host.indexOf("function as_run")), /\.remove\(|removeItem|deleteSequence/);
});

test("Exposure −0.5 / +0.5 add a fixed step; in a hand-set Lumetri only Exposure moves and it stays the editor's (0.10.1)", () => {
  const color = fs.readFileSync(path.join(panel, "premiere-color.js"), "utf8");
  assert.match(html, /id="exposureDown"[^>]*class="btn small"/);
  assert.match(html, /id="exposureUp"[^>]*class="btn small"/);
  // pressed several times in a row: act on the mouse going down (a click after Premiere took the focus never arrives)
  assert.match(main, /onTap\(\$\("exposureDown"\), \(\) => onExposureNudge\(-0\.5\), \{ repeat: true \}\)/);
  assert.match(main, /onTap\(\$\("exposureUp"\), \(\) => onExposureNudge\(0\.5\), \{ repeat: true \}\)/);
  const press = main.slice(main.indexOf("function onTap"), main.indexOf("function show("));
  assert.match(press, /\["pointerdown", "mousedown"\]/);
  assert.match(press, /if \(Date\.now\(\) - downAt < 1000\) return;/);
  const fn = color.slice(color.indexOf("async function nudgeExposure"), color.indexOf("// ---------------------------------------------------------------- render check"));
  assert.match(fn, /t = await target\(clip, \{ manual: true \}\)/);   // also the editor's own Lumetri (the user, 2026-11-04)
  assert.match(fn, /if \(t\.skip\)/);
  assert.match(fn, /if \(!pl\.t\.manual\) await remember\(pl\);/);     // Asistent's own: recorded; the editor's grade: never
  assert.equal((color.match(/target\([^)]*manual: true/g) || []).length, 1);  // only ±0.5 may touch a hand grade
  assert.match(fn, /\(pl\.t\.current\.exposure \|\| 0\) \+ delta/);
});

test("Exposure ±0.5 never greys the panel and queues a press that comes during a write", () => {
  const fn = main.slice(main.indexOf("async function onExposureNudge"), main.indexOf("// one JSON record per clip and press"));
  assert.doesNotMatch(fn, /setBusy\(/);
  assert.match(fn, /state\.nudgeQueued = \(state\.nudgeQueued \|\| 0\) \+ delta/);
  assert.match(fn, /step = state\.nudgeQueued \|\| 0/);
});

test("every answer also shows as a toast under the header, which never moves the buttons", () => {
  const css = fs.readFileSync(path.join(panel, "style.css"), "utf8");
  assert.match(html, /<div id="toast" class="toast" hidden><\/div>/);
  assert.match(css, /\.toast \{ position: absolute;/);
  const fin = main.slice(main.indexOf("function finish("), main.indexOf("function finish(") + 200);
  assert.match(fin, /toast\(opts\.toast \|\| text, ok\);/);
});

test("every button acts once per press, whichever events Premiere delivers (onTap)", async () => {
  const src = main.slice(main.indexOf("function onTap"), main.indexOf("function show("));
  const logs = [];
  const engine = { log: (lvl, m) => logs.push(m) };
  const state = { settleUntil: 0 };
  const onTap = new Function("engine", "state", `${src}; return onTap;`)(engine, state);
  const mk = () => { const b = new EventTarget(); b.textContent = "Log"; b.disabled = false; return b; };
  const fire = (b, ...kinds) => kinds.forEach((k) => b.dispatchEvent(new Event(k)));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  let n = 0;
  const b = mk();
  onTap(b, () => n++);
  fire(b, "pointerdown", "mousedown", "click");          // a normal press
  assert.strictEqual(n, 1);
  await sleep(100);
  fire(b, "mousedown");                                  // only the press arrives (the click was lost to Premiere's focus)
  assert.strictEqual(n, 2);
  await sleep(1100);
  fire(b, "click");                                      // only the click arrives (the test bridge's b.click())
  assert.strictEqual(n, 3);
  b.disabled = true;
  await sleep(100);
  fire(b, "pointerdown", "click");
  assert.strictEqual(n, 3);

  // the "panel just changed" guard: a normal button waits it out, a { repeat: true } one does not
  let m = 0;
  const r = mk();
  const c = mk();
  onTap(r, () => m++, { repeat: true });
  onTap(c, () => m++);
  state.settleUntil = Date.now() + 500;
  fire(r, "pointerdown", "click");
  fire(c, "pointerdown", "click");
  assert.strictEqual(m, 1);
  assert.ok(logs.some((l) => l.startsWith("panel: click ignored")));
});

test("the Exposure toast says in plain words what was added or removed", () => {
  const fn = main.slice(main.indexOf("async function onExposureNudge"), main.indexOf("// one JSON record per clip and press"));
  assert.match(fn, /exposure added/);
  assert.match(fn, /exposure removed/);
  assert.match(fn, /\{ toast: short \}/);
  const css = fs.readFileSync(path.join(panel, "style.css"), "utf8");
  assert.match(css, /\.toast \{[^}]*background-color: var\(--ok-bg\)/);   // a coloured face: a one-sided border did not show in Premiere
});

test("the Captions tab shows the English line under its Bulgarian line, and typed English goes with every run", () => {
  const ed = main.slice(main.indexOf("function renderCaptionEditor"), main.indexOf("async function onCaptionApply"));
  assert.match(ed, /if \(c\.en !== undefined\)/);
  assert.match(ed, /el\("div", "capline en"\)/);
  const apply = main.slice(main.indexOf("async function onCaptionApply"), main.indexOf("async function onSubtitles"));
  assert.match(apply, /saveEnglishFixed\(project\.path, map\)/);
  assert.match(main, /payload\.english_fixed = englishFixed\(project\.path\);/);
  assert.match(main, /payload\.project = project\.path;/);                       // the client's learning folder is found from it
});

test("a tooltip that would land on a text box goes above its button (native controls are drawn over it)", () => {
  const tip = main.slice(main.indexOf("function overNative"), main.indexOf("function bindTips"));
  assert.match(tip, /querySelectorAll\("input, textarea, select"\)/);
  assert.match(tip, /overNative\(x, y, w, h\)\) y = Math\.max\(6, r\.top - h - 4\)/);
});

test("the Captions tab says who speaks on each track and lists the learned fixes, collapsed, with remove for everyone", () => {
  const eng = fs.readFileSync(path.join(panel, "engine.js"), "utf8");
  assert.match(html, /id="speakerRow"/);
  assert.match(html, /id="learnedHead"[^>]*hidden/);                              // nothing shows before a run
  assert.match(html, /id="learnedList" hidden/);
  assert.match(eng, /call\("POST", "\/subtitles\/speakers", \{ project, speakers \}\)/);
  assert.match(eng, /call\("POST", "\/subtitles\/learned", \{ project, key, action \}\)/);
  const sp = main.slice(main.indexOf("function renderSpeakers"), main.indexOf("const learnedView"));
  assert.match(sp, /engine\.saveSpeakers\(projectPath, map\)/);
  assert.match(sp, /captionEdit\.speakersChanged = true/);
  const ln = main.slice(main.indexOf("function renderLearned"), main.indexOf("async function loadLearned"));
  assert.match(ln, /engine\.setLearned\(learnedView\.path, x\.key, x\.removed \? "restore" : "remove"\)/);
  assert.match(ln, /show\("learnedList", learnedView\.open\)/);
  assert.match(main, /const learnedView = \{ open: false/);                        // collapsed until clicked
  const apply = main.slice(main.indexOf("async function onCaptionApply"), main.indexOf("async function onSubtitles"));
  assert.match(apply, /!captionEdit\.speakersChanged/);                           // a speaker change alone is enough to rebuild
  assert.match(main, /renderSpeakers\(result, project\.path\);\n {4}loadLearned\(project\.path\);/);
});

test("the Captions tab has a search over the Bulgarian and English lines that hides, never drops, the other lines", () => {
  assert.match(html, /<input id="captionSearch"/);
  const f = main.slice(main.indexOf("function filterCaptions"), main.indexOf("// Who speaks on which microphone track"));
  assert.match(f, /input\.value\.toLowerCase\(\)\.includes\(q\)/);
  assert.match(f, /en\.value\.toLowerCase\(\)\.includes\(q\)/);
  assert.match(f, /input\.parentNode\.hidden = !hit/);
  // 0.9.98: nothing changes while typing (Premiere took the keyboard back when most lines vanished at the third letter)
  assert.doesNotMatch(main, /\$\("captionSearch"\)\.addEventListener\("input"/);
  assert.match(main, /\$\("captionSearch"\)\.addEventListener\("keydown", \(e\) => \{\s*if \(e\.key === "Enter"\) runSearch\(\);/);
  assert.match(main, /onTap\(\$\("captionFind"\), runSearch\)/);
  assert.match(f, /const q = search\.applied;/);
  const ed = main.slice(main.indexOf("function renderCaptionEditor"), main.indexOf("function filterCaptions"));
  assert.match(ed, /filterCaptions\(\);/);                                         // a rebuild keeps the search
});

test("the words changed in an English line are kept per project, undone when typed back, and sent with every run", () => {
  const apply = main.slice(main.indexOf("async function onCaptionApply"), main.indexOf("async function onSubtitles"));
  assert.match(apply, /captionedit\.pairsFor\(en\.getAttribute\("data-original"\), en\.value\)/);
  assert.match(apply, /delete words\[p\.said\.toLowerCase\(\)\]/);
  assert.match(apply, /saveEnglishWords\(project\.path, words\)/);
  assert.match(main, /payload\.english_words = englishWords\(project\.path\);/);
});

test("a colour press and Match POVs apply at once, with Before / after, no approval step (the user, 2026-11-04)", () => {
  const col = main.slice(main.indexOf("async function onColor("), main.indexOf("async function onExposureNudge"));
  assert.match(col, /const plans = colorPlans\("all"\);/);
  assert.ok(col.indexOf("await applyColor(plans") > col.indexOf("await runJob(job)"));
  assert.match(col, /finish\(out\.text, out\.ok, \[\.\.\.out\.blocks, \.\.\.blocks\], \{ previews \}\)/);
  assert.doesNotMatch(main, /Only a proposal|Apply the sure ones|Apply the match/);
  const shot = main.slice(main.indexOf("async function onShotMatch("), main.indexOf("function shotLine"));
  assert.match(shot, /const out = await applyShotMatch\(\);/);
  assert.match(shot, /onShotMatch\(cam\)/);                                   // another reference: matched again
});

