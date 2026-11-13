// Renders the cards changed by the trainer-effects work into a folder, with
// sizes and times, for review:
//   node tools/dev/card-fx-preview.mjs [outDir]   (default: .cache/card-fx)
// CARD_TRAINER_FX=0 renders them with the effects off.
import { mkdirSync, writeFileSync } from "fs";
import { performance } from "perf_hooks";
import { renderChallengeCard } from "../../utils/render/challengeCard.js";
import { renderEncounterCard } from "../../utils/render/encounterCard.js";
import { CHALLENGES, displaySprite } from "../../utils/challenge/roster.js";
import { typeStyle } from "../../utils/render/tokens.js";
import { GYM_BADGES } from "../../public/picker-pokemon/badges.js";
import { renderBattleVsCard, vsSide } from "../../utils/render/battleVsCard.js";
import { renderBattleFrame } from "../../utils/battle/render.js";

const out = process.argv[2] ?? ".cache/card-fx";
mkdirSync(out, { recursive: true });
const TEAM = [193, 22, 25, 6, 469, 12].map((id) => ({ id, variant: "normal", shiny: false }));
const TRAINERS = { rare: "alain.png", epic: "acerola.png", legendary: "alder.png", mythic: "cynthia-anime.png" };
const rows = [];
async function save(name, render) {
  const t0 = performance.now();
  const buf = await render();
  const ms = Math.round(performance.now() - t0);
  const kind = buf.subarray(0, 3).toString() === "GIF" ? "gif" : "png";
  writeFileSync(`${out}/${name}.${kind}`, buf);
  rows.push({ name: `${name}.${kind}`, kb: Math.round(buf.length / 1024), ms });
}

const misty = CHALLENGES.misty, opp = misty.opponents[0];
const challengeView = (tier) => ({
  key: "misty", kind: "gym", eyebrow: "GYM LEADER", title: opp.name, type: opp.type, accent: typeStyle(opp.type).fill,
  opponents: [{ name: opp.name, title: opp.title, type: opp.type, trainerFile: displaySprite(opp) }],
  partySize: opp.team.length,
  badge: { file: misty.badge.image.split("/").pop(), name: misty.badge.badge, earned: false },
  win: "1,500 CC", rematch: false,
  player: {
    name: "Coop", trainerFile: TRAINERS[tier], tier, team: TEAM,
    badges: GYM_BADGES.map((b, i) => ({ file: b.image.split("/").pop(), earned: i < 1 })),
  },
});
for (const tier of Object.keys(TRAINERS)) await save(`challenge-${tier}`, () => renderChallengeCard(challengeView(tier), { animate: true }));
await save("challenge-still", () => renderChallengeCard(challengeView("mythic")));

const e4 = CHALLENGES.elite4;
await save("challenge-elite4", () => renderChallengeCard({
  ...challengeView("legendary"), key: "elite4", kind: "elite4", eyebrow: "ELITE FOUR", title: "The Elite Four", type: null, badge: null,
  opponents: e4.opponents.map((o) => ({ name: o.name, title: o.title, type: o.type, trainerFile: displaySprite(o) })),
}, { animate: true }));

const encounter = (tier) => ({
  player: { name: "Coop", trainerFile: TRAINERS[tier], tier, team: TEAM },
  trainer: { title: "Youngster", name: "Joey", trainerFile: "youngster-gen3.png", partySize: 3 },
  heading: "Youngster Joey challenged Coop!", line: "My Rattata is in the top percentage!", prize: 840,
});
for (const tier of ["rare", "legendary"]) await save(`encounter-${tier}`, () => renderEncounterCard(encounter(tier), { animate: true }));

const mon = (ids) => ids.map((speciesId) => ({ speciesId, variant: "normal" }));
for (const [mode, pot] of [["open", null], ["ranked", null], ["wager", 1000]]) {
  const rated = mode !== "open";
  await save(`battle-vs-${mode}`, () => renderBattleVsCard({
    mode, pot,
    sides: [
      vsSide({ name: "Coop", trainerFile: TRAINERS.mythic, tier: "mythic", members: mon([193, 22, 25, 6, 469, 12]), record: rated ? { rating: 1512, wins: 9, losses: 4, streak: 3 } : { wins: 42, losses: 17, streak: 4 } }),
      vsSide({ name: "Ash", trainerFile: TRAINERS.legendary, tier: "legendary", members: mon([445, 248, 9, 94, 130, 3]), record: rated ? { rating: 1488, wins: 11, losses: 7, streak: 1 } : { wins: 30, losses: 22, streak: 0 } }),
    ],
  }, { animate: true }));
}
await save("battle-vs-rare", () => renderBattleVsCard({
  mode: "open", pot: null,
  sides: [
    vsSide({ name: "Coop", trainerFile: TRAINERS.rare, tier: "rare", members: mon([193, 22, 25]), record: { wins: 0, losses: 0, streak: 0 } }),
    vsSide({ name: "Ash", trainerFile: TRAINERS.epic, tier: "epic", members: mon([445, 248, 9, 94]), record: { wins: 3, losses: 1, streak: 3 } }),
  ],
}, { animate: true }));

// Playback: turn 1 of a sample battle, Coop (Mythic) against each tier.
const pk = (speciesId, name) => ({ speciesId, name, level: 50, variant: "normal" });
const sides = [
  { name: "Coop", members: [pk(193, "Yanma"), pk(22, "Fearow"), pk(25, "Pikachu"), pk(6, "Charizard"), pk(469, "Yanmega"), pk(12, "Butterfree")] },
  { name: "Ash", members: [pk(445, "Garchomp"), pk(248, "Tyranitar"), pk(9, "Blastoise"), pk(94, "Gengar"), pk(130, "Gyarados"), pk(3, "Venusaur")] },
];
const hit = (o) => ({ side: 0, slot: 0, targetSlot: 0, move: "Air Slash", damage: 10, crit: false, eff: 1, missed: false, hpAfter: 0.8, fainted: false, ...o });
const full = [[1, 1, 1, 1, 1, 1], [1, 1, 1, 1, 1, 1]];
const sprites = new Map();
for (const [tier, file] of [["rare", TRAINERS.rare], ["epic", TRAINERS.epic], ["legendary", TRAINERS.legendary], ["mythic", "giovanni-masters.png"]]) {
  await save(`playback-vs-${tier}`, () => renderBattleFrame({
    sides, sprites, hpBefore: full, badge: "TURN 1", trainers: [TRAINERS.mythic, file], tiers: ["mythic", tier],
    events: [hit({ hpAfter: 0.8 }), hit({ side: 1, slot: 0, targetSlot: 0, move: "Rock Slide", eff: 2, hpAfter: 0.3 })],
  }));
}
await save("playback-start", () => renderBattleFrame({ sides, sprites, hpBefore: full, trainers: [TRAINERS.mythic, TRAINERS.rare], tiers: ["mythic", null], screens: [["The battle begins!", "Yanma and Garchomp lead off."]] }));

console.table(rows);
