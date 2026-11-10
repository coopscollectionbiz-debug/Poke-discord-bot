// ==========================================================
// tests/commandCards.test.js
// The rendered cards behind /battle (private EXP), /leaderboard, /daily,
// /trainercard + /showcard, /pokedex and /inspectpokemon: the facts each
// shows, their text fallbacks, and that none of them mutates player data.
// Synthetic data only.
// ==========================================================

import { assertEqual, assertTrue, section, finish } from "./harness.js";
import { expMessage } from "../commands/battle.js";
import { expView, renderExpCard, expCardSize } from "../utils/render/expCard.js";
import { rankBattleRatings, leaderboardMessage } from "../commands/leaderboard.js";
import { leaderboardView, leaderboardSize } from "../utils/render/leaderboardCard.js";
import { catchView } from "../utils/render/catchCard.js";
import { renderDailyCard, DAILY_SIZE } from "../utils/render/dailyCard.js";
import { trainerCardView, renderTrainerCard, TRAINER_CARD_SIZE } from "../utils/render/trainerCard.js";
import { pokedexView, renderPokedexCard, POKEDEX_SIZE } from "../utils/render/pokedexCard.js";
import { inspectSlots, battleInfo } from "../commands/inspectpokemon.js";
import { renderInspectCard, INSPECT_SIZE } from "../utils/render/inspectCard.js";
import { BATTLE_FIXTURE, FIXTURES, leaderboardWorld } from "./fixtures/showteamFixtures.js";

const dims = (png) => [png.readUInt32BE(16), png.readUInt32BE(20)];
const clone = (o) => JSON.parse(JSON.stringify(o));

section("Battle: private EXP card");
{
  const { outcome, names, users } = BATTLE_FIXTURE;
  const before = clone(users);
  const win = expView(outcome, "A", names, users.A);
  assertEqual([win.won, win.opponent, win.pot, win.surge], [true, "Yoinkerrz", 200, true], "winner: victory, opponent, pot, surge");
  assertEqual(win.members.map((m) => m.id), [54, 559, 158, 129, 143, 560], "every Team member, in order");
  assertTrue(win.members[2].shiny && win.members[0].toLevel === 6 && win.members[0].learned.length === 2, "variants, level-ups and moves come from the outcome");
  const lose = expView(outcome, "B", names, users.B);
  assertEqual([lose.won, lose.pot, lose.surge, lose.rating], [false, 0, false, { from: 979, to: 964 }], "loser: no pot or surge, rating drop");
  assertEqual(users, before, "expView never mutates the records");
  assertEqual(dims(await renderExpCard(win)), [1000, expCardSize(6).h], "renders a 6-member card");

  const msg = await expMessage(outcome, "A", names, users.A);
  assertEqual([msg.content, msg.files.length, msg.flags], ["EXP from your battle with Yoinkerrz:", 1, 64], "caption + card, ephemeral");
  const fallback = await expMessage(outcome, "A", names, users.A, { render: async () => { throw new Error("boom"); } });
  assertTrue(!fallback.files && fallback.content.includes("Psyduck Lv 2 → **6**"), "render failure: the full text summary instead");
}

section("Leaderboard");
{
  const td = leaderboardWorld();
  const before = clone(td);
  const v = leaderboardView(rankBattleRatings(td, "p12"), td, "p12");
  assertEqual(v.top.map((p) => p.position), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], "top ten, ranked as before");
  assertEqual([v.top[0].name, v.top[0].lead, v.top[0].trainerFile], ["MistyCascade", { id: 445, variant: "normal" }, "cynthia.png"], "each player's lead Pokémon and trainer");
  assertEqual([v.you.position, v.you.name], [12, "NewChallenger"], "a viewer outside the top ten still sees their row");
  assertTrue(leaderboardView(rankBattleRatings(td, "p6"), td, "p6").top[5].isYou, "a viewer inside the top ten is highlighted");
  assertEqual(td, before, "never mutates trainer data");
  const msg = await leaderboardMessage(td, "p6");
  assertEqual(dims(msg.files[0].attachment), [1000, leaderboardSize(v).h], "renders the board image");
  const fb = await leaderboardMessage(td, "p6", { render: async () => { throw new Error("boom"); } });
  assertTrue(fb.embeds[0].data.description.startsWith("1. MistyCascade — 1212"), "render failure: the text embed instead");
  const empty = await leaderboardMessage({}, "x");
  assertTrue(empty.files.length === 1, "an empty ladder still renders");
}

