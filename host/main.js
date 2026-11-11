// Asistent host: the invisible CEP side. It long-polls the engine (127.0.0.1:47390, header X-Asistent) for commands,
// runs the matching function of host.jsx inside Premiere (ExtendScript) and posts the answer back. It listens on no
// port of its own. Commands: ping, probe, captions (and eval, which the engine only forwards in the test bridge).
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");

const VERSION = "0.10.45";
// 0.10.45: this Premiere's major version, said with every poll: the engine gives this host only the commands of panels in
// the same Premiere (two versions may run side by side). Read once at start (loop below).
let LANE = "";
const ENGINE = { host: "127.0.0.1", port: 47390 };
const LOG = path.join(os.homedir(), process.platform === "darwin" ? "Library/Application Support/Asistent" : "AppData/Local/Asistent", "logs", "host.log");

// CEP gives the extension folder as file:///Users/... (Mac) or file:///C:/... (Windows)
function extensionRoot() {
  const raw = decodeURI(window.__adobe_cep__.getSystemPath("extension"));
  return path.normalize(raw.replace(/^file:\/\//, "").replace(/^\/(?=[A-Za-z]:)/, ""));
}

function log(msg) {
  try {
    fs.mkdirSync(path.dirname(LOG), { recursive: true });
    fs.appendFileSync(LOG, new Date().toISOString() + " " + msg + "\n");
  } catch (e) { /* the log is a convenience */ }
}

function call(method, url, body, timeout) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : Buffer.from(JSON.stringify(body), "utf8");
    const req = http.request({ ...ENGINE, method, path: url, timeout: timeout || 30000,
      headers: Object.assign({ "X-Asistent": "1", "X-Asistent-Host": VERSION, "X-Asistent-Lane": LANE }, data ? { "Content-Type": "application/json", "Content-Length": data.length } : {}) }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); } catch (e) { reject(e); }
      });
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

// the JSON of the arguments is a valid ExtendScript expression; U+2028/2029 are the only characters ES3 would reject
function literal(v) {
  return JSON.stringify(v === undefined ? {} : v).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

function evalHost(code) {
  return new Promise((resolve) => window.__adobe_cep__.evalScript(code, resolve));
}

// host.jsx is evaluated again for every command, so a changed file takes effect without restarting Premiere
async function run(cmd) {
  const jsx = extensionRoot() + path.sep + "host.jsx";
  const code = `$.evalFile(${JSON.stringify(jsx)}); as_run(${JSON.stringify(String(cmd.name))}, ${literal(cmd.args)})`;
  const raw = await evalHost(code);
  try {
    return JSON.parse(raw);
  } catch (e) {
    return { ok: false, msg: "Premiere returned no readable answer: " + String(raw).slice(0, 300) };
  }
}

async function loop() {
  try { LANE = String(await evalHost("app.version") || "").split(".")[0].replace(/[^0-9]/g, ""); } catch (e) { LANE = ""; }
  log("host " + VERSION + " started (lane " + (LANE || "none") + ")");
  for (;;) {
    let pause = 0;
    try {
      const cmd = await call("GET", "/host/poll?wait=20", undefined, 30000);
      if (cmd && cmd.id) {
        log("command " + cmd.id + " " + cmd.name);
        let res;
        try { res = await run(cmd); } catch (e) { res = { ok: false, msg: String((e && e.message) || e) }; }
        log("result " + cmd.id + " ok=" + res.ok);
        await call("POST", "/host/result", { id: cmd.id, ok: !!res.ok, data: res }, 30000);
      }
    } catch (e) {
      pause = 5000;                                  // engine away or restarting: look again in a few seconds
    }
    if (pause) await new Promise((r) => setTimeout(r, pause));
  }
}

loop();
