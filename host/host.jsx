// Asistent host: the ExtendScript (ES3) side. main.js evaluates this file for every command and calls as_run(name, args).
// Every function answers with a JSON string {ok, msg, ...}; nothing here throws out of as_run.

var AS_HOST_VERSION = "0.10.11";

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

// The project and sequence the panel works in (0.10.25). With several projects open, ExtendScript's `app.project` is
// not always the panel's project (field report 2026-11-10, Premiere 26.5.2: 5 of 6 Fix audio presses got "No active
// sequence." while the panel had the sequence in front of it), so the project is found by its path among the open
// ones and the sequence by its id (UXP `Sequence.guid` = ExtendScript `sequenceID`), then by its name.
// Returns {project, seq} or {error}.
function as_target(a) {
    var proj = null, i;
    if (a.project) {
        for (i = 0; i < app.projects.numProjects; i++) {
            if (as_norm(app.projects[i].path) === as_norm(a.project)) { proj = app.projects[i]; break; }
        }
        if (!proj) return { error: "Premiere's scripts do not see the project " + String(a.project).replace(/^.*[\\\/]/, "") + " as open. Nothing was touched." };
    } else {
        proj = app.project;
    }
    if (!proj) return { error: "No project open." };
    // `activeSequence` is Premiere's one active sequence whichever project object it is read from (probed 2026-11-10 with
    // TEST and NEW TEST open: NEW TEST's object answered TEST's sequence), so it counts only when it is one of this
    // project's own sequences
    var act = null, seq = null, named = [], own = proj.sequences, front = app.project ? app.project.activeSequence : null;
    for (i = 0; front && i < own.numSequences; i++) if (own[i].sequenceID === front.sequenceID) act = own[i];
    if (a.guid) {
        for (i = 0; !seq && i < own.numSequences; i++) if (own[i].sequenceID === a.guid) seq = own[i];
    }
    if (!seq && a.sequence) {
        if (act && act.name === a.sequence) seq = act;
        else {
            for (i = 0; i < own.numSequences; i++) if (own[i].name === a.sequence) named.push(own[i]);
            if (named.length === 1) seq = named[0];
            else if (named.length > 1) return { error: "The project has " + named.length + " sequences named \"" + a.sequence + "\": open the one you mean and press again. Nothing was touched." };
        }
    }
    if (!seq && !a.sequence && !a.guid) seq = act;
    if (!seq) return { error: a.sequence ? "Premiere's scripts did not find the sequence \"" + a.sequence + "\". Nothing was touched." : "No active sequence." };
    return { project: proj, seq: seq, front: proj === app.project || as_norm(proj.path) === as_norm(app.project ? app.project.path : "") };
}

function as_find_bin(name, create, project) {
    var root = (project || app.project).rootItem, i;
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
    var tg = as_target(a);
    if (tg.error) return as_result(false, tg.error);
    var seq = tg.seq, proj = tg.project;
    var f = new File(a.srt);
    if (!f.exists) return as_result(false, "The subtitle file is missing: " + a.srt);
    if (seq.createCaptionTrack === undefined) {
        return as_result(false, "This Premiere version cannot create a caption track by script.", { premiere: String(app.version) });
    }
    var bin = as_find_bin(a.bin || "Subtitles", true, proj);
    var before = as_caption_tracks(seq);
    var item = as_find_item(bin, a.srt);
    var imported = false;
    if (!item) {
        imported = proj.importFiles([a.srt], true, bin, false);
        item = as_find_item(bin, a.srt);
    }
    if (!item) return as_result(false, "Premiere did not import the subtitle file.", { imported: imported });
    var fmt = as_caption_format();
    var made;
    try {
        made = fmt ? seq.createCaptionTrack(item, 0, fmt.value) : seq.createCaptionTrack(item, 0);
    } catch (e) {
        return as_result(false, "Premiere did not create the caption track: " + e, { format: fmt ? fmt.name : null });
    }
    var after = as_caption_tracks(seq);
    return as_result(true, "ok", { imported: imported, item: item.name, format: fmt ? fmt.name : null, returned: String(made),
        tracks_before: before, tracks_after: after });
}

