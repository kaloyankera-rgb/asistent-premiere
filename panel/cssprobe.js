// What this UXP really does with CSS (the redesign plan, step 0). Adobe's list of supported properties is incomplete
// (it leaves out `position`, which the tooltip uses), so every feature the new look might use is measured on
// temporary elements: a layout effect is read from the boxes, never from the style text. Touches only its own
// elements, removed at the end; nothing in Premiere. Run through the test bridge: `dev_cmd.py css_probe`.
// UXP lays a new element out a moment after it is added (0.9.70: every size read at once was 0), so each test
// builds its elements, waits for the layout (`settle`) and only then measures.

async function cssProbe(doc, win, sleep = (ms) => new Promise((r) => setTimeout(r, ms))) {
  const out = {};
  const host = doc.createElement("div");
  // inside the panel and laid out like any element; invisible for the second the probe takes
  host.setAttribute("style", "position: absolute; left: 0; top: 0; width: 400px; opacity: 0;");
  doc.body.appendChild(host);

  function box(style, parent = host, tag = "div") {
    const e = doc.createElement(tag);
    if (style) e.setAttribute("style", style);
    parent.appendChild(e);
    return e;
  }
  const rect = (e) => e.getBoundingClientRect();
  const css = (e, p) => {
    try {
      return win.getComputedStyle(e).getPropertyValue(p);
    } catch (err) {
      return `error: ${err.message}`;
    }
  };
  const settle = () => sleep(120);
  const tests = [];
  function test(name, fn) {
    tests.push([name, fn]);
  }

  test("flex", async () => {
    const row = box("display: flex; flex-direction: row;");
    const a = box("width: 10px; height: 10px;", row);
    const b = box("width: 10px; height: 10px;", row);
    await settle();
    return rect(b).left - rect(a).left === 10 && rect(a).top === rect(b).top;
  });
  test("flex_gap", async () => {
    const row = box("display: flex; flex-direction: row; gap: 6px;");
    const a = box("width: 10px; height: 10px;", row);
    const b = box("width: 10px; height: 10px;", row);
    await settle();
    return { works: rect(b).left - rect(a).right === 6, measured: rect(b).left - rect(a).right };
  });
  test("grid", async () => {
    const g = box("display: grid; grid-template-columns: 10px 10px;");
    const a = box("height: 10px;", g);
    const b = box("height: 10px;", g);
    await settle();
    return rect(a).top === rect(b).top && rect(b).left - rect(a).left === 10;
  });
  test("position_absolute", async () => {
    const p = box("position: relative; width: 50px; height: 50px;");
    const c = box("position: absolute; left: 7px; top: 9px; width: 5px; height: 5px;", p);
    await settle();
    return rect(c).left - rect(p).left === 7 && rect(c).top - rect(p).top === 9;
  });
  test("position_sticky", () => css(box("position: sticky; top: 0;"), "position"));
  test("css_variables", async () => {
    const e = box("--probe-w: 17px; width: var(--probe-w); height: 2px;");
    await settle();
    return rect(e).width === 17;
  });
  test("calc", async () => {
    const e = box("width: calc(10px + 5px); height: 2px;");
    await settle();
    await settle();
    return rect(e).width === 15;
  });
  test("transform", async () => {
    const p = box("width: 50px; height: 10px;");
    const c = box("width: 10px; height: 10px; transform: translateX(10px);", p);
    await settle();
    return { works: rect(c).left - rect(p).left === 10, value: css(c, "transform") };
  });
  test("box_shadow", () => css(box("box-shadow: 0 1px 2px rgba(0,0,0,0.5);"), "box-shadow") || "(empty)");
  test("outline", () => css(box("outline: 2px solid red;"), "outline-width") || "(empty)");
  test("transition", () => css(box("transition: background-color 120ms linear;"), "transition-duration") || "(empty)");
  test("animation", () => css(box("animation: none 1s;"), "animation-duration") || "(empty)");
  test("cursor", () => css(box("cursor: pointer;"), "cursor") || "(empty)");
  test("font_weight_600", () => css(box("font-weight: 600;"), "font-weight"));
  test("text_overflow", async () => {
    const e = box("width: 40px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;");
    e.textContent = "a long line of text that cannot fit";
    await settle();
    return { width: rect(e).width, value: css(e, "text-overflow") };
  });
  test("media_width", async () => {
    const st = box("", doc.head || host, "style");
    st.textContent = "@media (min-width: 1px) { #cssprobe-mq { width: 13px; } }";
    const e = box("height: 2px;");
    e.id = "cssprobe-mq";
    await settle();
    const w = rect(e).width;
    st.parentNode.removeChild(st);
    return w === 13;
  });
  test("prefers_color_scheme", () => (typeof win.matchMedia === "function"
    ? { dark: win.matchMedia("(prefers-color-scheme: dark)").matches, light: win.matchMedia("(prefers-color-scheme: light)").matches }
    : "no matchMedia"));
  test("selector_not", async () => {
    const p = box("");
    box("", p).className = "a";
    box("", p).className = "b";
    return p.querySelectorAll("div:not(.a)").length === 1;
  });
  test("selector_focus_visible", async () => {
    doc.querySelector(":focus-visible");
    return true;
  });
  test("inline_svg", async () => {
    const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", "12");
    svg.setAttribute("height", "12");
    svg.setAttribute("viewBox", "0 0 24 24");
    const path = doc.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M4 12h16");
    path.setAttribute("stroke", "currentColor");
    svg.appendChild(path);
    host.appendChild(svg);
    await settle();
    return { width: rect(svg).width, height: rect(svg).height };
  });
  // 0.9.68 in Premiere: <header>/<footer> came out as centred rows, buttons kept a grey face, icons were filled
  test("element_defaults", async () => {
    const r = {};
    for (const tag of ["div", "header", "footer", "nav", "section", "p", "span"]) {
      const wrap = box("width: 300px;");
      const e = box("", wrap, tag);
      const a = box("height: 4px;", e);
      const b = box("height: 4px;", e);
      a.textContent = "a";
      b.textContent = "b";
      await settle();
      r[tag] = { display: css(e, "display"), width: rect(e).width, stacked: rect(b).top > rect(a).top,
        a_width: rect(a).width, align: css(e, "align-items") };
    }
    return r;
  });
  test("button_face", async () => {
    const made = {};
    for (const [k, style] of [["plain", ""], ["literal", "background-color: #2d5fa8;"], ["transparent", "background-color: transparent; border: none;"],
      ["padded", "padding: 2px 6px; font-size: 11px;"]]) {
      const b = box(style, host, "button");
      b.textContent = "Sync cameras";
      made[k] = b;
    }
    await settle();
    const r = {};
    for (const [k, b] of Object.entries(made)) {
      r[k] = { bg: css(b, "background-color"), border: css(b, "border-top-color"), height: rect(b).height, width: rect(b).width };
    }
    return r;
  });
  test("svg_inheritance", async () => {
    const ns = "http://www.w3.org/2000/svg";
    const svg = doc.createElementNS(ns, "svg");
    svg.setAttribute("stroke", "#999");
    svg.setAttribute("fill", "none");
    const inherited = doc.createElementNS(ns, "path");
    inherited.setAttribute("d", "M4 12h16");
    const own = doc.createElementNS(ns, "path");
    own.setAttribute("d", "M4 12h16");
    own.setAttribute("stroke", "#999");
    own.setAttribute("fill", "none");
    svg.appendChild(inherited);
    svg.appendChild(own);
    host.appendChild(svg);
    return { inherited: { stroke: css(inherited, "stroke"), fill: css(inherited, "fill") },
      own: { stroke: css(own, "stroke"), fill: css(own, "fill") } };
  });
  test("select_without_selected", async () => {
    const s = box("", host, "select");
    for (const v of ["safe", "smart"]) {
      const o = doc.createElement("option");
      o.value = v;
      o.textContent = v;
      s.appendChild(o);
    }
    return { value: s.value, index: s.selectedIndex };
  });
  test("host_theme", async () => {
    const root = doc.documentElement;
    const v = (n) => css(root, n).trim() || css(doc.body, n).trim() || null;
    return {
      background: v("--uxp-host-background-color"), text: v("--uxp-host-text-color"),
      text_secondary: v("--uxp-host-text-color-secondary"), border: v("--uxp-host-border-color"),
      link: v("--uxp-host-link-text-color"), font_size: v("--uxp-host-font-size"),
      body_font: css(doc.body, "font-family"), body_size: css(doc.body, "font-size"), body_bg: css(doc.body, "background-color"),
    };
  });

  // icons: whether an outline can be given another way than the attribute (0.9.70: `stroke` stayed "none")
  test("svg_stroke_ways", async () => {
    const ns = "http://www.w3.org/2000/svg";
    const r = {};
    for (const [way, set] of [["style", (e) => e.setAttribute("style", "stroke: #999; fill: none; stroke-width: 2px;")],
      ["class", (e) => e.setAttribute("class", "cssprobe-stroke")]]) {
      const svg = doc.createElementNS(ns, "svg");
      svg.setAttribute("width", "16");
      svg.setAttribute("height", "16");
      svg.setAttribute("viewBox", "0 0 24 24");
      const path = doc.createElementNS(ns, "path");
      path.setAttribute("d", "M4 12h16");
      set(path);
      svg.appendChild(path);
      host.appendChild(svg);
      r[way] = { el: path, svg };
    }
    const st = box("", doc.head || host, "style");
    st.textContent = ".cssprobe-stroke { stroke: #999; fill: none; stroke-width: 2px; }";
    await settle();
    const res = {};
    for (const [way, x] of Object.entries(r)) res[way] = { stroke: css(x.el, "stroke"), width: rect(x.svg).width };
    st.parentNode.removeChild(st);
    return res;
  });
  // the built-in Spectrum widgets: do they exist here, and what size does a button get
  test("spectrum_widgets", async () => {
    const r = {};
    for (const [tag, attrs] of [["sp-button", { variant: "cta" }], ["sp-button", { variant: "secondary" }],
      ["sp-action-button", { quiet: "" }], ["sp-picker", {}], ["sp-checkbox", {}], ["sp-textfield", {}], ["sp-progressbar", {}]]) {
      const e = doc.createElement(tag);
      for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
      e.textContent = "Sync cameras";
      host.appendChild(e);
      r[`${tag}${attrs.variant ? `.${attrs.variant}` : ""}${"quiet" in attrs ? ".quiet" : ""}`] = e;
    }
    await settle();
    const out2 = {};
    for (const [k, e] of Object.entries(r)) {
      out2[k] = { width: rect(e).width, height: rect(e).height, defined: !!(win.customElements && win.customElements.get && win.customElements.get(e.tagName.toLowerCase())),
        has_disabled: "disabled" in e };
    }
    return out2;
  });

  for (const [name, fn] of tests) {
    try {
      out[name] = await fn();
    } catch (err) {
      out[name] = `error: ${(err && err.message) || err}`;
    }
  }
  host.parentNode.removeChild(host);
  return out;
}

module.exports = { cssProbe };
