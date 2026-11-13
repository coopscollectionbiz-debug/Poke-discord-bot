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
import { renderDailyCard, DAILY_SIZE, dailySize } from "../utils/render/dailyCard.js";
import { dexProgress, nationalCompletion } from "../utils/render/dexProgress.js";
import { trainerCardView, renderTrainerCard, TRAINER_CARD_SIZE, badgeSlot } from "../utils/render/trainerCard.js";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { pokedexView, renderPokedexCard, POKEDEX_SIZE } from "../utils/render/pokedexCard.js";
import { inspectSlots, battleInfo } from "../commands/inspectpokemon.js";
import { renderInspectCard, INSPECT_SIZE } from "../utils/render/inspectCard.js";
import { BATTLE_FIXTURE, FIXTURES, leaderboardWorld } from "./fixtures/showteamFixtures.js";
import { normalizeBox } from "../services/box.js";
import { normalizeShowcase } from "../services/showcaseTeam.js";
// Live records get their Showcase at load (filled once from the Casual team).
const launched = (u) => { normalizeBox(u); normalizeShowcase(u); return u; };

// Width × height of a PNG or GIF (cards animate when their sprites do).
const dims = (b) => (b.subarray(0, 3).toString() === "GIF" ? [b.readUInt16LE(6), b.readUInt16LE(8)] : [b.readUInt32BE(16), b.readUInt32BE(20)]);
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
  launched(user);
  const before = clone(user);
  const v = trainerCardView(user, { displayName: "coop13", trainer: { name: "Acerola", tier: "mythic" } });
  assertEqual([v.owned, v.shinies, v.trainers], [6, 2, 2], "counts species owned now (not empty entries or form keys)");
  assertEqual(v.team.map((s) => s.id), [6, 94, 445, 130, 25, 637], "the strip is the Showcase (filled from the Casual team at launch)");
  assertEqual([v.rank.current, v.rank.next], ["Expert Trainer", "Veteran Trainer"], "rank and the next rank");
  assertEqual(user, before, "never mutates the record");
  assertEqual(dims(await renderTrainerCard(v)), [TRAINER_CARD_SIZE.w, TRAINER_CARD_SIZE.h], "renders");
  const none = trainerCardView({ tp: 0, pokemon: {} }, { displayName: "New", trainer: null });
  assertEqual(dims(await renderTrainerCard(none)), [TRAINER_CARD_SIZE.w, TRAINER_CARD_SIZE.h], "renders for a brand-new player");

  // Badges from /challenge: a Gym key in challenge.won. Elite Four, Blue and Red wins aren't Badges.
  const badged = { ...clone(user), challenge: { won: { brock: "2026-11-01", misty: "2026-11-02", elite4: "2026-11-03" } } };
  const bv = trainerCardView(badged, { displayName: "coop13", trainer: null });
  assertEqual((bv.badges ?? []).map((b) => (b.earned ? b.key : "-")), ["brock", "misty", "-", "-", "-", "-", "-", "-"],
    "the 8 Badges in Gym order, earned ones marked");
  const at = async (png, x, y) => {
    const img = await loadImage(png);
    const ctx = createCanvas(img.width, img.height).getContext("2d");
    ctx.drawImage(img, 0, 0);
    return [...ctx.getImageData(x, y, 1, 1).data].slice(0, 3).reduce((a, b) => a + b, 0);
  };
  const slot = badgeSlot(0); // Boulder: its center pixel is white
  const [cx, cy] = [slot.x + slot.size / 2, slot.y + slot.size / 2];
  const earned = await at(await renderTrainerCard(bv), cx, cy);
  const unearned = await at(await renderTrainerCard(v), cx, cy);
  const background = await at(await renderTrainerCard(v), slot.x - 4, cy); // the gap before the first slot
  assertTrue(earned > 600, "an earned Badge is drawn in full color");
  assertTrue(unearned < earned - 300 && unearned > background + 30, "an unearned Badge is drawn dimmed");
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

section("Every card animates when asked");
{
  const { outcome, names, users } = BATTLE_FIXTURE;
  const td = leaderboardWorld();
  const user = { pokemon: { 399: { normal: 1, shiny: 0 }, 361: { normal: 0, shiny: 1 } } };
  const p = (id, variant) => catchView(user, { id, variant, catchResult: { level: 5, isNew: true, expGained: 0 }, trainerName: "Coop" });
  const cards = {
    exp: () => renderExpCard(expView(outcome, "A", names, users.A), { animate: true }),
    leaderboard: () => import("../utils/render/leaderboardCard.js").then((m) => m.renderLeaderboard(leaderboardView(rankBattleRatings(td, "p6"), td, "p6"), { animate: true })),
    daily: () => renderDailyCard({ pokemon: [p(399, "normal"), p(361, "shiny")], cc: 1000, tp: 100, stone: false, balance: { cc: 1, tp: 1 }, rankUp: null }, { animate: true }),
    trainer: () => renderTrainerCard(trainerCardView({ ...clone(FIXTURES.full.user), tp: 500 }, { displayName: "x", trainer: null }), { animate: true }),
    pokedex: () => renderPokedexCard(pokedexView(133, {}), { animate: true }),
    inspect: () => renderInspectCard(inspectSlots({ pokemon: { 1: { normal: 1 } } }, { id: 1 })[0], { animate: true }),
  };
  for (const [name, render] of Object.entries(cards)) {
    const buf = await render();
    assertEqual(buf.subarray(0, 3).toString(), "GIF", `${name}: animated GIF`);
  }
  // A species with only static art (#1025) breathes (tools/generate-pokemon-idles.mjs), so it animates too.
  const breathing = await renderPokedexCard(pokedexView(1025, {}), { animate: true });
  assertEqual(breathing.subarray(0, 3).toString(), "GIF", "static-art sprite with the breathing idle: animated GIF");
}

section("Pokédex progress (private cards only)");
{
  const user = { pokemon: { 1: { normal: 1, shiny: 0 }, 4: { normal: 0, shiny: 1 }, 7: { normal: 0, shiny: 0 }, 399: { normal: 2, shiny: 0 }, 700: { normal: 1, shiny: 0 }, "52:galar": { normal: 1, shiny: 0 } } };
  const before = clone(user);
  assertEqual(nationalCompletion(user), { owned: 3, total: 649 }, "national: species owned now out of released generations (Gen 6 Sylveon, emptied entries and forms don't count)");
  assertEqual(dexProgress(user, [399, 1, 4]).map((r) => [r.label, r.owned, r.total]), [["Sinnoh", 1, 107], ["Kanto", 2, 151], ["National", 3, 649]], "regions in order, deduplicated, then national");
  assertEqual(user, before, "never mutates the record");
  const p = catchView(user, { id: 399, variant: "normal", catchResult: { level: 3, isNew: false, expGained: 1 }, trainerName: "x" });
  const v = { pokemon: [p, p], cc: 1, tp: 1, stone: false, balance: { cc: 1, tp: 1 }, rankUp: null, dex: dexProgress(user, [399]) };
  assertEqual(dims(await renderDailyCard(v)), [dailySize(v).w, dailySize(v).h], "/daily grows a Pokédex row");
  assertEqual(dailySize(v).h - DAILY_SIZE.h, 80, "by 80 px");
  assertEqual(pokedexView(133, user).dex.map((r) => r.label), ["Kanto", "National"], "/pokedex: the species' region + national");
}

finish();
