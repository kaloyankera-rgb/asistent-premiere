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
    'button.addEventListener("click", () => {',
    '$("cancel").addEventListener("click", ()',
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

test("the subtitle press ends with placing the captions, and the panel never removes or mutes anything", () => {
  const fs = require("node:fs");
  const read = (f) => fs.readFileSync(`${__dirname}/../panel/${f}`, "utf8");
  const main = read("main.js");
  assert.match(main, /premiereCaptions\.place\(/);
  for (const f of ["premiere-captions.js", "captionplan.js", "premiere-subtitles.js", "main.js"]) {
    const src = read(f);
    assert.doesNotMatch(src, /createRemoveItemsAction|createRemoveItemAction|setMute|createSetDisabledAction/, `${f} must not remove or mute (permanent rule)`);
  }
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
  assert.match(fs.readFileSync(path.join(__dirname, "..", "panel", "premiere-captions.js"), "utf8"), /own && !opts\.again/);
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
