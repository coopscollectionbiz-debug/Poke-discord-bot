// ==========================================================
// tests/runChallenge.test.js
// Challenge rules applied to trainerData: unlocks, the 5-a-day cap, the
// fight loop (Elite Four HP carried between fights), EXP, first-win prizes,
// and the 10% CC loss (docs/superpowers/specs/2026-11-08-challenges-design.md).
// ==========================================================

import { assertEqual, assertTrue, section, finish } from "./harness.js";
import {
  challengeLoss, getChallengeRecord, isUnlocked, challengeBlock, prizeSprite,
  previewChallenge, simulateChallenge, runChallenge,
  startRun, continueRun, finishOpenRun, isRunStale, finishAllOpenRuns, attachRunMessage, challengeLogEntry, hideOpenRun,
} from "../utils/challenge/runChallenge.js";
import { CHALLENGES } from "../utils/challenge/roster.js";
import { buildTeam } from "../utils/battle/runBattle.js";
import { createNewUser } from "../utils/userSchema.js";
import { CHALLENGE } from "../utils/battle/tuning.js";
import { simulateBattle } from "../utils/battle/sim.js";
import { createRng } from "../utils/battle/rng.js";
import { trackProgress } from "../progression/achievements.js";
import { readFileSync } from "fs";

const D = new Date("2026-11-09T12:00:00Z");
const D1 = new Date("2026-11-10T00:00:01Z");
const GYMS = ["brock", "misty", "surge", "erika", "koga", "sabrina", "blaine", "giovanni"];
const STRONG = [150, 249, 250, 384, 483, 484];
const WEAK = [10];

function player(id, speciesIds, level) {
  const u = createNewUser(id, `Trainer ${id}`);
  for (const sid of speciesIds) {
    u.pokemon[sid] = { normal: 1, shiny: 0 };
    u.training ??= {};
    u.training[`${sid}:normal`] = { exp: level ** 3 };
  }
  u.displayedPokemon = speciesIds.map((sid) => ({ id: sid, variant: "normal" }));
  u.cc = 12345;
  return u;
}
const world = (speciesIds = STRONG, level = 100) => ({ A: player("A", speciesIds, level) });
const winAll = (keys) => Object.fromEntries(keys.map((k) => [k, "2026-11-01"]));
const run = (td, key, seed = 1, extra = {}) => runChallenge({ trainerData: td, userId: "A", key, seed, now: D, ...extra });
const block = (td, key, now = D) => challengeBlock({ trainerData: td, userId: "A", key, now });
const sum = (xs) => xs.reduce((a, b) => a + b, 0);

section("Loss amount");
assertEqual(CHALLENGE, { perDay: 5, lossShare: 0.1, previewMs: 120000, pickMs: 60000, staleRunMs: 900000 }, "CHALLENGE tuning");
assertEqual([challengeLoss(12345), challengeLoss(9), challengeLoss(0), challengeLoss(undefined)], [1234, 0, 0, 0], "10% rounded down; nothing under 10 CC");

section("Gating");
{
  const td = world();
  assertEqual([block(td, "elite4"), block(td, "blue"), block(td, "red"), block(td, "brock")],
    ["locked_elite4", "locked_blue", null, null], "fresh player: Gyms and Red open; Elite Four and Blue locked");
  assertEqual(td.A.challenge, undefined, "challengeBlock never creates the record");
  td.A.challenge = { won: winAll(GYMS.slice(0, 7)), day: null, attempts: 0 };
  assertEqual(block(td, "elite4"), "locked_elite4", "7 Badges: still locked");
  td.A.challenge.won.giovanni = "2026-11-02";
  assertEqual(block(td, "elite4"), null, "8 Badges: the Elite Four opens");
  assertEqual(block(td, "blue"), "locked_blue", "Blue waits for a cleared run");
  td.A.challenge.won.elite4 = "2026-11-03";
  assertEqual([block(td, "blue"), isUnlocked(td.A, "blue")], [null, true], "a cleared run opens Blue");

  const noTeam = world();
  noTeam.A.displayedPokemon = [];
  assertEqual(block(noTeam, "elite4"), "no_team", "no Team comes first");
  const gone = world();
  gone.A.pokemon[STRONG[0]].normal = 0;
  gone.A.displayedPokemon = [{ id: STRONG[0], variant: "normal" }];
  assertEqual(block(gone, "brock"), "no_team", "a Team of Pokémon no longer owned is no Team");
  const waiting = world();
  waiting.A.pendingWager = { nonce: "x" };
  assertEqual(block(waiting, "brock"), "pending_wager", "a pending wager blocks");
  assertEqual(run(waiting, "brock"), { ok: false, reason: "pending_wager" }, "runChallenge re-checks the wager");
  assertEqual(block({}, "brock"), "no_team", "an unknown player has no Team");
}

