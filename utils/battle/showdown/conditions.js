// ==========================================================
// utils/battle/showdown/conditions.js — what a fight's status tags and
// stat chips show (Battle FX spec, docs/superpowers/specs/2026-11-13-battle-fx-design.md).
//
// Read from the engine's own state rather than rebuilt from the log: the
// log alone misses Baton Pass, Psych Up and Transform. simulateFull reads
// it once before the leads come in, then after every turn (drive's onTurn),
// into result.conditions, indexed like result.snapshots.
// ==========================================================

import { slotOf } from "./engine.js";

/**
 * { status: [side][slot] "" | "brn" | "psn" | "tox" | "par" | "slp" | "frz"
 *   ("" when healthy or fainted),
 *   active: [side] { slot, boosts (nonzero stats only), confused, seeded } | null }.
 * `before`: nobody is in front yet. `sizes`: each side's Team size, so a
 * member left out of the fight (fainted in an earlier Elite Four fight)
 * still has its slot.
 */
export function readConditions(b, { before = false, sizes = null } = {}) {
  const status = b.sides.map((side, i) => {
    const row = Array.from({ length: sizes?.[i] ?? 0 }, () => "");
    for (const p of side.pokemon) row[slotOf(p)] = p.hp > 0 && p.status !== "fnt" ? p.status || "" : "";
    return Array.from(row, (v) => v ?? "");
  });
  const active = b.sides.map((side) => {
    const p = side.active[0];
    if (before || !p || p.hp <= 0) return null;
    const boosts = Object.fromEntries(Object.entries(p.boosts).filter(([, n]) => n !== 0));
    return { slot: slotOf(p), boosts, confused: "confusion" in p.volatiles, seeded: "leechseed" in p.volatiles };
  });
  return { status, active };
}
