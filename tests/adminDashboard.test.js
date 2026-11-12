// ==========================================================
// tests/adminDashboard.test.js — Admin changes, bulk grants, audit,
// sliding admin sessions and the write guards on the admin API.
// Design: docs/design/admin-dashboard-overhaul.md.
// Synthetic players, temp storage, real catalog data.
// ==========================================================

import fs from "fs/promises";
import os from "os";
import path from "path";
import http from "http";
import { assertTrue, assertEqual, section, finish } from "./harness.js";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "admin-"));
process.env.TRAINERDATA_DIR = dir;

const C = await import("../services/adminChanges.js");
const { createAdminHandlers } = await import("../services/adminApi.js");
const { appendAudit, readAudit } = await import("../utils/adminAudit.js");
const { lockUser } = await import("../utils/userLocks.js");
const { getTraining, trainingKey, expForLevel } = await import("../utils/training.js");
const auth = await import("../utils/dashboardAuth.js");
const express = (await import("express")).default;
const { mountAdminDashboard } = await import("../routes/admindashboard.js");

const clone = (o) => JSON.parse(JSON.stringify(o));
const player = (o = {}) => ({
  id: "1", name: "Ash", cc: 1000, tp: 50, rank: "Novice Trainer", onboardingComplete: true,
  pokemon: {}, training: {}, items: {}, trainers: [], displayedPokemon: [], displayedTrainer: null, ...o,
});
const change = (raw, ctx) => {
  const p = C.parseChange(raw, ctx);
  if (!p.ok) throw new Error(`parse failed: ${p.error}`);
  return p.change;
};
const UNRELEASED = 906; // Gen 9; POKEMON_GENERATIONS is unset in tests

// ======================= CC / TP =======================
section("CC and TP");
{
  const u = player();
  const r = C.applyChange(u, change({ kind: "cc", op: "add", amount: 500 }));
  assertTrue(r.ok && u.cc === 1500 && r.before === 1000 && r.after === 1500, "+500 CC adds to the live balance");
  const before = clone(u);
  const over = C.applyChange(u, change({ kind: "cc", op: "remove", amount: 2000 }));
  assertTrue(!over.ok && over.error === "They have 1,500 CC." && over.current === 1500, "removing more than they have is rejected with the current amount");
  assertEqual(u, before, "a rejected removal changes nothing");
  assertTrue(C.applyChange(u, change({ kind: "cc", op: "remove", amount: 1500 })).ok && u.cc === 0, "removing exactly all of it works");
  assertTrue(!C.parseChange({ kind: "cc", op: "add", amount: 0 }).ok && !C.parseChange({ kind: "cc", op: "add", amount: 1.5 }).ok && !C.parseChange({ kind: "cc", op: "add", amount: 1_000_001 }).ok, "amounts must be whole, 1 to 1,000,000");
  assertTrue(!C.parseChange({ kind: "cc", amount: 5 }).ok, "add or remove must be chosen");

  const t = player({ tp: 450, rank: "Novice Trainer" });
  const up = C.applyChange(t, change({ kind: "tp", op: "add", amount: 100 }));
  assertTrue(up.ok && t.rank === "Junior Trainer" && up.rankChanged?.to === "Junior Trainer", "TP over a tier boundary updates Rank and reports it");
  assertTrue(up.warnings.some((w) => w.includes("Junior Trainer")), "the review warns about the Rank change");
  const down = C.applyChange(t, change({ kind: "tp", op: "remove", amount: 500 }));
  assertTrue(down.ok && t.tp === 50 && t.rank === "Novice Trainer", "TP below the first tier falls back to Novice Trainer");
  const same = C.applyChange(player({ tp: 600, rank: "Junior Trainer" }), change({ kind: "tp", op: "add", amount: 10 }));
  assertTrue(same.ok && !same.rankChanged && same.warnings.length === 0, "no Rank change, no warning");
}