section("/daily card");
{
  const user = { pokemon: { 399: { normal: 1, shiny: 0 }, 361: { normal: 0, shiny: 1 } } };
  const p1 = catchView(user, { id: 399, variant: "normal", catchResult: { level: 3, isNew: false, expGained: 12 }, trainerName: "Coop" });
  const p2 = catchView(user, { id: 361, variant: "shiny", catchResult: { level: 5, isNew: true, expGained: 0 }, trainerName: "Coop" });
  for (const stone of [true, false]) {
    const png = await renderDailyCard({ pokemon: [p1, p2], cc: 1000, tp: 100, stone, balance: { cc: 5400, tp: 8308 }, rankUp: stone ? "Expert Trainer" : null });
    assertEqual(dims(png), [DAILY_SIZE.w, DAILY_SIZE.h], `renders${stone ? " with a stone and rank-up" : ""}`);
  }
}

section("Trainer card");
{
  const user = { ...clone(FIXTURES.full.user), cc: 5400, tp: 8308, trainers: ["a.png", "b.png"] };
  user.pokemon[999] = { normal: 0, shiny: 0 }; // an emptied entry must not count
  user.pokemon["52:galar"] = { normal: 1, shiny: 0 }; // form keys are not species
  const before = clone(user);
  const v = trainerCardView(user, { displayName: "coop13", trainer: { name: "Acerola", tier: "mythic" } });
  assertEqual([v.owned, v.shinies, v.trainers], [6, 2, 2], "counts species owned now (not empty entries or form keys)");
  assertEqual(v.team.map((s) => s.id), [6, 94, 445, 130, 25, 637], "the Team strip is the battle Team");
  assertEqual([v.rank.current, v.rank.next], ["Expert Trainer", "Veteran Trainer"], "rank and the next rank");
  assertEqual(user, before, "never mutates the record");
  assertEqual(dims(await renderTrainerCard(v)), [TRAINER_CARD_SIZE.w, TRAINER_CARD_SIZE.h], "renders");
  const none = trainerCardView({ tp: 0, pokemon: {} }, { displayName: "New", trainer: null });
  assertEqual(dims(await renderTrainerCard(none)), [TRAINER_CARD_SIZE.w, TRAINER_CARD_SIZE.h], "renders for a brand-new player");
}

section("/pokedex card");
{
  const user = { pokemon: { 133: { normal: 3, shiny: 1 } } };
  const eevee = pokedexView(133, user);
  assertEqual([eevee.normal, eevee.shiny, eevee.to], [3, 1, ["Vaporeon +7 more"]], "owned counts; long evolution lists summarised");
  assertEqual(pokedexView(5, user).from, ["Charmander"], "evolves from");
  assertTrue(pokedexView(700, {}).credit.includes("Smogon"), "#650+ keeps its sprite credit");
  assertEqual(pokedexView(122, {}).name, "Mr. Mime", "display names, not slugs");
  for (const shiny of [false, true]) assertEqual(dims(await renderPokedexCard(eevee, { shiny })), [POKEDEX_SIZE.w, POKEDEX_SIZE.h], `renders (${shiny ? "shiny" : "normal"} sprite)`);
}

section("/inspectpokemon cards");
{
  const user = { pokemon: { 1: { normal: 1, shiny: 1 } }, training: { "1:normal": { exp: 20 ** 3 }, "1:shiny": { exp: 9 ** 3 } } };
  const slots = inspectSlots(user, { id: 1 });
  assertEqual(slots.map((s) => [s.variant, s.level, s.slot]), [["normal", 20], ["shiny", 9]].map(([v, l]) => [v, l, null]), "one card per owned variant, at its Level");
  const text = battleInfo(user, 1);
  assertTrue(text.includes(`HP ${slots[0].stats.hp} · Atk ${slots[0].stats.atk}`), "card stats equal the existing text's stats");
  const base = inspectSlots({}, { id: 1 });
  assertEqual([base.length, base[0].level, base[0].moves, base[0].stats.hp], [1, null, [], 45], "not owned: one base-stats card, no moves");
  for (const s of [...slots, ...base]) assertEqual(dims(await renderInspectCard(s, { eyebrow: "TEST" })), [INSPECT_SIZE.w, INSPECT_SIZE.h], `renders ${s.variant}${s.level == null ? " (base)" : ""}`);
}

finish();
