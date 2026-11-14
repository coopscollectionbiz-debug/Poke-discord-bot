// ======================================================================
// TM list filter and sort (Shop · Technical Machines). No DOM, so tests
// can import it: tests/power50.test.js.
// ======================================================================

const byName = (a, b) => a.name.replace(/^TM\d*\s*/, "").localeCompare(b.name.replace(/^TM\d*\s*/, ""));
const movePower = (t) => (Number.isFinite(Number(t.power)) ? Number(t.power) : 0);
const SORT_FNS = {
  learners: (a, b) => b.teaches - a.teaches || a.price - b.price || byName(a, b),
  power: (a, b) => movePower(b) - movePower(a) || b.teaches - a.teaches || byName(a, b),
  "price-asc": (a, b) => a.price - b.price || byName(a, b),
  "price-desc": (a, b) => b.price - a.price || byName(a, b),
  name: byName,
};

export function filterTms(tms, { q = "", type = "", tier = "", mine = false, cat = "", sort = "learners" } = {}) {
  return tms
    .filter((t) => (!q || t.name.toLowerCase().includes(q)) && (!type || t.type === type) && (!tier || t.tier === tier) && (!cat || t.category === cat) && (!mine || t.teaches > 0))
    .sort(SORT_FNS[sort] ?? SORT_FNS.learners);
}