// ---------------------------------------------------------------- subtitles as text graphics
// The user's choice (2026-11-04): every subtitle line is an editable text graphic on a new video track, not a caption.
// Asistent's own template (scripts/caption_template.jsx, built once in After Effects) exposes one field, "Text";
// Premiere-made templates hide their text from scripts (probed: Source Text reads as binary). Probed in NEW TEST
// 2026-11-04: importMGT 0.6 s a line, setValue of the text 3 ms, `end` can be set; QE addTracks adds the track.
// The template is placed at its own size, so it is scaled to the sequence (2160x3840 needs 200 %).
function as_graphics(a) {
    var tg = as_target(a);
    if (tg.error) return as_result(false, tg.error);
    var seq = tg.seq;
    // QE (the new track) only reaches the front project's active sequence
    if (!tg.front || app.project.activeSequence.sequenceID !== seq.sequenceID) {
        return as_result(false, "Bring \"" + seq.name + "\" to the front (click its timeline) and press again. Nothing was touched.");
    }
    if (!new File(a.template).exists) return as_result(false, "The subtitle template is missing: " + a.template);
    var caps = a.captions || [];
    if (!caps.length) return as_result(false, "No subtitle lines to place.");
    if (seq.importMGT === undefined) return as_result(false, "This Premiere version cannot place graphics by script.");
    var t0 = new Date().getTime();
    // a new track on top, so nothing of the editor's is covered or overwritten
    app.enableQE();
    qe.project.getActiveSequence().addTracks(1, seq.videoTracks.numTracks, 0);
    var vi = seq.videoTracks.numTracks - 1;
    try { seq.videoTracks[vi].name = a.track_name || "Asistent subtitles"; } catch (e0) {}
    var scale = 100 * Math.min(Number(seq.frameSizeHorizontal) / a.width, Number(seq.frameSizeVertical) / a.height);
    var placed = 0, failed = [];
    for (var i = 0; i < caps.length; i++) {
        var at = new Time();
        at.seconds = caps[i].start;
        var ti = seq.importMGT(a.template, at.ticks, vi, 0);
        if (!ti) { failed.push(i + 1); continue; }
        var end = new Time();
        end.seconds = caps[i].end;
        ti.end = end;                          // trimmed at once, so the next line's place is free
        var mgt = ti.getMGTComponent();
        var field = mgt ? mgt.properties.getParamForDisplayName("Text") : null;
        if (!field) { failed.push(i + 1); continue; }
        var v = JSON.parse(field.getValue());
        v.textEditValue = String(caps[i].text).replace(/\n/g, "\r");      // After Effects text breaks lines on \r
        field.setValue(JSON.stringify(v), true);
        if (Math.abs(scale - 100) > 0.01) {
            for (var c = 0; c < ti.components.numItems; c++) {
                if (ti.components[c].matchName === "AE.ADBE Motion") {
                    var sc = ti.components[c].properties.getParamForDisplayName("Scale");
                    if (sc) sc.setValue(scale, true);
                }
            }
        }
        placed++;
    }
    return as_result(failed.length === 0, failed.length ? "Some lines were not placed: " + failed.join(", ") : "ok",
        { track: vi, placed: placed, failed: failed, scale: Math.round(scale * 100) / 100, ms: new Date().getTime() - t0 });
}

// ---------------------------------------------------------------- audio: L/L and R/R through the clip's channels
// The user's workflow (reference video 2026-11-03): duplicate the audio onto the track below, then Audio Channels:
// upper L/L, lower R/R; no Fill effects. No API sets the channels of a clip on the timeline (UXP has none;
// ExtendScript only for a project item), so each side is an audio-only subclip of exactly the media range the clip
// uses, with its own source mapping, put where the clips belong: the upper side overwrites the original audio,
// the lower one goes on the nearest free track below; then everything is linked to the video again.
// Probed in TEST.prproj 2026-11-03 (C0738): createSubClip(name, in, out, hard, takeVideo, takeAudio), mapping via
// setMappingForChannel + setAudioChannelMapping (audioChannelsType is read-only), placement exact to the tick,
// overwrite of the original audio without a crash, linkSelection relinks video + both sides.

var AS_LR_BIN = "Asistent L-R";

function as_tracks_clip(track, start, end) {
    for (var k = 0; k < track.clips.numItems; k++) {
        var c = track.clips[k];
        if (Math.abs(c.start.seconds - start) < 0.002 && Math.abs(c.end.seconds - end) < 0.002) return c;
    }
    return null;
}