// ======================= Items =======================
section("Items");
{
  const u = player();
  const r = C.applyChange(u, change({ kind: "item", op: "add", itemId: "evolution_stone", amount: 3 }));
  assertTrue(r.ok && u.items.evolution_stone === 3 && r.before === 0 && r.after === 3, "add 3 Evolution Stones");
  const over = C.applyChange(u, change({ kind: "item", op: "remove", itemId: "evolution_stone", amount: 5 }));
  assertTrue(!over.ok && over.error === "They have 3 × Evolution Stone.", "over-remove names the current count");
  assertTrue(C.applyChange(u, change({ kind: "item", op: "remove", itemId: "evolution_stone", amount: 2 })).ok && u.items.evolution_stone === 1, "remove 2");
  assertTrue(!C.applyChange(u, change({ kind: "item", op: "add", itemId: "pokeball", amount: 1 })).ok, "items that are never kept in the bag can't be granted");
  assertTrue(!C.parseChange({ kind: "item", op: "add", itemId: "nope", amount: 1 }).ok, "unknown items are rejected");
  const full = player({ items: { shiny_dust: 999_999_999 } });
  const cap = C.applyChange(full, change({ kind: "item", op: "add", itemId: "shiny_dust", amount: 5 }));
  assertTrue(!cap.ok && cap.error.startsWith("They can't hold") && full.items.shiny_dust === 999_999_999, "the stack limit is enforced and reads as the player's limit");
}

// ======================= Pokémon =======================
section("Pokémon");
{
  const u = player();
  const r = C.applyChange(u, change({ kind: "pokemon", op: "add", speciesId: 25, variant: "shiny", amount: 1, level: 40 }), { rand: () => 0 });
  assertTrue(r.ok && u.pokemon[25].shiny === 1 && getTraining(u, 25, "shiny").level === 40 && r.level === 40 && r.levelRolled === false, "first grant uses the admin's Level");
  const r2 = C.applyChange(u, change({ kind: "pokemon", op: "add", speciesId: 25, variant: "shiny", amount: 2, level: 5 }));
  assertTrue(r2.ok && u.pokemon[25].shiny === 3 && getTraining(u, 25, "shiny").level === 40, "extra copies add count only; the Level stays");

  const rolled = C.applyChange(u, change({ kind: "pokemon", op: "add", speciesId: 16, variant: "normal", amount: 1 }), { rand: () => 0 });
  assertTrue(rolled.ok && rolled.levelRolled === true && rolled.level >= 1 && getTraining(u, 16, "normal").level === rolled.level, "no Level given: a Catch level is rolled and stored");

  const pv = player({ pokemon: { 10: { normal: 2, shiny: 0 } } });
  const snapshot = clone(pv);
  const prev = C.previewChange(pv, change({ kind: "pokemon", op: "add", speciesId: 1, variant: "normal", amount: 1 }), { rand: () => 0.5 });
  assertTrue(prev.ok && typeof prev.level === "number", "preview shows the rolled Level");
  assertEqual(pv, snapshot, "preview never changes the record");

  assertTrue(!C.applyChange(player(), change({ kind: "pokemon", op: "add", speciesId: UNRELEASED, variant: "normal", amount: 1 })).ok, "unreleased Pokémon need the testing switch");
  const test = C.applyChange(player(), change({ kind: "pokemon", op: "add", speciesId: UNRELEASED, variant: "normal", amount: 1 }), { allowUnreleased: true });
  assertTrue(test.ok && test.warnings.some((w) => w.includes("isn't released")), "with the switch it's granted and the review warns");

  // Last copy on both teams (one legacy numeric slot).
  const t = player({
    pokemon: { 16: { normal: 1, shiny: 2 }, 25: { normal: 1, shiny: 0 } },
    training: { [trainingKey(16, "normal")]: { exp: expForLevel(34) }, [trainingKey(16, "shiny")]: { exp: expForLevel(20) } },
    displayedPokemon: [25, 16, { id: 16, variant: "shiny" }],
    battleTeam: [{ id: 16, variant: "normal" }, { id: 25, variant: "normal" }],
  });
  const partial = C.applyChange(t, change({ kind: "pokemon", op: "remove", speciesId: 16, variant: "shiny", amount: 1 }));
  assertTrue(partial.ok && t.pokemon[16].shiny === 1 && getTraining(t, 16, "shiny").level === 20 && t.displayedPokemon.length === 3, "removing a non-last copy keeps Level and team slots");
  const last = C.applyChange(t, change({ kind: "pokemon", op: "remove", speciesId: 16, variant: "normal", amount: 1 }));
  assertTrue(last.ok && t.pokemon[16].normal === 0 && !t.training[trainingKey(16, "normal")], "removing the last copy resets its Level");
  // Slots now also name their copy (uid, docs/adr/0001); compare the Pokémon only.
  const noUid = (team) => team.map((s) => (s && typeof s === "object" ? { id: s.id, variant: s.variant } : s));
  assertEqual(noUid(t.displayedPokemon), [25, { id: 16, variant: "shiny" }], "the Team slot is cleared; the shiny and the legacy slot stay");
  assertEqual(noUid(t.battleTeam), [{ id: 25, variant: "normal" }], "the Battle team slot is cleared");
  assertTrue(last.warnings.some((w) => w === "Clears Team slot 2.") && last.warnings.some((w) => w === "Clears Battle team slot 1.") && last.warnings.some((w) => w.includes("Resets Lv 34")), "the review warns about both slots and the Level");
  const over = C.applyChange(t, change({ kind: "pokemon", op: "remove", speciesId: 25, variant: "normal", amount: 2 }));
  assertTrue(!over.ok && over.error === "They have 1 × Pikachu.", "over-removing Pokémon is rejected with the count");
}

