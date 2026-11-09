// ==========================================================
// config/achievementRewards.js — which achievement rewards may be claimed
//
// EMPTY on purpose: decision D-07 (retroactive payouts and their cap) is
// not approved, so every currency/item reward in catalog/achievements.js
// stays "pending_approval". Players earn Achievement Points only.
//
// To enable a reward after approval, add its achievement id here (only
// cc/items rewards are claimable; titles/badges/cosmetics need their own
// release). The claim path (progression/achievements.js claimAchievement)
// already enforces lock → once-only → all-or-nothing → acknowledged save.
// ==========================================================

export const APPROVED_REWARD_IDS = Object.freeze([]);

export const defaultRewardPolicy = Object.freeze({
  isApproved: (entry) => !!entry && APPROVED_REWARD_IDS.includes(entry.id),
});