function as_in_bin(bin, item) {
    if (!bin || !item) return null;
    for (var i = 0; i < bin.children.numItems; i++) if (bin.children[i].nodeId === item.nodeId) return bin.children[i];
    return null;
}

function as_busy(track, start, end) {
    for (var k = 0; k < track.clips.numItems; k++) {
        var c = track.clips[k];
        if (Math.min(end, c.end.seconds) - Math.max(start, c.start.seconds) > 0.001) return true;
    }
    return false;
}

// a short tag of the media file, so C0001.MP4 of two cameras never shares a subclip (0.10.6, BUG-004)
function as_tag(path) {
    var h = 5381, s = String(path || "").toLowerCase();
    for (var i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) & 0xffffff;
    var t = h.toString(16);
    while (t.length < 6) t = "0" + t;
    return t;
}

function as_media(item) {
    try { return String(item.getMediaPath() || ""); } catch (e) { return ""; }
}

// a subclip found by name is reused only when it is really this media's range and side
function as_same_source(sub, pi, c) {
    if (as_norm(as_media(sub)) !== as_norm(as_media(pi))) return false;
    try {
        var i = sub.getInPoint(), o = sub.getOutPoint();
        if (i && o && (Math.abs(i.seconds - c.inPoint.seconds) > 0.0005 || Math.abs(o.seconds - c.outPoint.seconds) > 0.0005)) return false;
    } catch (e) { /* in/out not readable in this Premiere: the media and the name (ticks of the range) decide */ }
    return true;
}

function as_side_clip(bin, pi, c, side) {
    // one subclip per media file, range and side, reused on a second press (no duplicates in the bin). The name carries a tag
    // of the media path; a found one is checked against the media and the range before it is reused.
    var base = String(pi.name).replace(/\.[^.]*$/, "");
    var name = base + " " + as_tag(as_media(pi)) + " " + side + " " + c.inPoint.seconds.toFixed(2) + "-" + c.outPoint.seconds.toFixed(2);
    for (var i = 0; i < bin.children.numItems; i++) {
        if (bin.children[i].name === name && as_same_source(bin.children[i], pi, c)) return bin.children[i];
    }
    var sub = pi.createSubClip(name, c.inPoint.ticks, c.outPoint.ticks, 0, 0, 1);
    if (!sub) throw new Error("Premiere did not make a copy of " + pi.name + ".");
    sub.moveBin(bin);
    var m = sub.getAudioChannelMapping;
    var src = side === "L" ? 0 : 1;
    if (!m.setMappingForChannel(0, src) || !m.setMappingForChannel(1, src) || !sub.setAudioChannelMapping(m)) {
        // a copy without the right channels must never be found and reused by a later press
        try { sub.name = name + " FAILED"; } catch (e) { /* the name stays: as_same_source cannot tell, so say it */ }
        throw new Error("Premiere did not accept the channels " + side + "/" + side + " for " + name + ".");
    }
    return sub;
}

// A subclip that takes only the audio gets Premiere's default Audio label (green), while the pieces Asistent placed show
// the clip's own colour; a razor cut makes the new piece from the subclip, so it came out green (the user, 2026-11-05).
// The L/R subclips get the label of the clip they come from. Returns the label index set, or null when Premiere has no
// label methods (the result says so).
function as_same_label(sub, from) {
    try {
        if (!sub || !from || typeof from.getColorLabel !== "function" || typeof sub.setColorLabel !== "function") return null;
        var want = from.getColorLabel();
        if (sub.getColorLabel() !== want) sub.setColorLabel(want);
        return want;
    } catch (e) { return null; }
}

// the clip the L/R subclips were made from: the linked video's project item (the audio's own item is the subclip itself
// on a second press)
function as_source_item(c) {
    var li = c.getLinkedItems();
    for (var k = 0; li && k < li.numItems; k++) if (String(li[k].mediaType) === "Video" && li[k].projectItem) return li[k].projectItem;
    return null;
}

function as_deselect_all(seq) {
    var sel = seq.getSelection();
    for (var i = 0; i < sel.length; i++) sel[i].setSelected(false, i === sel.length - 1);
}

function as_where(c) {
    return { track: c.parentTrackIndex, start: c.start.seconds, end: c.end.seconds, name: String(c.name) };
}

