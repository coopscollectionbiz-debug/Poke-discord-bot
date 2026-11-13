// ==========================================================
// tests/fightRecords.test.js
// Battle Records (docs/design/battle-records.md): the Fight record store
// (newest 50 per group, shared Battles, torn lines, compaction,
// forgetPlayer) and the builders run on real Battles, Challenges, an
// Elite Four run with Revives, and a Trainer encounter.
// ==========================================================

import fs from "fs/promises";
import path from "path";
import { assertEqual, assertTrue, section, finish } from "./harness.js";
import { createFightStore, FORMER_TRAINER, newFightId } from "../utils/fightRecords.js";
import { battleRecord, challengeRecord, encounterRecord, recordFight, groupOf, memberView } from "../utils/fightRecordBuild.js";
import { liteRecord, createFightRecordHandlers } from "../services/fightRecordsApi.js";
import { runBattle } from "../utils/battle/runBattle.js";
import { runChallenge, startRun, continueRun, finishOpenRun } from "../utils/challenge/runChallenge.js";
import { fightEncounter } from "../utils/encounter/runEncounter.js";
import { rollTrainer } from "../utils/encounter/generate.js";
import { buildTeam } from "../utils/battle/runBattle.js";
import { createNewUser } from "../utils/userSchema.js";
// Wager battles need 25 registered species on both sides (economy audit 2026-11, D4).
const dex25 = (u) => { u.pokedex = { ...Object.fromEntries(Array.from({ length: 25 }, (_, i) => [i + 1, 1])), ...(u.pokedex ?? {}) }; return u; };

const ROOT = process.env.TRAINERDATA_DIR || ".";
let dirN = 0;
async function freshDir() {
  const d = path.join(ROOT, `fr-${process.pid}-${dirN++}`);
  await fs.mkdir(d, { recursive: true });
  return d;
}
const D = new Date("2026-11-12T12:00:00Z");

function player(id, speciesIds, level, cc = 12345) {
  const u = createNewUser(id, `Trainer ${id}`);
  for (const sid of speciesIds) {
    u.pokemon[sid] = { normal: 1, shiny: 0 };
    (u.training ??= {})[`${sid}:normal`] = { exp: level ** 3 };
  }
  u.displayedPokemon = speciesIds.map((sid) => ({ id: sid, variant: "normal" }));
  u.battleTeam = speciesIds.map((sid) => ({ id: sid, variant: "normal" }));
  u.cc = cc;
  u.displayedTrainer = "youngster-gen4.png";
  return u;
}

// A minimal record for the store tests.
let at = 1;
const rec = (players, group = "battles", extra = {}) => ({
  v: 1, id: newFightId(), at: at++, kind: group === "battles" ? "casual" : group === "encounters" ? "encounter" : "gym", group, players,
  sides: players.map((p) => ({ id: p, name: `N${p}`, trainer: null })), fights: [], winner: 0, rewards: Object.fromEntries(players.map((p) => [p, {}])), ...extra,
});

section("Store: add, list, get");
{
  const dir = await freshDir();
  const store = createFightStore({ dir: () => dir });
  const a = rec(["A", "B"]);
  const b = rec(["A"], "challenges");
  const c = rec(["A"], "encounters");
  assertEqual(await Promise.all([store.add(a), store.add(b), store.add(c)]), [true, true, true], "three records written");
  assertEqual((await store.list("A")).map((r) => r.id), [c.id, b.id, a.id], "list: newest first, every group");
  assertEqual((await store.list("A", { group: "challenges" })).map((r) => r.id), [b.id], "list filtered to one group");
  assertEqual((await store.list("B")).map((r) => r.id), [a.id], "a Battle is in both players' histories");
  assertEqual((await store.get("B", a.id))?.id, a.id, "the Defender can open the shared Battle");
  assertEqual(await store.get("B", b.id), null, "but not someone else's Challenge");
  assertEqual(await store.list("Z"), [], "a player with no fights gets an empty list");
  assertEqual(await store.add({ id: "x" }), false, "a malformed record is refused, not thrown");
  // A second store over the same file sees the same records (startup reload).
  const again = createFightStore({ dir: () => dir });
  assertEqual((await again.list("A")).map((r) => r.id), [c.id, b.id, a.id], "records survive a restart");
}

