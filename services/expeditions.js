// ==========================================================
// services/expeditions.js: Expeditions (Quests, Phase 2).
// docs/audits/economy-2026-11/REPORT.md, Q3.
//
// Every UTC day has the same 4 Missions for everyone (seeded by the date):
// 2, 4, 8 and 12 hours, each with a Level and 1 to 3 threat types. A player
// sends a party of 1 to 3 Copies on a Mission (each Mission once a day, 2
// running at once). Sent copies leave every Team and the Collection until
// the Expedition is claimed (services/box.js sendCopyAway / returnCopy), so
// nothing else can touch them while they're away.
//
// Success chance: 35% + 60% x (threats countered / threats), +1% per Level
// the party average is above the Mission Level, -3% per Level below,
// clamped to 5%..95%. A copy counters a threat when one of its types is
// super-effective against it. The outcome (success, bonus roll, loot draws)
// comes from a seed stored at send, so waiting or claiming twice changes
// nothing.
//
//   user.expeditions = {
//     running: [{ id, mission, sentAt, endsAt, party: [{ uid, rec, custom, teams }], chance, seed, success, bonus }],
//     taken:   { day, missions: [0, 2] },
//     caps:    { key: "2026-W46", stones, dust, pokemon, tms },
//   }
//
// Pure and synchronous: callers hold the user's lock and save afterwards.
// Sending needs QUESTS_ENABLED and QUESTS_EXPEDITIONS_ENABLED; claiming
// always works, so turning the switch off never strands a copy.
// ==========================================================

import { createRng } from "../utils/battle/rng.js";
import { TYPE_ID_TO_NAME, effectiveness } from "../utils/battle/data.js";
import { koExp } from "../utils/battle/rewards.js";
import { WIN_EXP_MULT } from "../utils/battle/tuning.js";
import { levelForExp } from "../utils/training.js";
import { getISOWeekKeyUTC } from "../utils/economyRules.js";
import { getSpeciesEntry } from "../utils/speciesCatalog.js";
import { sendCopyAway, returnCopy, copyTraining } from "./box.js";
import { reconcileTeamEquipment, EDITABLE_TEAMS } from "./heldItems.js";
import { questsEnabled } from "./quests.js";

const TRUE = new Set(["1", "true", "yes", "on"]);
/** Can players send Expeditions? Needs the Quests switch too. Default: false. */
export const expeditionsEnabled = (env = process.env) =>
  questsEnabled(env) && TRUE.has(String(env.QUESTS_EXPEDITIONS_ENABLED ?? "").trim().toLowerCase());

const HOUR = 3_600_000;
export const LENGTHS = Object.freeze([2, 4, 8, 12]);
const LEVEL_BY_LENGTH = Object.freeze({ 2: 15, 4: 30, 8: 40, 12: 60 });
const THREATS_BY_LENGTH = Object.freeze({ 2: 1, 4: 2, 8: 2, 12: 3 });
export const RUNNING_MAX = 2;
export const PARTY_MAX = 3;

// Loot (D9, economy audit 2026-11). Per success; a failure pays FAIL_CC_PER_HOUR and FAIL_EXP_SHARE.
export const LOOT = Object.freeze({
  ccPerHour: 15,
  stoneChance: Object.freeze({ 2: 0.1, 4: 0.2, 8: 0.4, 12: 0.6 }),
  dust: Object.freeze({ 2: 0, 4: 1, 8: 2, 12: 3 }),
  pokemonChance: Object.freeze({ 2: 0, 4: 0, 8: 0.05, 12: 0.1 }),
  tmChance: Object.freeze({ 2: 0, 4: 0, 8: 0, 12: 0.02 }),
  bonusChance: 0.2, // half x2 EXP, half one extra loot draw
  failCcPerHour: 5,
  failExpShare: 0.25,
});
/** Most an ISO week (UTC) of Expedition claims can pay of each item. */
export const WEEK_CAPS = Object.freeze({ stones: 5, dust: 15, pokemon: 2, tms: 1 });
// EXP: one won Casual battle against 3 foes at the Mission's Level. The foe
// is a fixed mid-strength species (Pidgeot, Base stat total 479).
const REF_FOE = 18;
const FOES = 3;

