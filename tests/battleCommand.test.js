// ==========================================================
// tests/battleCommand.test.js
// Drives the real /battle execute() and wager collector with stub
// Discord objects. Other commands (and the dashboard) replace a player's
// record in trainerData with a copy, so the wager flow must always act on
// the live record; CC must never be minted or stranded.
// ==========================================================

import { assertEqual, assertTrue, section, finish } from "./harness.js";
import { execute } from "../commands/battle.js";
import { lockUser } from "../utils/userLocks.js";
import { createNewUser } from "../utils/userSchema.js";
import { grantCatch } from "../utils/training.js";
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
function harness({ sendFails = false, perms = true, offeredReplyFails = false } = {}) {
  const trainerData = { A: trainer("A"), B: trainer("B") };
  const log = { replies: [], edits: [], messages: [] };
  const collectors = [];
  const channel = {
    send: async (opts) => {
      if (sendFails) throw new Error("Missing Permissions");
      const message = {
        id: `m${log.messages.length}`,
        opts,
        edits: [],
        edit: async (o) => { message.edits.push(o); },
        createMessageComponentCollector: () => {
          const c = { h: {}, ended: null, on(e, f) { this.h[e] = f; }, stop(reason) { this.ended ??= this.h.end?.([], reason); } };
          collectors.push(c);
          return c;
        },
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
  });
  const button = (userId, customId) => ({
    user: { id: userId },
    customId,
    replies: [],
    deferUpdate: async () => {},
    update: async () => {},
    reply: async function (o) { this.replies.push(o.content); },
    followUp: async function (o) { this.replies.push(o.content); },
  });
  const run = (userId, opponentId, wager) =>
    execute(interaction(userId, opponentId, wager), trainerData, null, null, lockUser, async () => {}, null);
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
  assertTrue(opts.embeds[0].data.description.includes("everything you have"), "the offer explains going All-in");
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