section("Store: newest N per group, shared Battles");
{
  const dir = await freshDir();
  const store = createFightStore({ dir: () => dir, keep: 3 });
  const shared = rec(["A", "B"]);
  await store.add(shared);
  const later = [];
  for (let i = 0; i < 3; i++) { const r = rec(["A", "C"]); later.push(r); await store.add(r); }
  assertEqual((await store.list("A")).map((r) => r.id), later.map((r) => r.id).reverse(), "A keeps only their newest 3 Battles");
  assertEqual(await store.get("A", shared.id), null, "the shared Battle left A's history");
  assertEqual((await store.get("B", shared.id))?.id, shared.id, "but stays in B's, who still has it in their 3");
  const enc = rec(["A"], "encounters");
  await store.add(enc);
  assertEqual((await store.list("A", { group: "battles" })).length, 3, "an encounter never pushes out a Battle");
  for (let i = 0; i < 3; i++) await store.add(rec(["B", "C"]));
  assertEqual(await store.get("B", shared.id), null, "once neither player has it, it's gone");
  const before = await store.stats();
  await store.compact();
  const after = await store.stats();
  assertTrue(before.dead > 0 && after.dead === 0 && after.bytes < before.bytes, `compaction drops dead lines (${before.bytes} → ${after.bytes} bytes)`);
  assertEqual(after.live, (await createFightStore({ dir: () => dir, keep: 3 }).stats()).live, "the rewritten file reloads to the same records");
}

section("Store: torn last line");
{
  const dir = await freshDir();
  const store = createFightStore({ dir: () => dir });
  const a = rec(["A"]);
  await store.add(a);
  await fs.appendFile(path.join(dir, "fight-records.ndjson"), '{"id":"f_torn","gro', "utf8");
  const reopened = createFightStore({ dir: () => dir });
  const b = rec(["A"]);
  assertEqual(await reopened.add(b), true, "a write after a torn line succeeds");
  assertEqual((await reopened.list("A")).map((r) => r.id), [b.id, a.id], "both records read back; the torn line is ignored");
  assertEqual((await createFightStore({ dir: () => dir }).list("A")).length, 2, "and after another restart");
}

section("Store: forgetPlayer");
{
  const dir = await freshDir();
  const store = createFightStore({ dir: () => dir });
  const own = rec(["A"], "challenges");
  const shared = rec(["A", "B"]);
  const other = rec(["B", "C"]);
  for (const r of [own, shared, other]) await store.add(r);
  assertEqual(await store.forgetPlayer("A"), { removed: 1, anonymised: 1 }, "their Challenge removed, the shared Battle anonymised");
  assertEqual(await store.list("A"), [], "they have no history");
  const seen = await store.get("B", shared.id);
  assertEqual([seen.players, seen.sides[0], "A" in seen.rewards], [["B"], { id: null, name: FORMER_TRAINER, trainer: null }, false], "B sees Former trainer, no id or rewards");
  assertEqual((await store.get("B", other.id))?.id, other.id, "records without them are untouched");
  const raw = await fs.readFile(path.join(dir, "fight-records.ndjson"), "utf8");
  assertTrue(!raw.includes('"A"') && !raw.includes("NA"), "their id and name are gone from the file");
}

