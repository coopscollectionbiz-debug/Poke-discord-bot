// ==========================================================
// tests/expeditions.test.js: Expeditions (Quests, Phase 2).
// ==========================================================

import { assertTrue, assertEqual, section, finish } from "./harness.js";
import {
  missionsFor, successChance, missionExp, sendExpedition, claimExpedition, ensureExpeditions, expeditionView,
  expeditionsEnabled, LOOT, WEEK_CAPS, RUNNING_MAX, countersOf,
} from "../services/expeditions.js";
import { createExpeditionHandlers, pickerCopies } from "../services/expeditionsApi.js";
import { createNewUser } from "../utils/userSchema.js";
import { grantCatch } from "../utils/training.js";
import { normalizeBox, copiesOf, canFeed, copyTraining } from "../services/box.js";
import { lockUser } from "../utils/userLocks.js";
import { getAcquirablePokemon } from "../utils/dataLoader.js";

const ON = { QUESTS_ENABLED: "1", QUESTS_EXPEDITIONS_ENABLED: "1" };
const NOW = Date.UTC(2026, 10, 13, 12, 0, 0);
const HOUR = 3_600_000;
const ID = "123456789012345678";

function player() {
  const u = createNewUser(ID, "Ash");
  for (const sp of [7, 7, 4, 1, 25, 74]) grantCatch(u, sp, "normal", () => 0.5);
  normalizeBox(u);
  const uidOf = (sp, n = 0) => copiesOf(u, sp, "normal")[n].uid;
  u.displayedPokemon = [{ id: 7, variant: "normal", uid: uidOf(7) }, { id: 4, variant: "normal", uid: uidOf(4) }];
  u.battleTeam = [{ id: 7, variant: "normal", uid: uidOf(7) }, { id: 25, variant: "normal", uid: uidOf(25) }];
  u.showcaseTeam = [{ id: 7, variant: "normal", uid: uidOf(7) }];
  u.equipment = { rev: 1, teams: { display: { [`u:${uidOf(7)}`]: "leftovers" }, battle: {} } };
  u.items.leftovers = 1;
  return { u, uidOf };
}
const deps = (extra = {}) => ({
  grantCc: (u, n) => { u.cc = (u.cc ?? 0) + n; return n; },
  grantItem: (u, id, n) => { u.items[id] = (u.items[id] ?? 0) + n; return { ok: true }; },
  rollCatch: () => ({ id: 16, name: "Pidgey" }),
  applyExp: (u, members, gains) => members.map((m, i) => ({ name: m.name, gained: gains[i], uid: m.copyUid })),
  pickTm: () => "tm_test",
  ...extra,
});

section("Switch");
assertEqual([expeditionsEnabled({}), expeditionsEnabled({ QUESTS_ENABLED: "1" }), expeditionsEnabled(ON)], [false, false, true], "needs both QUESTS_ENABLED and QUESTS_EXPEDITIONS_ENABLED");
{
  const { u, uidOf } = player();
  assertEqual(sendExpedition(u, { mission: 0, uids: [uidOf(7)] }, { now: NOW, env: {} }).status, 403, "off: sending refuses");
}

section("Missions");
{
  const a = missionsFor("2026-11-13");
  assertEqual(a, missionsFor("2026-11-13"), "the same 4 Missions for everyone on a day");
  assertEqual(a.map((m) => m.hours), [2, 4, 8, 12], "2, 4, 8 and 12 hours");
  assertEqual(a.map((m) => m.threats.length), [1, 2, 2, 3], "1 to 3 threats, more on longer Missions");
  assertTrue(a.every((m) => new Set(m.threats).size === m.threats.length), "no threat type twice");
  assertTrue(a.every((m, i) => Math.abs(m.level - [15, 30, 40, 60][i]) <= 5), "Levels near 15 / 30 / 40 / 60");
  assertTrue(JSON.stringify(missionsFor("2026-11-14")) !== JSON.stringify(a), "a new day, new Missions");
  assertTrue(countersOf("Fire").includes("Water") && countersOf("Fire").includes("Rock") && !countersOf("Fire").includes("Grass"), "Water and Rock counter Fire; Grass doesn't");
}

section("Success chance");
{
  const m = { threats: ["Fire"], level: 40 };
  const blastoise = { id: 9, level: 40 }, venusaur = { id: 3, level: 40 };
  assertEqual(successChance(m, [blastoise]), 0.95, "a Water counter at the Mission Level: 35% + 60%, capped at 95%");
  assertEqual(successChance(m, [venusaur]), 0.35, "no counter, same Level: 35%");
  assertEqual(successChance(m, [{ id: 3, level: 50 }]), 0.45, "+1% per Level above");
  assertEqual(successChance(m, [{ id: 3, level: 30 }]), 0.05, "-3% per Level below, floored at 5%");
  const two = { threats: ["Fire", "Grass"], level: 40 };
  assertEqual(successChance(two, [blastoise]), 0.65, "one of two threats countered: 35% + 30%");
  assertEqual(successChance(m, []), 0, "an empty party can't go");
}

