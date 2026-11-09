// ==========================================================
// tests/challengePlayback.test.js
// Replaying a Challenge: one message for a whole Elite Four run, leaders
// shown by name (never as a mention), no exact CC loss in public, and one
// replay slot per challenge.
// ==========================================================

import { assertEqual, assertTrue, section, finish } from "./harness.js";
import {
  challengeNames, challengeHeader, buildChallengeEmbed, playChallenge, prizeText, createQueue,
} from "../utils/battle/playback.js";
import { pickFrameTurns } from "../utils/battle/render.js";
import { runChallenge } from "../utils/challenge/runChallenge.js";
import { CHALLENGES } from "../utils/challenge/roster.js";
import { badgeEmoji } from "../utils/challenge/badgeEmojis.js";
import { createNewUser } from "../utils/userSchema.js";
import { PLAYBACK } from "../utils/battle/tuning.js";
import { simulateBattle } from "../utils/battle/sim.js";

PLAYBACK.delayMs = 0;
const NOW = new Date("2026-11-09T12:00:00Z");
const GYMS = ["brock", "misty", "surge", "erika", "koga", "sabrina", "blaine", "giovanni"];
const STRONG = [150, 249, 250, 384, 483, 484];
const OPPONENT_KEYS = Object.values(CHALLENGES).flatMap((c) => c.opponents.map((o) => o.key));

function player(speciesIds, level, won = {}) {
  const u = createNewUser("A", "Trainer A");
  for (const sid of speciesIds) {
    u.pokemon[sid] = { normal: 1, shiny: 0 };
    (u.training ??= {})[`${sid}:normal`] = { exp: level ** 3 };
  }
  u.displayedPokemon = speciesIds.map((sid) => ({ id: sid, variant: "normal" }));
  u.cc = 12345;
  u.challenge = { won, day: null, attempts: 0 };
  return { A: u };
}
const allGyms = Object.fromEntries(GYMS.map((k) => [k, "2026-11-01"]));
const outcomeOf = (td, key, seed = 1) => runChallenge({ trainerData: td, userId: "A", key, seed, now: NOW });

function recorder() {
  const sent = [];
  const edits = [];
  const channel = { send: async (o) => { sent.push(o); return { edit: async (e) => { edits.push(e); } }; } };
  return { sent, edits, channel };
}
const texts = ({ sent, edits }) => [...sent, ...edits].map((o) =>
  [o.content ?? "", ...(o.embeds ?? []).map((e) => JSON.stringify(e.toJSON ? e.toJSON() : e))].join("\n")).join("\n");
const embedText = (e) => JSON.stringify(e.toJSON());

section("Names and headers");
const runOut = outcomeOf(player(STRONG, 100, { ...allGyms }), "elite4");
const runNames = challengeNames(runOut, "A");
assertEqual(runNames, { A: "A", lorelei: "Elite Four Lorelei", bruno: "Elite Four Bruno", agatha: "Elite Four Agatha", lance: "Elite Four Lance" }, "challengeNames maps every opponent fought");
assertEqual(challengeHeader(runOut, 1).split("\n")[0], "⚔️ <@A> · Elite Four · Bruno (2 of 4)", "Elite Four header");
const brockWin = outcomeOf(player(STRONG, 100), "brock");
assertEqual(challengeHeader(brockWin, 0), "⚔️ <@A> challenges Gym Leader Brock!", "single-fight header");

