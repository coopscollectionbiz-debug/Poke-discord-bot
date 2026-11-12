// ==========================================================
// utils/liveEventText.js — Live events in words, for players.
// Used by /events, the start/end posts and the dashboard APIs.
// ==========================================================

import { DISCOUNT_CATEGORIES } from "./liveEventRules.js";
import { getSpeciesEntry } from "./speciesCatalog.js";

const x = (v) => `×${Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const join = (a) => (a.length <= 2 ? a.join(" and ") : `${a.slice(0, -1).join(", ")} and ${a.at(-1)}`);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** "Kanto Water Pokémon", "Pikachu and Eevee", "legendary Pokémon". */
export function targetText(match = {}) {
  const species = (match.species || []).map((id) => getSpeciesEntry(id)?.name ?? `#${id}`);
  const parts = [
    ...(match.regions || []).length ? [join(match.regions)] : [],
    ...(match.tiers || []).length ? [join(match.tiers)] : [],
    ...(match.types || []).length ? [`${join(match.types)}-type`] : [],
  ];
  if (species.length && !parts.length) return join(species);
  const what = parts.length ? `${parts.join(" ")} Pokémon` : "Pokémon";
  return species.length ? `${what} (only ${join(species)})` : what;
}

/** One effect as a short sentence. */
export function effectText(f) {
  switch (f.kind) {
    case "catchBoost": return `${cap(targetText(f.match))} turn up ${x(f.value)} as often`;
    case "catchLimit": return `Only ${targetText(f.match)} can be caught`;
    case "shiny": return `Shiny chance ${x(f.value)}`;
    case "catchRate": return `Chance of a catch while chatting ${x(f.value)}`;
    case "exp": return `Battle EXP ${x(f.value)}${(f.match?.types || []).length ? ` for ${join(f.match.types)}-type Pokémon` : ""}`;
    case "tp": return `TP from chatting ${x(f.value)}`;
    case "cc": return `CC earned ${x(f.value)}`;
    case "dust": return `Shiny Dust earned ${x(f.value)}`;
    case "discount": return `${f.value}% off ${join((f.categories || []).map((c) => DISCOUNT_CATEGORIES[c] ?? c))}`;
    case "encounterRate": return `Trainer encounters ${x(f.value)} as likely`;
    case "prize": return `Trainer encounter wins pay ${x(f.value)}`;
    case "battleCap": return `+${f.value} battle${f.value === 1 ? "" : "s"} per day`;
    default: return f.kind;
  }
}

/** Discord timestamp: each reader sees their own local time. */
export const discordTime = (ms, style = "f") => `<t:${Math.floor(ms / 1000)}:${style}>`;

/** Player-facing view of one event (no admin fields). */
export const publicEvent = (e, status, endAt) => ({
  id: e.id,
  name: e.name,
  status,
  startAt: e.startAt,
  endAt,
  effects: e.effects.map((f) => ({ kind: f.kind, text: effectText(f) })),
});