section("Sending takes the party off every Team and out of the Collection");
{
  const { u, uidOf } = player();
  const squirtle = uidOf(7), spare = uidOf(7, 1);
  const r = sendExpedition(u, { mission: 2, uids: [squirtle] }, { now: NOW, env: ON, rand: () => 0.5 });
  assertTrue(r.ok, "sent");
  assertEqual(r.left[0].teams.sort(), ["battleTeam", "displayedPokemon", "showcaseTeam"], "it leaves the Casual, Ranked and Showcase teams");
  assertTrue(![...u.displayedPokemon, ...u.battleTeam, ...u.showcaseTeam].some((s) => s.uid === squirtle), "no slot holds it");
  assertEqual(u.battleTeam.length, 1, "the Ranked team is one short (Ranked battles need 6 again)");
  assertEqual(u.box[squirtle], undefined, "it is out of the Collection");
  assertEqual(u.pokemon[7].normal, 1, "the Collection count drops while it's away");
  assertEqual(u.equipment?.teams?.display?.[`u:${squirtle}`], undefined, "its held item is unequipped (the unlock stays in the Bag)");
  assertEqual(u.items.leftovers, 1, "the held item unlock is kept");
  assertEqual(canFeed(u, { from: spare, to: squirtle }).ok, false, "nothing can feed it, evolve it or donate it: it isn't in the box");
  normalizeBox(u);
  assertEqual(u.box[squirtle], undefined, "loading the data again doesn't bring it back");
  assertTrue(!pickerCopies(u).some((c) => c.uid === squirtle), "the party picker doesn't offer it");
}

section("Send rules");
{
  const { u, uidOf } = player();
  const opts = { now: NOW, env: ON, rand: () => 0.5 };
  assertEqual(sendExpedition(u, { mission: 9, uids: [uidOf(7)] }, opts).status, 400, "unknown Mission");
  assertEqual(sendExpedition(u, { mission: 0, uids: [] }, opts).status, 400, "an empty party");
  assertEqual(sendExpedition(u, { mission: 0, uids: [uidOf(7), uidOf(7)] }, opts).status, 400, "the same copy twice");
  assertEqual(sendExpedition(u, { mission: 0, uids: [uidOf(7), uidOf(4), uidOf(1), uidOf(25)] }, opts).status, 400, "more than 3");
  assertEqual(sendExpedition(u, { mission: 0, uids: ["c_nope000000"] }, opts).status, 409, "a copy you don't have");
  assertTrue(sendExpedition(u, { mission: 0, uids: [uidOf(7)] }, opts).ok, "first Expedition");
  assertEqual(sendExpedition(u, { mission: 0, uids: [uidOf(4)] }, opts).status, 409, "each Mission once a day");
  assertTrue(sendExpedition(u, { mission: 1, uids: [uidOf(4)] }, opts).ok, "second Expedition");
  assertEqual(sendExpedition(u, { mission: 2, uids: [uidOf(1)] }, opts).status, 409, `${RUNNING_MAX} at once`);
  const next = sendExpedition(u, { mission: 0, uids: [uidOf(1)] }, { ...opts, now: NOW + 24 * HOUR });
  assertEqual(next.status, 409, "a new day frees the Missions, but not the running slots");
}

section("Claiming: the party returns with EXP and loot");
{
  const { u, uidOf } = player();
  const squirtle = uidOf(7);
  const before = copyTraining(u, squirtle);
  const sent = sendExpedition(u, { mission: 3, uids: [squirtle, uidOf(4)] }, { now: NOW, env: ON, rand: () => 0.123 });
  const id = sent.expedition.id;
  assertEqual(claimExpedition(u, id, { now: NOW + 11 * HOUR, ...deps() }).status, 409, "not before it returns");
  const later = claimExpedition(structuredClone(u), id, { now: NOW + 13 * HOUR, ...deps() });
  const r = claimExpedition(u, id, { now: NOW + 12 * HOUR, ...deps() });
  assertTrue(r.ok, "claimed when the time is up");
  assertEqual([r.expedition.success, r.cc, r.items, r.pokemon.length], [later.expedition.success, later.cc, later.items, later.pokemon.length], "claiming later changes nothing (outcome fixed at send)");
  assertEqual(u.box[squirtle] != null, true, "the copy is back under the same id");
  assertEqual(copyTraining(u, squirtle).exp, before.exp, "EXP goes through applyExp (stubbed here)");
  const share = r.expedition.success ? (r.expedition.bonus === "exp" ? 2 : 1) : LOOT.failExpShare;
  assertEqual(r.exp[0].gained, Math.floor(missionExp(sent.expedition.mission.level, before.level) * share), "EXP: one won battle at the Mission Level (x share)");
  assertEqual(r.cc, r.expedition.success ? LOOT.ccPerHour * 12 * (r.expedition.bonus === "loot" ? 2 : 1) : LOOT.failCcPerHour * 12, "CC by length and result");
  assertEqual(claimExpedition(u, id, { now: NOW + 13 * HOUR, ...deps() }).status, 404, "only once");
  assertEqual(u.displayedPokemon.some((s) => s.uid === squirtle), false, "returning doesn't put it back on a Team");
}