section("Builders: Battles");
{
  const td = { A: player("A", [6, 9, 3, 1, 4, 7], 60), B: player("B", [25, 133, 16, 19, 10, 13], 40) }; // ranked/wager need full teams of 6
  const casual = runBattle({ trainerData: td, challengerId: "A", defenderId: "B", mode: "open", seed: 7, now: D });
  const r = battleRecord(casual, { A: "Ash", B: "Gary" }, td, { now: D });
  assertEqual([r.kind, r.group, r.season, r.players, r.sides.map((s) => s.name), r.sides[0].trainer], ["casual", "battles", null, ["A", "B"], ["Ash", "Gary"], "youngster-gen4.png"], "casual: kind, players, names and sprite as they were");
  assertEqual(r.fights[0].members.map((s) => s.length), [6, 6], "both teams copied");
  assertTrue(r.fights[0].members[0].every((m) => m.moves.length > 0 && typeof m.moves[0] === "string"), "each member's moves stored by name");
  assertEqual(r.fights[0].result.log.length, casual.result.log.length, "the whole turn log is kept for the replay");
  assertEqual(r.winner, casual.result.winner, "winner side");
  assertEqual([!!r.rewards.A.exp, r.rewards.B.exp, r.rewards.A.rating], [true, undefined, undefined], "only the Challenger earns EXP; no rating");

  const ranked = runBattle({ trainerData: td, challengerId: "A", defenderId: "B", mode: "ranked", seed: 8, now: D });
  const rr = battleRecord(ranked, { A: "Ash", B: "Gary" }, td, { now: D });
  assertEqual([rr.kind, rr.season, rr.rewards.A.rating, rr.rewards.B.rating], ["ranked", 1, ranked.rating.A, ranked.rating.B], "ranked: Season and both rating changes");
  assertEqual(rr.fights[0].members[0][0].level, 50, "ranked members recorded at the Lv 50 they fought at");

  td.A.pendingWager = null;
  dex25(td.A); dex25(td.B);
  const wager = runBattle({ trainerData: td, challengerId: "A", defenderId: "B", mode: "wager", stake: 300, seed: 9, now: D });
  const wr = battleRecord(wager, {}, td, { now: D });
  const win = wager.winnerId, lose = wager.loserId;
  assertEqual([wr.rewards[win].cc, wr.rewards[lose].cc], [300, -300], "wager: the winner nets the Stake, the loser loses it");
  assertEqual(wr.sides.map((s) => s.name), ["Trainer A", "Trainer B"], "no Discord names: the saved player name");
  assertEqual(groupOf("wager"), "battles", "wager is a Battle");
}

section("Builders: Challenges");
{
  const td = { A: player("A", [150, 249, 250, 384, 483, 484], 100) };
  const out = runChallenge({ trainerData: td, userId: "A", key: "brock", seed: 1, now: D });
  const r = challengeRecord(out, "Ash", td, { now: D });
  assertEqual([r.kind, r.group, r.key, r.players, r.sides[1].name, r.winner], ["gym", "challenges", "brock", ["A"], "Gym Leader Brock", 0], "a Gym win");
  assertEqual([r.rewards.A.badge, r.rewards.A.cc > 0, !!r.rewards.A.prize], ["brock", true, true], "Badge and first-win prize recorded");
  assertEqual(r.fights.length, 1, "one fight");
  assertTrue(!!r.fights[0].foe.trainer, "the Gym Leader's sprite");

  const weak = { A: player("A", [10], 5) };
  const loss = challengeRecord(runChallenge({ trainerData: weak, userId: "A", key: "brock", seed: 1, now: D }), "Ash", weak, { now: D });
  assertEqual([loss.winner, loss.rewards.A.cc], [1, -1234], "a loss records the CC lost");
}

section("Builders: an Elite Four run with Revives");
{
  // A seed whose run wins at least one fight with a faint, so a Revive is picked.
  let found = null;
  for (let seed = 1; seed <= 300 && !found; seed++) {
    const td = { A: player("A", [149, 130, 6, 9, 3, 65], 70) };
    td.A.challenge = { won: Object.fromEntries(["brock", "misty", "surge", "erika", "koga", "sabrina", "blaine", "giovanni"].map((k) => [k, "2026-11-01"])), day: null, attempts: 0 };
    let step = startRun({ trainerData: td, userId: "A", seed, now: D });
    let revived = false;
    while (!step.ended) {
      const slot = step.fainted[0]?.slot;
      if (slot !== undefined) revived = true;
      step = continueRun({ trainerData: td, userId: "A", nonce: step.nonce, step: step.step + 1, slot, now: D });
    }
    if (revived && step.outcome.fights.length >= 2) found = { td, outcome: step.outcome };
  }
  assertTrue(!!found, "found a run with a Revive");
  const { td, outcome } = found;
  assertTrue(outcome.fights.slice(0, -1).every((f) => !f.result), "the outcome keeps only the last fight's turns");
  const r = challengeRecord(outcome, "Ash", td, { now: D });
  assertEqual([r.kind, r.sides[1].name, r.fights.length], ["elite4", "Elite Four", outcome.fights.length], "one record for the whole run");
  assertTrue(r.fights.every((f) => !f.missing && f.result?.log?.length >= 0), "every fight re-run with its full turns");
  assertEqual(r.fights.at(-1).result.turns, outcome.fights.at(-1).result.turns, "the re-run reaches the real last fight");
  assertEqual(r.fights.map((f) => f.foe.key), outcome.fights.map((f) => f.opponentKey), "fights in order");
  assertEqual(r.breaks, outcome.breaks, "Revive picks kept");
  const revived = outcome.breaks.findIndex((b) => b.slot != null);
  assertEqual(r.fights[revived + 1].members[0][outcome.breaks[revived].slot].hpFraction, undefined, "the revived Pokémon starts the next fight at full HP");

  // A run whose team record was tampered with: earlier fights are marked missing, never wrong.
  const bad = challengeRecord({ ...outcome, runTeam: outcome.runTeam.slice(1) }, "Ash", td, { now: D });
  assertTrue(bad.fights.slice(0, -1).every((f) => f.missing) && !!bad.fights.at(-1).result, "a re-run that disagrees keeps only the real last fight");

  // A run finished on restart (no Revives).
  const td2 = { A: player("A", [149, 130, 6, 9, 3, 65], 70) };
  td2.A.challenge = { ...td.A.challenge, run: undefined, day: null, attempts: 0 };
  const first = startRun({ trainerData: td2, userId: "A", seed: 5, now: D });
  const finished = first.ended ? first.outcome : finishOpenRun({ trainerData: td2, userId: "A", now: D });
  const fr = challengeRecord(finished, undefined, td2, { now: D });
  assertEqual([fr.sides[0].name, fr.fights.every((f) => !f.missing)], ["Trainer A", true], "a restart-finished run is recorded with every fight");
}

