// Asistent host: the ExtendScript (ES3) side. main.js evaluates this file for every command and calls as_run(name, args).
// Every function answers with a JSON string {ok, msg, ...}; nothing here throws out of as_run.

var AS_HOST_VERSION = "0.10.115";

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

// One more audio track after the last (0.10.45). Only QE can add one; it works on the ACTIVE sequence, so only for that.
// QE addTracks(video, after, audio, audioType, after): type 1 = a standard (stereo) track [probe in NEW TEST].
// -> true when the sequence really has one more track afterwards
function as_add_audio_track(seq) {
    var before = seq.audioTracks.numTracks;
    try {
        if (!app.project.activeSequence || app.project.activeSequence.sequenceID !== seq.sequenceID) return false;
        app.enableQE();
        qe.project.getActiveSequence().addTracks(0, 0, 1, 1, before);
    } catch (e) { return false; }
    return seq.audioTracks.numTracks > before;
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
    if (split && typeof a.lower === "number" && a.lower > a.track) {
        // 0.10.45: the panel chose one second-side track per source track (audioplan.lowerTracks); it may be a new one
        while (seq.audioTracks.numTracks <= a.lower && as_add_audio_track(seq)) { /* one more */ }
        var want = seq.audioTracks[a.lower];
        if (want && !want.isLocked() && !as_busy(want, a.start, a.end)) below = a.lower;
    }
    if (split && below < 0) {
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

// Rough cut by clones (0.10.45): clones arrive unlinked (UXP clones one track item at a time), so the video and audio
// pieces of one moment of one clip are linked again, as Fix audio relinks its copies. args: {project, sequence, guid,
// groups: [[{kind, track, start, end}]]} -> {ok, linked, missing}. One Premiere step per group (ExtendScript).
function as_link(a) {
    var tg = as_target(a);
    if (tg.error) return as_result(false, tg.error);
    var seq = tg.seq, linked = 0, missing = 0, groups = a.groups || [];
    for (var g = 0; g < groups.length; g++) {
        var parts = [];
        for (var k = 0; k < groups[g].length; k++) {
            var x = groups[g][k];
            var tracks = x.kind === "video" ? seq.videoTracks : seq.audioTracks;
            var c = tracks[x.track] ? as_tracks_clip(tracks[x.track], x.start, x.end) : null;
            if (c) parts.push(c); else missing++;
        }
        if (parts.length < 2) continue;
        try {
            as_deselect_all(seq);
            for (var p = 0; p < parts.length; p++) parts[p].setSelected(true, p === parts.length - 1);
            if (seq.linkSelection()) linked++;
        } catch (e) { /* counted as not linked */ }
    }
    try { as_deselect_all(seq); } catch (e2) { /* nothing selected */ }
    return as_result(true, "ok", { linked: linked, groups: groups.length, missing: missing });
}

// Stash clips (0.10.50): the stash's own sequence (made by Asistent from its shell, in the bin "Asistent stash") saved as a
// project file in the stash folder. exportAsProject writes the sequence with its clips, effects, keyframes and the project
// items they use (the media stays where it is). Nothing in the project is changed.
function as_stash_export(a) {
    var tg = as_target(a);
    if (tg.error) return as_result(false, tg.error);
    if (!/^Stash - /.test(String(tg.seq.name))) return as_result(false, "That is not one of Asistent's stash sequences: not exported.");
    var f = new File(a.path);
    if (f.exists) return as_result(false, "The stash already has a project file.");
    var ok = tg.seq.exportAsProject(f.fsName);
    f = new File(a.path);
    return as_result(!!f.exists && f.length > 0, f.exists ? "ok" : "Premiere did not write the project file.",
        { bytes: f.exists ? f.length : 0, returned: String(ok) });
}

// Tracks added at the top of the ACTIVE sequence (QE works only on the active one): {video, audio} -> {ok, video, audio}
// (the counts after). Used when a stash or a tracked layer has no free room; adding a track removes nothing.
function as_add_tracks(a) {
    var tg = as_target(a);
    if (tg.error) return as_result(false, tg.error);
    var seq = tg.seq, v0 = seq.videoTracks.numTracks, a0 = seq.audioTracks.numTracks;
    if (!app.project.activeSequence || app.project.activeSequence.sequenceID !== seq.sequenceID) return as_result(false, "Open the sequence first.");
    app.enableQE();
    // addTracks(video count, after video index, audio count, audio type 1 = stereo, after audio index)
    qe.project.getActiveSequence().addTracks(Math.max(0, a.video | 0), v0, Math.max(0, a.audio | 0), 1, a0);
    return as_result(true, "ok", { video: seq.videoTracks.numTracks, audio: seq.audioTracks.numTracks, before: { video: v0, audio: a0 } });
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

// ---------------------------------------------------------------- Brand page (0.10.71)
// A client's MOGRT placed at a time on a track the panel chose free (brandplan.placeOn: above every clip from that time on,
// so nothing of the editor's is covered or cut). importMGT is the call as_graphics proved in NEW TEST (2026-11-04).
function as_brand_mogrt(a) {
    var tg = as_target(a);
    if (tg.error) return as_result(false, tg.error);
    var seq = tg.seq;
    if (seq.importMGT === undefined) return as_result(false, "This Premiere version cannot place a MOGRT by script.");
    if (!new File(a.path).exists) return as_result(false, "The MOGRT file is missing: " + a.path);
    var vi = a.video | 0, ai = a.audio | 0;
    if (vi < 0 || vi >= seq.videoTracks.numTracks) return as_result(false, "The track V" + (vi + 1) + " does not exist. Nothing was placed.");
    if (ai < 0 || ai >= seq.audioTracks.numTracks) ai = 0;
    var at = new Time();
    at.seconds = Math.max(0, Number(a.seconds) || 0);
    var ti = seq.importMGT(a.path, at.ticks, vi, ai);
    if (!ti) return as_result(false, "Premiere did not place the MOGRT (it may need a newer Premiere or After Effects).");
    var info = { track: vi, start: ti.start.seconds, end: ti.end.seconds, name: String(ti.name) };
    try {
        var m = ti.getMGTComponent();
        info.controls = m ? m.properties.numItems : 0;
    } catch (e) { info.controls = -1; }
    return as_result(true, "ok", info);
}

function as_hex_rgb(hex) {
    var h = String(hex).replace("#", "");
    return [parseInt(h.substr(0, 2), 16), parseInt(h.substr(2, 2), 16), parseInt(h.substr(4, 2), 16)];
}

// The colour controls of a MOGRT (Essential Graphics properties the template exposes): getColorValue answers
// [alpha, red, green, blue] 0-255 for those only.
function as_colour_controls(mgt) {
    var out = [];
    for (var p = 0; p < mgt.properties.numItems; p++) {
        var pr = mgt.properties[p], v = null;
        try { v = pr.getColorValue(); } catch (e) { v = null; }
        if (v && v.length === 4 && typeof v[1] === "number" && v[1] >= 0 && v[1] <= 255) out.push(pr);
    }
    return out;
}

// The colour goes into one colour control (index: 0 = the first) of every selected MOGRT. Native text (Premiere's Type
// tool, captions upgraded to graphics) has no scriptable colour in 26.x: those are counted and listed (name, start), and
// the panel puts a Tint on the text ones (0.10.111).
function as_brand_color(a) {
    var tg = as_target(a);
    if (tg.error) return as_result(false, tg.error);
    var seq = tg.seq, sel = seq.getSelection(), rgb = as_hex_rgb(a.hex), idx = Math.max(0, a.index | 0);
    var out = { mogrts: 0, set: 0, other: 0, others: [], skipped: [], controls: [] };
    for (var i = 0; i < sel.length; i++) {
        var ti = sel[i], mgt = null;
        if (ti.mediaType && String(ti.mediaType) !== "Video") continue;
        try { mgt = ti.getMGTComponent(); } catch (e) { mgt = null; }
        if (!mgt) { out.other++; out.others.push({ name: String(ti.name), start: ti.start.seconds }); continue; }
        out.mogrts++;
        var cols = as_colour_controls(mgt);
        if (!out.controls.length) for (var c = 0; c < cols.length; c++) out.controls.push(String(cols[c].displayName));
        if (!cols.length) { out.skipped.push(String(ti.name) + ": no colour control"); continue; }
        var pr = cols[Math.min(idx, cols.length - 1)];
        var animated = false;
        try { animated = pr.isTimeVarying(); } catch (e2) { animated = false; }
        if (animated) { out.skipped.push(String(ti.name) + ": " + pr.displayName + " has keyframes"); continue; }
        pr.setColorValue(255, rgb[0], rgb[1], rgb[2], true);
        out.set++;
    }
    return as_result(true, "ok", out);
}

// ---------------------------------------------------------------- 0.10.108: the rough cut made in a DUPLICATE of the sequence
// The user (2026-11-15): Cut silences crashed Premiere 26.5.3 on a five-minute selection. The crash is inside Premiere's
// UXP layer while it hands the panel a copy of a clip (about 60 runs in NEW TEST; 2 of 8 still crashed after every panel-side
// change), so the panel no longer copies clips. The host duplicates the editor's sequence, razors the DUPLICATE at the cut
// frames, removes from it what is not a kept piece and moves the pieces together. The editor's own sequence is never
// touched: every phase after "start" works only on the sequence whose id AND name are the ones "start" made (approved by
// the user 2026-11-15: removing clips in Asistent's own duplicate).
// Probed in NEW TEST (2026-11-15): Sequence.clone() makes "<name> Copy" in the project; QE's sequence razor(timecode) cuts
// every unlocked track frame exact (drop-frame timecode from Time.getFormatted); QE's TRACK razor is not usable (QE hides a
// track that has the same name as another one); removing a TrackItem (remove with false, false) and move(Time) change that one item only,
// linked partners stay, and a move is exact to the tick.
// One call does one phase for at most AS_CUT_BUDGET ms and says where it stopped; the panel calls again.
var AS_CUT_BUDGET = 15000;

function as_cut_frame(time, tpf) {
    return Math.round(Number(time.ticks) / tpf);
}

// the duplicate "start" made: found by its id, and it must still carry the name it was given
function as_cut_target(a) {
    var tg = as_target({ project: a.project, guid: a.cut });
    if (tg.error) return { error: "The new sequence \"" + a.name + "\" was not found any more. Nothing else was changed." };
    if (String(tg.seq.name) !== String(a.name) || tg.seq.sequenceID !== a.cut) return { error: "The new sequence \"" + a.name + "\" is not the one that was made. Nothing else was changed." };
    if (!tg.front) return { error: "Another project is in front in Premiere: bring this one to the front and press again." };
    return tg;
}

function as_cut_lock(tracks, on) {
    for (var t = 0; t < tracks.numTracks; t++) {
        try { tracks[t].setLocked(on ? 1 : 0); } catch (e) { /* a track that cannot be locked is cut with the others */ }
    }
}

// A phase's clock starts when it has listed the clips, and a call always does at least one item (0.10.122): a long clip
// list used to eat the whole budget before the first item, and the panel then called again with the same result for ever.
function as_cut_clock() {
    return new Date().getTime() + AS_CUT_BUDGET;
}

// the sequence's frame rate as text, from its ticks per frame (254016000000 ticks make a second)
function as_cut_rate(tpf) {
    return (Math.round(254016000000 / tpf * 1000) / 1000) + " fps";
}

// which tracks were locked, as the editor had them: [1|0 per video track], [1|0 per audio track]; null when this Premiere
// does not say (the tracks are then left unlocked, as the cut leaves them)
function as_cut_locks(seq) {
    var out = { v: [], a: [] }, kinds = [["v", seq.videoTracks], ["a", seq.audioTracks]];
    for (var n = 0; n < kinds.length; n++) {
        for (var t = 0; t < kinds[n][1].numTracks; t++) {
            try { out[kinds[n][0]].push(kinds[n][1][t].isLocked() ? 1 : 0); } catch (e) { return null; }
        }
    }
    return out;
}

// every clip of the duplicate: [{k: "v"|"a", t: track, f: start frame, e: end frame, c: the clip}]
function as_cut_clips(seq, tpf) {
    var out = [], kinds = [["v", seq.videoTracks], ["a", seq.audioTracks]];
    for (var n = 0; n < kinds.length; n++) {
        var tracks = kinds[n][1];
        for (var t = 0; t < tracks.numTracks; t++) {
            var clips = tracks[t].clips;
            for (var k = 0; k < clips.numItems; k++) {
                var c = clips[k];
                out.push({ k: kinds[n][0], t: t, f: as_cut_frame(c.start, tpf), e: as_cut_frame(c.end, tpf), c: c });
            }
        }
    }
    return out;
}

// pieces by "kind|track|from|to"; a clip that lies off the frame grid may round one frame away, so the neighbours count too
function as_cut_index(pieces, at) {
    var map = {};
    for (var i = 0; i < pieces.length; i++) {
        var p = pieces[i], f = at ? p.at : p.f, e = at ? p.at + (p.e - p.f) : p.e;
        map[p.k + "|" + p.t + "|" + f + "|" + e] = i + 1;
    }
    return map;
}

function as_cut_lookup(map, k, t, f, e) {
    var exact = map[k + "|" + t + "|" + f + "|" + e];
    if (exact) return exact;
    for (var df = -1; df <= 1; df++) {
        for (var de = -1; de <= 1; de++) {
            var hit = map[k + "|" + t + "|" + (f + df) + "|" + (e + de)];
            if (hit) return hit;
        }
    }
    return 0;
}

function as_cut_start(a) {
    var tg = as_target(a);
    if (tg.error) return as_result(false, tg.error);
    if (!tg.front) return as_result(false, "Another project is in front in Premiere: bring this one to the front and press again. Nothing was made.");
    var proj = tg.project, src = tg.seq, before = {}, i, made = null;
    for (i = 0; i < proj.sequences.numSequences; i++) {
        before[proj.sequences[i].sequenceID] = 1;
        if (String(proj.sequences[i].name) === String(a.name)) return as_result(false, "The project already has a sequence named \"" + a.name + "\". Nothing was made: rename or delete it and press again.");
    }
    if (!src.clone()) return as_result(false, "Premiere did not duplicate the sequence. Nothing was made.");
    for (i = 0; i < proj.sequences.numSequences; i++) if (!before[proj.sequences[i].sequenceID]) made = proj.sequences[i];
    if (!made || made.sequenceID === src.sequenceID) return as_result(false, "The duplicate of the sequence did not appear in the project. Nothing else was changed.");
    made.name = a.name;
    try {
        var bin = as_find_bin(a.bin || "No silence", true, proj);
        if (bin && made.projectItem) made.projectItem.moveBin(bin);
    } catch (e) { /* it stays next to the original */ }
    proj.openSequence(made.sequenceID);
    return as_result(true, "ok", { cut: made.sequenceID, tpf: Number(made.timebase), source: String(src.name) });
}

// cut frames with no clip edge within a frame: [frame, ...]. A cut is asked only where a kept piece ends inside its clip,
// so after the razor there must be an edge there (of the picture, of the sound, or of either when both were cut).
function as_cut_unsplit(all, cuts) {
    var edges = { v: {}, a: {} }, n, d, miss = [];
    for (n = 0; n < all.length; n++) {
        edges[all[n].k][all[n].f] = 1;
        edges[all[n].k][all[n].e] = 1;
    }
    for (n = 0; n < cuts.length; n++) {
        var only = cuts[n].only || "", kinds = only ? [only] : ["v", "a"], hit = false;
        for (var k = 0; k < kinds.length; k++) for (d = -1; d <= 1; d++) if (edges[kinds[k]][cuts[n].f + d]) hit = true;
        if (!hit) miss.push(cuts[n].f);
    }
    return miss;
}

// The timecode string QE's razor is given for a tick time. Premiere's own Time.getFormatted() is right for a drop-frame
// sequence (probed at 29.97, ";" in the string) and when the display is not a timecode at all (frames, feet). For a plain
// timecode it is written here, counting frames with the sequence's own whole-number frame base, because getFormatted can
// count with another base than the razor reads with (0.10.123, the user's "Lokal 2", iPhone footage at 59.974 fps,
// 2026-11-21: frame 16058 came out as "00:08:55:08", 30 frames to the second, the razor read 60 to the second and cut at
// twice the time: 434 of 436 cuts were not where they were asked). At the standard rates both give the same string.
function as_cut_timecode(tm, st, tpf) {
    var own = String(tm.getFormatted(st.videoFrameRate, st.videoDisplayFormat));
    if (own.indexOf(";") >= 0 || own.split(":").length !== 4) return own;
    var base = Math.round(254016000000 / tpf), f = Math.round(Number(tm.ticks) / tpf);
    if (!(base >= 1) || !(f >= 0)) return own;
    var two = function (n) { return (n < 10 ? "0" : "") + n; };
    var sec = Math.floor(f / base);
    return two(Math.floor(sec / 3600)) + ":" + two(Math.floor(sec / 60) % 60) + ":" + two(sec % 60) + ":" + two(f % base);
}

function as_cut_razor(a, tg, until) {
    var seq = tg.seq, proj = tg.project, tpf = Number(seq.timebase), cuts = a.cuts || [], i = Number(a.i) || 0;
    if (!app.project.activeSequence || app.project.activeSequence.sequenceID !== seq.sequenceID) proj.openSequence(seq.sequenceID);
    if (!app.project.activeSequence || app.project.activeSequence.sequenceID !== seq.sequenceID) return as_result(false, "Premiere did not open the new sequence \"" + a.name + "\", so nothing was cut. It can be deleted.");
    app.enableQE();
    var qs = qe.project.getActiveSequence();
    // the razor works on the sequence in front: it must be the duplicate, never the editor's own sequence
    if (!qs || String(qs.name) !== String(a.name)) return as_result(false, "The new sequence \"" + a.name + "\" is not the one in front, so nothing was cut. It can be deleted.");
    var st = seq.getSettings(), zero = Number(seq.zeroPoint) || 0, state = null, refused = 0;
    // evidence for the odd-frame-rate probe (below): the first razor's timecode string and the clip counts around it
    var from = i, ev = {}, probe = (i === 0 && cuts.length > 0);
    if (probe) ev.before = as_cut_clips(seq, tpf).length;
    until = as_cut_clock();
    for (; i < cuts.length; i++) {
        if (i > from && new Date().getTime() > until) break;
        var only = cuts[i].only || "";
        if (only !== state) {
            as_cut_lock(seq.videoTracks, only === "a");
            as_cut_lock(seq.audioTracks, only === "v");
            state = only;
        }
        var tm = new Time();
        tm.ticks = String(cuts[i].f * tpf + zero);
        // the string is as_cut_timecode's (see there for what the odd frame rate showed). The first razor is checked at
        // once: its string, Premiere's own string and the clip counts come back as tc / tc_own / before / after_first (and
        // go to the engine log), and when it did not land the cut stops there, with one stray cut instead of hundreds
        var tc = as_cut_timecode(tm, st, tpf);
        if (!qs.razor(tc)) refused++;
        if (probe && i === 0) {
            var now = as_cut_clips(seq, tpf);
            ev.tc = String(tc);
            ev.tc_own = String(tm.getFormatted(st.videoFrameRate, st.videoDisplayFormat));
            ev.after_first = now.length;
            if (as_cut_unsplit(now, [cuts[0]]).length) {
                as_cut_lock(seq.videoTracks, false);
                as_cut_lock(seq.audioTracks, false);
                var first = { i: 1, done: false, refused: refused, rate: as_cut_rate(tpf), unsplit: 1 };
                for (var k0 in ev) first[k0] = ev[k0];
                return as_result(false, "Premiere did not cut the new sequence \"" + a.name + "\" where it was asked to: the first cut (frame " + cuts[0].f +
                    ", asked as " + ev.tc + ") is not there; the sequence runs at " + first.rate + ", which Premiere's razor may not handle. Nothing was removed. " +
                    "The unfinished sequence \"" + a.name + "\" can be deleted; your own sequence was not changed.", first);
            }
        }
    }
    as_cut_lock(seq.videoTracks, false);
    as_cut_lock(seq.audioTracks, false);
    var out = { i: i, done: i >= cuts.length, refused: refused, rate: as_cut_rate(tpf) };
    for (var key in ev) out[key] = ev[key];
    if (out.done && cuts.length) {
        // the check the odd frame rate showed to be needed: a razor that says yes may still have cut elsewhere
        var miss = as_cut_unsplit(as_cut_clips(seq, tpf), cuts);
        if (miss.length) {
            out.unsplit = miss.length;
            return as_result(false, "Premiere did not cut the new sequence \"" + a.name + "\" where it was asked to: there is no clip edge at " + miss.length + " of " + cuts.length +
                " cut frames (the first is frame " + miss[0] + "; the sequence runs at " + out.rate + ", which Premiere's razor may not handle). Nothing was removed. " +
                "The unfinished sequence \"" + a.name + "\" can be deleted; your own sequence was not changed.", out);
        }
    }
    return as_result(true, "ok", out);
}

// The kept pieces' clips stay, and a clip goes only when it lies entirely inside a cut range of its own track (one frame of
// rounding allowed): never a clip that overlaps a kept piece by more than a frame (a razor that landed off must not cost
// speech). Every kept piece must have a clip of its own first, else nothing is removed at all.
function as_cut_clean(a, tg, until) {
    var seq = tg.seq, tpf = Number(seq.timebase), pieces = a.pieces || [], map = as_cut_index(pieces, false);
    var all = as_cut_clips(seq, tpf), matched = 0, extra = [], n, p;
    until = as_cut_clock();
    if (!pieces.length) return as_result(false, "The cut has no kept pieces, so nothing was removed from the new sequence \"" + a.name + "\". It can be deleted; your own sequence was not changed.");
    var here = {}, lost = 0;
    for (n = 0; n < all.length; n++) here[all[n].k + "|" + all[n].t + "|" + all[n].f + "|" + all[n].e] = n + 1;
    for (n = 0; n < pieces.length; n++) if (!as_cut_lookup(here, pieces[n].k, pieces[n].t, pieces[n].f, pieces[n].e)) lost++;
    if (lost) return as_result(false, "Premiere did not cut the new sequence \"" + a.name + "\" where it was asked to: " + lost + " of " + pieces.length +
        " kept pieces have no clip of their own (the sequence runs at " + as_cut_rate(tpf) + "), so nothing was removed from it. " +
        "The unfinished sequence can be deleted; your own sequence was not changed.", { lost: lost, pieces: pieces.length });
    // the kept pieces of each track, in order (they never overlap each other)
    var by = {};
    for (n = 0; n < pieces.length; n++) {
        p = pieces[n];
        (by[p.k + "|" + p.t] = by[p.k + "|" + p.t] || []).push(p);
    }
    for (var key in by) by[key].sort(function (x, y) { return x.f - y.f; });
    var overlap = 0;
    for (n = 0; n < all.length; n++) {
        if (as_cut_lookup(map, all[n].k, all[n].t, all[n].f, all[n].e)) { matched++; continue; }
        // the first kept piece of its track that ends more than a frame after this clip starts: it must start a frame or
        // more after the clip ends, else the clip holds kept speech
        var list = by[all[n].k + "|" + all[n].t] || [], lo = 0, hi = list.length;
        while (lo < hi) {
            var mid = (lo + hi) >> 1;
            if (list[mid].e > all[n].f + 1) hi = mid; else lo = mid + 1;
        }
        if (lo < list.length && list[lo].f < all[n].e - 1) overlap++; else extra.push(all[n]);
    }
    as_cut_lock(seq.videoTracks, false);
    as_cut_lock(seq.audioTracks, false);
    var removed = 0, refused = 0;
    for (n = extra.length - 1; n >= 0; n--) {                 // from the end of each track backwards
        if (n < extra.length - 1 && new Date().getTime() > until) break;
        try { if (extra[n].c.remove(false, false) === false) refused++; else removed++; } catch (e) { refused++; }
    }
    return as_result(true, "ok", { done: n < 0, removed: removed, refused: refused, matched: matched, left: n + 1, overlap: overlap });
}

function as_cut_move(a, tg, until) {
    var seq = tg.seq, tpf = Number(seq.timebase), pieces = a.pieces || [], i = Number(a.i) || 0;
    var all = as_cut_clips(seq, tpf), here = {}, n, moved = 0, missing = [], from = i;
    for (n = 0; n < all.length; n++) here[all[n].k + "|" + all[n].t + "|" + all[n].f + "|" + all[n].e] = n + 1;
    until = as_cut_clock();
    for (; i < pieces.length; i++) {
        if (i > from && new Date().getTime() > until) break;
        var p = pieces[i], d = p.at - p.f;
        if (!d) continue;
        var hit = as_cut_lookup(here, p.k, p.t, p.f, p.e);
        if (!hit) {
            if (!as_cut_lookup(here, p.k, p.t, p.at, p.at + (p.e - p.f))) missing.push(i);   // not where it was and not where it goes
            continue;
        }
        var tm = new Time();
        tm.ticks = String(d * tpf);
        try { all[hit - 1].c.move(tm); moved++; } catch (e) { missing.push(i); }
    }
    return as_result(true, "ok", { i: i, done: i >= pieces.length, moved: moved, missing: missing.length });
}

function as_cut_finish(a, tg) {
    var seq = tg.seq, tpf = Number(seq.timebase), marks = a.marks || [], n, cleared = 0, added = 0;
    if (a.i) {                                              // the pieces moved: the duplicate's own markers point at the old places
        try {
            var old = [], m = seq.markers.getFirstMarker();
            while (m) { old.push(m); m = seq.markers.getNextMarker(m); }
            for (n = 0; n < old.length; n++) { seq.markers.deleteMarker(old[n]); cleared++; }
        } catch (e) { /* the markers stay */ }
    }
    for (n = 0; n < marks.length; n++) {
        try {
            var mk = seq.markers.createMarker(marks[n].frame * tpf / 254016000000);
            mk.name = String(marks[n].name || "Review");
            mk.comments = String(marks[n].comment || "");
            added++;
        } catch (e2) { /* a marker less */ }
    }
    // the duplicate came with the editor's In and Out, which mean nothing in the cut sequence: it is whole again (In at
    // the start, Out at the end; measured in NEW TEST 2026-11-15: an In to Out cut of 33 s kept In 40.5 and Out 200.25)
    try { seq.setInPoint(0); seq.setOutPoint(Number(seq.end) / 254016000000); } catch (e5) { /* the marks stay */ }
    try { as_deselect_all(seq); } catch (e3) { /* nothing selected */ }
    try { seq.setPlayerPosition("0"); } catch (e4) { /* the playhead stays */ }
    var all = as_cut_clips(seq, tpf), map = as_cut_index(a.pieces || [], true), there = 0;
    for (n = 0; n < all.length; n++) if (as_cut_lookup(map, all[n].k, all[n].t, all[n].f, all[n].e)) there++;
    // the tracks go back as the editor had them (0.10.122; the cut unlocked all of them): read from the editor's own
    // sequence, which is only looked at, and put on the duplicate when it has the same tracks (a clone does)
    var relocked = 0;
    try {
        var src = as_target(a);
        if (!src.error) {
            var want = as_cut_locks(src.seq);
            if (want && want.v.length === seq.videoTracks.numTracks && want.a.length === seq.audioTracks.numTracks) {
                for (n = 0; n < want.v.length; n++) if (want.v[n]) { seq.videoTracks[n].setLocked(1); relocked++; }
                for (n = 0; n < want.a.length; n++) if (want.a[n]) { seq.audioTracks[n].setLocked(1); relocked++; }
            }
        }
    } catch (e6) { /* the tracks stay unlocked */ }
    return as_result(true, "ok", { clips: all.length, there: there, markers_cleared: cleared, markers: added, relocked: relocked });
}

function as_rough_cut(a) {
    if (!a.name) return as_result(false, "The new sequence has no name.");
    if (a.phase === "start") return as_cut_start(a);
    var tg = as_cut_target(a);
    if (tg.error) return as_result(false, tg.error);
    var until = new Date().getTime() + AS_CUT_BUDGET;
    if (a.phase === "razor") return as_cut_razor(a, tg, until);
    if (a.phase === "clean") return as_cut_clean(a, tg, until);
    if (a.phase === "move") return as_cut_move(a, tg, until);
    if (a.phase === "finish") return as_cut_finish(a, tg);
    return as_result(false, "Unknown phase: " + a.phase);
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
        if (name === "link") return as_link(args || {});
        if (name === "stash_export") return as_stash_export(args || {});
        if (name === "add_tracks") return as_add_tracks(args || {});
        if (name === "brand_mogrt") return as_brand_mogrt(args || {});
        if (name === "brand_color") return as_brand_color(args || {});
        if (name === "rough_cut") return as_rough_cut(args || {});
        if (name === "eval") return as_eval(args || {});
        if (name === "play") return as_play(args || {});
        if (name === "play_stop") return as_play_stop(args || {});
        return as_result(false, "Unknown command: " + name);
    } catch (e) {
        return as_result(false, "ExtendScript: " + e.toString() + (e.line ? " (line " + e.line + ")" : ""));
    }
}