section("Daily cap");
{
  const td = world();
  const results = [1, 2, 3, 4, 5].map((s) => run(td, "brock", s).ok);
  assertEqual(results, [true, true, true, true, true], "5 challenges on one day");
  assertEqual(run(td, "brock", 6), { ok: false, reason: "cap" }, "the 6th is refused");
  assertEqual(td.A.challenge.attempts, 5, "the refusal isn't counted");
  assertEqual(block(td, "brock", D1), null, "a preview from before midnight passes after it");
  assertTrue(run(td, "brock", 7, { now: D1 }).ok, "the next UTC day allows another");
  assertEqual([td.A.challenge.day, td.A.challenge.attempts], ["2026-11-10", 1], "the count resets to the click's day");
  const rec = getChallengeRecord(td.A, "2026-11-10");
  assertEqual(rec.attempts, 1, "getChallengeRecord keeps today's count");
  assertEqual(getChallengeRecord(td.A, "2026-11-11").attempts, 0, "and resets on a new day");
}

section("First win");
{
  const td = world();
  const out = run(td, "brock");
  assertTrue(out.ok && out.cleared, "STRONG beats Brock");
  assertEqual(td.A.cc, 12345 + 2500, "prize CC");
  assertEqual([td.A.items.evolution_stone, td.A.items.shiny_dust], [1, 5], "1 stone and 5 Dust");
  assertTrue(td.A.trainers.includes("brock-gen3.png"), "Brock's first enabled sprite unlocked");
  assertEqual(td.A.challenge.won.brock, "2026-11-09", "won records the UTC day");
  assertEqual([out.badge, out.unlocked, out.ccLost], ["brock", null, 0], "badge, nothing unlocked, nothing lost");
  assertEqual(out.prize, { cc: 2500, stones: 1, dust: 5, sprites: [{ trainerKey: "brock", file: "brock-gen3.png" }] }, "the Outcome lists the prize");
  const again = run(td, "brock", 2);
  assertTrue(again.cleared, "rematch won");
  assertEqual([again.prize, again.badge, td.A.cc, td.A.items.evolution_stone], [null, null, 12345 + 2500, 1], "a rematch pays no prize");
  assertEqual(td.A.challenge.won.brock, "2026-11-09", "the first-win day is kept");
}

section("Sprite fallback");
{
  const td = world();
  td.A.trainers = ["BROCK-GEN3.png", "brock-lgpe.png", "brock.png"];
  assertEqual(prizeSprite(td.A, "brock"), { trainerKey: "brock", cc: 7500 }, "owning every enabled sprite (any case) pays half the Rare price");
  assertEqual(prizeSprite({ trainers: ["brock-gen3.png"] }, "brock"), { trainerKey: "brock", file: "brock-lgpe.png" }, "otherwise the next unowned sprite");
  assertEqual(prizeSprite({ trainers: { "brock-gen3.png": 1 } }, "brock"), { trainerKey: "brock", file: "brock-lgpe.png" }, "a legacy trainers object counts too");
  const out = run(td, "brock");
  assertEqual(out.prize.sprites[0], { trainerKey: "brock", cc: 7500 }, "the Outcome shows the CC instead of a sprite");
  assertEqual(td.A.cc, 12345 + 2500 + 7500, "CC rises by the prize plus the fallback");
  assertEqual(td.A.trainers.length, 3, "no sprite added");

  const legacy = world();
  legacy.A.trainers = { "x.png": 1 };
  run(legacy, "brock");
  assertTrue(Array.isArray(legacy.A.trainers) && legacy.A.trainers.includes("x.png") && legacy.A.trainers.includes("brock-gen3.png"),
    "a legacy trainers object becomes an array with the new sprite");

  // Older code wrote trainers onto the array as properties (services/assets.js, D1).
  const owned = ["x.png"];
  owned["brock-gen3.png"] = 1;
  assertEqual(prizeSprite({ trainers: owned }, "brock"), { trainerKey: "brock", file: "brock-lgpe.png" },
    "a trainer stored as an array property counts as owned");
  const stray = world();
  stray.A.trainers = ["x.png"];
  stray.A.trainers["y.png"] = 1;
  run(stray, "brock");
  assertEqual([...stray.A.trainers], ["x.png", "y.png", "brock-gen3.png"], "the prize keeps a trainer stored as an array property");
}

