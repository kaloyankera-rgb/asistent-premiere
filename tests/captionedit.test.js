const test = require("node:test");
const assert = require("node:assert");
const { pairsFor, pairsFromEdits, addToNotes } = require("../panel/captionedit.js");

test("one changed word is one correction", () => {
  assert.deepStrictEqual(pairsFor("мога и един раф", "мога и един рафт"), [{ heard: "раф", said: "рафт" }]);
  assert.deepStrictEqual(pairsFor("сума ти нища", "сума ти неща"), [{ heard: "нища", said: "неща" }]);
});

test("a changed stretch of several words is one correction, punctuation and case alone are not corrections", () => {
  assert.deepStrictEqual(pairsFor("само една стена ще чакай да бъде ти", "само една стена трябваше да боядисам"),
    [{ heard: "ще чакай да бъде ти", said: "трябваше да боядисам" }]);
  assert.deepStrictEqual(pairsFor("Добре, я да видим", "добре я да видим!"), []);
});

test("a short word that changed is anchored by its neighbour, so it is not replaced everywhere", () => {
  assert.deepStrictEqual(pairsFor("той за градината", "то и за градината"), [{ heard: "той", said: "то и" }]);
  assert.deepStrictEqual(pairsFor("ще чакай", "ще чакам"), [{ heard: "чакай", said: "чакам" }]);
});

test("an added or a removed word is anchored on its neighbour", () => {
  assert.deepStrictEqual(pairsFor("ето това", "ето само това"), [{ heard: "ето", said: "ето само" }]);
  assert.deepStrictEqual(pairsFor("ето само това", "ето това"), [{ heard: "ето само", said: "ето" }]);
  assert.deepStrictEqual(pairsFor("само това", "най-вече това"), [{ heard: "само", said: "най-вече" }]);
});

test("two separate changes in one caption are two corrections; with one short word between they are one phrase", () => {
  assert.deepStrictEqual(pairsFor("раф и нища днес", "рафт и неща днес"), [{ heard: "раф и нища", said: "рафт и неща" }]);
  assert.deepStrictEqual(pairsFor("раф днес ще нища", "рафт днес ще неща"), [{ heard: "раф", said: "рафт" }, { heard: "нища", said: "неща" }]);
});

test("an emptied caption or an untouched one gives nothing", () => {
  assert.deepStrictEqual(pairsFor("ето това", ""), []);
  assert.deepStrictEqual(pairsFor("ето това", "ето това"), []);
});

test("captions: only the edited ones count, line breaks are spaces, the same pair is added once", () => {
  const caps = [{ text: "мога и един\nраф" }, { text: "втори раф" }, { text: "без промяна" }];
  assert.deepStrictEqual(pairsFromEdits(caps, ["мога и един рафт", "втори рафт", "без промяна"]), [{ heard: "раф", said: "рафт" }]);
  assert.deepStrictEqual(pairsFromEdits(caps, [undefined, null, "без промяна"]), []);
});

test("the corrections box: new lines are added, a line for the same heard words is replaced, other lines stay", () => {
  const notes = "# note\nДжи Строй\nраф => рафт";
  assert.strictEqual(addToNotes(notes, [{ heard: "нища", said: "неща" }]), "# note\nДжи Строй\nраф => рафт\nнища => неща");
  assert.strictEqual(addToNotes(notes, [{ heard: "Раф", said: "рафта" }]), "# note\nДжи Строй\nРаф => рафта");
  assert.strictEqual(addToNotes("", [{ heard: "а", said: "б" }]), "а => б");
});