section("Result embed");
{
  const e = buildChallengeEmbed(brockWin, challengeNames(brockWin, "A")).toJSON();
  assertEqual(e.title, "🏆 A defeated Gym Leader Brock!", "single win title");
  assertTrue(e.description.includes(`🏅 ${badgeEmoji("brock")} Earned the Boulder Badge!`), "Badge line");
  assertTrue(e.description.includes("🎁 Brock sprite, 2,500 CC, 1 stone, and 5 Dust"), "prize line");
  assertTrue(!e.description.includes("💸"), "no loss line on a win");
  assertEqual(e.fields.map((f) => f.name), ["EXP · A"], "one EXP field, no rating");

  const r = buildChallengeEmbed(runOut, runNames).toJSON();
  assertEqual(r.title, "🏆 A cleared the Elite Four!", "run clear title");
  assertTrue(r.description.includes("Lorelei ✓ · Bruno ✓ · Agatha ✓ · Lance ✓"), "run progress");
  assertTrue(r.description.includes("🔓 Blue is waiting."), "Blue unlock line");
  assertTrue(r.description.includes("Lorelei sprite, Bruno sprite, Agatha sprite, Lance sprite, 30,000 CC, 4 stones, and 40 Dust"), "run prize");

  const lost = outcomeOf(player([10], 5), "brock");
  const l = buildChallengeEmbed(lost, challengeNames(lost, "A")).toJSON();
  assertEqual(l.title, "Gym Leader Brock wins!", "single loss title");
  assertTrue(l.description.includes("💸 Lost 10% of their CC."), "loss line");
  assertTrue(!embedText(buildChallengeEmbed(lost, challengeNames(lost, "A"))).includes("1,234") && !embedText(buildChallengeEmbed(lost, challengeNames(lost, "A"))).includes("1234"), "no exact amount");

  const eighth = outcomeOf(player(STRONG, 100, Object.fromEntries(GYMS.slice(0, 7).map((k) => [k, "d"]))), "giovanni");
  assertTrue(buildChallengeEmbed(eighth, challengeNames(eighth, "A")).toJSON().description.includes("🔓 The Elite Four is open!"), "Elite Four unlock line");

  const rematch = outcomeOf(player(STRONG, 100, { brock: "d" }), "brock");
  const m = buildChallengeEmbed(rematch, challengeNames(rematch, "A")).toJSON();
  assertTrue(!m.description.includes("🎁") && !m.description.includes("🏅"), "a rematch shows no prize or Badge");

  assertEqual(prizeText("brock", { cc: 2500, stones: 1, dust: 5, sprites: [{ trainerKey: "brock", cc: 7500 }] }),
    "7,500 CC for owning every Brock sprite, 2,500 CC, 1 stone, and 5 Dust", "sprite fallback text");
  assertEqual(prizeText("surge", { cc: 4000, stones: 1, dust: 10, sprites: [{ trainerKey: "ltsurge", file: "x.png" }] }),
    "Lt. Surge sprite, 4,000 CC, 1 stone, and 10 Dust", "Lt. Surge's sprite is named for him");
}

section("Run loss");
{
  let lost = null;
  for (let seed = 1; seed <= 200 && !lost; seed++) {
    const o = outcomeOf(player([6, 9, 3, 65, 68, 94], 60, { ...allGyms }), "elite4", seed);
    if (!o.cleared && o.fights.length >= 2) lost = o;
  }
  assertTrue(lost !== null, "fixture: a run that ends after Lorelei");
  const e = buildChallengeEmbed(lost, challengeNames(lost, "A")).toJSON();
  const last = CHALLENGES.elite4.opponents[lost.fights.length - 1].name;
  assertEqual(e.title, `The Elite Four run ends at ${last}.`, "run loss title");
  const progress = CHALLENGES.elite4.opponents.slice(0, lost.fights.length).map((o, i) => `${o.name} ${i === lost.fights.length - 1 ? "✗" : "✓"}`).join(" · ");
  assertTrue(e.description.includes(progress), `run progress (${progress})`);
  assertTrue(e.description.includes("💸 Lost 10% of their CC."), "a failed run's loss line");
}

section("Elite Four replay");
{
  const rec = recorder();
  await playChallenge(rec.channel, runOut, runNames);
  assertEqual(rec.sent.length, 1, "one message for the whole run");
  const contents = rec.edits.map((e) => e.content).filter(Boolean);
  assertTrue(contents.some((c) => c.includes("(2 of 4)")) && contents.some((c) => c.includes("(4 of 4)")), "headers for each fight");
  assertTrue(rec.sent[0].content.includes("(1 of 4)"), "the first fight posts the message");
  const expected = runOut.fights.reduce((t, f) => t + pickFrameTurns(f.result.turns, PLAYBACK.maxUpdates).length + 1, 0) + runOut.fights.length - 1;
  assertEqual(rec.edits.length, expected, "each fight: start frame, turns, final frame on the same message");
  assertEqual(rec.edits.at(-1).embeds?.[0]?.toJSON().title, "🏆 A cleared the Elite Four!", "the result embed comes with the last frame");
  assertTrue(rec.edits.slice(0, -1).every((e) => !e.embeds?.length), "no embed before the end");
  assertTrue(!OPPONENT_KEYS.some((k) => texts(rec).includes(`<@${k}`)), "no leader is ever a mention");
}