section("Achievements");
{
  // trackProgress(user, []) runs the one-time look back over the whole
  // record first, so only the challenge's own events can unlock below.
  const collector = world();
  collector.A.trainers = Array.from({ length: 9 }, (_, i) => `t${i}.png`);
  trackProgress(collector.A, [], D.getTime());
  run(collector, "brock");
  assertTrue("trainer_10" in (collector.A.ach ?? {}), "a prize sprite counts toward Trainer Collector (10 trainers)");

  const almost = world(STRONG, 49);
  for (const sid of STRONG) almost.A.training[`${sid}:normal`].exp = 50 ** 3 - 1;
  trackProgress(almost.A, [], D.getTime());
  assertTrue(!("lvl_50" in (almost.A.ach ?? {})), "no Lv 50 before the challenge");
  run(almost, "brock");
  assertTrue("lvl_50" in (almost.A.ach ?? {}), "a Level reached in a challenge counts toward Seasoned (Lv 50)");
  assertEqual(almost.A.stats?.winStreak ?? 0, 0, "a challenge win doesn't move the Battle win streak");
}

section("Prize items go through the inventory service");
{
  const td = world();
  td.A.items.shiny_dust = 1_000_000_000; // catalog/items.js ABSOLUTE_MAX_STACK
  run(td, "brock");
  assertEqual([td.A.items.shiny_dust, td.A.items.evolution_stone], [1_000_000_000, 1], "Dust stops at the stack limit; the stone still arrives");
}

section("Loss");
{
  const td = world(WEAK, 5);
  const out = run(td, "red");
  assertTrue(out.ok && !out.cleared, "Caterpie loses to Red");
  assertEqual([out.ccLost, td.A.cc, out.prize, out.badge], [1234, 11111, null, null], "loses 10% of 12,345");
  assertEqual(td.A.challenge.attempts, 1, "a loss uses an attempt");
  assertEqual(td.A.challenge.won, {}, "nothing won");

  const capped = world(WEAK, 5);
  assertEqual(run(capped, "red", 1, { maxLoss: 500 }).ccLost, 500, "never more than the previewed amount");
  assertEqual(capped.A.cc, 12345 - 500, "maxLoss applied to the balance");
  const poor = world(WEAK, 5);
  poor.A.cc = 9;
  assertEqual([run(poor, "red").ccLost, poor.A.cc], [0, 9], "under 10 CC loses nothing");

  // A Team strong enough to knock some of Red's Pokémon out, but not to win.
  const MID = [18, 59, 130, 68, 94, 34];
  let found = null;
  for (let seed = 1; seed <= 100 && !found; seed++) {
    const t = world(MID, 70);
    const o = run(t, "red", seed);
    if (!o.cleared && sum(o.fights[0].gains) > 0) found = { t, o };
  }
  assertTrue(found !== null, "fixture: a Lv 70 Team loses to Red with knockouts");
  const gained = sum(found.o.exp.A.map((e) => e.gained));
  assertEqual(gained, sum(found.o.fights[0].gains), "a loss still pays the fight's EXP");
  assertTrue(gained > 0, "and it's more than 0");
}

section("Elite Four run");
{
  const td = world();
  td.A.challenge = { won: winAll(GYMS), day: null, attempts: 0 };
  const out = run(td, "elite4");
  assertEqual([out.fights.length, out.cleared, out.unlocked, out.badge], [4, true, "blue", null], "4 fights, cleared, Blue unlocked");
  assertEqual(out.fights.map((f) => f.opponentKey), ["lorelei", "bruno", "agatha", "lance"], "in order");
  assertEqual(out.prize.sprites.map((s) => s.trainerKey), ["lorelei", "bruno", "agatha", "lance"], "4 sprites");
  assertTrue(out.prize.sprites.every((s) => s.file), "all 4 are sprites, not CC");
  assertEqual([td.A.cc, td.A.items.evolution_stone, td.A.items.shiny_dust], [12345 + 30000, 4, 40], "30,000 CC, 4 stones, 40 Dust");
  assertEqual(td.A.challenge.attempts, 1, "the run uses one attempt");
  assertEqual(out.fights.map((f) => f.winnerId), ["A", "A", "A", "A"], "winnerId per fight");
  assertEqual(out.fights[1].sides[1].userId, "bruno", "the opponent side is keyed by opponent");
  assertTrue(out.fights[1].sides[1].members.every((m) => m.variant === "normal" && m.name), "opponent members carry a name and variant for playback");

  const eighth = world();
  eighth.A.challenge = { won: winAll(GYMS.slice(0, 7)), day: null, attempts: 0 };
  assertEqual(run(eighth, "giovanni").unlocked, "elite4", "the 8th Badge unlocks the Elite Four");
  assertEqual(run(eighth, "giovanni", 2).unlocked, null, "a Giovanni rematch unlocks nothing");
}