// ======================= Trainers =======================
section("Trainers");
{
  const keys = new Map([["aaron.png", "aaron.png"], ["acerola.png", "acerola.png"]]);
  assertTrue(!C.parseChange({ kind: "trainer", op: "add", key: "made-up.png" }, { trainerKeys: keys }).ok, "unknown trainers can't be granted");
  assertTrue(!C.parseChange({ kind: "trainer", op: "add", key: "../x.png" }, { trainerKeys: keys }).ok, "paths are rejected");
  const u = player({ trainers: ["aaron.png"], displayedTrainer: "aaron.png" });
  assertTrue(!C.applyChange(u, change({ kind: "trainer", op: "add", key: "AARON.png" }, { trainerKeys: keys })).ok, "already owned (any case) is rejected");
  assertTrue(C.applyChange(u, change({ kind: "trainer", op: "add", key: "acerola.png" }, { trainerKeys: keys })).ok && u.trainers.includes("acerola.png"), "grant a trainer");
  const rm = C.applyChange(u, change({ kind: "trainer", op: "remove", key: "aaron.png" }));
  assertTrue(rm.ok && !u.trainers.includes("aaron.png") && u.displayedTrainer === null && rm.warnings.length === 1, "removing the displayed trainer clears it and warns");
  assertTrue(!C.applyChange(u, change({ kind: "trainer", op: "remove", key: "aaron.png" })).ok, "removing one they don't own is rejected");
}

// ======================= Level =======================
section("Level");
{
  const u = player({ pokemon: { 25: { normal: 1, shiny: 0 } } });
  const r = C.applyChange(u, change({ kind: "level", speciesId: 25, variant: "normal", level: 75 }));
  assertTrue(r.ok && getTraining(u, 25, "normal").level === 75 && r.after === "Lv 75", "set Lv 75");
  assertTrue(!C.applyChange(u, change({ kind: "level", speciesId: 25, variant: "shiny", level: 10 })).ok, "can't set a Level on a Variant they don't own");
  assertTrue(!C.parseChange({ kind: "level", speciesId: 25, level: 101 }).ok && !C.parseChange({ kind: "level", speciesId: 25, level: 0 }).ok, "Level must be 1 to 100");
}

// ======================= Cooldowns =======================
section("Cooldowns");
{
  const now = Date.parse("2026-11-11T12:00:00Z");
  const u = player({ lastDaily: now - 1000, daily: { streak: 7 }, weeklyPackClaimed: true, lastQuest: now - 5, lastRecruit: now - 5, battle: { day: "2026-11-11", started: 10, vs: { 2: 3 }, rating: 1100 } });
  const r = C.applyChange(u, change({ kind: "cooldown", cooldowns: ["daily", "weekly", "quest", "recruit", "battle"] }), { now });
  assertTrue(r.ok && u.lastDaily === 0 && u.daily.streak === 7 && u.weeklyPackClaimed === false && u.lastQuest === 0 && u.lastRecruit === 0, "daily/weekly/quest/recruit reset; the daily streak is kept");
  assertTrue(u.battle.started === 0 && Object.keys(u.battle.vs).length === 0 && u.battle.rating === 1100, "Battle cap reset; Battle rating untouched");
  assertEqual([r.before.daily, r.after.daily, r.before.battle, r.after.battle], ["claimed today", "ready", "10 started today", "0 started today"], "before/after states are readable");
  assertTrue(!C.parseChange({ kind: "cooldown", cooldowns: [] }).ok && !C.parseChange({ kind: "cooldown", cooldowns: ["nap"] }).ok, "empty or unknown cooldowns are rejected");
}

