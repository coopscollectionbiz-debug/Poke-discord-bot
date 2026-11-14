// ==========================================================
// tests/battleRecordsPage.test.js
// The Battle Records page's logic (public/battlerecords/records.js) on
// real Fight records: the Defender's view, the summary, damage per slot,
// and replay steps that end at the simulator's final HP.
// ==========================================================

import { assertEqual, assertTrue, section, finish } from "./harness.js";
import { perspective, summarize, replaySteps, stepForTurn, damageBySlot, moveText, timeAgo, itemLabel } from "../public/battlerecords/records.js";
import { battleRecord, challengeRecord } from "../utils/fightRecordBuild.js";
import { runBattle } from "../utils/battle/runBattle.js";
import { startRun, continueRun } from "../utils/challenge/runChallenge.js";
import { createNewUser } from "../utils/userSchema.js";

const D = new Date("2026-11-12T12:00:00Z");
function player(id, speciesIds, level) {
  const u = createNewUser(id, `Trainer ${id}`);
  for (const sid of speciesIds) {
    u.pokemon[sid] = { normal: 1, shiny: 0 };
    (u.training ??= {})[`${sid}:normal`] = { exp: level ** 3 };
  }
  u.displayedPokemon = speciesIds.map((sid) => ({ id: sid, variant: "normal" }));
  return u;
}

const td = { A: player("A", [6, 9, 3, 25], 55), B: player("B", [149, 130, 65], 50) };
// One battle a day, so every battle stays inside the Battle cap.
const day = (n) => new Date(D.getTime() + n * 86400000);
const battles = [1, 2, 3, 4, 5].map((seed) => battleRecord(runBattle({ trainerData: td, challengerId: "A", defenderId: "B", mode: "open", seed, now: day(seed) }), { A: "Ash", B: "Gary" }, td, { now: day(seed) }));

section("Perspective");
{
  const r = battles[0];
  const a = perspective(r, "A"), b = perspective(r, "B");
  assertEqual([a.mine, b.mine], [0, 1], "Challenger is side 0, Defender side 1");
  assertTrue(a.won !== b.won, "exactly one of them won");
  assertEqual([a.me.name, b.me.name, a.foe.name], ["Ash", "Gary", "Gary"], "names from each side");
  assertEqual(b.team.map((m) => m.speciesId), [149, 130, 65], "the Defender sees their own team as theirs");
  assertEqual(a.totalKos, b.totalFaints, "A's KOs are B's faints");
  assertEqual(a.kos.reduce((x, y) => x + y, 0), a.totalKos, "KOs per slot add up");
}

section("Summary");
{
  const s = summarize(battles, "A");
  const wins = battles.filter((r) => r.winner === 0).length;
  assertEqual([s.count, s.wins, s.losses], [5, wins, 5 - wins], "W/L over the records");
  assertEqual(s.winRate, Math.round((100 * wins) / 5), "win rate");
  assertEqual(s.top.length, 3, "top 3 Pokémon");
  assertEqual(s.top[0].games, 5, "each used in all 5");
  assertEqual(s.rating, null, "casual battles have no rating line");
  // Ranked needs full teams of 6.
  const full = (u, ids) => {
    const c = structuredClone(u);
    for (const sid of ids) c.pokemon[sid] = { normal: 1, shiny: 0 };
    c.battleTeam = [...c.displayedPokemon, ...ids.map((sid) => ({ id: sid, variant: "normal" }))];
    return c;
  };
  const rankedTd = { A: full(td.A, [1, 4]), B: full(td.B, [143, 131, 248]) };
  const ranked = battleRecord(runBattle({ trainerData: rankedTd, challengerId: "A", defenderId: "B", mode: "ranked", seed: 9, now: day(9) }), {}, rankedTd, { now: day(9) });
  const sr = summarize([ranked, ...battles], "B");
  assertEqual([sr.rating.current, sr.rating.change], [ranked.rewards.B.rating.to, ranked.rewards.B.rating.to - ranked.rewards.B.rating.from], "rating: newest and change");
  assertEqual(summarize(Array(25).fill(battles[0]), "A").count, 20, "summary covers the newest 20");
}