section("Each fight's result stays up");
{
  // Fights 1-3's result frames must stay up a full delay before the next fight's start frame replaces them.
  const delayMs = 600; // well above the ~0.2 s a frame takes to render
  const stamps = [];
  const channel = { send: async () => ({ edit: async () => { stamps.push(Date.now()); } }) };
  await playChallenge(channel, runOut, runNames, { maxUpdates: 2, delayMs, queue: createQueue(1) });
  let i = -1;
  const gaps = runOut.fights.slice(0, -1).map((f) => {
    i += pickFrameTurns(f.result.turns, 2).length + (i === -1 ? 1 : 2); // fight 0 starts with send(), later fights with an edit
    return stamps[i + 1] - stamps[i];
  });
  assertTrue(gaps.every((g) => g >= delayMs * 0.9), `each fight's result shows for a full delay (${gaps.join(", ")} ms)`);
}

section("Single fights in public");
{
  const lostTd = player([10], 5);
  const lost = outcomeOf(lostTd, "brock");
  const rec = recorder();
  await playChallenge(rec.channel, lost, challengeNames(lost, "A"));
  const all = texts(rec);
  assertTrue(all.includes("💸 Lost 10% of their CC."), "the loss line posts");
  assertTrue(!all.includes("1,234") && !all.includes("1234"), "the exact loss never posts");
  assertTrue(!OPPONENT_KEYS.some((k) => all.includes(`<@${k}`)), "no mention of Brock");

  const win = recorder();
  await playChallenge(win.channel, brockWin, challengeNames(brockWin, "A"));
  const w = texts(win);
  assertTrue(w.includes("Earned the Boulder Badge") && w.includes("2,500 CC"), "a first win shows the Badge and prize");
}

section("A fight lost before a move is made");
{
  // An Elite Four fight that starts with every Pokémon fainted (after a double-knockout win) has 0 turns.
  const base = outcomeOf(player([10], 5), "brock");
  const fainted = base.fights[0].sides[0].members.map((m) => ({ ...m, hpFraction: 0 }));
  const result = simulateBattle({ sides: [{ members: fainted }, { members: base.fights[0].sides[1].members }], seed: 1 });
  const zero = { ...base, fights: [{ ...base.fights[0], sides: [{ ...base.fights[0].sides[0], members: fainted }, base.fights[0].sides[1]], result }] };
  const rec = recorder();
  await playChallenge(rec.channel, zero, challengeNames(zero, "A"));
  assertEqual([rec.sent.length, rec.edits.length], [1, 1], "the start frame, then straight to the result");
  assertEqual(rec.edits[0].embeds?.[0]?.toJSON().title, "Gym Leader Brock wins!", "with the result embed");
}

section("Replay slots");
{
  const q = createQueue(1);
  const first = recorder();
  const second = recorder();
  const p1 = playChallenge(first.channel, runOut, runNames, { maxUpdates: 12, delayMs: 0, queue: q });
  const p2 = playChallenge(second.channel, brockWin, challengeNames(brockWin, "A"), { maxUpdates: 12, delayMs: 0, queue: q });
  await new Promise((r) => setTimeout(r, 0));
  assertTrue(second.sent[0]?.content.includes("#1 in line"), "a challenge waiting for a slot shows its place");
  assertTrue(second.sent[0]?.content.startsWith(challengeHeader(brockWin, 0)), "with its header");
  await Promise.all([p1, p2]);
  assertTrue(first.sent.length === 1 && first.edits.length > 4, "the run kept its slot through all 4 fights");

  const failing = { send: async () => ({ edit: async () => { throw new Error("Unknown Message"); } }) };
  const q2 = createQueue(1);
  await playChallenge(failing, runOut, runNames, { maxUpdates: 12, delayMs: 0, queue: q2 });
  assertTrue(true, "a failed edit stops the replay without throwing");
  let free = false;
  await q2.acquire().then((release) => { free = true; release(); });
  assertTrue(free, "and frees its slot");
  const broken = { send: async () => { throw new Error("Missing Access"); } };
  const threw = await playChallenge(broken, brockWin, challengeNames(brockWin, "A"), { maxUpdates: 12, delayMs: 0, queue: q2 }).catch(() => "threw");
  assertEqual(threw, "threw", "a challenge that can't be posted tells the caller");
}

finish();
