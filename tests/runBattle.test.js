// ==========================================================
// tests/runBattle.test.js
// Applying a whole battle to trainerData: Teams, caps, EXP, Elo, pot.
// ==========================================================

import { assertEqual, assertTrue, section, finish } from "./harness.js";
import { buildTeam, runBattle, withBothLocks } from "../utils/battle/runBattle.js";
import { buildResultEmbed, createQueue, expSummary, playBattle, resultScreens } from "../utils/battle/playback.js";
import { pickFrameTurns } from "../utils/battle/render.js";
import { lockUser } from "../utils/userLocks.js";
import { createNewUser } from "../utils/userSchema.js";
import { grantCatch } from "../utils/training.js";

const NOW = new Date("2026-11-02T12:00:00Z");
const fixed = () => 0.5;

function trainer(id, team) {
  const u = createNewUser(id, `Trainer ${id}`);
  for (const [speciesId] of team) grantCatch(u, speciesId, "normal", fixed);
  u.displayedPokemon = team.map(([speciesId]) => ({ id: speciesId, variant: "normal" }));
  return u;
}
const world = () => ({
  A: trainer("A", [[6], [25], [1]]),
  B: trainer("B", [[19], [9]]),
  C: trainer("C", []),
});
const open = (td, seed = 1, c = "A", d = "B") =>
  runBattle({ trainerData: td, challengerId: c, defenderId: d, mode: "open", seed, now: NOW });

section("Open battle");
{
  const td = world();
  const before = { a: JSON.stringify(td.A.training), b: JSON.stringify(td.B.training) };
  const out = open(td);
  assertTrue(out.ok, "battle runs");
  assertTrue(out.result.knockouts.some((k) => k.bySide === 0), "Challenger scores a knockout (fixture precondition)");
  assertTrue(JSON.stringify(td.A.training) !== before.a, "Challenger's Team gains EXP");
  assertEqual(JSON.stringify(td.B.training), before.b, "Defender's training is unchanged");
  assertEqual([td.A.battle.started, td.B.battle.started], [1, 0], "only the Challenger uses a battle");
  const dA = td.A.battle.rating - 1000, dB = td.B.battle.rating - 1000;
  assertTrue(dA === -dB && dA !== 0, "ratings move equal and opposite");
  assertEqual(td[out.winnerId].battle.wins + td[out.loserId].battle.losses, 2, "W/L recorded");
  assertEqual(Object.keys(out.exp), ["A"], "EXP report covers the Challenger only");
  assertTrue(out.exp.A.every((e) => e.toLevel >= e.fromLevel && Array.isArray(e.learned)), "EXP report has Level changes and learned moves");
  assertEqual(out.sides.map((s) => s.members.length), [3, 2], "both Teams fought");
}

section("Wager battle");
{
  const td = world();
  const ccBefore = { A: td.A.cc, B: td.B.cc };
  const out = runBattle({ trainerData: td, challengerId: "A", defenderId: "B", mode: "wager", stake: 50, seed: 2, now: NOW });
  assertEqual(td[out.winnerId].cc - ccBefore[out.winnerId], 100, "winner gets the 2 × 50 pot");
  assertEqual(td[out.loserId].cc, ccBefore[out.loserId], "loser's Stake was already taken");
  assertEqual(Object.keys(out.exp).sort(), ["A", "B"], "both Teams earn EXP");
  assertEqual([td.A.battle.started, td.B.battle.started, td.A.battle.vs.B, td.B.battle.vs.A], [1, 1, 1, 1], "both players use a battle");
}

section("Teams");
{
  const td = world();
  td.B.pokemon[19].normal = 0;
  assertEqual(buildTeam(td.B).map((m) => m.speciesId), [9], "unowned team slots are dropped");
  td.B.pokemon[9].normal = 0;
  assertEqual(open(td).reason, "no_team_defender", "a Team of only unowned slots counts as no Team");
  assertEqual(open(world(), 1, "C", "B").reason, "no_team_challenger", "Challenger needs a Team");
  assertEqual(buildTeam(td.A)[0].name, "Charizard", "members carry the game's name");
}

