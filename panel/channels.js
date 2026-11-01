// What a clip's effect chain does to its two channels. Pure logic, tested with node.

const RE = {
  fillLL: /fill\s*right\s*with\s*left/i,        // right := left  -> L/L
  fillRR: /fill\s*left\s*with\s*right/i,        // left := right  -> R/R
  swap: /swap\s*channels/i,
};

// effect names in chain order -> "LL", "RR" or null (both sides still play their own channel)
function routeOf(names) {
  let ch = ["L", "R"];
  for (const n of names) {
    if (RE.fillLL.test(n)) ch = [ch[0], ch[0]];
    else if (RE.fillRR.test(n)) ch = [ch[1], ch[1]];
    else if (RE.swap.test(n)) ch = [ch[1], ch[0]];
  }
  if (ch[0] === "L" && ch[1] === "L") return "LL";
  if (ch[0] === "R" && ch[1] === "R") return "RR";
  return null;
}

module.exports = { routeOf, RE };