// A place for each lead threat type (generic, not from any game).
const PLACES = Object.freeze({
  Normal: "Quiet Meadow", Fighting: "Training Grounds", Flying: "Windy Cliffs", Poison: "Toxic Marsh",
  Ground: "Dusty Canyon", Rock: "Boulder Pass", Bug: "Buzzing Woods", Ghost: "Old Tower", Steel: "Iron Works",
  Fire: "Volcano Ridge", Water: "Sea Cave", Grass: "Tall Grass", Electric: "Power Station", Psychic: "Strange Garden",
  Ice: "Frozen Lake", Dragon: "Dragon Peak", Dark: "Shadow Alley", Fairy: "Moonlit Glade",
});
const TYPE_NAMES = Object.values(TYPE_ID_TO_NAME);

const utcDayOf = (now) => new Date(now).toISOString().slice(0, 10);
function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/** The day's 4 Missions, the same for every player. */
export function missionsFor(day) {
  const rng = createRng(hash(`missions:${day}`));
  return LENGTHS.map((hours, index) => {
    const pool = [...TYPE_NAMES];
    const threats = [];
    for (let k = 0; k < THREATS_BY_LENGTH[hours]; k++) threats.push(pool.splice(rng.int(pool.length), 1)[0]);
    const level = LEVEL_BY_LENGTH[hours] + rng.int(11) - 5;
    return Object.freeze({ id: `${day}:${index}`, index, day, name: PLACES[threats[0]], hours, level, threats: Object.freeze(threats) });
  });
}

/** Attacking types that are super-effective against a threat type. */
export const countersOf = (threat) => TYPE_NAMES.filter((t) => effectiveness(t, [threat]) > 1);

const typesOf = (speciesId) => (getSpeciesEntry(speciesId)?.types ?? []).map((t) => TYPE_ID_TO_NAME[t] ?? String(t));

/** Success chance (0..1) for a party: [{ id (species), level }]. */
export function successChance(mission, party) {
  if (!party.length) return 0;
  const countered = mission.threats.filter((th) => party.some((c) => typesOf(c.id).some((t) => effectiveness(t, [th]) > 1))).length;
  const avg = party.reduce((t, c) => t + c.level, 0) / party.length;
  const diff = avg - mission.level;
  const adj = diff >= 0 ? diff * 0.01 : diff * 0.03;
  const p = 0.35 + 0.6 * (countered / mission.threats.length) + adj;
  return Math.round(Math.min(0.95, Math.max(0.05, p)) * 100) / 100;
}

/** EXP one copy at `level` earns from a successful Mission at `missionLevel`. */
export const missionExp = (missionLevel, level) =>
  Math.floor(koExp({ foeSpeciesId: REF_FOE, foeLevel: missionLevel, recipientLevel: level }) * FOES * WIN_EXP_MULT);

/** Bring user.expeditions to the current day and week, repairing bad data. */
export function ensureExpeditions(user, now = Date.now()) {
  let x = user.expeditions;
  if (!x || typeof x !== "object" || Array.isArray(x)) x = user.expeditions = {};
  if (!Array.isArray(x.running)) x.running = [];
  x.running = x.running.filter((e) => e && typeof e === "object" && Array.isArray(e.party) && Number.isFinite(e.endsAt));
  const day = utcDayOf(now);
  if (!x.taken || x.taken.day !== day || !Array.isArray(x.taken.missions)) x.taken = { day, missions: [] };
  const key = getISOWeekKeyUTC(new Date(now));
  if (!x.caps || x.caps.key !== key) x.caps = { key, stones: 0, dust: 0, pokemon: 0, tms: 0 };
  return x;
}

const fail = (status, error) => ({ ok: false, status, error });

/**
 * Send a party. `rand` gives the outcome seed (injectable for tests).
 * @returns {{ ok:true, expedition, left: { uid, teams[] }[] } | { ok:false, status, error }}
 */