section("Refusals and caps");
{
  const td = world();
  assertEqual(open(td, 1, "A", "A").reason, "self", "can't battle yourself");
  for (let i = 0; i < 3; i++) open(td, i);
  assertEqual(open(td, 9).reason, "cap_opponent", "4th battle vs the same Defender is refused");
  td.A.battle.started = 10;
  td.C = trainer("C", [[16]]);
  assertEqual(open(td, 9, "A", "C").reason, "cap_daily", "11th battle of the day is refused");
  td.A.battle.day = "2026-11-01";
  assertTrue(open(td, 9, "A", "C").ok, "caps use the day of the battle, not the offer");
  const w = world();
  w.B.battle = { rating: 1000, wins: 0, losses: 0, day: "2026-11-02", started: 10, vs: {} };
  assertEqual(runBattle({ trainerData: w, challengerId: "A", defenderId: "B", mode: "wager", stake: 1, seed: 1, now: NOW }).reason,
    "defender_cap_daily", "a Defender out of battles can't take a wager");
}

section("Determinism");
assertEqual(open(world(), 42), open(world(), 42), "same inputs + seed → same outcome");

section("Both locks");
{
  const order = [];
  const spyLock = (id, fn) => lockUser(id, async () => { order.push(id); return fn(); });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const timeout = new Promise((r) => setTimeout(() => r("deadlock"), 2000));
  const both = Promise.all([
    withBothLocks(spyLock, "B", "A", async () => { await sleep(20); return 1; }),
    withBothLocks(spyLock, "A", "B", async () => 2),
  ]);
  assertEqual(await Promise.race([both, timeout]), [1, 2], "overlapping pairs both finish (no deadlock)");
  assertEqual(order.slice(0, 2), ["A", "B"], "locks are taken in ascending id order");
}

section("Result embed");
{
  const names = { A: "Ash", B: "Gary" };
  const td = world();
  const out = open(td, 1);
  const wager = runBattle({ trainerData: world(), challengerId: "A", defenderId: "B", mode: "wager", stake: 30, seed: 3, now: NOW });
  for (const [label, outcome] of [["Open", out], ["Wager", wager]]) {
    const embed = buildResultEmbed(outcome, names).data;
    assertEqual(embed.fields.map((f) => f.name), ["Battle rating"], `${label}: the only field is Battle rating`);
    assertTrue(!embed.title && !embed.description, `${label}: no title or description (the image shows the rest)`);
  }
  const value = buildResultEmbed(out, names).data.fields[0].value;
  assertTrue(value.includes(`Ash **${td.A.battle.rating}**`) && value.includes(`Gary **${td.B.battle.rating}**`), "both new ratings are shown");
  const moved = { ...out, rating: { A: { from: 1000, to: 1016 }, B: { from: 1000, to: 984 } } };
  assertEqual(buildResultEmbed(moved, names).data.fields[0].value, "Ash **1016** ▲16\nGary **984** ▼16", "each change shows its direction and size");
}

section("Private EXP summary");
{
  const names = { A: "Ash", B: "Gary" };
  const fake = {
    sides: [{ userId: "A" }, { userId: "B" }],
    exp: {
      A: [
        { name: "Luxio", fromLevel: 16, toLevel: 17, gained: 900, learned: ["Spark"] },
        { name: "Trubbish", fromLevel: 4, toLevel: 4, gained: 80, learned: [] },
      ],
      B: [{ name: "Mudkip", fromLevel: 9, toLevel: 9, gained: 45, learned: [] }],
    },
  };
  assertEqual(expSummary(fake, "A", names), [
    "EXP from your battle with Gary:",
    "Luxio Lv 16 → **17** · +900 EXP",
    "Trubbish Lv 4 · +80 EXP",
  ].join("\n"), "every Pokémon's gain, with the level-up shown");
  assertEqual(expSummary(fake, "B", names), "EXP from your battle with Ash:\nMudkip Lv 9 · +45 EXP", "the Defender's summary names the Challenger");
}

section("Result text box");
{
  const mons = (...list) => list.map(([speciesId, name]) => ({ speciesId, variant: "normal", level: 5, name }));
  const fake = {
    sides: [{ userId: "A", members: mons([405, "Luxio"], [568, "Trubbish"]) }, { userId: "B", members: mons([258, "Mudkip"], [504, "Patrat"]) }],
    winnerId: "A",
    result: { endedBy: "knockout", knockouts: [{ bySide: 0, bySlot: 0 }, { bySide: 0, bySlot: 0 }] },
    exp: { A: [
      { key: "405:normal", name: "Luxio", fromLevel: 16, toLevel: 17, gained: 900, learned: [] },
      { key: "568:normal", name: "Trubbish", fromLevel: 4, toLevel: 5, gained: 80, learned: [] },
      { key: "179:normal", name: "Mareep", fromLevel: 4, toLevel: 5, gained: 80, learned: ["Thunder Shock"] },
    ] },
  };
  const names = { A: "Ash", B: "Gary" };
  assertEqual(resultScreens(fake, names), [
    ["Ash defeated Gary!", "Luxio was the MVP with 2 knockouts!"],
    ["Luxio grew to Lv17! Trubbish and Mareep grew to Lv5!", "Mareep learned Thunder Shock!"],
  ], "a win, the MVP, then level-ups and moves");
  const quiet = { ...fake, exp: { A: [] }, result: { endedBy: "turnCap", knockouts: [] } };
  assertEqual(resultScreens(quiet, names), [["Time's up! Ash wins on HP left.", ""]], "a turn-cap win with no level-ups is one screen");
}

