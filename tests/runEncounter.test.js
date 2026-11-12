// ==========================================================
// tests/runEncounter.test.js
// Who a Trainer can spot, the encounter record, and the fight
// (docs/superpowers/specs/2026-11-10-trainer-encounters-design.md,
// Spotting and Prize money): a win pays the Prize money, a loss pays the
// same or what the player holds, EXP either way, the card's Team fights
// minus what the player gave up, and nothing touches Battles or challenges.
// ==========================================================

import { assertEqual, assertTrue, section, finish } from "./harness.js";
import { getEncounterRecord, spotBlock, recordSpot, fightEncounter } from "../utils/encounter/runEncounter.js";
import { rollTrainer } from "../utils/encounter/generate.js";
import { createNewUser, validateUserSchema } from "../utils/userSchema.js";
import { buildTeam } from "../utils/battle/runBattle.js";
import { learnableMoves } from "../services/movesets.js";

function player(speciesIds, level, cc = 12345) {
  const u = createNewUser("A", "A");
  for (const sid of speciesIds) {
    u.pokemon[sid] = { normal: 1, shiny: 0 };
    (u.training ??= {})[`${sid}:normal`] = { exp: level ** 3 };
  }
  u.displayedPokemon = speciesIds.map((sid) => ({ id: sid, variant: "normal" }));
  u.cc = cc;
  return u;
}
const STRONG = () => player([150, 249, 250, 384, 483, 484], 100);
const card = (user) => buildTeam(user).map(({ speciesId, variant }) => ({ speciesId, variant }));
const weakTrainer = rollTrainer({ team: Array.from({ length: 6 }, () => ({ level: 10 })), seed: 1 });
// A Trainer the player can knock one Pokémon off before losing: a Lv 5
// Caterpie leads, then two Lv 100 Dragonite.
const toughTrainer = {
  ...weakTrainer, classKey: "acetrainer", title: "Ace Trainer", name: "Kent", tier: "over",
  party: [{ speciesId: 10, level: 5 }, { speciesId: 149, level: 100 }, { speciesId: 149, level: 100 }], prize: 3000,
};
const fight = (user, trainer, { team = card(user), seed = 1 } = {}) =>
  fightEncounter({ trainerData: { A: user }, userId: "A", encounter: { team, trainer }, seed, now: new Date("2026-11-10T12:00:00Z") });

section("The record");
{
  const u = player([25], 20);
  const r = getEncounterRecord(u, "2026-11-10");
  assertEqual(r, { day: "2026-11-10", count: 0, lastAt: null }, "created empty");
  recordSpot(u, new Date("2026-11-10T08:00:00Z"));
  assertEqual(u.encounter, { day: "2026-11-10", count: 1, lastAt: Date.parse("2026-11-10T08:00:00Z") }, "a posted card counts");
  assertEqual(getEncounterRecord(u, "2026-11-11"), { day: "2026-11-11", count: 0, lastAt: Date.parse("2026-11-10T08:00:00Z") },
    "a new UTC day resets the count but keeps when the last one was");
  assertEqual(Object.keys(validateUserSchema(u, "A", "A").encounter), ["day", "count", "lastAt"], "the validator keeps it");
}

section("Who can be spotted");
{
  const now = new Date("2026-11-10T12:00:00Z");
  assertEqual(spotBlock({ user: player([25], 20), open: false, now }), null, "a player with a Team");
  assertEqual(spotBlock({ user: player([], 20), open: false, now }), "no_team", "no Team");
  assertEqual(spotBlock({ user: Object.assign(player([25], 20), { challenge: { won: {}, run: { nonce: "x" } } }), open: false, now }), "run_open",
    "an open Elite Four run");
  assertEqual(spotBlock({ user: Object.assign(player([25], 20), { pendingWager: { stake: 5 } }), open: false, now }), "pending_wager",
    "a wager waiting for an answer");
  assertEqual(spotBlock({ user: player([25], 20), open: true, now }), "open", "one at a time");
  const recent = player([25], 20);
  recordSpot(recent, new Date(now.getTime() - 29 * 60_000));
  assertEqual(spotBlock({ user: recent, open: false, now }), "gap", "within 30 minutes of the last one");
  assertEqual(spotBlock({ user: recent, open: false, now: new Date(now.getTime() + 60_000) }), null, "30 minutes later");
  const full = player([25], 20);
  for (let i = 8; i >= 1; i--) recordSpot(full, new Date(now.getTime() - i * 3_600_000));
  assertEqual(full.encounter.count, 8, "8 today");
  assertEqual(spotBlock({ user: full, open: false, now }), "cap", "8 a day");
  assertEqual(spotBlock({ user: full, open: false, now: new Date("2026-11-11T09:00:00Z") }), null, "a new UTC day");
  const before = JSON.stringify(full);
  spotBlock({ user: full, open: false, now: new Date("2026-11-11T09:00:00Z") });
  assertEqual(JSON.stringify(full), before, "read-only");
}