// ======================= Reset =======================
section("Reset player");
{
  const u = player({ id: "42", name: "Misty", cc: 9000, tp: 8000, pokemon: { 1: { normal: 3, shiny: 1 } }, items: { shiny_dust: 5 }, battle: { rating: 1300 }, achievements: { x: 1 } });
  assertTrue(C.applyChange(u, change({ kind: "reset", confirmName: "misty " }), { playerName: "Misty" }).ok, "name check ignores case and surrounding spaces");
  const w = player({ name: "Brock", pendingWager: { stake: 500, expiresAt: Date.parse("2026-11-11T13:05:00Z") } });
  const blocked = C.applyChange(w, change({ kind: "reset", confirmName: "Brock" }), { playerName: "Brock" });
  assertTrue(!blocked.ok && blocked.error.includes("13:05 UTC") && w.pendingWager, "reset is refused while a wager offer is open");
  const wrong = C.applyChange(player({ name: "Gary" }), change({ kind: "reset", confirmName: "Ash" }), { playerName: "Gary" });
  assertTrue(!wrong.ok && wrong.error.includes("Gary"), "the wrong name is refused");
  const v = player({ id: "42", name: "Misty", cc: 9000, tp: 8000, pokemon: { 1: { normal: 3, shiny: 1 } }, items: { shiny_dust: 5 }, battle: { rating: 1300 }, achievements: { x: 1 } });
  const r = C.applyChange(v, change({ kind: "reset", confirmName: "Misty" }), { playerName: "Misty" });
  assertTrue(r.ok && v.cc === 0 && v.tp === 0 && Object.keys(v.pokemon).length === 0 && !v.battle && !v.achievements && v.onboardingComplete === false, "full wipe back to a new player");
  assertTrue(v.id === "42" && v.name === "Misty", "id and name are kept");
  assertTrue(r.before.cc === 9000 && r.before.pokemon[1].normal === 3, "the result holds the old record for the audit");
}

// ======================= Reasons, bulk kinds =======================
section("Reasons and bulk rules");
{
  assertTrue(!C.needsReason(change({ kind: "cc", op: "add", amount: 1 })) && C.needsReason(change({ kind: "cc", op: "remove", amount: 1 })), "removals need a reason, single grants don't");
  assertTrue(C.needsReason(change({ kind: "level", speciesId: 1, level: 5 })) && C.needsReason(change({ kind: "reset" })), "Level changes and resets need a reason");
  assertTrue(C.needsReason(change({ kind: "cc", op: "add", amount: 1 }), { bulk: true }), "bulk grants need a reason");
  assertTrue(C.isBulkable(change({ kind: "pokemon", op: "add", speciesId: 1, amount: 1 })) && C.isBulkable(change({ kind: "cooldown", cooldowns: ["daily"] })), "grants and cooldown resets can be bulk");
  assertTrue(!C.isBulkable(change({ kind: "cc", op: "remove", amount: 1 })) && !C.isBulkable(change({ kind: "level", speciesId: 1, level: 5 })) && !C.isBulkable(change({ kind: "reset" })), "removals, Levels and resets can't");
}

