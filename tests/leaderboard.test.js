// ==========================================================
// tests/leaderboard.test.js
// Battle rating leaderboard ordering and "your position".
// ==========================================================

import { assertEqual, section, finish } from "./harness.js";
import { rankBattleRatings } from "../commands/leaderboard.js";

const player = (id, rating, wins, losses) => ({ id, name: `P${id}`, battle: { rating, wins, losses } });
const td = {};
for (let i = 1; i <= 12; i++) td[i] = player(String(i), 1000 + i * 10, i, 1);
td.tieA = player("tieA", 1200, 3, 0);
td.tieB = player("tieB", 1200, 7, 9);
td.idle = { id: "idle", name: "Idle" };
td.zero = player("zero", 1000, 0, 0);

section("Leaderboard");
const board = rankBattleRatings(td, "1");
assertEqual(board.top.length, 10, "top 10 only");
assertEqual(board.top.slice(0, 2).map((p) => p.userId), ["tieB", "tieA"], "rating ties ordered by wins");
assertEqual(board.top[2], { userId: "12", name: "P12", rating: 1120, wins: 12, losses: 1 }, "entries carry name, rating, W/L");
assertEqual(board.you, { position: 14, rating: 1010, wins: 1, losses: 1 }, "your 1-based position, even outside the top 10");
assertEqual(rankBattleRatings(td, "idle").you, null, "no battles → no position");
assertEqual(board.top.some((p) => ["idle", "zero"].includes(p.userId)), false, "players with no battles are excluded");

finish();
