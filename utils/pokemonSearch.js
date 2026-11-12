// ==========================================================
// utils/pokemonSearch.js: finding a Pokémon by what a player typed.
// Used by /pokedex (autocomplete while typing, and "Did you mean" when a
// misspelled name is sent anyway). Pure; no player data is changed.
// ==========================================================

/** Lowercase letters and digits only: "Mr. Mime" → "mrmime", "Farfetch'd" → "farfetchd". */
export const searchKey = (s) => String(s ?? "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");

/**
 * Autocomplete choices: up to `limit` { name, value } (value = dex number).
 * Order: names starting with the text, then names containing it, then a dex
 * number match; Pokémon the player owns come first within each group.
 * `list`: [{ id, name }] (released species only, plus owned ones).
 */
export function autocompleteChoices(query, list, { owned = new Set(), limit = 25 } = {}) {
  const q = searchKey(query);
  const num = /^#?\d+$/.test(String(query).trim()) ? Number(String(query).trim().replace("#", "")) : null;
  const rank = (p) => {
    const k = searchKey(p.name);
    if (!q) return 0;
    if (k.startsWith(q)) return 1;
    if (k.includes(q)) return 2;
    if (num != null && String(p.id).startsWith(String(num))) return 3;
    return null;
  };
  return list
    .map((p) => ({ p, r: rank(p) }))
    .filter((x) => x.r != null)
    .sort((a, b) => a.r - b.r || (owned.has(b.p.id) - owned.has(a.p.id)) || a.p.id - b.p.id)
    .slice(0, limit)
    .map(({ p }) => ({ name: `${p.name} · #${String(p.id).padStart(4, "0")}${owned.has(p.id) ? " · owned" : ""}`.slice(0, 100), value: String(p.id) }));
}

/** Edit distance (insert / delete / substitute / swap of neighbours). */
export function editDistance(a, b) {
  const m = a.length, n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[m][n];
}

/**
 * A misspelled name: { match } when one Pokémon is a clear winner (close,
 * and clearly closer than the next), else { suggestions: up to 3 } (may be
 * empty when nothing is close).
 */
export function closestPokemon(query, list) {
  const q = searchKey(query);
  if (!q) return { suggestions: [] };
  // Part of a name ("char"): one such Pokémon opens, several are offered.
  const starts = list.filter((p) => searchKey(p.name).startsWith(q)).sort((a, b) => a.id - b.id);
  if (starts.length === 1) return { match: starts[0] };
  if (starts.length > 1) return { suggestions: starts.slice(0, 3) };
  const scored = list
    .map((p) => {
      const k = searchKey(p.name);
      // A shared start counts for a lot ("charmel" → Charmeleon).
      const dist = editDistance(q, k.slice(0, Math.max(q.length, k.length)));
      const prefix = k.startsWith(q.slice(0, 3)) ? -0.5 : 0;
      return { p, score: dist + prefix };
    })
    .sort((a, b) => a.score - b.score || a.p.id - b.p.id);
  const maxScore = Math.max(2, Math.floor(q.length / 3)); // a typo per ~3 letters
  const close = scored.filter((s) => s.score <= maxScore);
  if (close.length && (close.length === 1 || close[1].score - close[0].score >= 1.5) && close[0].score <= 2) return { match: close[0].p };
  return { suggestions: close.slice(0, 3).map((s) => s.p) };
}