// ======================= Filters =======================
section("Bulk filters");
{
  const now = Date.parse("2026-11-11T12:00:00Z");
  const day = 86_400_000;
  const f = (raw) => C.parseFilters(raw).filters;
  const rich = player({ cc: 50_000, tp: 900, lastActiveAt: now - day });
  const poor = player({ cc: 200, tp: 9000, lastDaily: now - 10 * day });
  const fresh = player({ cc: 0, tp: 0, onboardingComplete: false, lastActiveAt: now });
  const shiny = player({ pokemon: { 16: { normal: 0, shiny: 1 } }, items: { shiny_dust: 1 } });
  assertTrue(!C.matchesFilters(fresh, f({}), now) && C.matchesFilters(fresh, f({ onboardedOnly: false }), now), "onboarded only is on by default");
  assertTrue(C.matchesFilters(poor, f({ ccMax: 1000 }), now) && !C.matchesFilters(rich, f({ ccMax: 1000 }), now), "max CC");
  assertTrue(C.matchesFilters(poor, f({ tpMin: 5000 }), now) && !C.matchesFilters(rich, f({ tpMin: 5000 }), now), "min TP");
  assertTrue(C.matchesFilters(rich, f({ activeDays: 7 }), now) && !C.matchesFilters(poor, f({ activeDays: 7 }), now), "active within N days uses lastActiveAt, else claims");
  assertTrue(C.lastActiveOf(poor) === now - 10 * day && C.lastActiveOf(rich) === now - day, "Last active falls back to the latest claim");
  assertTrue(C.matchesFilters(shiny, f({ owns: { kind: "pokemon", id: 16, variant: "shiny", has: true } }), now) && !C.matchesFilters(shiny, f({ owns: { kind: "pokemon", id: 16, variant: "normal", has: true } }), now), "owns a Pokémon by Variant");
  assertTrue(C.matchesFilters(rich, f({ owns: { kind: "item", id: "shiny_dust", has: false } }), now) && !C.matchesFilters(shiny, f({ owns: { kind: "item", id: "shiny_dust", has: false } }), now), "lacks an item");
  assertTrue(!C.parseFilters({ ccMin: -1 }).ok && !C.parseFilters({ tpMax: "lots" }).ok, "bad filter values are rejected");
}

// ======================= API: single changes =======================
section("API: single changes, audit, replay");
const admin = { id: "900", name: "Coop" };
function setup(players, { saveOk = true } = {}) {
  const state = { td: players, saves: 0, audit: [], roles: [] };
  const h = createAdminHandlers({
    getTrainerData: () => state.td,
    lockUser,
    save: async () => {
      state.saves++;
      return saveOk ? { saved: true, note: "" } : { saved: false, note: "Saved locally; backup pending." };
    },
    appendAudit: async (entries) => {
      state.audit.push(...entries);
      return { ok: true };
    },
    syncRole: async (id, tp) => {
      state.roles.push({ id, tp });
      return id === "3" ? { ok: false, reason: "They aren't in the server." } : { ok: true };
    },
    getTrainerKeys: async () => new Map([["aaron.png", "aaron.png"]]),
    rand: () => 0,
  });
  return { state, h };
}
{
  const { state, h } = setup({ 1: player(), 2: player({ id: "2", name: "Misty" }) });
  const pv = await h.preview({ userId: "1", change: { kind: "cc", op: "remove", amount: 400 } });
  assertTrue(pv.status === 200 && pv.body.before === 1000 && pv.body.after === 600 && pv.body.needsReason === true && state.td[1].cc === 1000, "preview reports before/after and needs a reason; nothing changes");
  const noReason = await h.apply({ admin, userId: "1", change: { kind: "cc", op: "remove", amount: 400 }, reason: "  ", requestId: "req-00001" });
  assertTrue(noReason.status === 400 && state.td[1].cc === 1000 && state.saves === 0, "a removal without a reason is refused");
  const r = await h.apply({ admin, userId: "1", change: { kind: "cc", op: "remove", amount: 400 }, reason: "duplicated by bug", requestId: "req-00002" });
  assertTrue(r.status === 200 && r.body.saved && state.td[1].cc === 600 && state.saves === 1, "applied and saved");
  const a = state.audit[0];
  assertTrue(a.adminId === "900" && a.adminName === "Coop" && a.userId === "1" && a.userName === "Ash" && a.before === 1000 && a.after === 600 && a.reason === "duplicated by bug", "audit has who, whom, before/after and why");

  // Double-click: same requestId, concurrent.
  const [x, y] = await Promise.all([
    h.apply({ admin, userId: "2", change: { kind: "cc", op: "add", amount: 100 }, requestId: "req-00003" }),
    h.apply({ admin, userId: "2", change: { kind: "cc", op: "add", amount: 100 }, requestId: "req-00003" }),
  ]);
  assertTrue(x.status === 200 && y.status === 200 && state.td[2].cc === 1100 && (x.body.replayed || y.body.replayed), "a repeated request id applies once");
  assertTrue((await h.apply({ admin, userId: "2", change: { kind: "cc", op: "add", amount: 100 } })).status === 400, "a request id is required");

  const over = await h.apply({ admin, userId: "1", change: { kind: "tp", op: "remove", amount: 9999 }, reason: "x", requestId: "req-00004" });
  assertTrue(over.status === 409 && over.body.current === 50, "over-remove comes back as 409 with the current amount");
  assertTrue((await h.preview({ userId: "nobody", change: { kind: "cc", op: "add", amount: 1 } })).status === 404, "unknown player is 404");

  const tp = await h.apply({ admin, userId: "1", change: { kind: "tp", op: "add", amount: 500 }, requestId: "req-00005" });
  assertTrue(tp.status === 200 && tp.body.role?.ok === true && state.roles.length === 1 && state.roles[0].tp === 550, "a Rank change syncs the Discord role after the save");
  await h.apply({ admin, userId: "1", change: { kind: "tp", op: "add", amount: 1 }, requestId: "req-00006" });
  assertTrue(state.roles.length === 1, "no Rank change, no role sync");

  const rs = await h.apply({ admin, userId: "2", change: { kind: "reset", confirmName: "Misty" }, reason: "requested by player", requestId: "req-00007" });
  assertTrue(rs.status === 200 && rs.body.before === null && state.td[2].cc === 0 && state.audit.at(-1).before.cc === 1100, "reset: the response omits the old record, the audit keeps it");

  const { h: h2, state: s2 } = setup({ 1: player() }, { saveOk: false });
  const pend = await h2.apply({ admin, userId: "1", change: { kind: "cc", op: "add", amount: 1 }, requestId: "req-00008" });
  assertTrue(pend.status === 200 && pend.body.saved === false && pend.body.note && s2.audit.length === 1, "a delayed save is reported, not hidden");
}

