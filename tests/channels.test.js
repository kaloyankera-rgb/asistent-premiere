// node --test tests/channels.test.js
const test = require("node:test");
const assert = require("node:assert");
const { routeOf } = require("../panel/channels.js");

test("no routing effect: both channels play their own side", () => {
  assert.strictEqual(routeOf(["Volume", "Channel Volume", "Panner"]), null);
});

test("the two Fill effects", () => {
  assert.strictEqual(routeOf(["Volume", "Fill Right with Left"]), "LL");
  assert.strictEqual(routeOf(["Volume", "Fill Left with Right"]), "RR");
});

test("split in one step: Swap in front of Fill Left with Right gives L/L on the original", () => {
  // original after the step: Volume, Swap Channels, Fill Left with Right -> L/L ; copy: Volume, Fill Left with Right -> R/R
  assert.strictEqual(routeOf(["Volume", "Swap Channels", "Fill Left with Right"]), "LL");
  assert.strictEqual(routeOf(["Volume", "Fill Left with Right", "Swap Channels"]), "RR");
  assert.strictEqual(routeOf(["Swap Channels"]), null);
});
