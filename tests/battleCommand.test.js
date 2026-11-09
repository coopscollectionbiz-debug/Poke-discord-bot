// ==========================================================
// tests/battleCommand.test.js
// Drives the real /battle execute() and wager collector with stub
// Discord objects. Other commands (and the dashboard) replace a player's
// record in trainerData with a copy, so the wager flow must always act on
// the live record; CC must never be minted or stranded.
// ==========================================================

import { MessageFlags } from "discord.js";
import { assertEqual, assertTrue, section, finish } from "./harness.js";
import { execute } from "../commands/battle.js";
import { lockUser } from "../utils/userLocks.js";
import { createNewUser } from "../utils/userSchema.js";
import { grantCatch, getMoveset, expForLevel } from "../utils/training.js";
import { ensureUserInitialized } from "../utils/userInitializer.js";
import { refundAllPending } from "../utils/battle/wager.js";
import { PLAYBACK } from "../utils/battle/tuning.js";

PLAYBACK.delayMs = 0;
const quiet = console.log;
console.log = (...a) => { if (!String(a[0]).includes("loaded from memory")) quiet(...a); };

const trainer = (id) => {
  const u = createNewUser(id, id);
  u.cc = 100;
  grantCatch(u, 25, "normal", () => 0.5);
  u.displayedPokemon = [{ id: 25, variant: "normal" }];
  return u;
};

// One fake guild channel; every message gets a controllable collector.
function harness({ sendFails = false, perms = true, offeredReplyFails = false, followUpFails = null } = {}) {
  const trainerData = { A: trainer("A"), B: trainer("B") };
  const log = { replies: [], edits: [], messages: [], followUps: [], saves: [] };
  const collectors = [];
  const newCollector = () => {
    const c = { h: {}, ended: null, on(e, f) { this.h[e] = f; }, stop(reason) { this.ended ??= this.h.end?.([], reason); } };
    collectors.push(c);
    return c;
  };
  // Records who got each follow-up, and whether the battle's result embed was already showing.
  // A follow-up with buttons (the move prompt) gets a collector like any message.
  const followUp = (userId) => async (o) => {
    if (followUpFails === userId) throw new Error("Invalid Webhook Token");
    const entry = { userId, ...o, afterResult: !!log.messages.at(-1)?.edits.at(-1)?.embeds };
    log.followUps.push(entry);
    return { id: `f${log.followUps.length}`, createMessageComponentCollector: () => (entry.collector = newCollector()) };
  };
  const channel = {
    send: async (opts) => {
      if (sendFails) throw new Error("Missing Permissions");
      const message = {
        id: `m${log.messages.length}`,
        opts,
        edits: [],
        edit: async (o) => { message.edits.push(o); },
        createMessageComponentCollector: newCollector,
      };
      log.messages.push(message);
      return message;
    },
  };
  const interaction = (userId, opponentId, wager) => ({
    user: { id: userId, username: userId },
    member: { displayName: userId },
    channelId: "chan",
    channel,
    appPermissions: { has: () => perms },
    options: {
      getUser: () => ({ id: opponentId, username: opponentId, bot: false }),
      getInteger: () => wager ?? null,
      getMember: () => ({ displayName: opponentId }),
    },
    reply: async (o) => { log.replies.push(o.content); },
    deferReply: async () => {},
    editReply: async (o) => {
      const text = typeof o === "string" ? o : o.content;
      if (offeredReplyFails && text.includes("Wager offered")) throw new Error("503 Service Unavailable");
      log.edits.push(text);
    },
    followUp: followUp(userId),
  });
  const button = (userId, customId) => ({
    user: { id: userId },
    customId,
    replies: [],
    deferUpdate: async () => {},
    update: async () => {},
    reply: async function (o) { this.replies.push(o.content); },
    followUp: async function (o) { this.replies.push(o.content); return followUp(userId)(o); },
  });
  const save = async (_data, opts) => { log.saves.push(opts); return true; };
  const run = (userId, opponentId, wager) =>
    execute(interaction(userId, opponentId, wager), trainerData, null, null, lockUser, save, null);
  return { trainerData, log, collectors, run, button, totalCc: () => trainerData.A.cc + trainerData.B.cc };
}

const replaceRecord = (t, id) => ensureUserInitialized(id, id, t.trainerData, null); // e.g. /daily or a dashboard save