section("Carried HP and fixed Levels");
{
  // A Lv 60 Team that wins at least one Elite Four fight and takes damage.
  const MIDTEAM = [6, 9, 3, 65, 68, 94];
  const sims = [];
  for (let seed = 1; seed <= 60; seed++) {
    const team = buildTeam(player("A", MIDTEAM, 60));
    sims.push(simulateChallenge({ team, opponents: CHALLENGES.elite4.opponents, seed }));
  }
  const multi = sims.filter((s) => s.fights.length >= 2);
  assertTrue(multi.length > 0, `fixture: some runs reach a second fight (${multi.length}/60)`);
  const carries = multi.every((s) => s.fights.slice(1).every((f, i) => {
    const before = s.fights[i].result.snapshots.at(-1)[0];
    return f.result.snapshots[0][0].every((hp, slot) => Math.abs(hp - before[slot]) <= 0.02 && (before[slot] > 0) === (hp > 0));
  }));
  assertTrue(carries, "each fight starts where the last one ended; fainted stay fainted");
  assertTrue(multi.some((s) => s.fights[1].result.snapshots[0][0].some((hp) => hp < 1)), "some Pokémon start a later fight damaged");
  assertTrue(sims.every((s) => s.fights.slice(0, -1).every((f) => f.won)), "the run stops at the first loss");
  assertTrue(sims.every((s) => s.cleared === (s.fights.length === 4 && s.fights[3].won)), "cleared means all 4 won");

  let lost = null;
  for (let seed = 1; seed <= 200 && !lost; seed++) {
    const t = world(MIDTEAM, 60);
    t.A.challenge = { won: winAll(GYMS), day: null, attempts: 0 };
    const o = run(t, "elite4", seed);
    if (!o.cleared && o.fights.length >= 2) lost = { t, o };
  }
  assertTrue(lost !== null, "fixture: a run that beats Lorelei and loses later");
  assertEqual([lost.o.ccLost, lost.t.A.cc], [1234, 11111], "a failed run costs 10% once");
  assertEqual(lost.o.unlocked, null, "a failed run unlocks nothing");
  assertTrue(lost.o.fights.every((f) => f.sides[0].members.every((m) => m.level === 60)), "Levels stay fixed during the run");
  const startExp = player("A", MIDTEAM, 60).training;
  const perMember = MIDTEAM.map((_, i) => sum(lost.o.fights.map((f) => f.gains[i])));
  assertEqual(MIDTEAM.map((sid) => lost.t.A.training[`${sid}:normal`].exp - startExp[`${sid}:normal`].exp), perMember,
    "each member's EXP rises by the sum of its per-fight gains");
  assertEqual(lost.o.exp.A.map((e) => e.gained), perMember, "the EXP report shows the summed gains");
}

section("A win with every Pokémon fainted");
{
  // Gen 5: when both last Pokémon faint on one recoil move, the recoil user's side wins.
  const ids = Object.keys(JSON.parse(readFileSync(new URL("../battleData.json", import.meta.url))).species).map(Number);
  let found = null;
  for (let seed = 0; seed < 50000 && !found; seed++) {
    const rng = createRng(seed);
    const team = Array.from({ length: 6 }, () => ({ speciesId: ids[rng.int(ids.length)], variant: "normal", level: 50 }));
    const first = simulateBattle({ sides: [{ members: team }, { members: CHALLENGES.elite4.opponents[0].team }], seed: seed + 1, surge: null });
    if (first.winner === 0 && first.snapshots.at(-1)[0].every((hp) => hp === 0)) found = { team, seed };
  }
  assertTrue(found !== null, "fixture: a team that beats Lorelei with every Pokémon fainted");
  const s = simulateChallenge({ team: found.team, opponents: CHALLENGES.elite4.opponents, seed: found.seed });
  assertEqual([s.fights.length, s.fights[0].won, s.fights[1].won, s.cleared], [2, true, false, false], "the run ends at the next fight");
  assertEqual(s.fights[1].result.turns, 0, "which is lost before a move is made");
  const saved = simulateChallenge({ team: found.team, opponents: CHALLENGES.elite4.opponents, seed: found.seed, pick: () => 0 });
  assertTrue(saved.breaks[0].slot === 0 && saved.fights[1].result.turns >= 1, "a Revive lets that run fight on");
}

