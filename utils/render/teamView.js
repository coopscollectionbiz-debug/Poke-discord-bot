// ==========================================================
// utils/render/teamView.js
// The read-only view model behind team images: a player's Team exactly as
// battles use it (buildTeam: slot order, owned variants only), plus the
// display facts each slot needs. Pure: never mutates the player record.
//
// Only data the game really has is exposed. The game has no nicknames,
// abilities, natures, IVs/EVs, held items or persistent HP/status (see
// docs/design/VISUAL-UX-AUDIT.md), so none are invented here.
// ==========================================================

import fs from "fs";
import { buildTeam, teamForPick } from "../battle/runBattle.js";
import { getSpecies, getMove } from "../battle/data.js";
import { computeStats } from "../battle/stats.js";
import { autoMoveset } from "../battle/moveset.js";
import { teamPower } from "../battle/power.js";
import { getTraining, expForLevel } from "../training.js";
import { LEVEL_CAP } from "../battle/tuning.js";
import { rankedRecord } from "../battle/rewards.js";
import { getRank } from "../rankSystem.js";
import { TYPE_ID_TO_NAME } from "../battle/data.js";
import { displaySpeciesName } from "./names.js";
import { megaShortName, teamMegaStatus } from "../megaDisplay.js";
import { copyTraining } from "../../services/box.js";
import { megaFormGate, megaBattleProfile } from "../megas.js";
import { isMegaCapabilityEnabled } from "../../config/features.js";

const POKEMON = JSON.parse(fs.readFileSync(new URL("../../pokemonData.json", import.meta.url), "utf8"));

/** EXP progress through the current Level, 0..1 (1 at the Level cap). */
export function expProgress(exp, level) {
  if (level >= LEVEL_CAP) return 1;
  const lo = expForLevel(level), hi = expForLevel(level + 1);
  return hi > lo ? Math.max(0, Math.min(1, (exp - lo) / (hi - lo))) : 0;
}

/**
 * One slot's display facts, from species data and the player's training.
 * A member that battles as a Mega (buildTeam: validated, fail-closed) shows
 * the Mega's name, sprite, types and stats; its Level, EXP, rarity, Pokédex
 * number and moves stay the base line's, exactly as in battle.
 */
export function slotView(user, member, index) {
  const { speciesId: id, variant, level } = member;
  const entry = POKEMON[id] ?? {};
  const species = getSpecies(id);
  const profile = member.megaForm ? member.battleProfile : null;
  const types = profile ? [...profile.types] : species?.types ?? (entry.types ?? []).map((t) => TYPE_ID_TO_NAME[t]).filter(Boolean);
  // The slot's own copy (docs/adr/0001); the line's best copy for older callers.
  const { exp } = (member.copyUid && copyTraining(user, member.copyUid)) || getTraining(user, id, variant);
  const statBase = profile?.baseStats ?? species?.baseStats;
  const stats = statBase ? computeStats(statBase, level) : null;
  const baseName = displaySpeciesName(id, entry.name ?? member.baseName ?? member.name);
  return {
    slot: index + 1,
    id,
    spriteId: profile ? member.megaForm : id,
    mega: profile ? { formId: member.megaForm, name: profile.name, shortName: megaShortName(member.megaForm), baseName } : null,
    name: profile ? profile.name : baseName,
    variant,
    shiny: variant === "shiny",
    level,
    expFrac: expProgress(exp, level),
    types,
    tier: String(entry.tier ?? "common").toLowerCase(),
    region: entry.region ?? null,
    generation: entry.generation ?? null,
    stats,
    statTotal: stats ? stats.hp + stats.atk + stats.def + stats.spa + stats.spd + stats.spe : null,
    // The moves this member battles with: the team's chosen moveset (member.moves), else automatic.
    moves: species ? (Array.isArray(member.moves) && member.moves.length ? member.moves : autoMoveset(id, level)).map((m) => getMove(m)?.name ?? m) : [],
  };
}

