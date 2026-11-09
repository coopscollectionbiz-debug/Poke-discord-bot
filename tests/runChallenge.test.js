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
} from "../utils/challenge/runChallenge.js";
import { CHALLENGES } from "../utils/challenge/roster.js";
import { buildTeam } from "../utils/battle/runBattle.js";
import { createNewUser } from "../utils/userSchema.js";
import { CHALLENGE } from "../utils/battle/tuning.js";

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
assertEqual(CHALLENGE, { perDay: 5, lossShare: 0.1, previewMs: 120000 }, "CHALLENGE tuning");
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

section("Surge side");
{
  const strong = buildTeam(player("A", STRONG, 100));
  const brock = Array.from({ length: 200 }, (_, i) => simulateChallenge({ team: strong, opponents: CHALLENGES.brock.opponents, seed: i + 1 }));
  assertTrue(brock.every((s) => s.fights.every((f) => f.surge === null)), "a leader never surges, even as the Underdog");
  const lv40 = buildTeam(player("A", [18, 59, 130, 68, 94, 34], 40));
  const red = Array.from({ length: 300 }, (_, i) => simulateChallenge({ team: lv40, opponents: CHALLENGES.red.opponents, seed: i + 1 }));
  const surged = red.filter((s) => s.fights[0].surge);
  assertTrue(surged.length > 0, `the player's Team surges sometimes (${surged.length}/300)`);
  assertTrue(surged.every((s) => s.fights[0].surge.side === 0), "always on the player's side");
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
