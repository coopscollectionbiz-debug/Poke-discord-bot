// ==========================================================
// tests/challengePlayback.test.js
// Replaying a Challenge: one message for a whole Elite Four run, played one
// fight at a time with the Revive in each header, leaders shown by name
// (never as a mention), no exact CC loss in public, and a replay slot held
// only while a fight plays.
// ==========================================================

import { assertEqual, assertTrue, section, finish } from "./harness.js";
import {
  challengeNames, challengeHeader, buildChallengeEmbed, playChallenge, prizeText, createQueue,
  playChallengeFight, showChoosing, showRunResult, challengeTheme, challengeAward,
} from "../utils/battle/playback.js";
import { pickFrameTurns, portraitBox, AWARD, ANIMATION, FRAME_WIDTH, CHALLENGE_LAYOUT } from "../utils/battle/render.js";
import { GifReader } from "omggif";
import { runChallenge, startRun, continueRun } from "../utils/challenge/runChallenge.js";
import { CHALLENGES } from "../utils/challenge/roster.js";
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
// Every Step of an interactive Elite Four run, reviving the first fainted Pokémon.
function runSteps(ids, level, seed = 1) {
  const td = player(ids, level, { ...allGyms });
  const steps = [startRun({ trainerData: td, userId: "A", seed, maxLoss: 1234, channelId: "C", now: NOW })];
  while (!steps.at(-1).ended) {
    const s = steps.at(-1);
    steps.push(continueRun({ trainerData: td, userId: "A", nonce: s.nonce, step: s.step + 1, slot: s.fainted[0]?.slot, now: NOW }));
  }
  return steps;
}
// What the command replays for a Step: the view, or the Outcome once the run ended.
const shown = (s) => (s.ended ? s.outcome : s.view);
const slotFree = (q) => Promise.race([q.acquire().then((release) => { release(); return true; }), new Promise((r) => setTimeout(() => r(false), 50))]);

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
  assertTrue(e.description.includes("🏅 Earned the Boulder Badge!"), "Badge line");
  assertTrue(!e.thumbnail, "no Badge thumbnail: the final frame presents the Badge");
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
  assertTrue(!m.description.includes("🎁") && !m.description.includes("🏅") && !m.thumbnail, "a rematch shows no prize or Badge");

  assertEqual(prizeText("brock", { cc: 2500, stones: 1, dust: 5, sprites: [{ trainerKey: "brock", cc: 7500 }] }),
    "7,500 CC for owning every Brock sprite, 2,500 CC, 1 stone, and 5 Dust", "sprite fallback text");
  assertEqual(prizeText("surge", { cc: 4000, stones: 1, dust: 10, sprites: [{ trainerKey: "ltsurge", file: "x.png" }] }),
    "Lt. Surge sprite, 4,000 CC, 1 stone, and 10 Dust", "Lt. Surge's sprite is named for him");
}

section("Theme and award");
{
  assertEqual(challengeTheme(brockWin, 0, "acerola-masters.png"),
    { trainers: ["acerola-masters.png", "brock-gen3.png"], type: "Rock", badgeFile: "boulder.png" }, "a Gym: both trainers, the type, the Badge");
  assertEqual(challengeTheme(runOut, 1, null), { trainers: [null, "bruno-gen3.png"], type: "Fighting", badgeFile: null },
    "an Elite Four fight: that member, no Badge, and an empty portrait for a player with no trainer");

  assertEqual(challengeAward(brockWin, "A"), { badgeFile: "boulder.png", title: "BOULDER BADGE", lines: ["A received the Boulder Badge!", ""] },
    "a first Gym win presents the Badge");
  assertEqual(challengeAward(outcomeOf(player(STRONG, 100, { brock: "d" }), "brock"), "A"), null, "a rematch presents nothing");
  assertEqual(challengeAward(outcomeOf(player([10], 5), "brock"), "A"), null, "nor does a loss");
  assertEqual(challengeAward(runOut, "A"), { badgeFile: null, title: "ELITE FOUR CLEARED", lines: ["A cleared the Elite Four!", ""] }, "the Elite Four");
  const firstWin = (key, won) => {
    for (let seed = 1; seed < 50; seed++) {
      const o = outcomeOf(player(STRONG, 100, won), key, seed);
      if (o.cleared) return o;
    }
    return null;
  };
  const blue = firstWin("blue", { ...allGyms, elite4: "d" });
  const red = firstWin("red", {});
  assertTrue(blue && red, "fixture: first wins over Blue and Red");
  assertEqual(challengeAward(blue, "A"), { badgeFile: null, title: "CHAMPION DEFEATED", lines: ["A beat Champion Blue for the first time!", ""] }, "Blue (no Champion title: the spec has none)");
  assertEqual(challengeAward(red, "A"), { badgeFile: null, title: "RED DEFEATED", lines: ["A beat Red for the first time!", ""] }, "Red");
}