function inactiveMegaMessage(user, env) {
  const mega = teamMegaStatus(user, { env });
  return mega && !mega.active ? mega.message : null;
}

/**
 * The whole team image's data.
 * - members: the battle Team (owned slots, in order)
 * - fallback: true when the player has no Team and the image shows the
 *   first owned Pokémon instead (the current /showteam behavior, kept)
 */
export function buildTeamView(user, { displayName = "Trainer", trainerFile = null, env = process.env, pick = null } = {}) {
  // pick ("casual" | "ranked"): the team a /challenge or encounter fights with, at real Levels.
  let members = pick ? teamForPick(user ?? {}, pick, { env }) : buildTeam(user ?? {}, { env });
  let fallback = false;
  if (!members.length) {
    // Same rule as today's /showteam: first six owned species, normal variant.
    const owned = Object.keys(user?.pokemon ?? {})
      .filter((k) => /^\d+$/.test(k) && (user.pokemon[k]?.normal ?? 0) > 0)
      .map(Number).slice(0, 6);
    members = owned.map((id) => ({ speciesId: id, variant: "normal", name: POKEMON[id]?.name, level: getTraining(user, id, "normal").level }));
    fallback = members.length > 0;
  }
  const slots = members.map((m, i) => slotView(user, m, i));
  const known = members.filter((m) => getSpecies(m.speciesId));
  return {
    displayName,
    rank: getRank(user?.tp ?? 0) ?? "Unranked", // getRank is null under 100 TP; no rank name is invented
    tp: Math.floor(user?.tp ?? 0),
    trainerFile: trainerFile ?? user?.displayedTrainer ?? null,
    // This season's ranked record (null before the first ranked battle of the season).
    battle: (() => { const r = rankedRecord(user); return r.wins + r.losses > 0 ? r : null; })(),
    power: known.length ? teamPower(known) : 0,
    slots,
    fallback,
    // A selected Mega that can't battle right now: shown as its base form,
    // with this one-line reason (null when there's nothing to explain).
    megaNotice: fallback ? null : inactiveMegaMessage(user, env),
  };
}

/**
 * The Showcase team as a team image (CONTEXT.md "Showcase team"): favorites
 * at their real Levels, any number of Megas (shown while Mega teams are on),
 * repeats as separate copies. No Team power, rating or record: it never
 * fights. stats/emptyNote tell the refined renderer what to show instead.
 */
export function buildShowcaseView(user, { displayName = "Trainer", trainerFile = null, env = process.env } = {}) {
  const megaOn = isMegaCapabilityEnabled("team", env);
  const members = (Array.isArray(user?.showcaseTeam) ? user.showcaseTeam : []).flatMap((s) => {
    const t = s.uid ? copyTraining(user, s.uid) : null;
    if (!t) return [];
    const member = { speciesId: Number(s.id), variant: s.variant === "shiny" ? "shiny" : "normal", level: t.level, copyUid: s.uid };
    if (s.mega && megaOn && megaFormGate(s.mega, "team", { env }).allowed) {
      const profile = megaBattleProfile(s.mega);
      if (profile) Object.assign(member, { megaForm: s.mega, battleProfile: profile });
    }
    return [member];
  });
  const slots = members.map((m, i) => ({ ...slotView(user, m, i), noLead: true })); // never fights: no lead
  const megas = slots.filter((s) => s.mega).length;
  const shiny = slots.filter((s) => s.shiny).length;
  return {
    kind: "showcase",
    displayName,
    rank: getRank(user?.tp ?? 0) ?? "Unranked",
    tp: Math.floor(user?.tp ?? 0),
    trainerFile: trainerFile ?? user?.displayedTrainer ?? null,
    battle: null,
    power: 0,
    slots,
    fallback: false,
    megaNotice: null,
    stats: [["FAVORITES", String(slots.length)], ...(megas ? [["MEGAS", String(megas)]] : []), ...(shiny ? [["SHINY", String(shiny)]] : [])],
    emptyNote: slots.length ? null : "No favorites picked yet. Pick them on the Teams page: run /dashboard.",
  };
}