// ======================= API: bulk =======================
section("API: bulk grants");
{
  const now = Date.now();
  const players = {
    1: player({ id: "1", name: "Ash", cc: 100, lastActiveAt: now }),
    2: player({ id: "2", name: "Misty", cc: 5000, lastActiveAt: now }),
    3: player({ id: "3", name: "Brock", cc: 10, tp: 400, trainers: ["aaron.png"], lastActiveAt: now }),
    4: player({ id: "4", name: "Gary", cc: 10, onboardingComplete: false }),
  };
  const { state, h } = setup(players);
  const pv = await h.bulkPreview({ change: { kind: "cc", op: "add", amount: 500 }, target: { filters: { ccMax: 1000 } } });
  assertTrue(pv.status === 200 && pv.body.count === 2 && pv.body.players.map((p) => p.name).join() === "Ash,Brock" && pv.body.summary === "Add 500 CC", "filter preview lists exactly the matches");
  assertTrue((await h.bulkPreview({ change: { kind: "cc", op: "remove", amount: 5 }, target: { userIds: ["1"] } })).status === 400, "bulk removals are refused");

  const noReason = await h.bulkApply({ admin, change: { kind: "cc", op: "add", amount: 500 }, userIds: ["1", "3"], reason: "", requestId: "bulk-0001" });
  assertTrue(noReason.status === 400 && state.td[1].cc === 100, "a bulk grant needs a reason");

  const r = await h.bulkApply({ admin, change: { kind: "cc", op: "add", amount: 500 }, userIds: ["1", "3"], reason: "Outage 11 Nov", requestId: "bulk-0002" });
  assertTrue(r.status === 200 && r.body.granted === 2 && state.td[1].cc === 600 && state.td[3].cc === 510 && state.saves === 1, "both granted, one save");
  assertTrue(state.audit.length === 2 && state.audit.every((a) => a.batchId === r.body.batchId && a.reason === "Outage 11 Nov" && a.batchSize === 2), "one audit entry per player, sharing the batch id");
  const again = await h.bulkApply({ admin, change: { kind: "cc", op: "add", amount: 500 }, userIds: ["1", "3"], reason: "Outage 11 Nov", requestId: "bulk-0002" });
  assertTrue(again.body.replayed && state.td[1].cc === 600 && state.saves === 1, "retrying the batch grants nothing twice");

  const tr = await h.bulkApply({ admin, change: { kind: "trainer", op: "add", key: "aaron.png" }, userIds: ["1", "2", "3"], reason: "event", requestId: "bulk-0003" });
  assertTrue(tr.body.granted === 2 && tr.body.skipped.length === 1 && tr.body.skipped[0].name === "Brock" && tr.body.skipped[0].error.includes("already own"), "partial failure: the rest still get it and the skip is listed");

  const sel = await h.bulkPreview({ change: { kind: "cooldown", cooldowns: ["daily"] }, target: { userIds: ["2", "4", "missing"] } });
  assertTrue(sel.body.count === 2, "a selected list ignores unknown ids and doesn't apply filters");

  const tp = await h.bulkApply({ admin, change: { kind: "tp", op: "add", amount: 200 }, userIds: ["3"], reason: "event", requestId: "bulk-0004" });
  assertTrue(tp.body.roleFailures.length === 1 && tp.body.roleFailures[0].reason === "They aren't in the server.", "role sync failures are listed; the grant stands");
}