section("Revive in the sim");
{
  const opponents = CHALLENGES.elite4.opponents;
  const sims = (team, pick, n = 60) => Array.from({ length: n }, (_, i) => {
    const calls = [];
    const s = simulateChallenge({ team, opponents, seed: i + 1, pick: pick ? (arg) => { calls.push(arg); return pick(arg); } : undefined });
    return { s, calls };
  });
  const offeredBreaks = (runs) => runs.flatMap(({ s }) => s.breaks.flatMap((b, k) => (b.offered ? [{ s, b, k }] : [])));
  const startOf = (s, k) => s.fights[k + 1].result.snapshots[0][0];
  const endOf = (s, k) => s.fights[k].result.snapshots.at(-1)[0];

  const mid = buildTeam(player("A", [6, 9, 3, 65, 68, 94], 60));
  const firstFainted = ({ hp }) => hp.findIndex((h) => h === 0);
  const picked = sims(mid, firstFainted);
  assertTrue(picked.every(({ s }) => s.breaks.length === s.fights.length - 1), "one break after each fight but the last");
  const revived = offeredBreaks(picked);
  assertTrue(revived.length > 0, `fixture: some breaks have a fainted Pokémon (${revived.length})`);
  assertTrue(revived.every(({ s, b, k }) => b.slot === endOf(s, k).indexOf(0) && startOf(s, k)[b.slot] === 1),
    "the picked Pokémon starts the next fight at full HP");
  assertTrue(revived.every(({ s, b, k }) => startOf(s, k).every((hp, slot) => slot === b.slot
    || (Math.abs(hp - endOf(s, k)[slot]) <= 0.02 && (endOf(s, k)[slot] > 0) === (hp > 0)))),
    "the others carry their HP, and the other fainted stay fainted");
  assertTrue(picked.every(({ s, calls }) => {
    const ks = s.breaks.flatMap((b, k) => (b.offered ? [k] : []));
    return calls.length === ks.length && calls.every((c, j) => c.team === mid && c.hp.includes(0) && c.next === opponents[ks[j] + 1]);
  }), "pick hears the Team, the HP, and the next opponent, only when something has fainted");

  const strong = sims(buildTeam(player("A", STRONG, 100)), firstFainted);
  const clean = strong.flatMap(({ s }) => s.breaks.filter((b) => !b.offered));
  assertTrue(clean.length > 0, `fixture: some breaks have nothing fainted (${clean.length})`);
  assertTrue(clean.every((b) => b.slot === null), "a break with nothing fainted is { offered: false, slot: null }");
  assertTrue(strong.every(({ s, calls }) => calls.length === s.breaks.filter((b) => b.offered).length), "and pick isn't called for it");

  const bad = [["a standing slot", ({ hp }) => hp.findIndex((h) => h > 0)], ["slot 7", () => 7], ["null", () => null], ["no pick", null]];
  for (const [label, pick] of bad) {
    const offered = offeredBreaks(sims(mid, pick));
    assertTrue(offered.length > 0 && offered.every(({ s, b, k }) => b.slot === null
      && startOf(s, k).every((hp, slot) => (endOf(s, k)[slot] === 0) === (hp === 0))), `a pick of ${label} revives nothing`);
  }
}

section("No Underdog surge");
{
  // Challenges have no surge (decided): even a far weaker Team, the case
  // where /battle surges most, fights at its own Levels.
  const lone = buildTeam(player("A", [6], 30));
  const lv40 = buildTeam(player("A", [18, 59, 130, 68, 94, 34], 40));
  const runs = [
    ...Array.from({ length: 300 }, (_, i) => simulateChallenge({ team: lone, opponents: CHALLENGES.brock.opponents, seed: i + 1 })),
    ...Array.from({ length: 300 }, (_, i) => simulateChallenge({ team: lv40, opponents: CHALLENGES.red.opponents, seed: i + 1 })),
  ];
  assertTrue(runs.every((r) => r.fights.every((f) => f.surge === null)), "no challenge fight ever surges");
  const td = world();
  assertTrue(run(td, "brock").fights.every((f) => f.surge === null), "and runChallenge reports none");
}