export function sendExpedition(user, { mission: index, uids }, { now = Date.now(), env = process.env, rand = Math.random } = {}) {
  if (!expeditionsEnabled(env)) return fail(403, "Expeditions aren't open yet.");
  const x = ensureExpeditions(user, now);
  const missions = missionsFor(x.taken.day);
  if (!Number.isInteger(index) || !missions[index]) return fail(400, "Unknown Mission.");
  if (x.taken.missions.includes(index)) return fail(409, "You already took this Mission today.");
  if (x.running.length >= RUNNING_MAX) return fail(409, `You can run ${RUNNING_MAX} Expeditions at once.`);
  if (!Array.isArray(uids) || uids.length < 1 || uids.length > PARTY_MAX) return fail(400, `Pick 1 to ${PARTY_MAX} Pokémon.`);
  if (new Set(uids).size !== uids.length) return fail(400, "A Pokémon is listed twice.");
  const party = [];
  for (const uid of uids) {
    const rec = typeof uid === "string" ? user.box?.[uid] : null;
    if (!rec) return fail(409, "One of those Pokémon is no longer in your Collection.");
    party.push({ uid, id: Number(rec.id), level: copyTraining(user, uid).level });
  }
  const mission = missions[index];
  const chance = successChance(mission, party);
  const seed = Math.floor(rand() * 2 ** 31) >>> 0;
  const rng = createRng(seed);
  // Always three draws before the loot ones (claimExpedition replays them).
  const [r1, r2, r3] = [rng.next(), rng.next(), rng.next()];
  const success = r1 < chance;
  const bonus = success && r2 < LOOT.bonusChance ? (r3 < 0.5 ? "exp" : "loot") : null;

  const away = uids.map((uid) => sendCopyAway(user, uid));
  for (const t of EDITABLE_TEAMS) reconcileTeamEquipment(user, t); // held items leave with the copies
  const expedition = {
    id: `x${seed.toString(36)}${x.running.length}`,
    mission: { ...mission, threats: [...mission.threats] },
    sentAt: now,
    endsAt: now + mission.hours * HOUR,
    party: away,
    chance,
    seed,
    success,
    bonus,
  };
  x.running.push(expedition);
  x.taken.missions.push(index);
  return { ok: true, expedition: runningView(expedition, now), left: away.map((a) => ({ uid: a.uid, teams: a.teams })) };
}

/**
 * Claim a finished Expedition: the party comes back, then EXP and loot.
 * deps: grantCc(user, n) → paid, grantItem(user, id, n) → { ok },
 *       rollCatch(user, ball) → { id, name, … } | null, applyExp(user, members, gains) → [{ name, fromLevel, toLevel, gained }],
 *       pickTm(rng) → item id | null
 */