// ======================= Audit file =======================
section("Audit file");
{
  await appendAudit([{ adminId: "900", userId: "1", summary: "Add 1 CC", batchId: "b-1" }, { adminId: "900", userId: "2", summary: "Add 1 CC", batchId: "b-1" }]);
  await appendAudit({ adminId: "901", userId: "1", summary: "Remove 1 CC" });
  const all = await readAudit();
  assertTrue(all.total === 3 && all.entries[0].summary === "Remove 1 CC" && typeof all.entries[0].at === "number", "newest first, timestamped");
  assertTrue((await readAudit({ userId: "1" })).total === 2 && (await readAudit({ batchId: "b-1" })).total === 2 && (await readAudit({ adminId: "901" })).total === 1, "filters by player, batch and admin");
  await fs.appendFile(path.join(dir, "admin-audit.ndjson"), "{torn", "utf8");
  assertTrue((await readAudit()).total === 3, "a torn line is skipped");
}

// ======================= Sliding sessions =======================
section("Admin sessions");
{
  const t0 = Date.now();
  const token = auth.generateToken("900", "c", "admin", { name: "Coop" });
  const req = { cookies: { admin_session: token } };
  assertTrue(auth.adminSessionOf(req, t0 + 11 * 60_000) === null, "an unopened link dies after 10 minutes");
  const token2 = auth.generateToken("900", "c", "admin", { name: "Coop" });
  const req2 = { cookies: { admin_session: token2 } };
  auth.activateAdminSession(token2, t0);
  const s1 = auth.adminSessionOf(req2, t0 + 25 * 60_000);
  assertTrue(s1?.id === "900" && s1.name === "Coop" && s1.expires === t0 + 55 * 60_000, "each use slides expiry to 30 minutes later");
  let t = t0;
  for (let i = 0; i < 8; i++) { // 8 × 29 min = 3 h 52 min
    t += 29 * 60_000;
    auth.adminSessionOf(req2, t);
  }
  const s2 = auth.adminSessionOf(req2, t0 + 3 * 60 * 60_000 + 59 * 60_000);
  assertTrue(s2?.expires === t0 + 4 * 60 * 60_000, "never past 4 hours after opening");
  assertTrue(auth.adminSessionOf(req2, t0 + 4 * 60 * 60_000 + 1) === null, "after 4 hours the session ends");
  const t3 = auth.generateToken("901", "c", "admin");
  auth.activateAdminSession(t3, t0);
  assertTrue(auth.adminSessionOf({ cookies: { admin_session: t3 } }, t0 + 31 * 60_000) === null, "30 idle minutes end the session");
  const player_ = auth.generateToken("1", "c");
  assertTrue(auth.adminSessionOf({ cookies: { admin_session: player_ } }, t0) === null, "a player dashboard token is not an admin session");
}