section("Builders: Trainer encounter");
{
  const u = player("A", [150, 249], 80);
  const trainer = rollTrainer({ team: buildTeam(u), seed: 3 });
  const out = fightEncounter({ trainerData: { A: u }, userId: "A", encounter: { team: buildTeam(u).map(({ speciesId, variant }) => ({ speciesId, variant })), trainer }, seed: 4, now: D });
  const r = encounterRecord(out, "Ash", { A: u }, { now: D });
  assertEqual([r.kind, r.group, r.players, r.sides[1].name, r.sides[1].trainer], ["encounter", "encounters", ["A"], `${trainer.title} ${trainer.name}`, trainer.spriteFile], "the Trainer as met");
  assertEqual(r.rewards.A.cc, out.won ? out.prize : -out.paid, "Prize money won or paid");
}

section("recordFight never throws");
{
  const store = { add: async () => true };
  assertEqual(await recordFight(() => { throw new Error("boom"); }, { store }), false, "a builder bug resolves false");
  assertEqual(await recordFight(() => rec(["A"]), { store }), true, "a good record is handed to the store");
  assertEqual(memberView({ speciesId: 25, name: "Pikachu", level: 10, hpFraction: 1 }).hpFraction, undefined, "full HP isn't stored");
}

section("API");
{
  const dir = await freshDir();
  const store = createFightStore({ dir: () => dir });
  const td = { A: player("A", [6], 50), B: player("B", [9], 50) };
  const r = battleRecord(runBattle({ trainerData: td, challengerId: "A", defenderId: "B", mode: "open", seed: 1, now: D }), {}, td, { now: D });
  await store.add(r);
  const api = createFightRecordHandlers({ store, isAuthorized: (_req, id) => id === "A" || id === "B" });
  const call = async (fn, query, params = {}) => {
    let status = 200, body;
    const res = { status(s) { status = s; return this; }, json(b) { body = b; return this; } };
    await fn({ query, params }, res);
    return { status, body };
  };
  const list = await call(api.list, { id: "A" });
  assertEqual([list.status, list.body.records.length, list.body.records[0].fights[0].result.log], [200, 1, undefined], "list: lite records without the turn log");
  assertTrue(list.body.records[0].fights[0].result.knockouts !== undefined, "but with knockouts for the rows");
  assertEqual((await call(api.list, { id: "X" })).status, 403, "someone else's session: 403");
  assertEqual((await call(api.list, {})).status, 400, "no id: 400");
  assertEqual((await call(api.list, { id: "A", group: "nope" })).status, 400, "unknown group: 400");
  const one = await call(api.get, { id: "B" }, { fightId: r.id });
  assertEqual([one.status, one.body.record.fights[0].result.log.length > 0], [200, true], "detail: the full record for a player in it");
  assertEqual((await call(api.get, { id: "B" }, { fightId: "f_nope" })).status, 404, "unknown fight: 404");
  assertEqual(liteRecord({ fights: [{ foe: {}, missing: true }] }).fights[0].missing, true, "missing fights pass through");
}

finish();