section("Playback");
{
  const out = open(world(), 4);
  const sent = [];
  const edits = [];
  const channel = { send: async (opts) => { sent.push(opts); return { edit: async (o) => { edits.push(o); } }; } };
  await playBattle(channel, out, { A: "Ash", B: "Gary" }, { maxUpdates: 12, delayMs: 0 });
  assertEqual(sent.length, 1, "one new channel message (so mentions notify)");
  assertTrue(sent[0].content.includes("<@A> challenged <@B>!") && sent[0].files.length === 1, "first message mentions both players with the start frame");
  assertEqual(sent[0].files[0].name, "battle.gif", "frames are animated GIFs");
  assertEqual(edits.length, pickFrameTurns(out.result.turns, 12).length + 1, "one edit per turn (up to 12), then the result");
  assertTrue(edits.at(-1).embeds?.length === 1 && edits.slice(0, -1).every((e) => !e.embeds), "result embed arrives with the final image");
  const failing = { send: async () => ({ edit: async () => { throw new Error("Unknown Message"); } }) };
  await playBattle(failing, out, { A: "Ash", B: "Gary" }, { maxUpdates: 12, delayMs: 0 });
  assertTrue(true, "a failed edit stops playback without throwing");
}

section("Replay line");
{
  const tick = () => new Promise((r) => setImmediate(r));
  const q = createQueue(2);
  const order = [];
  const places = { c: [], d: [] };
  const a = await q.acquire();
  const b = await q.acquire();
  const c = q.acquire((n) => places.c.push(n)).then((release) => { order.push("c"); return release; });
  const d = q.acquire((n) => places.d.push(n)).then((release) => { order.push("d"); return release; });
  await tick();
  assertEqual(order, [], "only 2 replay at once; the rest wait");
  assertEqual([places.c, places.d], [[1], [2]], "each newcomer hears its place in line");
  a();
  await tick();
  assertEqual(order, ["c"], "a freed slot goes to the first in line");
  assertEqual(places.d, [2, 1], "everyone behind moves up one");
  b();
  (await c)();
  (await d)();
  await tick();
  assertEqual(order, ["c", "d"], "first come, first served");
  let free = false;
  q.acquire().then(() => { free = true; });
  await tick();
  assertTrue(free, "every slot comes back once its replay ends");
}
{
  const tick = () => new Promise((r) => setImmediate(r));
  const out = open(world(), 4);
  const q = createQueue(1);
  const hold = await q.acquire();
  const sent = [];
  const edits = [];
  const channel = { send: async (opts) => { sent.push(opts); return { edit: async (o) => { edits.push(o); } }; } };
  const playing = playBattle(channel, out, { A: "Ash", B: "Gary" }, { maxUpdates: 12, delayMs: 0, queue: q });
  await tick();
  assertEqual(sent.length, 1, "a waiting battle still posts right away (so mentions notify)");
  assertTrue(sent[0].content.includes("<@A> challenged <@B>!") && sent[0].content.includes("You're #1 in line"),
    "the waiting message shows both players and their place");
  assertTrue(!sent[0].files?.length, "no image is rendered while waiting");
  hold();
  await playing;
  assertEqual(sent.length, 1, "the battle replays on the waiting message, not a new one");
  assertTrue(edits[0].files.length === 1 && !edits[0].content.includes("in line"), "the start frame replaces the place in line");
  assertEqual(edits.length, pickFrameTurns(out.result.turns, 12).length + 2, "start frame, one edit per turn, then the result");

  const broken = { send: async () => { throw new Error("Missing Permissions"); } };
  const failed = await playBattle(broken, out, { A: "Ash", B: "Gary" }, { maxUpdates: 12, delayMs: 0, queue: q }).catch(() => "threw");
  assertEqual(failed, "threw", "a battle that can't be posted still tells the caller");
  let free = false;
  q.acquire().then(() => { free = true; });
  await tick();
  assertTrue(free, "a failed replay frees its slot");
}

finish();