section("Player dashboard sessions");
{
  const t0 = Date.now();
  const unopened = auth.generateToken("1", "c");
  assertTrue(auth.requireDashboardSession({ cookies: { dashboard_session: unopened } }, "1", t0 + 11 * 60_000) === false, "an unopened link dies after 10 minutes");
  const token = auth.generateToken("1", "c");
  const req = { cookies: { dashboard_session: token } };
  auth.activateDashboardSession(token, t0);
  assertTrue(auth.requireDashboardSession(req, "2", t0) === false, "another player's id is refused");
  assertTrue(auth.requireDashboardSession(req, "1", t0 + 25 * 60_000) === true, "still open 25 minutes in");
  assertTrue(auth.requireDashboardSession(req, 1, t0 + 54 * 60_000) === true, "each save slides expiry to 30 minutes later");
  let t = t0 + 54 * 60_000;
  while (t + 29 * 60_000 < t0 + 4 * 60 * 60_000) {
    t += 29 * 60_000;
    assertTrue(auth.requireDashboardSession(req, "1", t), "keeps sliding while in use");
  }
  assertTrue(auth.requireDashboardSession(req, "1", t0 + 4 * 60 * 60_000 + 1) === false, "after 4 hours the session ends");
  const idle = auth.generateToken("1", "c");
  auth.activateDashboardSession(idle, t0);
  assertTrue(auth.requireDashboardSession({ cookies: { dashboard_session: idle } }, "1", t0 + 31 * 60_000) === false, "30 idle minutes end the session");
  const admin = auth.generateToken("1", "c", "admin");
  assertTrue(auth.activateDashboardSession(admin, t0) === false, "an admin token can't open a player session");
  assertTrue(auth.requireDashboardSession({ cookies: { dashboard_session: admin } }, "1", t0) === false, "an admin token is not a player session");
}

// ======================= Route guards =======================
section("Route guards");
{
  process.env.ADMIN_DASH_TOKEN = "shared-secret";
  const td = { 1: player() };
  const app = express();
  let blocked = null;
  mountAdminDashboard(app, {
    getTrainerData: () => td,
    requireAdminSession: () => null,
    adminSessionOf: (req) => (req.headers.cookie === "admin_session=good" ? { id: "900", name: "Coop", expires: 1 } : null),
    lockUser,
    save: async () => ({ saved: true, note: "" }),
    writeBlocked: () => blocked,
    appendAudit: async () => ({ ok: true }),
    readAudit: async () => ({ total: 0, entries: [] }),
  });
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (p, body, headers = {}) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  const grant = { userId: "1", change: { kind: "cc", op: "add", amount: 5 }, requestId: "route-0001" };

  assertTrue((await fetch(`${base}/api/admin/users`)).status === 403, "reads need auth");
  assertTrue((await fetch(`${base}/api/admin/users`, { headers: { "x-admin-token": "shared-secret" } })).status === 200, "the shared token can read (header)");
  assertTrue((await fetch(`${base}/api/admin/users?token=shared-secret`)).status === 403, "the shared token is not accepted in the URL");
  assertTrue((await post("/api/admin/change", grant, { "x-admin-token": "shared-secret" })).status === 403 && td[1].cc === 1000, "the shared token can't write");
  assertTrue((await post("/api/admin/change", grant, { cookie: "admin_session=good", origin: "https://evil.example" })).status === 403 && td[1].cc === 1000, "a write from another site is refused");
  const form = await fetch(base + "/api/admin/change", { method: "POST", headers: { cookie: "admin_session=good", "content-type": "application/x-www-form-urlencoded" }, body: "a=1" });
  assertTrue(form.status === 415, "writes must be JSON");
  blocked = "The bot is starting up or restarting. Try again in a moment.";
  const b = await post("/api/admin/change", grant, { cookie: "admin_session=good" });
  assertTrue(b.status === 503 && td[1].cc === 1000, "writes wait while the bot isn't ready");
  blocked = null;
  const ok = await post("/api/admin/change", grant, { cookie: "admin_session=good", origin: base });
  assertTrue(ok.status === 200 && td[1].cc === 1005, "a same-site session write goes through");
  const pl = await (await fetch(`${base}/api/admin/player/1`, { headers: { cookie: "admin_session=good" } })).json();
  assertTrue(pl.ok && pl.player.cc === 1005 && Array.isArray(pl.pokemon) && pl.cooldowns.length === 5, "player view is shaped for the page");
  const cat = await (await fetch(`${base}/api/admin/catalog`, { headers: { cookie: "admin_session=good" } })).json();
  assertTrue(cat.species.some((s) => s.id === 25 && s.released) && cat.species.some((s) => s.id === UNRELEASED && !s.released) && cat.items.every((i) => i.id !== "pokeball") && cat.trainers.length > 100, "catalog marks unreleased Pokémon and lists only holdable items");
  server.close();
  delete process.env.ADMIN_DASH_TOKEN;
}

await fs.rm(dir, { recursive: true, force: true });
finish();
