// ==========================================================
// tests/battleRewards.test.js
// Power rating, Underdog surge odds, Gen V EXP, Elo, Battle caps.
// ==========================================================

import { assertEqual, assertTrue, section, finish } from "./harness.js";
import { teamPower, surgeChance } from "../utils/battle/power.js";
import {
  koExp, teamExp, eloUpdate, utcDay, getBattleRecord, capBlock, recordStart,
} from "../utils/battle/rewards.js";

section("Power rating");
assertTrue(teamPower([{ speciesId: 6, level: 50 }]) > teamPower([{ speciesId: 6, level: 20 }]), "higher Level → higher Power rating");
assertTrue(teamPower([{ speciesId: 6, level: 30 }, { speciesId: 25, level: 30 }]) > teamPower([{ speciesId: 6, level: 30 }]), "more members → higher Power rating");

section("Underdog surge odds");
assertEqual(surgeChance(100, 100), { underdog: null, chance: 0 }, "no surge between even teams");
assertEqual(surgeChance(100, 500), { underdog: 0, chance: 0.2 }, "5× gap → side 0 is the Underdog at the max chance");
assertEqual(surgeChance(300, 200).underdog, 1, "the weaker side is the Underdog");

section("Gen V EXP");
assertEqual(koExp({ foeSpeciesId: 25, foeLevel: 30, recipientLevel: 30 }), 100, "Pikachu Lv 30 KO at equal level (hand-computed)");
const low = koExp({ foeSpeciesId: 25, foeLevel: 10, recipientLevel: 30 });
const high = koExp({ foeSpeciesId: 25, foeLevel: 50, recipientLevel: 30 });
assertTrue(high > 100 && 100 > low && low >= 1 && Number.isInteger(low), "higher-level foes pay more, lower pay less");
const members = [{ speciesId: 4, level: 30 }, { speciesId: 1, level: 10 }];
const knockedOut = [{ speciesId: 25, level: 30 }, { speciesId: 19, level: 20 }];
const lost = teamExp({ members, knockedOut, won: false });
const won = teamExp({ members, knockedOut, won: true });
assertTrue(lost.every((e, i) => Math.abs(won[i] - e * 1.5) <= 1), "a win pays 1.5×");
assertTrue(lost[1] > lost[0], "every member earns, each at its own Level (lower Level earns more)");
assertEqual(teamExp({ members, knockedOut: [], won: false }), [0, 0], "no knockouts, no EXP");

section("Elo");
assertEqual(eloUpdate(1000, 1000, 1), [1016, 984], "even match moves 16");
const [fav] = eloUpdate(1400, 1000, 1);
assertTrue(fav - 1400 < 4, "beating a much weaker player pays almost nothing");

section("Battle record and caps");
const user = {};
const rec = getBattleRecord(user, "2026-11-02");
assertEqual([rec.rating, rec.wins, rec.losses, rec.started], [1000, 0, 0, 0], "new record starts at 1000");
assertTrue(user.battle === rec, "record is stored on the user");
for (let i = 0; i < 3; i++) recordStart(rec, "B");
assertEqual(capBlock(rec, "B"), "opponent", "4th battle vs the same Defender is blocked");
assertEqual(capBlock(rec, "C"), null, "a different Defender is fine");
for (let i = 0; i < 7; i++) recordStart(rec, `X${i}`);
assertEqual(capBlock(rec, "C"), "daily", "11th battle of the day is blocked");
rec.rating = 1100; rec.wins = 5; rec.losses = 2;
const next = getBattleRecord(user, "2026-11-03");
assertEqual([next.started, next.vs, next.rating, next.wins, next.losses], [0, {}, 1100, 5, 2], "a new UTC day resets caps, keeps rating and W/L");
assertEqual(utcDay(new Date("2026-11-02T23:59:59Z")), "2026-11-02", "utcDay uses UTC");

finish();
