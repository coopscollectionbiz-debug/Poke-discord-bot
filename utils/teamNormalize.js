// utils/teamNormalize.js
// ===========================================================
// ✅ Team Normalization (variant-safe)
// - Accepts legacy teams: [25, 6, "131"]
// - Accepts new teams: [{ id: 25, variant: "normal"|"shiny" }, ...]
// - Clamps to 6
// - Dedupes by (id + variant)
// - Drops invalid entries safely
// ===========================================================

export function normVariant(v) {
  return String(v || "normal").toLowerCase() === "shiny" ? "shiny" : "normal";
}

function toTeamObj(entry) {
  // legacy number
  if (typeof entry === "number" && Number.isInteger(entry)) {
    return { id: entry, variant: "normal" };
  }

  // legacy numeric string
  if (typeof entry === "string") {
    const n = Number(entry);
    return Number.isInteger(n) ? { id: n, variant: "normal" } : null;
  }

  // new object shape
  if (entry && typeof entry === "object") {
    // allow { id } or { pokeId } just in case older code used it
    const rawId = entry.id ?? entry.pokeId ?? entry.pokemonId;
    const pid = Number(rawId);
    if (!Number.isInteger(pid) || pid <= 0) return null;

    return { id: pid, variant: normVariant(entry.variant) };
  }

  return null;
}

function teamKey(slot) {
  return `${Number(slot.id)}:${normVariant(slot.variant)}`;
}

/**
 * Normalize any "team-like" input into:
 *   [{ id: Number, variant: "normal"|"shiny" }, ...] (max 6, unique by id+variant)
 */
export function normalizeTeam(rawTeam) {
  const arr = Array.isArray(rawTeam) ? rawTeam : [];
  const mapped = arr.map(toTeamObj).filter(Boolean);

  const seen = new Set();
  const out = [];

  for (const slot of mapped) {
    const normalized = { id: Number(slot.id), variant: normVariant(slot.variant) };
    const k = teamKey(normalized);
    if (seen.has(k)) continue;
    seen.add(k);

    out.push(normalized);
    if (out.length >= 6) break;
  }

  return out;
}

/**
 * Optional helper: ensure a team is exactly length N (pads with nulls).
 * Useful if some UI expects fixed 6 slots.
 */
export function normalizeTeamToFixed(rawTeam, size = 6) {
  const team = normalizeTeam(rawTeam);
  while (team.length < size) team.push(null);
  return team.slice(0, size);
}

/**
 * Optional helper: convert normalized team back to legacy [id, id, ...]
 * (drops variant info).
 */
export function toLegacyTeamIds(rawTeam) {
  return normalizeTeam(rawTeam).map((s) => s.id);
}