section("Claiming works with the switch off (nothing stranded)");
{
  const { u, uidOf } = player();
  const s = sendExpedition(u, { mission: 0, uids: [uidOf(7)] }, { now: NOW, env: ON, rand: () => 0.2 });
  assertTrue(claimExpedition(u, s.expedition.id, { now: NOW + 3 * HOUR, ...deps() }).ok, "claimed with no switch in deps");
}

section("Weekly caps");
{
  const { u, uidOf } = player();
  let t = Date.UTC(2026, 10, 9, 1, 0, 0); // Monday, week 46
  const totals = { stones: 0, dust: 0, pokemon: 0 };
  let successes = 0;
  for (let d = 0; d < 7; d++, t += 24 * HOUR) {
    for (const mission of [2, 3]) {
      const uid = copiesOf(u, 7, "normal")[0]?.uid ?? Object.keys(u.box)[0];
      const s = sendExpedition(u, { mission, uids: [uid] }, { now: t, env: ON, rand: () => (d * 2 + mission) / 20 });
      const r = claimExpedition(u, s.expedition.id, { now: t + 12 * HOUR, ...deps() });
      totals.stones += r.items.evolution_stone ?? 0;
      totals.dust += r.items.shiny_dust ?? 0;
      totals.pokemon += r.pokemon.length;
      if (r.expedition.success) successes++;
    }
  }
  assertTrue(successes > 0, `${successes} successful Expeditions in the week`);
  assertTrue(totals.stones <= WEEK_CAPS.stones && totals.dust <= WEEK_CAPS.dust && totals.pokemon <= WEEK_CAPS.pokemon, `capped: ${JSON.stringify(totals)}`);
  assertEqual(u.expeditions.caps.dust, totals.dust, "the week's count matches what was paid");
}

section("View");
{
  const { u, uidOf } = player();
  ensureExpeditions(u, NOW);
  sendExpedition(u, { mission: 0, uids: [uidOf(7)] }, { now: NOW, env: ON, rand: () => 0.5 });
  const v = expeditionView(u, { now: NOW + HOUR, env: ON });
  assertTrue(v.missions[0].taken && !v.missions[1].taken, "taken Missions are marked");
  assertTrue(v.missions.every((m) => m.threats.every((th) => Array.isArray(th.counters))), "each threat lists its counters (for the live chance)");
  assertEqual([v.running.length, v.running[0].done, v.slots.used], [1, false, 1], "one running, not back yet");
}

section("Handlers: replays never send or pay twice");
{
  const { u, uidOf } = player();
  const td = { [ID]: u };
  let t = NOW;
  const logs = [];
  const h = createExpeditionHandlers({ getTrainerData: () => td, lockUser, save: async () => ({ saved: true, note: "" }), loadPool: getAcquirablePokemon, logEvent: (...a) => logs.push(a[0]), now: () => t, env: ON, rand: () => 0.05 });
  const body = { id: ID, mission: 0, uids: [uidOf(7)], requestId: "send-aaaa-1111" };
  const s1 = await h.send({ body, isAuthorized: () => true });
  const s2 = await h.send({ body, isAuthorized: () => true });
  assertTrue(s1.body.success && s2.body.replayed && u.expeditions.running.length === 1, "a repeated send request sends once");
  t += 2 * HOUR;
  const cc0 = u.cc;
  const c1 = await h.claim({ body: { id: ID, expedition: s1.body.expedition.id, requestId: "claim-aaaa-1111" }, isAuthorized: () => true });
  const c2 = await h.claim({ body: { id: ID, expedition: s1.body.expedition.id, requestId: "claim-aaaa-1111" }, isAuthorized: () => true });
  assertTrue(c1.body.success && c2.body.replayed && u.cc - cc0 === c1.body.cc, "a repeated claim pays once");
  assertEqual(logs, ["expedition_send", "expedition_claim"], "send and claim are logged once each");
  const v = await h.view({ query: { id: ID }, isAuthorized: () => true });
  assertTrue(v.body.copies.some((c) => c.uid === uidOf(7)) && v.body.missions.length === 4, "the view lists copies and Missions");
  assertEqual((await h.view({ query: { id: ID }, isAuthorized: () => false })).status, 403, "someone else's session is refused");
}

finish();