section("A win");
{
  const u = STRONG();
  const cc = u.cc;
  const [battle, challenge] = [JSON.stringify(u.battle), JSON.stringify(u.challenge)];
  const win = fight(u, weakTrainer);
  assertTrue(win.ok && win.won && win.winnerId === "A", "the Team wins");
  assertEqual([u.cc, win.prize, win.paid], [cc + weakTrainer.prize, weakTrainer.prize, 0], "the Trainer pays the Prize money");
  assertTrue(win.exp.A.length === 6 && win.exp.A.every((e) => e.gained >= 0), "EXP for every Team member");
  assertEqual(win.sides[1].members.map((m) => [m.speciesId, m.level, m.variant]), weakTrainer.party.map((m) => [m.speciesId, m.level, "normal"]),
    "the Trainer's party as rolled");
  assertEqual([win.sides[1].userId, win.surge, win.trainer], ["trainer", null, weakTrainer], "the outcome's shape");
  assertEqual([JSON.stringify(u.battle), JSON.stringify(u.challenge)], [battle, challenge], "never the Battle record or challenges");
  assertEqual(JSON.stringify(fight(STRONG(), weakTrainer)), JSON.stringify(fight(STRONG(), weakTrainer)), "same seed, same fight");
}

section("A loss");
{
  const u = player([6, 9], 50);
  const loss = fight(u, toughTrainer);
  assertTrue(loss.ok && !loss.won && loss.winnerId === "trainer", "the Trainer wins");
  assertEqual([u.cc, loss.paid], [12345 - 3000, 3000], "the player pays the same Prize money");
  assertTrue(loss.result.knockouts.some((k) => k.bySide === 0) && loss.exp.A.some((e) => e.gained > 0), "and still gets EXP for knockouts");
  const poor = player([6, 9], 50, 37);
  assertEqual([fight(poor, toughTrainer).paid, poor.cc], [37, 0], "pays at most the balance at the click");
  const broke = player([6, 9], 50, 0);
  assertEqual([fight(broke, toughTrainer).paid, broke.cc], [0, 0], "never below 0");
}

section("The card's Team");
{
  const u = player([6, 94, 445], 60);
  const team = card(u);
  u.displayedPokemon = [{ id: 25, variant: "normal" }]; // a Team change after the card: the card's Team still fights
  u.pokemon[25] = { normal: 1, shiny: 0 };
  delete u.pokemon[94]; // given up after the card
  assertEqual(fight(u, weakTrainer, { team }).sides[0].members.map((m) => m.speciesId), [6, 445], "a Pokémon no longer owned sits out");
  delete u.pokemon[6];
  delete u.pokemon[445];
  assertEqual(fight(u, weakTrainer, { team }), { ok: false, reason: "no_team" }, "none left: refused");
  const run = Object.assign(STRONG(), { challenge: { won: {}, run: { nonce: "x" } } });
  assertEqual(fight(run, weakTrainer).reason, "run_open", "re-checked at the click: an open run");
  const wager = Object.assign(STRONG(), { pendingWager: { stake: 5 } });
  assertEqual(fight(wager, weakTrainer).reason, "pending_wager", "and a pending wager");
  assertEqual(wager.cc, 12345, "a refusal changes nothing");
}

section("The card's Team fights like the Display team");
{
  // Encounters are casual: each Pokémon fights with its chosen Display-team
  // moves, and the card's Mega slot as a Mega if it still qualifies at the click.
  const u = player([6, 94, 445], 60);
  const moves = learnableMoves(u, 6, "normal").map((m) => m.id);
  u.movesets = { display: { "6:normal": [moves[0]] }, battle: { "6:normal": [moves[1]] } };
  assertEqual(fight(u, weakTrainer).sides[0].members[0].moves, [moves[0]], "the Display team's chosen moves, not the Battle team's");
  const ON = { MEGA_EVOLUTION_ENABLED: "1", MEGA_BATTLES_ENABLED: "1" };
  Object.assign(process.env, ON);
  u.megaUnlocks = { "6:normal": { forms: { "mega-charizard-x": { at: 1, stone: null } }, preferred: null } };
  const team = [{ speciesId: 6, variant: "normal", megaForm: "mega-charizard-x" }, { speciesId: 94, variant: "normal" }];
  const lead = (t) => fight(u, weakTrainer, { team: t }).sides[0].members[0];
  assertEqual(lead(team).megaForm, "mega-charizard-x", "the card's Mega battles as the Mega");
  delete u.megaUnlocks;
  assertEqual(lead(team).megaForm, undefined, "and as its base form once it no longer qualifies");
  for (const k of Object.keys(ON)) delete process.env[k];
  assertEqual(lead(card(u)).megaForm, undefined, "a card without a Mega fights without one");
}

finish();
