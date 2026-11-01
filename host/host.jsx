// Asistent host: the ExtendScript (ES3) side. main.js evaluates this file for every command and calls as_run(name, args).
// Every function answers with a JSON string {ok, msg, ...}; nothing here throws out of as_run.

var AS_HOST_VERSION = "0.9.45";

function as_json(v) {
    if (v === null || v === undefined) return "null";
    var t = typeof v;
    if (t === "number") return isFinite(v) ? String(v) : "null";
    if (t === "boolean") return v ? "true" : "false";
    if (t === "string") {
        var s = '"';
        for (var i = 0; i < v.length; i++) {
            var c = v.charAt(i), code = v.charCodeAt(i);
            if (c === '"') s += '\\"';
            else if (c === "\\") s += "\\\\";
            else if (c === "\n") s += "\\n";
            else if (c === "\r") s += "\\r";
            else if (c === "\t") s += "\\t";
            else if (code < 32) s += "\\u" + ("0000" + code.toString(16)).slice(-4);
            else s += c;
        }
        return s + '"';
    }
    if (v instanceof Array) {
        var a = [];
        for (var j = 0; j < v.length; j++) a.push(as_json(v[j]));
        return "[" + a.join(",") + "]";
    }
    var o = [];
    for (var k in v) if (v.hasOwnProperty(k)) o.push(as_json(k) + ":" + as_json(v[k]));
    return "{" + o.join(",") + "}";
}

function as_result(ok, msg, extra) {
    var r = extra || {};
    r.ok = ok;
    r.msg = msg;
    return as_json(r);
}

// names of the properties/methods an ExtendScript object reports (for finding what this Premiere offers)
function as_names(o) {
    var out = [];
    try {
        var p = o.reflect.properties, m = o.reflect.methods, i;
        for (i = 0; i < p.length; i++) out.push(String(p[i].name));
        for (i = 0; i < m.length; i++) out.push(String(m[i].name) + "()");
    } catch (e) {
        try { for (var k in o) out.push(String(k)); } catch (e2) { out.push("unreadable: " + e2); }
    }
    return out;
}

function as_norm(p) {
    return String(p || "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function as_find_bin(name, create) {
    var root = app.project.rootItem, i;
    for (i = 0; i < root.children.numItems; i++) {
        var c = root.children[i];
        if (c.type === ProjectItemType.BIN && c.name === name) return c;
    }
    return create ? root.createBin(name) : null;
}

function as_find_item(bin, path) {
    var want = as_norm(path), i;
    for (i = 0; i < bin.children.numItems; i++) {
        var c = bin.children[i], mp = "";
        try { mp = c.getMediaPath(); } catch (e) { mp = ""; }
        if (as_norm(mp) === want) return c;
    }
    return null;
}

function as_caption_tracks(seq) {
    try {
        if (seq.captionTracks) return seq.captionTracks.numTracks;
    } catch (e) { /* not in this build */ }
    return -1;
}

function as_ping() {
    var info = { host: AS_HOST_VERSION, premiere: String(app.version) };
    try { info.project = app.project ? app.project.name : null; } catch (e) { info.project = null; }
    try {
        var seq = app.project.activeSequence;
        info.sequence = seq ? seq.name : null;
        info.createCaptionTrack = seq ? typeof seq.createCaptionTrack : "no sequence";
        info.captionTracks = seq ? as_caption_tracks(seq) : null;
    } catch (e2) { info.sequence = null; }
    return as_result(true, "ok", info);
}

// what the caption API of this Premiere looks like (for the first run on a new version)
function as_probe() {
    var r = { premiere: String(app.version) };
    var seq = app.project.activeSequence;
    r.sequence = seq ? as_names(seq) : null;
    try { r.Sequence = as_names(Sequence); } catch (e) { r.Sequence = "none"; }
    try { r.ProjectItem = as_names(app.project.rootItem); } catch (e2) { r.ProjectItem = "none"; }
    try { r.captionTracks = seq && seq.captionTracks ? as_names(seq.captionTracks) : "none"; } catch (e3) { r.captionTracks = "none"; }
    try { app.enableQE(); var q = qe.project.getActiveSequence(); r.qeSequence = q ? as_names(q) : "none"; } catch (e4) { r.qeSequence = "none: " + e4; }
    return as_result(true, "ok", r);
}

// the caption format for an SRT: the constant this Premiere calls "subtitle"
function as_caption_format() {
    var names = ["CAPTION_FORMAT_SUBTITLE", "CAPTION_FORMAT_OPEN_EBU_SUBTITLE", "CAPTION_FORMAT_708"];
    for (var i = 0; i < names.length; i++) {
        try { if (Sequence[names[i]] !== undefined) return { name: names[i], value: Sequence[names[i]] }; } catch (e) { /* next */ }
    }
    return null;
}

// args: {srt, sequence, project, bin}. Imports the SRT into the bin and puts it on a new caption track at 0 (the
// times in the file are sequence times). The panel has already removed what an earlier press placed.
function as_captions(a) {
    if (!app.project) return as_result(false, "Няма отворен проект.");
    var seq = app.project.activeSequence;
    if (!seq) return as_result(false, "Няма активна секвенция.");
    if (a.sequence && seq.name !== a.sequence) {
        return as_result(false, "Активната секвенция е „" + seq.name + "“, а субтитрите са за „" + a.sequence + "“. Върни се на нея и опитай пак.");
    }
    if (a.project && as_norm(app.project.path) !== as_norm(a.project)) {
        return as_result(false, "Отворен е друг проект. Нищо не е пипано.");
    }
    var f = new File(a.srt);
    if (!f.exists) return as_result(false, "Файлът със субтитрите липсва: " + a.srt);
    if (seq.createCaptionTrack === undefined) {
        return as_result(false, "Тази версия на Premiere няма създаване на caption писта през скрипт.", { premiere: String(app.version) });
    }
    var bin = as_find_bin(a.bin || "Субтитри", true);
    var before = as_caption_tracks(seq);
    var item = as_find_item(bin, a.srt);
    var imported = false;
    if (!item) {
        imported = app.project.importFiles([a.srt], true, bin, false);
        item = as_find_item(bin, a.srt);
    }
    if (!item) return as_result(false, "Premiere не внесе файла със субтитрите.", { imported: imported });
    var fmt = as_caption_format();
    var made;
    try {
        made = fmt ? seq.createCaptionTrack(item, 0, fmt.value) : seq.createCaptionTrack(item, 0);
    } catch (e) {
        return as_result(false, "Premiere не създаде caption пистата: " + e, { format: fmt ? fmt.name : null });
    }
    var after = as_caption_tracks(seq);
    return as_result(true, "ok", { imported: imported, item: item.name, format: fmt ? fmt.name : null, returned: String(made),
        tracks_before: before, tracks_after: after });
}

// test bridge only (the engine forwards it only with devbridge.enabled; refused outside TEST.prproj)
function as_eval(a) {
    if (!app.project || String(app.project.name) !== "TEST.prproj") return as_result(false, "eval само в TEST.prproj.");
    var out = eval(String(a.code));
    return as_result(true, "ok", { value: (out === undefined ? null : (typeof out === "object" ? as_json(out) : String(out))) });
}

function as_run(name, args) {
    try {
        if (name === "ping") return as_ping();
        if (name === "probe") return as_probe();
        if (name === "captions") return as_captions(args || {});
        if (name === "eval") return as_eval(args || {});
        return as_result(false, "Непозната команда: " + name);
    } catch (e) {
        return as_result(false, "ExtendScript: " + e.toString() + (e.line ? " (ред " + e.line + ")" : ""));
    }
}
