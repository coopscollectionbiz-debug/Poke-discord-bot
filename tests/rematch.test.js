// ==========================================================
// tests/rematch.test.js
// Rematch request bookkeeping: one open request per Defender, nonce-checked
// settling, the rest-of-the-day block after a decline or expiry, lifting it,
// and closing every open request at startup.
// ==========================================================

import { assertEqual, assertTrue, section, finish } from "./harness.js";
import {
  openRematch, attachRematchMessage, settleRematch, blockRematch, isRematchBlocked, liftRematchBlock, closeAllRematches,
} from "../utils/battle/rematch.js";

const DAY = "2026-11-12";
const ask = (a, defenderId = "B", nonce = "n1", day = DAY) => openRematch(a, { defenderId, channelId: "chan", nonce, day });

section("Open");
{
  const a = { id: "A" };
  assertEqual(ask(a), { ok: true }, "a request opens");
  assertEqual(a.rematchRequests.B, { nonce: "n1", channelId: "chan", messageId: null, day: DAY }, "it's saved on the Challenger, by Defender");
  assertEqual(ask(a, "B", "n2"), { ok: false, reason: "rematch_pending" }, "one open request per Defender");
  assertEqual(ask(a, "C", "n3"), { ok: true }, "a request to someone else can open alongside it");
  attachRematchMessage(a, "B", "wrong", "m9");
  assertEqual(a.rematchRequests.B.messageId, null, "a wrong nonce attaches nothing");
  attachRematchMessage(a, "B", "n1", "m1");
  assertEqual(a.rematchRequests.B.messageId, "m1", "the message is remembered for restart cleanup");
}

section("Settle");
{
  const a = { id: "A" };
  ask(a);
  assertEqual(settleRematch(a, "B", "wrong"), null, "a wrong nonce settles nothing");
  assertTrue(a.rematchRequests.B, "…and the request stays open");
  assertEqual(settleRematch(a, "B", "n1")?.nonce, "n1", "the right nonce returns the request");
  assertEqual(a.rematchRequests, undefined, "…and removes it (no empty map left on the record)");
  assertEqual(settleRematch(a, "B", "n1"), null, "settling twice returns nothing");
  assertEqual(settleRematch({}, "B", "n1"), null, "a record with no requests is fine");
}

section("Block");
{
  const a = { id: "A" };
  assertTrue(!isRematchBlocked(a, "B", DAY), "nobody is blocked to start with");
  blockRematch(a, "B", DAY);
  assertTrue(isRematchBlocked(a, "B", DAY), "blocked for the request's day");
  assertTrue(!isRematchBlocked(a, "C", DAY), "only from that Defender");
  assertTrue(!isRematchBlocked(a, "B", "2026-11-13"), "a new UTC day lifts it");
  assertEqual(ask(a), { ok: false, reason: "rematch_blocked" }, "a blocked Challenger can't open a request");
  assertEqual(a.rematchRequests, undefined, "…and nothing is saved");

  // A request sent before midnight that expires after it blocks nothing today.
  const late = { id: "L" };
  blockRematch(late, "B", "2026-11-11");
  assertTrue(!isRematchBlocked(late, "B", DAY), "a block from yesterday's request doesn't apply today");

  blockRematch(a, "C", "2026-11-13");
  assertEqual(a.rematchBlocked, { C: "2026-11-13" }, "setting a block drops other days' blocks");

  assertEqual(liftRematchBlock(a, "C"), true, "lifting reports a change");
  assertTrue(!isRematchBlocked(a, "C", "2026-11-13"), "…and the block is gone");
  assertEqual(liftRematchBlock(a, "C"), false, "lifting again changes nothing");
  assertEqual(liftRematchBlock(undefined, "C"), false, "a missing record is fine");
}

section("Startup closes every open request");
{
  const td = { A: { id: "A" }, C: { id: "C" }, D: { id: "D" } };
  ask(td.A, "B", "n1");
  attachRematchMessage(td.A, "B", "n1", "m1");
  ask(td.A, "C", "n2");
  ask(td.C, "A", "n3");
  attachRematchMessage(td.C, "A", "n3", "m3");
  const closed = closeAllRematches(td);
  assertEqual(closed.map((c) => [c.userId, c.channelId, c.messageId]), [["A", "chan", "m1"], ["A", "chan", null], ["C", "chan", "m3"]], "every open request is listed with its message");
  assertEqual([td.A.rematchRequests, td.C.rematchRequests], [undefined, undefined], "…and cleared");
  assertTrue(!isRematchBlocked(td.A, "B", DAY) && !isRematchBlocked(td.C, "A", DAY), "a restart blocks nobody");
  assertEqual(closeAllRematches(td), [], "running it again closes nothing");
}

finish();
