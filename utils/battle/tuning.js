// ==========================================================
// utils/battle/tuning.js
// Every battle and leveling tunable in one place. Values come from the
// battles spec (docs/superpowers/specs/2026-11-02-battles-design.md);
// tests/battleBalance.test.js checks the battle ones against the
// spec's upset targets.
// ==========================================================

export const IV = 15; // fixed for everyone: no IVs/EVs/natures
export const LEVEL_CAP = 100;

// Randomness: a notch above Gen 5 (85–100% roll, 1/16 and 1/8 crits).
export const DAMAGE_ROLL_MIN = 0.8;
export const CRIT_CHANCE = 1 / 12;
export const HIGH_CRIT_CHANCE = 1 / 8; // moves with critRatio >= 2
export const CRIT_MULT = 2;
export const MOVE_RANDOM_CHANCE = 0.1;
export const TURN_CAP = 300;

// Underdog surge: chance grows with the Power rating ratio; a surge raises
// the Underdog's Levels until the gap is `residual`. Tuned by
// tests/battleBalance.test.js: even 43%, 2× 5.0%, 3× 2.1%, 5×+ 0.6%.
export const SURGE = { minRatio: 1.25, perRatio: 0.15, maxChance: 0.2, residual: 1.3 };

// Catch level by Stage (or "legendary": Tier legendary/mythic at Stage 1).
export const CATCH_RANGES = {
  1: { min: 2, max: 15, tailMax: 35 },
  2: { min: 16, max: 32, tailMax: 50 },
  3: { min: 32, max: 45, tailMax: 65 },
  legendary: { min: 40, max: 55, tailMax: 75 },
};
export const CATCH_SKEW = 2; // > 1 leans rolls toward the low end
export const CATCH_TAIL_CHANCE = 0.03;
export const DUPLICATE_LEVEL_SHARE = 0.5; // of the EXP needed for the next Level

// Battle EXP (Gen V formula). 0.035 ≈ 2 months from Lv 5 → 100 at 10 battles/day.
export const BST_YIELD_SCALE = 0.035;
export const TRAINER_BATTLE_MULT = 1.5;
export const WIN_EXP_MULT = 1.5;

export const ELO = { start: 1000, k: 32 };
// Ranked and wager battles: Battle teams fight at one fixed Level (stored
// Levels unchanged; EXP still uses them). `season` resets every ranked
// record when it changes (owner decision: all ratings reset at launch).
export const RANKED = { level: 50, season: 1 };
export const CAPS = { perDay: 10, perOpponent: 3 };
export const WAGER = { minStake: 1, windowMs: 15 * 60 * 1000 };
// Challenges (/challenge): attempts per UTC day, share of CC lost on a loss,
// and how long the private preview's buttons work.
// pickMs: how long a Revive pick stays open. staleRunMs: an Elite Four run
// with no step for this long stopped unexpectedly (a Discord reply window is 15 minutes).
// statBoost: every challenge opponent's stats, HP included, are raised by
// this much in battle; players only see the roster's Levels (decided
// 2026-11-10, hidden on purpose). 1.1 raised the Level a Team needs by 2-4
// for the Gyms and 5-7 for the Elite Four, Blue and Red
// (tests/challengeBalance.test.js), and leaves EXP unchanged, since EXP
// follows the opponent's Level.
export const CHALLENGE = {
  perDay: 5, lossShare: 0.1, previewMs: 2 * 60 * 1000, pickMs: 60 * 1000, staleRunMs: 15 * 60 * 1000, statBoost: 1.1,
};
// Playback: one image per turn, 2 s apart; longer battles are spread over 12.
// At most maxAtOnce replays render at once; the rest wait in line. In local
// tests turns kept the 2 s pace with up to 5 at once and slipped at 6; a Fly
// shared CPU is about half as fast, so 2 keeps a margin.
export const PLAYBACK = { maxUpdates: 12, delayMs: 2000, maxAtOnce: 2 };
// Trainer encounters (docs/superpowers/specs/2026-11-10-trainer-encounters-design.md;
// every value decided 2026-11-10). chance: per message that earns TP, after
// a miss on the catch roll. gapMs and perDay count every posted card, run
// from or not. answerMs: how long Battle! and Run work. resultMs (decided
// 2026-11-11): how long the final image stays up before the card shrinks to
// its result line. Each tier's band is
// added to the player's average Team Level, clamped to minLevel..maxLevel.
// aceShare: the part of Over-tier encounters that use the Ace Trainer class.
// surprise: the part of Under-tier encounters whose last Pokémon is swapped
// for any species at avg + band.
export const ENCOUNTER = {
  chance: 0.01,
  gapMs: 30 * 60 * 1000,
  perDay: 8,
  answerMs: 2 * 60 * 1000,
  resultMs: 10 * 1000,
  tiers: [
    { key: "under", share: 0.7, band: [-15, -2] },
    { key: "even", share: 0.2, band: [-2, 2] },
    { key: "over", share: 0.1, band: [5, 15] },
  ],
  minLevel: 5,
  maxLevel: 100,
  partySize: [3, 6],
  aceShare: 0.5,
  surprise: { share: 0.03, band: [10, 25] },
};
