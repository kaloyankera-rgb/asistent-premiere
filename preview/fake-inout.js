// A stand-in for panel/premiere-inout.js in the browser preview: the page's Apply and Remove get made-up results (no Premiere).
window.PREVIEW_INOUT = {
  apply: async (project, opts) => ({
    clips: 2, steps: 2, keys: 148, shortened: ["Interview A"],
    skipped: [{ name: "Clip C", why: "it is reversed: reversed clips are not animated" }],
    notes: [], opts,
  }),
  remove: async () => ({ clips: 0, skipped: [{ name: "Clip C", why: "it has no In/Out animation" }], steps: 0 }),
  info: async () => ({ fps: 30, clips: [] }),
  isTagged: () => false,
  TAG: 17.25,
};