// one clip: {track, start, end, route: "split" | "split_rl" | "use_left" | "use_right" | "label"}; "label" only gives an
// earlier L/R copy the clip's own label and never splits anything
function as_route_one(seq, bin, a) {
    var track = seq.audioTracks[a.track];
    if (!track) return { ok: false, msg: "no audio track A" + (a.track + 1) };
    var c = as_tracks_clip(track, a.start, a.end);
    if (!c) return { ok: false, msg: "the clip is not in its place (was it moved?)" };
    var pi = c.projectItem;
    if (a.route === "label" && !as_in_bin(bin, pi)) return { ok: true, status: "skip" };
    if (as_in_bin(bin, pi)) {
        var mine = /\s(L|R)\s[\d.]+-[\d.]+$/.exec(String(pi.name));
        if (!mine) return { ok: false, msg: "the clip is from the bin \"" + AS_LR_BIN + "\", but its name does not say L or R: not touched" };
        // an earlier press (before 0.10.4) left the subclips with the green Audio label: give them the clip's own one
        var srcItem = as_source_item(c), lbl = null;
        if (srcItem) {
            var other = /\sL\s/.test(String(pi.name)) ? String(pi.name).replace(/\sL\s/, " R ") : String(pi.name).replace(/\sR\s/, " L ");
            lbl = as_same_label(pi, srcItem);
            for (var b = 0; b < bin.children.numItems; b++) if (bin.children[b].name === other) as_same_label(bin.children[b], srcItem);
        }
        return { ok: true, status: "already", side: mine[1], upper: as_where(c), label: lbl };
    }
    var map = pi.getAudioChannelMapping;
    if (!map || map.audioChannelsType !== 1 || map.audioClipsNumber !== 1) {
        return { ok: false, msg: "the clip is not one stereo clip (see Modify > Audio Channels), not touched" };
    }
    if (track.isLocked()) return { ok: false, msg: "track A" + (a.track + 1) + " is locked" };
    var split = a.route === "split" || a.route === "split_rl";
    var upperSide = a.route === "use_right" || a.route === "split_rl" ? "R" : "L";
    var lowerSide = upperSide === "L" ? "R" : "L";
    var below = -1;
    if (split) {
        for (var t = a.track + 1; t < seq.audioTracks.numTracks; t++) {
            var tr = seq.audioTracks[t];
            if (!tr.isLocked() && !as_busy(tr, a.start, a.end)) { below = t; break; }
        }
        if (below < 0) return { ok: false, msg: "no free audio track below A" + (a.track + 1) + ": add one (right-click > Add Track) and press again" };
    }
    // what the original audio was linked to (the video, other audio of the same clip), to link it all again
    var keep = [], li = c.getLinkedItems();
    for (var k = 0; li && k < li.numItems; k++) {
        var x = li[k];
        if (x.nodeId === c.nodeId) continue;
        keep.push({ video: String(x.mediaType) === "Video", track: x.parentTrackIndex, start: x.start.seconds, end: x.end.seconds });
    }
    var up = as_side_clip(bin, pi, c, upperSide);
    var low = split ? as_side_clip(bin, pi, c, lowerSide) : null;
    var label = as_same_label(up, pi);
    if (low) as_same_label(low, pi);
    var at = c.start.seconds, inPt = c.inPoint.seconds;
    if (low && !seq.audioTracks[below].overwriteClip(low, at)) return { ok: false, msg: "Premiere did not put the copy on A" + (below + 1) };
    if (!track.overwriteClip(up, at)) {
        return { ok: false, msg: "Premiere did not put " + upperSide + "/" + upperSide + " on A" + (a.track + 1) +
            (low ? "; the " + lowerSide + "/" + lowerSide + " copy on A" + (below + 1) + " stays there (Cmd/Ctrl+Z takes it back)" : "") };
    }
    // check: both sides exactly where the original was, the same part of the media
    var u = as_tracks_clip(seq.audioTracks[a.track], a.start, a.end);
    var l = low ? as_tracks_clip(seq.audioTracks[below], a.start, a.end) : null;
    var bad = [];
    if (!u || u.projectItem.nodeId !== up.nodeId || Math.abs(u.inPoint.seconds - inPt) > 0.002) bad.push(upperSide);
    if (low && (!l || l.projectItem.nodeId !== low.nodeId || Math.abs(l.inPoint.seconds - inPt) > 0.002)) bad.push(lowerSide);
    if (bad.length) return { ok: false, msg: "the check failed for " + bad.join(", ") + ": check the clip by hand" };
    var linked = false;
    try {
        as_deselect_all(seq);
        var parts = [u];
        if (l) parts.push(l);
        for (var j = 0; j < keep.length; j++) {
            var tracks = keep[j].video ? seq.videoTracks : seq.audioTracks;
            var o = tracks[keep[j].track] ? as_tracks_clip(tracks[keep[j].track], keep[j].start, keep[j].end) : null;
            if (o) parts.push(o);
        }
        for (var p = 0; p < parts.length; p++) parts[p].setSelected(true, p === parts.length - 1);
        linked = parts.length > 1 ? !!seq.linkSelection() : false;
        as_deselect_all(seq);
    } catch (e) { linked = false; }
    return { ok: true, status: "done", upperSide: upperSide, upper: as_where(u), lower: l ? as_where(l) : null,
        lowerSide: l ? lowerSide : null, linked: linked, relinked: keep.length, label: label };
}