section("Accept after the Challenger's record was replaced");
{
  const t = harness();
  await t.run("A", "B", 50);
  const nonce = t.trainerData.A.pendingWager.nonce;
  await replaceRecord(t, "A");
  await t.collectors[0].h.collect(t.button("B", `wager_accept:${nonce}`));
  assertEqual(t.trainerData.A.pendingWager, null, "live record's pending wager is cleared");
  assertEqual(t.totalCc(), 200, "no CC minted or lost (pot paid to the winner)");
  assertEqual(refundAllPending(t.trainerData), [], "a restart refunds nothing more");
  assertEqual(t.log.messages.length, 2, "the battle is posted");
}

section("Challenger's Team gets stronger after the offer");
{
  const t = harness();
  await t.run("A", "B", 50);
  const nonce = t.trainerData.A.pendingWager.nonce;
  // B saw A's Pikachu in the offer; A swaps in a Mewtwo before B answers.
  grantCatch(t.trainerData.A, 150, "normal", () => 0.5);
  t.trainerData.A.displayedPokemon = [{ id: 150, variant: "normal" }];
  await t.collectors[0].h.collect(t.button("B", `wager_accept:${nonce}`));
  assertEqual([t.trainerData.A.cc, t.trainerData.B.cc, t.trainerData.A.pendingWager], [100, 100, null], "the Stake is refunded");
  assertEqual(t.log.messages.length, 1, "no battle runs");
  assertTrue(t.log.messages[0].edits.at(-1)?.content.includes("Team got stronger"), "the offer says why it closed");
}

section("Expiry and decline after a replaced record");
{
  const t = harness();
  await t.run("A", "B", 50);
  await replaceRecord(t, "A");
  t.collectors[0].stop("time");
  await t.collectors[0].ended;
  assertEqual([t.trainerData.A.cc, t.trainerData.A.pendingWager], [100, null], "expiry refunds the live record");

  const d = harness();
  await d.run("A", "B", 50);
  const nonce = d.trainerData.A.pendingWager.nonce;
  await replaceRecord(d, "A");
  await d.collectors[0].h.collect(d.button("B", `wager_decline:${nonce}`));
  assertEqual([d.trainerData.A.cc, d.trainerData.A.pendingWager], [100, null], "decline refunds the live record");
}

section("Concurrent offers");
{
  const t = harness();
  await Promise.all([t.run("A", "B", 50), t.run("A", "B", 50)]);
  assertEqual(t.trainerData.A.cc, 50, "exactly one Stake held");
  assertEqual(t.log.messages.length, 1, "exactly one offer posted");
  assertTrue(t.log.edits.includes("You already have a wager waiting for an answer."), "the second offer is refused");
}

section("Stakes are never stranded");
{
  const t = harness({ sendFails: true });
  await t.run("A", "B", 50);
  assertEqual([t.trainerData.A.cc, t.trainerData.A.pendingWager], [100, null], "a failed offer post refunds the Stake");

  const g = harness();
  await g.run("A", "B", 50);
  g.collectors[0].stop("messageDelete");
  await g.collectors[0].ended;
  assertEqual([g.trainerData.A.cc, g.trainerData.A.pendingWager], [100, null], "a deleted offer message refunds the Stake");
}

section("Double click: Accept then Decline");
{
  const t = harness();
  await t.run("A", "B", 50);
  const nonce = t.trainerData.A.pendingWager.nonce;
  await t.collectors[0].h.collect(t.button("B", `wager_accept:${nonce}`));
  const late = t.button("B", `wager_decline:${nonce}`);
  await t.collectors[0].h.collect(late);
  const offer = t.log.messages[0];
  assertTrue(!offer.edits.some((e) => e.content?.includes("declined")), "a late Decline doesn't overwrite 'accepted'");
  assertEqual(late.replies, ["This wager is no longer open."], "the late click gets a private note");
  assertEqual(t.totalCc(), 200, "no CC moved by the late click");
}

section("A failed reply after the offer is posted");
{
  const t = harness({ offeredReplyFails: true });
  let threw = false;
  await t.run("A", "B", 50).catch(() => { threw = true; });
  assertTrue(!threw, "the command doesn't throw");
  assertEqual(t.collectors.length, 1, "the offer still listens for Accept and Decline");
  t.collectors[0].stop("time");
  await t.collectors[0].ended;
  assertEqual([t.trainerData.A.cc, t.trainerData.A.pendingWager], [100, null], "expiry still refunds the Stake");
}

section("The offer never shows the Defender's balance");
{
  const t = harness();
  t.trainerData.B.cc = 30;
  await t.run("A", "B", 50);
  const { opts } = t.log.messages[0];
  assertEqual(opts.components[0].components[0].data.label, "Accept (50 CC)", "the button shows the Stake, not B's balance");
  assertTrue(!JSON.stringify(opts).includes("30 CC"), "B's 30 CC appears nowhere in the offer");
  assertTrue(opts.embeds[0].data.description.includes("accepting puts you all in"), "the offer explains going All-in");
}

