// ==========================================================
// tools/cpu-profile-top.mjs — where a .cpuprofile spent its time.
//   node --cpu-prof --cpu-prof-dir=prof tools/bench-render-threads.mjs --child 0
//   node tools/cpu-profile-top.mjs prof/*.cpuprofile [top=25]
// Prints self time per function (file:line) and per file, as % of samples.
// ==========================================================

import { readFileSync } from "fs";

const args = process.argv.slice(2);
const top = Number(args.find((a) => /^\d+$/.test(a)) ?? 25);
const files = args.filter((a) => !/^\d+$/.test(a));
const byFn = new Map(), byFile = new Map();
let total = 0;

for (const file of files) {
  const prof = JSON.parse(readFileSync(file, "utf8"));
  const nodes = new Map(prof.nodes.map((n) => [n.id, n]));
  const counts = new Map();
  for (const id of prof.samples) counts.set(id, (counts.get(id) ?? 0) + 1);
  for (const [id, c] of counts) {
    const { functionName, url, lineNumber } = nodes.get(id).callFrame;
    const short = (url || "(native)").replace(/^.*\/(node_modules\/[^/]+|utils|commands|tools)\//, "$1/");
    const fn = `${functionName || "(anon)"}  ${short}:${lineNumber + 1}`;
    byFn.set(fn, (byFn.get(fn) ?? 0) + c);
    byFile.set(short, (byFile.get(short) ?? 0) + c);
    total += c;
  }
}

const show = (map, n) => [...map].sort((a, b) => b[1] - a[1]).slice(0, n)
  .map(([k, c]) => ({ "%": +((100 * c) / total).toFixed(1), where: k }));
console.log(`${total} samples`);
console.table(show(byFile, 12));
console.table(show(byFn, top));
