// The visible pixels of a still for the Anchor page's Use alpha (0.10.69): Asistent's engine reads the file directly
// (engine/asistent/anchoralpha.py), so no file dialog is needed (Anchor Studio asked for the same PNG once, since a UXP
// panel may only read files the user picked) and big images are no problem. Same interface as Anchor Studio's
// alpha-source.js: bounds(path, [width, height], cutoff %, invert alpha, progress) -> {x, y, width, height} in source pixels.
const engine = require("./engine.js");

async function bounds(path, dimensions, threshold, invert, progress) {
  if (progress) progress("Reading the visible pixels…");
  const r = await engine.anchorAlpha(path, threshold, !!invert);
  if (r.width !== dimensions[0] || r.height !== dimensions[1]) {
    throw new Error("The image's size does not match Premiere's source size. No clips were changed.");
  }
  return Object.assign({}, r.bounds);
}

module.exports = { bounds };
