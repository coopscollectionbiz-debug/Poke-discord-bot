// ==========================================================
// tests/fixtures/showteamFixtures.js
// Synthetic players for /showteam previews and tests. Invented records only:
// never copy production player data here.
// ==========================================================

const exp = (level, frac = 0.5) => ({ exp: Math.floor(level ** 3 + ((level + 1) ** 3 - level ** 3) * frac) });

function player({ team, owned = {}, levels = {}, tp = 12_480, battle = { rating: 1184, wins: 23, losses: 9 }, trainer = "cynthia.png" }) {
  const pokemon = {};
  const training = {};
  for (const [id, variant] of team) {
    pokemon[id] ??= { normal: 0, shiny: 0 };
    pokemon[id][variant] += 1;
  }
  for (const [id, v] of Object.entries(owned)) pokemon[id] = { normal: 0, shiny: 0, ...v };
  for (const [key, [level, frac]] of Object.entries(levels)) training[key] = exp(level, frac);
  return {
    tp,
    battle: battle && { ...battle, day: "2026-11-09", started: 0, vs: {} },
    displayedTrainer: trainer,
    pokemon,
    training,
    displayedPokemon: team.map(([id, variant]) => ({ id, variant })),
  };
}

export const FIXTURES = {
  // A typical late-game Team: legendaries, a shiny, mixed sprite sizes.
  full: {
    displayName: "Coop",
    user: player({
      team: [[6, "normal"], [94, "shiny"], [445, "normal"], [130, "normal"], [25, "shiny"], [637, "normal"]],
      levels: { "6:normal": [62, 0.7], "94:shiny": [48, 0.2], "445:normal": [55, 0.9], "130:normal": [41, 0.4], "25:shiny": [33, 0.05], "637:normal": [58, 0.55] },
    }),
  },
  // Three Pokémon: the other slots must look intentionally empty.
  partial: {
    displayName: "Misty_Waterflower",
    user: player({
      team: [[121, "normal"], [134, "shiny"], [55, "normal"]],
      levels: { "121:normal": [27, 0.3], "134:shiny": [22, 0.6], "55:normal": [19, 0.1] },
      tp: 2_150,
      battle: { rating: 1000, wins: 2, losses: 3 },
      trainer: "hilda-masters.png",
    }),
  },
  // Layout stress: the longest names, the widest sprite (Lugia), a static
  // later-generation sprite, a hyphenated data name, an unknown species with
  // no sprite (placeholder), a 15-character display name, Level 100.
  stress: {
    displayName: "TheVeryLongestTrainerNameAllowed",
    user: player({
      team: [[249, "shiny"], [555, "normal"], [9999, "normal"], [1025, "normal"], [612, "shiny"], [534, "normal"]],
      levels: { "249:shiny": [100, 0], "555:normal": [44, 0.5], "1025:normal": [70, 0.99], "612:shiny": [64, 0.25], "534:normal": [5, 0] },
      tp: 251_337,
      battle: { rating: 1999, wins: 1204, losses: 997 },
      trainer: "not-a-real-trainer.png",
    }),
  },
  // Owns Pokémon but never picked a Team: the current fallback (first six).
  fallback: {
    displayName: "NewTrainer",
    user: { ...player({ team: [], owned: { 1: { normal: 2 }, 4: { normal: 1 }, 7: { normal: 1 }, 16: { normal: 3 }, 19: { normal: 1 } }, tp: 40, battle: null, trainer: null }), displayedPokemon: [] },
  },
  // Brand-new player: nothing owned.
  empty: {
    displayName: "Brand New",
    user: { tp: 0, pokemon: {}, displayedPokemon: [], training: {} },
  },
};

// Random-catch announcements: the player record after grantCatch, plus
// grantCatch's own result. Invented data.
const owned = (ids) => Object.fromEntries(ids.map((id) => [id, { normal: 1, shiny: 0 }]));
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
export const CATCH_FIXTURES = {
  // The screenshot's case: a first catch of a common.
  newCommon: { trainerName: "Coop", id: 613, variant: "normal", catchResult: { level: 4, isNew: true, expGained: 0 },
    user: { pokemon: { ...owned(range(495, 540)), 613: { normal: 1, shiny: 0 } } } },
  // A shiny duplicate gives EXP toward the next Level.
  shinyDuplicate: { trainerName: "Misty_Waterflower", id: 149, variant: "shiny", catchResult: { level: 37, isNew: false, expGained: 3_291 },
    user: { pokemon: { ...owned(range(1, 120)), 149: { normal: 2, shiny: 3 } } } },
  // A legendary first catch with a long name.
  newLegendary: { trainerName: "TheVeryLongestTrainerNameAllowed", id: 487, variant: "normal", catchResult: { level: 61, isNew: true, expGained: 0 },
    user: { pokemon: { ...owned(range(387, 420)), 487: { normal: 1, shiny: 0 } } } },
};