// args: {project, sequence, items: [...]} -> {ok, items: [result per item, in order]}
function as_audio_route(a) {
    var tg = as_target(a);
    if (tg.error) return as_result(false, tg.error);
    var seq = tg.seq;
    var bin = as_find_bin(AS_LR_BIN, true, tg.project);
    var out = [], items = a.items || [];
    for (var i = 0; i < items.length; i++) {
        try { out.push(as_route_one(seq, bin, items[i])); }
        catch (e) { out.push({ ok: false, msg: String(e.message || e) }); }
    }
    return as_result(true, "ok", { items: out });
}

// test bridge only (the engine forwards it only with devbridge.enabled; refused outside TEST.prproj)
// Captions tab ▶ (0.10.11, the user: play in the Program Monitor, not a second player beside it). QE's player is the only
// script control of playback in 26.0.2 (probed in NEW TEST: player.play(1.0) ran 118.0 -> 120.05 s in 2 s, stop() stopped it;
// qe.startPlayback() did nothing). The playhead goes to `start` (sequence seconds) and Premiere plays from there.
function as_play(a) {
    if (!app.project || !app.project.activeSequence) return as_result(false, "No active sequence.");
    var start = Math.max(0, Number(a.start) || 0);
    app.enableQE();
    var player = qe.project.getActiveSequence().player;
    if (player.isPlaying) player.stop();
    app.project.activeSequence.setPlayerPosition(String(Math.round(start * 254016000000)));
    player.play(1.0);
    return as_result(true, "ok", { from: start });
}

// Stops the playback ▶ started, only while the playhead is still inside that passage: playback the editor started
// elsewhere (or after moving the playhead) is left alone.
function as_play_stop(a) {
    if (!app.project || !app.project.activeSequence) return as_result(true, "no sequence");
    app.enableQE();
    var player = qe.project.getActiveSequence().player;
    var at = app.project.activeSequence.getPlayerPosition().seconds;
    if (player.isPlaying && at >= Number(a.from) - 0.1 && at <= Number(a.until) + 0.75) {
        player.stop();
        return as_result(true, "stopped", { at: at });
    }
    return as_result(true, "left alone", { at: at, playing: !!player.isPlaying });
}

function as_eval(a) {
    if (!app.project || !/^(NEW )?TEST\.prproj$/.test(String(app.project.name))) return as_result(false, "eval only in TEST.prproj or NEW TEST.prproj.");
    var out = eval(String(a.code));
    return as_result(true, "ok", { value: (out === undefined ? null : (typeof out === "object" ? as_json(out) : String(out))) });
}

function as_run(name, args) {
    try {
        if (name === "ping") return as_ping();
        if (name === "probe") return as_probe();
        if (name === "captions") return as_captions(args || {});
        if (name === "graphics") return as_graphics(args || {});
        if (name === "audio_route") return as_audio_route(args || {});
        if (name === "eval") return as_eval(args || {});
        if (name === "play") return as_play(args || {});
        if (name === "play_stop") return as_play_stop(args || {});
        return as_result(false, "Unknown command: " + name);
    } catch (e) {
        return as_result(false, "ExtendScript: " + e.toString() + (e.line ? " (line " + e.line + ")" : ""));
    }
}