section("Themed replay frames");
{
  const composite = (gif, k) => {
    const r = new GifReader(gif);
    const px = new Uint8Array(r.width * r.height * 4);
    for (let i = 0; i <= k; i++) r.decodeAndBlitFrameRGBA(i, px);
    return { r, px };
  };
  const bright = (px, x, y) => { const i = (Math.round(y) * FRAME_WIDTH + Math.round(x)) * 4; return px[i] + px[i + 1] + px[i + 2]; };
  const gifOf = (o) => o.files[0].attachment;
  const win = recorder();
  await playChallenge(win.channel, brockWin, challengeNames(brockWin, "A"), { ...PLAYBACK, trainer: "acerola-masters.png" });
  const start = composite(gifOf(win.sent[0]), 0).px;
  let white = 0;
  for (let y = CHALLENGE_LAYOUT.pillY; y < CHALLENGE_LAYOUT.pillY + 34; y++) for (let x = FRAME_WIDTH / 2 - 120; x < FRAME_WIDTH / 2 + 120; x++) if (bright(start, x, y) > 700) white++;
  assertTrue(white > 60, "the replay's frames carry the challenge theme (the Boulder Badge in the center pill)");
  const bare = recorder();
  await playChallenge(bare.channel, brockWin, challengeNames(brockWin, "A"));
  const bareStart = composite(gifOf(bare.sent[0]), 0).px;
  const box = portraitBox(0);
  let differ = 0;
  for (let y = box.y; y < box.y + box.h; y++) for (let x = box.x; x < box.x + box.w; x++) if (Math.abs(bright(start, x, y) - bright(bareStart, x, y)) > 60) differ++;
  assertTrue(differ > 600, "with the challenger's own trainer in their portrait");

  const result = gifOf(win.edits.at(-1));
  const { r } = composite(result, 0);
  assertEqual(r.numFrames(), 2 * ANIMATION.idleFrames, "a first win's result frame has the award screen after the result");
  assertTrue(bright(composite(result, ANIMATION.idleFrames + 5).px, AWARD.cx, AWARD.cy) > 600, "presenting the Badge");
  const again = recorder();
  const rematch = outcomeOf(player(STRONG, 100, { brock: "d" }), "brock");
  await playChallenge(again.channel, rematch, challengeNames(rematch, "A"));
  assertEqual(new GifReader(gifOf(again.edits.at(-1))).numFrames(), ANIMATION.idleFrames, "a rematch's result has no award screen");
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

section("Revive in the header");
{
  const v = runSteps(STRONG, 100)[1].view;
  const name = v.fights[1].sides[0].members[2].name;
  const line2 = (breaks) => challengeHeader({ ...v, breaks }, 1).split("\n")[1];
  assertEqual(line2([{ offered: true, slot: 2 }]), `💊 <@A> revived ${name}!`, "a Revive shows under the next fight's header");
  assertEqual(line2([{ offered: true, slot: null }]), "💊 No Pokémon was revived.", "an offered break with no pick says so");
  assertEqual(line2([{ offered: false, slot: null }]), undefined, "a break with nothing fainted adds no line");
  assertEqual(challengeHeader(v, 0), "⚔️ <@A> · Elite Four · Lorelei (1 of 4)", "the first fight has no Revive line");
}

section("Elite Four replay, one fight at a time");
{
  const steps = runSteps(STRONG, 100);
  const names = challengeNames(steps.at(-1).outcome, "A");
  const rec = recorder();
  const q = createQueue(1);
  let message = null;
  const free = [];
  for (const s of steps) {
    message = await playChallengeFight(rec.channel, message, shown(s), s.step, names, { last: s.ended, maxUpdates: PLAYBACK.maxUpdates, delayMs: 0, queue: q });
    free.push(await slotFree(q));
  }
  assertEqual([steps.length, rec.sent.length], [4, 1], "one message for the whole run");
  assertTrue(rec.sent[0].content.includes("(1 of 4)"), "the first fight posts the message");
  const contents = rec.edits.map((e) => e.content).filter(Boolean);
  assertTrue(contents.some((c) => c.includes("(2 of 4)")) && contents.some((c) => c.includes("(4 of 4)")), "headers for each fight");
  const fights = steps.map((s) => shown(s).fights[s.step]);
  const expected = fights.reduce((t, f) => t + pickFrameTurns(f.result.turns, PLAYBACK.maxUpdates).length + 1, 0) + fights.length - 1;
  assertEqual(rec.edits.length, expected, "each fight: start frame, turns, final frame on the same message");
  assertEqual(rec.edits.at(-1).embeds?.[0]?.toJSON().title, "🏆 A cleared the Elite Four!", "the result embed comes with the last frame");
  assertTrue(rec.edits.slice(0, -1).every((e) => !e.embeds?.length), "no embed before the end");
  assertEqual(free, [true, true, true, true], "the replay slot is free after each fight");
  assertTrue(!OPPONENT_KEYS.some((k) => texts(rec).includes(`<@${k}`)), "no leader is ever a mention");

  const waiting = recorder();
  const first = await playChallengeFight(waiting.channel, null, shown(steps[0]), 0, names, { last: false, maxUpdates: 2, delayMs: 0, queue: q });
  const release = await q.acquire();
  const second = playChallengeFight(waiting.channel, first, shown(steps[1]), 1, names, { last: false, maxUpdates: 2, delayMs: 0, queue: q });
  await new Promise((r) => setTimeout(r, 0));
  assertTrue(waiting.edits.at(-1).content.includes("#1 in line") && waiting.sent.length === 1, "a later fight waiting for a slot shows its place on the run's message");
  release();
  assertEqual(await second, first, "then plays on that message");
}

section("Each fight's result stays up");
{
  // Fights 1-3's result frames must stay up a full delay before the next fight's start frame replaces them.
  const delayMs = 600; // well above the ~0.2 s a frame takes to render
  const steps = runSteps(STRONG, 100);
  const names = challengeNames(steps.at(-1).outcome, "A");
  const stamps = [];
  const channel = { send: async () => ({ edit: async () => { stamps.push(Date.now()); } }) };
  let message = null;
  const ends = [];
  for (const s of steps) {
    message = await playChallengeFight(channel, message, shown(s), s.step, names, { last: s.ended, maxUpdates: 2, delayMs, queue: createQueue(1) });
    ends.push(stamps.length - 1);
  }
  const gaps = ends.slice(0, -1).map((e) => stamps[e + 1] - stamps[e]);
  assertTrue(gaps.every((g) => g >= delayMs * 0.9), `each fight's result shows for a full delay (${gaps.join(", ")} ms)`);
}

section("Choosing a Revive, and the run's result");
{
  const steps = runSteps(STRONG, 100);
  const edits = [];
  const message = { edit: async (e) => { edits.push(e); } };
  const failing = { edit: async () => { throw new Error("Unknown Message"); } };
  assertEqual(await showChoosing(message, steps[0].view, 0), true, "showChoosing edits the run's message");
  assertEqual(edits[0], { content: `${challengeHeader(steps[0].view, 0)}\n⏳ <@A> is choosing a Pokémon to revive…` }, "the header, then the wait, and the image stays");
  assertEqual(await showChoosing(failing, steps[0].view, 0), false, "a failed edit returns false without throwing");

  const out = steps.at(-1).outcome;
  const names = challengeNames(out, "A");
  assertEqual(await showRunResult(message, out, names, "A note."), true, "showRunResult edits the run's message");
  const r = edits.at(-1);
  assertEqual([r.content, r.embeds[0].toJSON().title, r.files], ["A note.", "🏆 A cleared the Elite Four!", undefined], "the note and the result embed, no new image");
  assertEqual(await showRunResult(failing, out, names, "A note."), false, "a failed edit returns false without throwing");
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
  const p1 = playChallenge(first.channel, brockWin, challengeNames(brockWin, "A"), { maxUpdates: 12, delayMs: 0, queue: q });
  const p2 = playChallenge(second.channel, brockWin, challengeNames(brockWin, "A"), { maxUpdates: 12, delayMs: 0, queue: q });
  await new Promise((r) => setTimeout(r, 0));
  assertTrue(second.sent[0]?.content.includes("#1 in line"), "a challenge waiting for a slot shows its place");
  assertTrue(second.sent[0]?.content.startsWith(challengeHeader(brockWin, 0)), "with its header");
  await Promise.all([p1, p2]);
  assertTrue(first.sent.length === 1 && second.sent.length === 1, "then plays on that message");

  const failing = { send: async () => ({ edit: async () => { throw new Error("Unknown Message"); } }) };
  const q2 = createQueue(1);
  await playChallenge(failing, brockWin, challengeNames(brockWin, "A"), { maxUpdates: 12, delayMs: 0, queue: q2 });
  assertTrue(true, "a failed edit stops the replay without throwing");
  let free = false;
  await q2.acquire().then((release) => { free = true; release(); });
  assertTrue(free, "and frees its slot");
  const broken = { send: async () => { throw new Error("Missing Access"); } };
  const threw = await playChallenge(broken, brockWin, challengeNames(brockWin, "A"), { maxUpdates: 12, delayMs: 0, queue: q2 }).catch(() => "threw");
  assertEqual(threw, "threw", "a challenge that can't be posted tells the caller");
  const steps = runSteps(STRONG, 100);
  const names = challengeNames(steps.at(-1).outcome, "A");
  const gone = { edit: async () => { throw new Error("Unknown Message"); } };
  assertEqual(await playChallengeFight(failing, gone, steps[1].view, 1, names, { last: false, maxUpdates: 12, delayMs: 0, queue: q2 }), null,
    "a later fight on a deleted message returns null without throwing");
  assertEqual(await slotFree(q2), true, "and frees its slot");
}

finish();