// A finished battle as runBattle returns it (only the fields the post-battle
// message reads), plus the winner's record after saving. Invented data.
export const BATTLE_FIXTURE = {
  names: { A: "RocYourFace", B: "Yoinkerrz" },
  outcome: {
    mode: "wager",
    stake: 100,
    winnerId: "A",
    surge: { side: 0 },
    sides: [{ userId: "A" }, { userId: "B" }],
    rating: { A: { from: 1000, to: 1015 }, B: { from: 979, to: 964 } },
    exp: {
      A: [
        { key: "54:normal", name: "Psyduck", fromLevel: 2, toLevel: 6, gained: 214, learned: ["Water Sport", "Confusion"] },
        { key: "559:normal", name: "Scraggy", fromLevel: 2, toLevel: 5, gained: 130, learned: [] },
        { key: "158:shiny", name: "Totodile", fromLevel: 2, toLevel: 4, gained: 66, learned: ["Water Gun"] },
        { key: "129:normal", name: "Magikarp", fromLevel: 2, toLevel: 2, gained: 4, learned: [] },
        { key: "143:normal", name: "Snorlax", fromLevel: 47, toLevel: 47, gained: 1_840, learned: [] },
        { key: "560:normal", name: "Scrafty", fromLevel: 16, toLevel: 17, gained: 540, learned: ["Headbutt"] },
      ],
      B: [
        { key: "151:normal", name: "Mew", fromLevel: 42, toLevel: 42, gained: 4, learned: [] },
        { key: "643:normal", name: "Reshiram", fromLevel: 41, toLevel: 41, gained: 4, learned: [] },
        { key: "306:normal", name: "Aggron", fromLevel: 35, toLevel: 35, gained: 4, learned: [] },
        { key: "376:normal", name: "Metagross", fromLevel: 35, toLevel: 35, gained: 4, learned: [] },
        { key: "197:normal", name: "Umbreon", fromLevel: 28, toLevel: 28, gained: 4, learned: [] },
        { key: "254:normal", name: "Sceptile", fromLevel: 35, toLevel: 35, gained: 4, learned: [] },
      ],
    },
  },
  users: {
    A: { training: { "54:normal": { exp: 6 ** 3 + 30 }, "559:normal": { exp: 5 ** 3 + 20 }, "158:shiny": { exp: 4 ** 3 + 10 }, "129:normal": { exp: 2 ** 3 + 4 }, "143:normal": { exp: 47 ** 3 + 4000 }, "560:normal": { exp: 17 ** 3 + 300 } } },
    B: { training: { "151:normal": { exp: 42 ** 3 + 2000 }, "643:normal": { exp: 41 ** 3 + 900 }, "306:normal": { exp: 35 ** 3 + 1200 }, "376:normal": { exp: 35 ** 3 + 3000 }, "197:normal": { exp: 28 ** 3 + 100 }, "254:normal": { exp: 35 ** 3 + 2500 } } },
  },
};

// A leaderboard of invented players (names, ratings, trainers, leads).
export function leaderboardWorld() {
  const rows = [
    ["p1", "MistyCascade", 1212, 22, 2, "cynthia.png", 445], ["p2", "ProfOakLab", 1205, 27, 4, "hilda-masters.png", 6],
    ["p3", "TeamRocketJess", 1111, 13, 5, "aaron.png", 94], ["p4", "BrockSolid", 1102, 11, 4, null, 95],
    ["p5", "ElmLabAide", 1015, 1, 0, "acerola-masters.png", 25], ["p6", "Coop", 1015, 1, 0, "cynthia.png", 143],
    ["p7", "SurfingPikachu", 1014, 12, 15, null, 130], ["p8", "SandSeaSentinel", 1008, 5, 6, null, 328],
    ["p9", "GhostTypeGal", 1006, 1, 1, null, 609], ["p10", "AxolotlAce", 1001, 5, 5, null, 195],
    ["p11", "LateBloomer", 990, 3, 4, null, 1], ["p12", "NewChallenger", 975, 0, 2, null, 4],
  ];
  const td = {};
  for (const [id, name, rating, wins, losses, trainer, lead] of rows) {
    td[id] = { name, displayedTrainer: trainer, battle: { rating, wins, losses }, pokemon: { [lead]: { normal: 1, shiny: 0 } }, displayedPokemon: [{ id: lead, variant: "normal" }] };
  }
  return td;
}
