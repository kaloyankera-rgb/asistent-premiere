// Screenshots of every preview scenario at the panel's real widths (development only).
//   node shoot.js <label>              -> shots/<label>/<scenario>-<width>.png
//   node shoot.js <label> --compare A  -> also writes shots/compare-A-<label>.html and says which images differ
// Uses the Chrome installed on this computer (playwright-core, no browser download).
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright-core");

const ROOT = path.resolve(__dirname, "..");                 // tools/asistent: /panel and /preview are served from here
const SCENARIOS = ["idle", "offline", "busy", "done", "error", "log", "color", "beforeafter", "captions", "search", "learned", "open", "update", "nudge"];
const WIDTHS = [240, 300, 420];
const HEIGHT = Number(process.env.HEIGHT) || 760;
const NOISE = 250;                                           // run-to-run anti-aliasing differs by up to ~150 pixels                                          // tall enough to see most of the Tools view at once
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".json": "application/json" };

function serve() {
  const server = http.createServer((req, res) => {
    const file = path.join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, { "Content-Type": `${TYPES[path.extname(file)] || "application/octet-stream"}; charset=utf-8` });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r(server)));
}

async function main() {
  const label = process.argv[2] || "now";
  const ci = process.argv.indexOf("--compare");
  const against = ci > 0 ? process.argv[ci + 1] : null;
  const out = path.join(__dirname, "shots", label);
  fs.mkdirSync(out, { recursive: true });
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}/preview/index.html`;
  const browser = await chromium.launch({ channel: "chrome" });
  const errors = [];
  for (const w of WIDTHS) {
    const page = await browser.newPage({ viewport: { width: w, height: HEIGHT }, deviceScaleFactor: 2 });
    page.on("pageerror", (e) => errors.push(`${w}px: ${e.message}`));
    for (const s of SCENARIOS) {
      await page.goto(`${base}?s=${s}`);
      await page.waitForSelector("html[data-ready='1']", { timeout: 5000 });
      await page.waitForTimeout(250);
      await page.screenshot({ path: path.join(out, `${s}-${w}.png`) });
    }
    await page.close();
  }
  console.log(`${SCENARIOS.length * WIDTHS.length} shots in ${path.relative(process.cwd(), out) || out}`);
  if (errors.length) console.log(`page errors:\n  ${[...new Set(errors)].join("\n  ")}`);
  if (against) await compare(browser, against, label);
  await browser.close();
  server.close();
}

// pixels that differ between two PNGs (decoded by Chrome) and the box around them
async function pixelDiff(browser, fileA, fileB) {
  const page = await browser.newPage();
  const url = (f) => `data:image/png;base64,${fs.readFileSync(f).toString("base64")}`;
  const r = await page.evaluate(async ([a, b]) => {
    const load = (src) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.src = src; });
    const [ia, ib] = await Promise.all([load(a), load(b)]);
    if (ia.width !== ib.width || ia.height !== ib.height) return { pixels: -1 };
    const px = (img) => { const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
      const g = c.getContext("2d"); g.drawImage(img, 0, 0); return g.getImageData(0, 0, c.width, c.height).data; };
    const da = px(ia);
    const db = px(ib);
    let n = 0;
    let top = Infinity;
    let bottom = -1;
    for (let i = 0; i < da.length; i += 4) {
      if (da[i] !== db[i] || da[i + 1] !== db[i + 1] || da[i + 2] !== db[i + 2]) {
        n++;
        const y = Math.floor(i / 4 / ia.width);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    }
    return { pixels: n, rows: n ? [top / 2, bottom / 2] : null };       // shots are 2x: rows in CSS pixels
  }, [url(fileA), url(fileB)]);
  await page.close();
  return r;
}

// which images changed against an earlier label, and a side-by-side page to look at them
async function compare(browser, a, b) {
  const dirA = path.join(__dirname, "shots", a);
  const dirB = path.join(__dirname, "shots", b);
  const rows = [];
  let changed = 0;
  for (const s of SCENARIOS) {
    for (const w of WIDTHS) {
      const f = `${s}-${w}.png`;
      const d = fs.existsSync(path.join(dirA, f)) ? await pixelDiff(browser, path.join(dirA, f), path.join(dirB, f)) : { pixels: -1 };
      const same = d.pixels >= 0 && d.pixels <= NOISE;
      if (!same) {
        changed++;
        console.log(`  ${f}: ${d.pixels < 0 ? "size differs" : `${d.pixels} pixels, rows ${d.rows[0]}-${d.rows[1]}`}`);
      }
      rows.push(`<tr><td>${s} ${w}px${same ? "" : " <b>changed</b>"}</td><td><img src="${a}/${f}"></td><td><img src="${b}/${f}"></td></tr>`);
    }
  }
  const html = `<!DOCTYPE html><meta charset="utf-8"><title>${a} vs ${b}</title><style>body{background:#111;color:#ddd;font:12px sans-serif}` +
    `img{width:${Math.max(...WIDTHS)}px;vertical-align:top}td{padding:6px;vertical-align:top}</style>` +
    `<table><tr><th></th><th>${a}</th><th>${b}</th></tr>${rows.join("")}</table>`;
  fs.writeFileSync(path.join(__dirname, "shots", `compare-${a}-${b}.html`), html);
  console.log(`${changed} of ${rows.length} images differ from "${a}"; page: shots/compare-${a}-${b}.html`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
