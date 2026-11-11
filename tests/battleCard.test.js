// ==========================================================
// tests/battleCard.test.js — /showbattlecard (utils/render/battleCard.js,
// commands/showbattlecard.js): the Battle team at Lv 50 with real Levels,
// this season's ranked record and leaderboard position. Synthetic players.
// ==========================================================

import { assertEqual, assertTrue, section, finish } from "./harness.js";
import { createNewUser } from "../utils/userSchema.js";
import { grantCatch } from "../utils/training.js";
import { RANKED } from "../utils/battle/tuning.js";
import { battleCardView, renderBattleCard, BATTLE_CARD_SIZE } from "../utils/render/battleCard.js";
import { battleCardMessage, equippedTrainer, data } from "../commands/showbattlecard.js";
import { rankBattleRatings } from "../commands/leaderboard.js";

const fixed = () => 0.5;
function trainer(id, display, battle, record = null) {
  const u = createNewUser(id, `Trainer ${id}`);
  for (const sid of new Set([...display, ...battle])) grantCatch(u, sid, "normal", fixed);
  u.displayedPokemon = display.map((sid) => ({ id: sid, variant: "normal" }));
  if (battle.length) u.battleTeam = battle.map((sid) => ({ id: sid, variant: "normal" }));
  if (record) u.battle = { ...record, day: "2026-11-10", started: 0, vs: {}, season: RANKED.season };
  return u;
}
const world = () => ({
  A: trainer("A", [25, 1], [6, 150, 25], { rating: 1184, wins: 23, losses: 9 }),
  B: trainer("B", [19], [9], { rating: 1250, wins: 5, losses: 1 }),
  C: trainer("C", [16], []),
});

section("view");
{
  const td = world();
  td.A.stats = { winStreak: 3 };
  const v = battleCardView(td.A, { displayName: "Ash", board: rankBattleRatings(td, "A") });
  assertEqual(v.team.map((s) => s.id), [6, 150, 25], "the Battle team, not the Display team");
  assertTrue(v.team.every((s) => s.level === RANKED.level && Number.isInteger(s.realLevel)), "everyone at Lv 50, real Level kept");
  assertEqual([v.rating, v.wins, v.losses, v.played], [1184, 23, 9, true], "this season's ranked record");
  assertEqual([v.position, v.players], [2, 2], "leaderboard position and how many are ranked");
  assertEqual(v.streak, 3, "win streak shown");
  assertTrue(v.power > 0, "Power at Lv 50");
  const c = battleCardView(td.C, { displayName: "New", board: rankBattleRatings(td, "C") });
  assertEqual([c.team.length, c.played, c.position, c.streak, c.rating], [0, false, null, 0, 1000], "no Battle team, no ranked battles: empty card, base rating");
  const old = world().A;
  old.battle.season = 0;
  assertEqual(battleCardView(old, {}).rating, 1000, "a previous season's record isn't shown");
}

section("render");
{
  const td = world();
  const png = await renderBattleCard(battleCardView(td.A, { displayName: "Ash", board: rankBattleRatings(td, "A") }), { animate: false });
  assertEqual(png.subarray(1, 4).toString(), "PNG", "still card is a PNG");
  assertEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [BATTLE_CARD_SIZE.w, BATTLE_CARD_SIZE.h], "1200 × 560");
  const empty = await renderBattleCard(battleCardView(td.C, { displayName: "New" }), { animate: false });
  assertEqual(empty.subarray(1, 4).toString(), "PNG", "an empty Battle team still renders");
}

section("command");
{
  assertEqual(data.name, "showbattlecard", "command name");
  const td = world();
  const msg = await battleCardMessage(td, "A", "Ash");
  assertTrue(msg.files?.length === 1 && /^battlecard\.(png|gif)$/.test(msg.files[0].name), "sends the card as an image");
  const fallback = await battleCardMessage(td, "A", "Ash", { render: async () => { throw new Error("boom"); } });
  assertTrue(/1184 rating · 23W–9L · #2 of 2/.test(fallback.content) && /Lv 50/.test(fallback.content), "text fallback if rendering fails");
  assertEqual(equippedTrainer("does-not-exist.png"), null, "unknown trainer file → none");
}

finish();
