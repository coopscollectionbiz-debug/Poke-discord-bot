// ==========================================================
// tests/wager.test.js
// Stake hold, All-in, accept, decline/expiry refunds, restart refunds.
// ==========================================================

import { assertEqual, assertTrue, section, finish } from "./harness.js";
import { offerWager, attachMessage, refundWager, acceptStake, refundAllPending } from "../utils/battle/wager.js";

const NOW = 1_800_000_000_000;
const user = (id, cc) => ({ id, cc });
const offer = (c, stake, nonce = "n1", defenderId = "B") =>
  offerWager(c, { defenderId, stake, channelId: "chan", nonce, now: NOW });

section("Offer");
{
  const a = user("A", 500);
  assertEqual(offer(a, 100), { ok: true }, "offer succeeds");
  assertEqual(a.cc, 400, "Stake is held right away");
  assertEqual(a.pendingWager, { defenderId: "B", stake: 100, channelId: "chan", messageId: null, nonce: "n1", expiresAt: NOW + 15 * 60 * 1000 }, "pending wager recorded");
  assertEqual(offer(a, 10, "n2"), { ok: false, reason: "pending_exists" }, "one pending wager per Challenger");
  attachMessage(a, "n1", "msg1");
  assertEqual(a.pendingWager.messageId, "msg1", "offer message is remembered for restart cleanup");
  assertEqual([offer(user("X", 50), 0).reason, offer(user("X", 50), 2.5).reason], ["invalid_stake", "invalid_stake"], "Stake must be a whole number ≥ 1");
  const poor = user("P", 50);
  assertEqual(offer(poor, 51).reason, "insufficient_cc", "can't stake more than you have");
  assertEqual(poor.cc, 50, "a refused offer holds nothing");
}

section("Accept");
{
  const a = user("A", 500), b = user("B", 300);
  offer(a, 100);
  assertEqual(acceptStake(a, user("C", 999), "n1", NOW), { ok: false, reason: "wrong_defender" }, "only the Defender can accept");
  assertEqual(acceptStake(a, b, "nope", NOW), { ok: false, reason: "no_wager" }, "nonce must match");
  assertEqual(acceptStake(a, b, "n1", NOW + 15 * 60 * 1000 + 1), { ok: false, reason: "expired" }, "expired after 15 minutes");
  assertEqual(acceptStake(a, b, "n1", NOW + 1000), { ok: true, stake: 100, refunded: 0 }, "full accept");
  assertEqual([a.cc, b.cc, a.pendingWager], [400, 200, null], "both Stakes held, pending cleared");
  assertEqual(acceptStake(a, b, "n1", NOW + 2000), { ok: false, reason: "no_wager" }, "second accept with same nonce fails");
}

section("All-in");
{
  const a = user("A", 500), b = user("B", 30);
  offer(a, 100);
  assertEqual(acceptStake(a, b, "n1", NOW), { ok: true, stake: 30, refunded: 70 }, "Defender with less goes All-in");
  assertEqual([a.cc, b.cc], [470, 0], "Challenger gets the excess back");
  const c = user("A", 500), broke = user("B", 0);
  offer(c, 100);
  assertEqual(acceptStake(c, broke, "n1", NOW).reason, "no_cc", "0 CC can't accept");
  assertTrue(c.pendingWager?.nonce === "n1", "the wager stays pending");
}

section("Refunds");
{
  const a = user("A", 500);
  offer(a, 100);
  assertEqual(refundWager(a, "other"), 0, "wrong nonce refunds nothing");
  assertEqual(refundWager(a, "n1"), 100, "decline/expiry refunds the Stake");
  assertEqual([a.cc, a.pendingWager], [500, null], "CC restored, pending cleared");
  assertEqual(refundWager(a, "n1"), 0, "refund is idempotent by nonce");
  assertEqual(a.cc, 500, "no double refund");

  const td = { A: user("A", 500), B: user("B", 500), C: user("C", 500) };
  offer(td.A, 100, "x");
  attachMessage(td.A, "x", "m1");
  offer(td.C, 25, "y", "A");
  const refunded = refundAllPending(td);
  assertEqual(refunded, [{ userId: "A", stake: 100, channelId: "chan", messageId: "m1" }, { userId: "C", stake: 25, channelId: "chan", messageId: null }], "restart refunds every pending Stake");
  assertEqual([td.A.cc, td.C.cc, td.A.pendingWager, td.C.pendingWager], [500, 500, null, null], "balances restored");
  assertEqual(refundAllPending(td), [], "running it again refunds nothing");
}

finish();
