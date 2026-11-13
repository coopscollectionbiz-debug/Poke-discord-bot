// ==========================================================
// utils/battle/rematch.js
// Rematch requests (decided 2026-11-12): once a Challenger has started
// CAPS.perOpponent casual battles against one Defender in a UTC day, another
// casual battle with them runs only if the Defender accepts. Open requests
// are saved on the Challenger, one per Defender, so a restart can close
// their messages. Every settle checks the request's nonce, so a late click,
// an expiry and a restart can never settle the same request twice.
//
// A declined or expired request blocks the Challenger from asking that
// Defender again for the rest of the request's UTC day. The block is the
// request's day, so it ends at midnight on its own; it also lifts when the
// Defender sends the Challenger a /battle that isn't refused.
// ==========================================================

export function openRematch(user, { defenderId, channelId, nonce, day }) {
  if (isRematchBlocked(user, defenderId, day)) return { ok: false, reason: "rematch_blocked" };
  if (user.rematchRequests?.[defenderId]) return { ok: false, reason: "rematch_pending" };
  (user.rematchRequests ??= {})[defenderId] = { nonce, channelId, messageId: null, day };
  return { ok: true };
}

export function attachRematchMessage(user, defenderId, nonce, messageId) {
  const request = user.rematchRequests?.[defenderId];
  if (request?.nonce === nonce) request.messageId = messageId;
}

/** Removes the open request to `defenderId` if `nonce` still matches it. Returns the request, or null. */
export function settleRematch(user, defenderId, nonce) {
  const request = user?.rematchRequests?.[defenderId];
  if (!request || request.nonce !== nonce) return null;
  delete user.rematchRequests[defenderId];
  if (!Object.keys(user.rematchRequests).length) delete user.rematchRequests;
  return request;
}

/** Blocks asking `defenderId` again on `day`. Blocks from other days have ended, so they're dropped. */
export function blockRematch(user, defenderId, day) {
  const today = Object.entries(user.rematchBlocked ?? {}).filter(([, d]) => d === day);
  user.rematchBlocked = { ...Object.fromEntries(today), [defenderId]: day };
}

export const isRematchBlocked = (user, defenderId, day) => user?.rematchBlocked?.[defenderId] === day;

/** `opponentId` challenged `user`, so `user` may ask them for a rematch again. True if a block was lifted. */
export function liftRematchBlock(user, opponentId) {
  if (!user?.rematchBlocked?.[opponentId]) return false;
  delete user.rematchBlocked[opponentId];
  return true;
}

/** Startup: request buttons die with the old process, so every open request is closed (blocking nobody). */
export function closeAllRematches(trainerData) {
  const closed = [];
  for (const [userId, user] of Object.entries(trainerData)) {
    for (const { channelId, messageId } of Object.values(user?.rematchRequests ?? {})) closed.push({ userId, channelId, messageId });
    if (user?.rematchRequests) delete user.rematchRequests;
  }
  return closed;
}