section("Private EXP messages");
{
  const t = harness();
  await t.run("A", "B");
  assertEqual(t.log.followUps.map((f) => f.userId), ["A"], "Open battle: only the Challenger gets an EXP message");
  const [a] = t.log.followUps;
  assertEqual(a.flags, MessageFlags.Ephemeral, "only they can see it");
  assertTrue(a.content.startsWith("EXP from your battle with B:") && a.content.includes("Pikachu"), "it lists their Team's EXP");
  assertTrue(a.afterResult, "it arrives after the result is shown");

  const w = harness();
  await w.run("A", "B", 50);
  await w.collectors[0].h.collect(w.button("B", `wager_accept:${w.trainerData.A.pendingWager.nonce}`));
  assertEqual(w.log.followUps.map((f) => f.userId).sort(), ["A", "B"], "Wager battle: each player gets their own");
  assertTrue(w.log.followUps.every((f) => f.flags === MessageFlags.Ephemeral && f.afterResult), "both private, both after the result");
  assertTrue(w.log.followUps.find((f) => f.userId === "B").content.startsWith("EXP from your battle with A:"), "the Defender's names the Challenger");

  // Accepted late: the Challenger's /battle is over 15 minutes old, so Discord refuses its follow-up.
  const late = harness({ followUpFails: "A" });
  await late.run("A", "B", 50);
  let threw = false;
  await late.collectors[0].h.collect(late.button("B", `wager_accept:${late.trainerData.A.pendingWager.nonce}`))
    .catch(() => { threw = true; });
  assertTrue(!threw, "a refused Challenger follow-up doesn't throw");
  assertEqual(late.log.followUps.map((f) => f.userId), ["B"], "the Defender still gets theirs");
}

section("Move prompt after the EXP message");
{
  // A Lv 33 Charmander one EXP short of Slash, with 4 moves already, against a
  // Shedinja its Fire moves knock out in one super-effective hit.
  const onTeam = (user, id, exp) => {
    grantCatch(user, id, "normal", () => 0.5);
    if (exp != null) user.training[`${id}:normal`].exp = exp;
    user.displayedPokemon = [{ id, variant: "normal" }];
  };
  const almost34 = expForLevel(34) - 1;
  const t = harness();
  onTeam(t.trainerData.A, 4, almost34);
  onTeam(t.trainerData.B, 292);
  await t.run("A", "B");
  const learned = getMoveset(t.trainerData.A, 4, "normal").includes("slash");
  assertTrue(learned, "fixture: Charmander knocked out Shedinja and learned Slash");
  const [exp, prompt] = t.log.followUps;
  assertTrue(exp.content.startsWith("EXP from your battle") && prompt?.userId === "A", "Open battle: the Challenger's prompt follows their EXP message");
  assertEqual(prompt?.flags, MessageFlags.Ephemeral, "only they can see it");
  assertTrue(prompt?.content.startsWith("Charmander learned **Slash** and forgot **Scratch**."), "it asks about Slash");
  const flameBurst = prompt.components[0].components.find((b) => b.data.label === "Flame Burst").data.custom_id;
  t.log.saves.length = 0;
  await prompt.collector.h.collect({
    user: { id: "A" }, customId: flameBurst, deferUpdate: async () => {}, editReply: async () => {},
  });
  assertEqual(getMoveset(t.trainerData.A, 4, "normal"), ["scratch", "ember", "firefang", "slash"], "a click changes the Challenger's Moveset");
  assertEqual(t.log.saves, [{ force: true }], "and saves at once, like the battle's results");

  const w = harness();
  onTeam(w.trainerData.A, 292);
  onTeam(w.trainerData.B, 4, almost34);
  await w.run("A", "B", 10);
  await w.collectors[0].h.collect(w.button("B", `wager_accept:${w.trainerData.A.pendingWager.nonce}`));
  const bMessages = w.log.followUps.filter((f) => f.userId === "B");
  assertTrue(bMessages[0]?.content.startsWith("EXP from your battle") && bMessages[1]?.content.includes("learned **Slash**"),
    "Wager battle: the Defender's prompt follows their EXP message, on their Accept click");
  assertTrue(!w.log.followUps.some((f) => f.userId === "A" && f.components), "no prompt for a player with nothing to ask");
}

section("Missing channel permissions");
{
  const t = harness({ perms: false });
  await t.run("A", "B");
  await t.run("A", "B", 50);
  assertEqual(t.log.replies.length, 2, "both modes are refused up front");
  assertEqual([t.trainerData.A.cc, t.trainerData.A.battle], [100, null], "nothing is held or recorded");
}

console.log = quiet;
finish();