section("Replay steps");
for (const r of battles) {
  const steps = replaySteps(r, "B");
  const f = r.fights[0];
  const last = steps.at(-1);
  assertEqual(last.kind, "result", `seed: ends on the result (${steps.length} steps)`);
  assertEqual(last.hp, f.result.snapshots.at(-1), "the last step's HP is the simulator's final snapshot");
  assertEqual(steps.filter((s) => s.kind === "move").length, f.result.log.flat().length, "one step per move");
  assertEqual(steps.filter((s) => s.kind === "faint").length, f.result.knockouts.length, "one faint step per knockout");
  assertTrue(steps.every((s) => !s.members || s.hp[0].length === s.members[0].length), "HP for every slot");
}
{
  const steps = replaySteps(battles[0], "A");
  const t2 = stepForTurn(steps, 0, 1);
  assertTrue(steps[t2].turn === 1, "next from the intro goes to turn 1");
  const t3 = stepForTurn(steps, t2, 1);
  assertEqual([steps[t3].turn, stepForTurn(steps, t3, -1)], [2, t2], "next turn, then back to the previous turn's start");
  assertEqual(stepForTurn(steps, t3 + 0, -1), t2, "back from a turn's start goes to the previous turn");
}

section("Elite Four replay");
{
  let found = null;
  for (let seed = 1; seed <= 300 && !found; seed++) {
    const t = { A: player("A", [149, 130, 6, 9, 3, 65], 70) };
    t.A.challenge = { won: Object.fromEntries(["brock", "misty", "surge", "erika", "koga", "sabrina", "blaine", "giovanni"].map((k) => [k, "2026-11-01"])), day: null, attempts: 0 };
    let step = startRun({ trainerData: t, userId: "A", seed, now: D });
    while (!step.ended) step = continueRun({ trainerData: t, userId: "A", nonce: step.nonce, step: step.step + 1, slot: step.fainted[0]?.slot, now: D });
    if (step.outcome.fights.length >= 3) found = challengeRecord(step.outcome, "Ash", t, { now: D });
  }
  const steps = replaySteps(found, "A");
  assertEqual(steps.filter((s) => s.kind === "intro").length, found.fights.length, "an intro per fight");
  assertEqual(new Set(steps.map((s) => s.fight)).size, found.fights.length, "every fight played");
  const intro2 = steps.find((s) => s.kind === "intro" && s.fight === 1);
  assertTrue(intro2.heading.startsWith(`Fight 2 of ${found.fights.length}`), "headings count the fights");
  assertEqual(intro2.hp[0], found.fights[1].result.snapshots[0][0], "fight 2 starts with the HP carried from fight 1");
  const p = perspective(found, "A");
  assertEqual(p.foes.map((f) => f.name), found.fights.map((f) => f.foe.name), "the E4 members met");
}

section("Text and numbers");
assertEqual(moveText({ move: "Surf", eff: 2, crit: true }, "Lapras", "the opposing Charizard"), "Lapras used Surf! A critical hit! It's super effective!", "a super effective crit");
assertEqual(moveText({ move: "Thunder", missed: true, eff: 1 }, "Pikachu", "x"), "Pikachu used Thunder! Pikachu's attack missed!", "a miss");
assertEqual(moveText({ move: "Earthquake", eff: 0 }, "Golem", "the opposing Pidgey"), "Golem used Earthquake! It doesn't affect the opposing Pidgey…", "no effect");
assertEqual(timeAgo(0, 3 * 3600 * 1000 + 5), "3 hours ago", "time ago");
assertEqual(itemLabel("life_orb"), "Life Orb", "item label");
{
  const dmg = damageBySlot(battles[0], 0);
  assertTrue(dmg.every((x) => x >= 0) && dmg.reduce((a, b) => a + b, 0) > 0, "damage per slot, in % of HP");
}

section("Your Battle plan (full sim)");
{
  // As the server sends it to A (services/fightRecordsApi.js forViewer): only A's plan.
  const r = { ...battles[0], sides: [{ ...battles[0].sides[0], plan: { id: "setup", name: "Set up & sweep" } }, battles[0].sides[1]] };
  assertEqual(perspective(r, "A").plan, "Set up & sweep", "the expanded row names your plan");
  assertTrue(replaySteps(r, "A")[0].caption.endsWith("Your Battle plan: Set up & sweep."), "and so does the replay's first caption");
  assertEqual([perspective(battles[0], "A").plan, replaySteps(battles[0], "A")[0].caption.includes("Battle plan")], [null, false], "a record without one names none");
}

finish();
