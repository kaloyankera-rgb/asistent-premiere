// After Effects script: builds Asistent's subtitle templates (.mogrt) once, so Premiere can place every subtitle line as
// an editable text graphic (2026-11-04, the user's choice: text graphics, static lines). Run by scripts/caption_template.sh;
// it opens a NEW empty project (nothing of the user's is touched), saves it and the templates only into OUT, and writes
// OUT/caption_template.json with what it did. Premiere reads the text field through getMGTComponent ("Text").
//
// Two sizes, matching subtitles.py: "short" for 9:16 (one line, up to 3 words) and "standard" for 16:9 (up to 2 lines).
// White Visuelt Pro Bold with a black outline, centred, in the lower part of the frame above the platforms' buttons.

(function () {
  // OUT_DIR is written in front of this script by caption_template.sh (an app started by a script sees no shell variables)
  var OUT = typeof OUT_DIR !== "undefined" ? OUT_DIR : $.getenv("ASISTENT_TEMPLATES");
  var report = { ok: false, made: [], errors: [] };

  function write(obj) {
    var f = new File(OUT + "/caption_template.json");
    f.encoding = "UTF-8";
    f.open("w");
    f.write(JSON_like(obj));
    f.close();
  }

  // ExtendScript has no JSON: a tiny writer for this report
  function JSON_like(v) {
    if (v === null || v === undefined) return "null";
    if (typeof v === "boolean" || typeof v === "number") return String(v);
    if (typeof v === "string") return '"' + v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n") + '"';
    if (v instanceof Array) {
      var a = [];
      for (var i = 0; i < v.length; i++) a.push(JSON_like(v[i]));
      return "[" + a.join(",") + "]";
    }
    var o = [];
    for (var k in v) if (v.hasOwnProperty(k)) o.push('"' + k + '":' + JSON_like(v[k]));
    return "{" + o.join(",") + "}";
  }

  function make(name, w, h, size, y, sample) {
    var comp = app.project.items.addComp(name, w, h, 1, 10, 30);
    var layer = comp.layers.addText(sample);
    layer.name = "Text";
    var prop = layer.property("Source Text");
    var doc = prop.value;
    doc.resetCharStyle();
    doc.resetParagraphStyle();
    doc.font = "VisueltPro-Bold";
    doc.fontSize = size;
    doc.applyFill = true;
    doc.fillColor = [1, 1, 1];
    doc.applyStroke = true;
    doc.strokeColor = [0, 0, 0];
    doc.strokeWidth = Math.round(size * 0.12);
    doc.strokeOverFill = false;
    doc.justification = ParagraphJustification.CENTER_JUSTIFY;
    prop.setValue(doc);
    // the text's own box is centred on its point, so one or two lines stay centred around the same place
    var r = layer.sourceRectAtTime(0, false);
    layer.property("Anchor Point").setValue([r.left + r.width / 2, r.top + r.height / 2]);
    layer.property("Position").setValue([w / 2, y]);
    prop.addToMotionGraphicsTemplateAs(comp, "Text");
    comp.motionGraphicsTemplateName = name;
    var file = OUT + "/" + name + ".mogrt";
    var ok = comp.exportAsMotionGraphicsTemplate(true, file);
    if (ok) report.made.push(file);
    else report.errors.push(name + ": exportAsMotionGraphicsTemplate returned false");
  }

  try {
    if (!OUT) throw new Error("ASISTENT_TEMPLATES is not set");
    new Folder(OUT).create();
    // never at the cost of the user's work: an open project with unsaved changes stops it here
    if (app.project && app.project.dirty) throw new Error("After Effects has a project with unsaved changes open: save or close it and run again.");
    app.beginSuppressDialogs();
    app.newProject();
    app.project.save(new File(OUT + "/caption_template.aep"));
    make("Asistent Subtitle 9x16", 1080, 1920, 74, 1300, "Днес ще ви");
    make("Asistent Subtitle 16x9", 1920, 1080, 58, 920, "Днес ще ви покажа три неща");
    app.project.save();
    report.ok = report.errors.length === 0;
  } catch (e) {
    report.errors.push(String(e));
  }
  try {
    write(report);
  } catch (e2) {}
  app.endSuppressDialogs(false);
})();