section("Interactive Elite Four run");
{
  const MIDTEAM = [6, 9, 3, 65, 68, 94];
  const ready = (id, ids = STRONG, level = 100) => {
    const u = player(id, ids, level);
    u.challenge = { won: winAll(GYMS), day: null, attempts: 0 };
    return u;
  };
  const start = (td, extra = {}) => startRun({ trainerData: td, userId: "A", seed: 1, maxLoss: 1234, channelId: "C1", now: D, ...extra });
  // Picks the first fainted Pokémon, like the sim's pick below.
  const cont = (td, step, extra = {}) => continueRun({
    trainerData: td, userId: "A", nonce: step.nonce, step: step.step + 1, slot: step.fainted[0]?.slot, now: D, ...extra,
  });
  const finishLoop = (td, step) => {
    while (!step.ended) step = cont(td, step);
    return step.outcome;
  };
  // A seed whose run with `ids` at `level` survives fight 0 and passes `ok`.
  const openRun = (ids, level, ok = () => true) => {
    for (let seed = 1; seed <= 200; seed++) {
      const td = { A: ready("A", ids, level) };
      const step = start(td, { seed });
      if (!step.ended && ok(step)) return { td, step, seed };
    }
    return null;
  };

  {
    const td = { A: ready("A") };
    const before = structuredClone(td.A.training);
    const step = start(td);
    assertEqual([step.ok, step.step, step.ended, step.next.name], [true, 0, false, "Bruno"], "startRun plays Lorelei; Bruno is next");
    assertEqual([td.A.challenge.attempts, td.A.challenge.run.next], [1, 1], "the attempt counts at Fight!, and the run waits on fight 1");
    assertEqual([td.A.challenge.run.channelId, td.A.challenge.run.messageId], ["C1", null], "the run remembers its channel");
    assertEqual([step.view.key, step.view.userId, step.view.fights.length, step.view.breaks], ["elite4", "A", 1, []], "the view so far");
    assertTrue(step.view.fights[0].result && step.view.fights[0].sides[0].userId === "A", "the fight just played is complete");
    assertEqual(td.A.training, before, "EXP waits for the end of the run");
    assertEqual(td.A.challenge.run.updatedAt, D.getTime(), "updatedAt is the step's time");

    assertEqual(["brock", "elite4", "red"].map((k) => block(td, k)), ["run_open", "run_open", "run_open"], "an open run blocks every challenge");
    assertEqual(run(td, "brock"), { ok: false, reason: "run_open" }, "runChallenge refuses too");
    assertEqual(start(td), { ok: false, reason: "run_open" }, "and so does a second startRun");
    assertEqual(td.A.challenge.attempts, 1, "refusals aren't counted");
  }

  {
    let same = 0, revives = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const td = { A: ready("A", MIDTEAM, 60) };
      const sim = simulateChallenge({ team: buildTeam(td.A), opponents: CHALLENGES.elite4.opponents, seed, pick: ({ hp }) => hp.indexOf(0) });
      const o = finishLoop(td, start(td, { seed }));
      const totals = MIDTEAM.map((_, i) => sum(sim.fights.map((f) => f.gains[i])));
      if (o.cleared === sim.cleared
        && JSON.stringify(o.fights.map((f) => f.winnerId === "A")) === JSON.stringify(sim.fights.map((f) => f.won))
        && JSON.stringify(o.breaks) === JSON.stringify(sim.breaks)
        && JSON.stringify(o.exp.A.map((e) => e.gained)) === JSON.stringify(totals)) same++;
      revives += o.breaks.filter((b) => b.slot !== null).length;
    }
    assertEqual(same, 30, "an interactive run with the same picks plays out exactly like simulateChallenge");
    assertTrue(revives > 0, `fixture: those runs include Revives (${revives})`);
  }

  {
    const { td, step } = openRun(STRONG, 100);
    const snapshot = JSON.stringify(td);
    const tries = [
      cont(td, step, { nonce: "other" }),
      cont(td, step, { step: 0 }),
      cont(td, step, { step: 2 }),
      continueRun({ trainerData: td, userId: "B", nonce: step.nonce, step: 1, slot: undefined, now: D }),
    ];
    assertTrue(tries.every((t) => t.ok === false && t.reason === "stale_step"), "a wrong nonce, a past or future step, or no run is stale_step");
    assertEqual(JSON.stringify(td), snapshot, "and changes nothing");
  }

  {
    const found = openRun(MIDTEAM, 60, (s) => s.fainted.length > 0);
    assertTrue(found !== null, "fixture: a Lv 60 Team beats Lorelei with a Pokémon fainted");
    const { td, step } = found;
    assertEqual(step.fainted.map((f) => Object.keys(f)), step.fainted.map(() => ["slot", "name", "level"]), "fainted lists slot, name, and level");
    assertTrue(step.fainted.every((f) => f.level === 60 && f.name === buildTeam(td.A)[f.slot].name), "for the HP-0 members");
    const next = continueRun({ trainerData: td, userId: "A", nonce: step.nonce, step: 1, slot: null, now: D });
    assertEqual(next.view.breaks[0], { offered: true, slot: null }, "no pick after something fainted is offered, with no slot");
    assertTrue(step.fainted.every((f) => next.view.fights[1].result.snapshots[0][0][f.slot] === 0), "and the fainted stay fainted");
    assertEqual(next.view.fights[0], { opponentKey: "lorelei", winnerId: "A" }, "earlier fights in the view are summaries");
  }

  {
    const td = { A: ready("A") };
    const o = finishLoop(td, start(td));
    assertEqual([o.ok, o.key, o.fights.length, o.breaks.length, o.cleared, o.unlocked], [true, "elite4", 4, 3, true, "blue"], "a cleared run: 4 fights, 3 breaks, Blue unlocked");
    assertTrue(o.prize && o.prize.cc === 30000 && td.A.cc === 12345 + 30000, "the prize is paid");
    assertEqual([td.A.challenge.run, td.A.challenge.won.elite4, td.A.challenge.attempts], [undefined, "2026-11-09", 1], "the run is gone; the win has the run's day");
    assertTrue(o.fights.at(-1).result && o.fights.at(-1).opponentKey === "lance", "the last fight is complete");

    const late = { A: ready("A") };
    const first = start(late);
    const after = finishLoop(late, cont(late, first, { now: D1 }));
    assertEqual([after.cleared, late.A.challenge.won.elite4], [true, "2026-11-09"], "a run that ends after midnight keeps its start day");

    const lost = { A: ready("A", WEAK, 5) };
    const l = start(lost, { maxLoss: 500 });
    assertEqual([l.ended, l.outcome.cleared, l.outcome.ccLost, lost.A.cc, l.outcome.breaks], [true, false, 500, 12345 - 500, []],
      "a run lost at Lorelei ends at once and costs at most the previewed amount");
    assertEqual(lost.A.challenge.run, undefined, "and is closed");
    const uncapped = { A: ready("A", WEAK, 5) };
    assertEqual(start(uncapped, { maxLoss: undefined }).outcome.ccLost, 1234, "with no preview, 10%");
  }

  {
    const { td, step } = openRun(STRONG, 100);
    td.A = structuredClone(td.A);
    const next = cont(td, step);
    assertTrue(next.ok && next.step === 1, "a record replaced mid-run (the dashboard's save) continues from the live record");
    assertTrue(finishLoop(td, next).cleared && td.A.challenge.run === undefined, "and finishes on it");
  }

  {
    const found = openRun(MIDTEAM, 60);
    const { td, step } = found;
    td.A.pokemon[9].normal = 0;
    delete td.A.training["9:normal"];
    const o = finishLoop(td, step);
    assertEqual(td.A.training["9:normal"], undefined, "a Team member given away mid-run gets no training record");
    assertEqual(o.exp.A.map((e) => e.key), MIDTEAM.filter((id) => id !== 9).map((id) => `${id}:normal`), "and isn't in the EXP report");
  }

  {
    const { td } = openRun(STRONG, 100);
    const loaded = { A: JSON.parse(JSON.stringify(td.A)) }; // as a restart reads it
    const o = finishOpenRun({ trainerData: loaded, userId: "A", now: D });
    assertEqual([o.ok, o.cleared, o.fights.length], [true, true, 4], "finishOpenRun plays the rest of the run");
    assertTrue(o.breaks.slice(1).every((b) => b.slot === null), "with no Revives");
    assertEqual(loaded.A.challenge.run, undefined, "and closes it");
    assertEqual(finishOpenRun({ trainerData: loaded, userId: "A", now: D }), null, "with no open run it returns null");

    let lost = null;
    for (let seed = 1; seed <= 200 && !lost; seed++) {
      const t = { A: ready("A", MIDTEAM, 60) };
      t.A.cc = 5000;
      if (start(t, { seed }).ended) continue;
      const o = finishOpenRun({ trainerData: t, userId: "A", now: D });
      if (!o.cleared) lost = { o, t };
    }
    assertTrue(lost !== null, "fixture: a run finished this way that loses");
    assertEqual([lost.o.ccLost, lost.t.A.cc], [500, 4500], "it charges 10% (under the previewed 1,234)");
  }

  {
    const { td } = openRun(STRONG, 100);
    const at = (ms) => new Date(D.getTime() + ms);
    assertEqual([isRunStale(td.A, at(15 * 60 * 1000)), isRunStale(td.A, at(15 * 60 * 1000 + 1))], [false, true], "stale after 15 minutes");
    assertEqual(isRunStale(world().A, at(10 ** 9)), false, "no run is never stale");
  }

  {
    const td = { A: ready("A"), B: ready("B"), C: ready("C") };
    const a = start(td);
    startRun({ trainerData: td, userId: "B", seed: 2, maxLoss: 100, channelId: "C2", now: D });
    attachRunMessage(td.A, "wrong", { channelId: "X", messageId: "X" });
    assertEqual(td.A.challenge.run.messageId, null, "attachRunMessage ignores a wrong nonce");
    attachRunMessage(td.A, a.nonce, { channelId: "C1", messageId: "M1" });
    const done = finishAllOpenRuns(td, D);
    assertEqual(done.map((d) => [d.userId, d.channelId, d.messageId, d.outcome.ok]), [["A", "C1", "M1", true], ["B", "C2", null, true]],
      "finishAllOpenRuns finishes every open run and says where its message is");
    assertEqual([td.A.challenge.run, td.B.challenge.run, td.C.challenge.attempts], [undefined, undefined, 0], "both runs are gone; C is untouched");
  }
}