export function claimExpedition(user, expeditionId, { now = Date.now(), grantCc, grantItem, rollCatch, applyExp, pickTm = () => null } = {}) {
  const x = ensureExpeditions(user, now);
  const i = x.running.findIndex((e) => e.id === expeditionId);
  if (i < 0) return fail(404, "That Expedition isn't running.");
  const e = x.running[i];
  if (now < e.endsAt) return fail(409, "That Expedition hasn't returned yet.");

  // Same seed, same draws: the success and bonus rolls first, then loot.
  const rng = createRng(e.seed);
  rng.next(); rng.next(); rng.next();
  const L = e.mission.hours;
  const draws = e.success ? (e.bonus === "loot" ? 2 : 1) : 0;
  const found = { stones: 0, dust: 0, pokemon: 0, tms: 0 };
  for (let d = 0; d < draws; d++) {
    if (rng.next() < LOOT.stoneChance[L]) found.stones++;
    found.dust += LOOT.dust[L];
    if (rng.next() < LOOT.pokemonChance[L]) found.pokemon++;
    if (rng.next() < LOOT.tmChance[L]) found.tms++;
  }
  const room = (k) => Math.max(0, WEEK_CAPS[k] - (x.caps[k] ?? 0));
  const paid = Object.fromEntries(Object.keys(found).map((k) => [k, Math.min(found[k], room(k))]));
  const capped = Object.fromEntries(Object.keys(found).map((k) => [k, found[k] - paid[k]]));

  // The party comes home first, so EXP lands on the returned copies.
  x.running.splice(i, 1);
  const back = e.party.map((p) => ({ ...p, uid: returnCopy(user, p) }));
  const share = e.success ? (e.bonus === "exp" ? 2 : 1) : LOOT.failExpShare;
  const members = back.map((p) => ({ speciesId: Number(p.rec.id), variant: p.rec.shiny ? "shiny" : "normal", copyUid: p.uid, name: getSpeciesEntry(p.rec.id)?.name ?? `#${p.rec.id}` }));
  const gains = back.map((p) => Math.floor(missionExp(e.mission.level, copyTraining(user, p.uid).level) * share));
  const exp = applyExp(user, members, gains);

  const cc = grantCc(user, e.success ? LOOT.ccPerHour * L * draws : LOOT.failCcPerHour * L);
  const items = {};
  if (paid.stones && grantItem(user, "evolution_stone", paid.stones).ok) items.evolution_stone = paid.stones;
  if (paid.dust && grantItem(user, "shiny_dust", paid.dust).ok) items.shiny_dust = paid.dust;
  const pokemon = [];
  for (let k = 0; k < paid.pokemon; k++) { const p = rollCatch(user, "pokeball"); if (p) pokemon.push(p); }
  const tms = [];
  for (let k = 0; k < paid.tms; k++) { const tm = pickTm(rng); if (tm && grantItem(user, tm, 1).ok) tms.push(tm); }
  x.caps.stones += items.evolution_stone ?? 0;
  x.caps.dust += items.shiny_dust ?? 0;
  x.caps.pokemon += pokemon.length;
  x.caps.tms += tms.length;

  return {
    ok: true,
    expedition: { id: e.id, mission: e.mission, success: e.success, bonus: e.bonus, chance: e.chance },
    party: back.map((p) => p.uid),
    exp,
    cc,
    items,
    pokemon,
    tms,
    capped: Object.values(capped).some((n) => n > 0) ? capped : null,
  };
}

function runningView(e, now) {
  return {
    id: e.id,
    mission: e.mission,
    sentAt: e.sentAt,
    endsAt: e.endsAt,
    done: now >= e.endsAt,
    chance: e.chance,
    party: e.party.map((p) => ({ uid: p.uid, id: Number(p.rec.id), shiny: !!p.rec.shiny, name: getSpeciesEntry(p.rec.id)?.name ?? `#${p.rec.id}` })),
  };
}

/**
 * Copies out on an Expedition, as rows for the Collection grid (same shape as
 * bot_final.js copyRows, plus when they're back and where they went). They are
 * shown there but locked: they aren't in the box until the Expedition is claimed.
 * [uid, id, shiny 0|1, level, caughtAt|0, trained 0|1, 0, exp, endsAt, missionName]
 */
export function awayCopyRows(user) {
  const out = [];
  for (const e of user?.expeditions?.running ?? []) {
    for (const p of e.party ?? []) {
      const exp = Math.max(0, Number(p.rec?.exp) || 0);
      out.push([p.uid, Number(p.rec?.id), p.rec?.shiny ? 1 : 0, levelForExp(exp), p.rec?.at ?? 0, p.custom ? 1 : 0, 0, exp, e.endsAt, e.mission?.name ?? "an Expedition"]);
    }
  }
  return out;
}

/** What the dashboard and /quest show (call ensureExpeditions first). */
export function expeditionView(user, { now = Date.now(), env = process.env } = {}) {
  const x = user.expeditions;
  return {
    enabled: expeditionsEnabled(env),
    now, // the server's clock, so countdowns don't depend on the device's
    day: x.taken.day,
    missions: missionsFor(x.taken.day).map((m) => ({
      ...m,
      threats: m.threats.map((t) => ({ type: t, counters: countersOf(t) })),
      taken: x.taken.missions.includes(m.index),
    })),
    running: x.running.map((e) => runningView(e, now)),
    slots: { used: x.running.length, max: RUNNING_MAX },
    partyMax: PARTY_MAX,
    caps: { key: x.caps.key, stones: [x.caps.stones, WEEK_CAPS.stones], dust: [x.caps.dust, WEEK_CAPS.dust], pokemon: [x.caps.pokemon, WEEK_CAPS.pokemon], tms: [x.caps.tms, WEEK_CAPS.tms] },
    loot: LOOT,
  };
}
