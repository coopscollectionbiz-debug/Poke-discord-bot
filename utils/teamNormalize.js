export function normVariant(v) {
  const s = String(v ?? "normal").toLowerCase().trim();
  return s === "shiny" ? "shiny" : "normal";
}

export function toTeamObj(entry) {
  if (typeof entry === "number") return Number.isInteger(entry) ? { id: entry, variant: "normal" } : null;
  if (typeof entry === "string") {
    const n = Number(entry);
    return Number.isInteger(n) ? { id: n, variant: "normal" } : null;
  }
  if (entry && typeof entry === "object") {
    const id = Number(entry.id);
    if (!Number.isInteger(id)) return null;

    const legacyIsShiny = entry.variant == null && (entry.shiny === true || entry.isShiny === true);
    return { id, variant: legacyIsShiny ? "shiny" : normVariant(entry.variant) };
  }
  return null;
}

export function normalizeTeam(rawTeam, maxSize = 6) {
  const arr = Array.isArray(rawTeam) ? rawTeam : [];
  const mapped = arr.map(toTeamObj).filter(Boolean);

  const seen = new Set();
  const out = [];

  for (const slot of mapped) {
    const clean = { id: Number(slot.id), variant: normVariant(slot.variant) };
    const k = `${clean.id}:${clean.variant}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(clean);
    if (out.length >= maxSize) break;
  }
  return out;
}