section("The dashboard never sees an open run");
{
  // The run's seed decides its remaining fights; with it, a player could test each Revive offline.
  const td = { A: world().A };
  td.A.challenge = { won: winAll(GYMS), day: null, attempts: 0 };
  startRun({ trainerData: td, userId: "A", seed: 1, maxLoss: 1234, channelId: "C", now: D });
  const shown = hideOpenRun(td.A);
  assertEqual([shown.challenge.run, Object.keys(shown.challenge).sort(), JSON.stringify(shown).includes('"seed"')],
    [undefined, ["attempts", "day", "won"], false], "the dashboard's copy has no run and no seed");
  assertTrue(td.A.challenge.run?.seed === 1, "the record keeps its run");
  const plain = world().A;
  assertEqual(hideOpenRun(plain), plain, "a record with no open run is sent as is");
}

section("Event log entry");
{
  const single = run(world(), "brock");
  assertEqual(challengeLogEntry(single), { key: "brock", seed: 1, reached: 1, cleared: true, prize: true, ccLost: 0 }, "a single fight");
  const breaks = [{ offered: true, slot: 0 }, { offered: false, slot: null }, { offered: true, slot: null }];
  assertEqual(challengeLogEntry({ ...single, key: "elite4", breaks }).revives, [0, "none", null],
    "a run lists each break's Revive: the slot, \"none\" when nothing fainted, or null for no pick");
}

section("Battle record untouched");
{
  const td = world();
  run(td, "brock");
  const lose = world(WEAK, 5);
  run(lose, "red");
  assertEqual([td.A.battle, lose.A.battle], [undefined, undefined], "challenges never touch user.battle");
}

section("Preview");
{
  const td = world();
  const p = previewChallenge(td.A, "brock");
  assertEqual([p.firstWin, p.prize.cc, p.loss], [true, 2500, 1234], "first win, prize, and loss");
  assertEqual(p.prize.sprites, [{ trainerKey: "brock", file: "brock-gen3.png" }], "the prize sprite");
  assertEqual(td.A.challenge, undefined, "a preview changes nothing");
  run(td, "brock");
  const after = previewChallenge(td.A, "brock");
  assertEqual([after.firstWin, after.prize, after.loss], [false, null, challengeLoss(td.A.cc)], "a rematch has no prize");
}

finish();
