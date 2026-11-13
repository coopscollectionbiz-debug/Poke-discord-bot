// ==========================================================
// tests/tmShop.test.js — TM system phase T3: TM catalog items, prices and
// the shop (services/tmShop.js).
// ==========================================================

import fs from "fs";
import { assertTrue, assertEqual, section, finish } from "./harness.js";
import { listCatalog, getCatalogItem, CATEGORIES } from "../catalog/items.js";
import { TM_PRICE_BY_TIER, tmTierOf } from "../catalog/tms.js";
import { tmMoveIds } from "../utils/battle/tmData.js";
import { grantItem, runInventoryTransaction, listInventory } from "../services/inventory.js";
import { tmShopView, buyTms, sellableTms, tmBoughtThisWeek, tmLearners } from "../services/tmShop.js";
import { isTmEnabled, tmWeeklyCap } from "../config/tmFeatures.js";

const ON = { TM_ENABLED: "1" };
const OFF = {};
const clone = (o) => JSON.parse(JSON.stringify(o));
const player = (cc = 50000) => ({ cc, items: { evolution_stone: 0 }, pokemon: { 6: { normal: 1, shiny: 0 }, 25: { normal: 0, shiny: 1 } } });

section("catalog items and approved prices (D-T6)");
{
  const tms = listCatalog().filter((i) => i.category === "tm");
  assertEqual(tms.length, 172, "one item per catalog move (156 launch + 16 held)");
  assertEqual(tms.filter((i) => i.status === "active").length, 156, "156 active (sellable)");
  assertEqual(sellableTms().length, 156, "the shop sells exactly the 156 launch TMs");
  assertTrue(tmMoveIds().every((m) => tmTierOf(m)), "every catalog move has an explicit price tier");
  assertEqual(TM_PRICE_BY_TIER, { basic: 1500, standard: 3000, power: 5000, premium: 6000, elite: 7500 }, "tier prices");
  const price = (m) => getCatalogItem(`tm_${m}`).shop.price.cc;
  assertEqual([price("thunderbolt"), price("thunderpunch"), price("cut"), price("thunder"), price("doubleedge"), price("flareblitz"), price("bravebird")], [6000, 3000, 1500, 5000, 7500, 7500, 7500], "Thunderbolt 6,000 · Thunder Punch 3,000 · Cut 1,500 · Thunder 5,000 · Elite 7,500");
  assertEqual(getCatalogItem("tm_thunderbolt").name, "TM24 Thunderbolt", "Gen 5 TMs keep their number in the name");
  assertEqual(getCatalogItem("tm_playrough").name, "TM Play Rough", "later moves have no number");
  assertEqual(getCatalogItem("tm_overheat").status, "defined", "held TMs are defined, not obtainable");
  assertTrue(!grantItem(player(), "tm_overheat", 1).ok, "grantItem refuses a held TM");
  assertEqual(getCatalogItem("tm_solarbeam"), null, "moves outside the catalog have no item");
  assertEqual(CATEGORIES.tm?.label, "Technical Machines", "new bag category");
  const bag = player(); grantItem(bag, "tm_thunderbolt", 2);
  const row = listInventory(bag).find((r) => r.id === "tm_thunderbolt");
  assertEqual([row.category, row.quantity, /Used up when taught/.test(row.usage)], ["tm", 2, true], "TMs show in the bag with their use");
}

section("flags");
assertEqual([isTmEnabled(OFF), isTmEnabled(ON), isTmEnabled({ TM_ENABLED: "0" })], [false, true, false], "TM_ENABLED is opt-in");
assertEqual([tmWeeklyCap({}), tmWeeklyCap({ TM_WEEKLY_CAP: "10" }), tmWeeklyCap({ TM_WEEKLY_CAP: "0" }), tmWeeklyCap({ TM_WEEKLY_CAP: "abc" })], [null, 10, null, null], "weekly cap off unless a positive whole number (D-T7)");

section("shop switched off");
{
  const u = player();
  const before = clone(u);
  const v = tmShopView(u, { env: OFF });
  assertEqual([v.enabled, v.tms], [false, []], "nothing listed");
  assertEqual(buyTms(u, { item: "tm_thunderbolt" }, { env: OFF }).code, "disabled", "purchases refused");
  assertEqual(u, before, "record untouched");
}

section("listing (server-derived)");
{
  const v = tmShopView(player(), { env: ON });
  const tb = v.tms.find((t) => t.item === "tm_thunderbolt");
  assertEqual([tb.price, tb.tier, tb.type, tb.teaches, tb.owned], [6000, "premium", "Electric", 1, 0], "Thunderbolt: price, tier, type; teaches 1 (the shiny Pikachu)");
  assertEqual(v.tms.find((t) => t.item === "tm_thunderpunch").teaches, 2, "Thunder Punch teaches the Charizard and the Pikachu");
  assertEqual(v.tms.find((t) => t.item === "tm_surf").teaches, 0, "Surf teaches neither");
  assertTrue(!v.tms.some((t) => t.item === "tm_overheat"), "held TMs are not listed");
  assertEqual(v.weekly, { bought: 0, cap: null, remaining: null }, "weekly counter shown, cap off");
}

section("buying");
{
  const now = new Date("2026-11-11T12:00:00Z");
  const u = player(20000);
  const r = buyTms(u, { item: "tm_thunderpunch", qty: 2 }, { env: ON, now });
  assertTrue(r.ok, "2 × Thunder Punch bought");
  assertEqual([u.cc, u.items.tm_thunderpunch, r.cost, u.tmShop.bought], [14000, 2, 6000, 2], "CC charged once per copy, TMs in the bag, counter +2");
  const before = clone(u);
  assertEqual(buyTms(u, { item: "tm_doubleedge", qty: 2 }, { env: ON, now }).code, "insufficient_cc", "15,000 CC > 14,000 CC refused");
  assertEqual(buyTms(u, { item: "tm_overheat" }, { env: ON, now }).code, "not_for_sale", "held TM refused");
  assertEqual(buyTms(u, { item: "tm_solarbeam" }, { env: ON, now }).code, "unknown_tm", "non-catalog move refused");
  assertEqual(buyTms(u, { item: "evolution_stone" }, { env: ON, now }).code, "unknown_tm", "non-TM item refused");
  assertEqual(buyTms(u, { item: "tm___proto__" }, { env: ON, now }).code, "unknown_tm", "forged id refused");
  for (const q of [0, 11, 1.5, -1, "2"]) assertEqual(buyTms(u, { item: "tm_cut", qty: q }, { env: ON, now }).code, "bad_quantity", `quantity ${JSON.stringify(q)} refused`);
  assertEqual(u, before, "refusals change nothing");

  const capped = player(100000);
  const env = { ...ON, TM_WEEKLY_CAP: "3" };
  assertTrue(buyTms(capped, { item: "tm_cut", qty: 3 }, { env, now }).ok, "3 within a cap of 3");
  const over = buyTms(capped, { item: "tm_cut", qty: 1 }, { env, now });
  assertEqual([over.code, over.remaining], ["weekly_cap", 0], "a 4th is refused when the cap is on");
  assertEqual(tmBoughtThisWeek(capped, new Date("2026-11-18T12:00:00Z")), 0, "the counter starts over next ISO week");
  assertTrue(buyTms(capped, { item: "tm_cut", qty: 1 }, { env, now: new Date("2026-11-18T12:00:00Z") }).ok, "and buying works again");
  const noCap = player(100000);
  assertTrue(buyTms(noCap, { item: "tm_cut", qty: 10 }, { env: ON, now }).ok && buyTms(noCap, { item: "tm_cut", qty: 10 }, { env: ON, now }).ok, "no cap at launch: 20 in one week is fine");
  const fresh = player();
  tmShopView(fresh, { env: ON });
  assertTrue(!("tmShop" in fresh), "viewing the shop never creates the counter field");
}

section("replay: the same request id charges once");
{
  const trainerData = { u1: player(10000) };
  const args = {
    trainerData, userId: "u1", lock: (_id, fn) => fn(), save: async () => ({ saved: true, note: "" }),
    requestId: "buy12345-tm", payloadKey: "buy-tm:tm_thunderbolt:1",
    mutate: (u) => buyTms(u, { item: "tm_thunderbolt", qty: 1 }, { env: ON }),
  };
  const a = await runInventoryTransaction(args);
  const b = await runInventoryTransaction(args);
  assertTrue(a.ok && b.ok && b.replayed, "second call is a replay");
  assertEqual([trainerData.u1.cc, trainerData.u1.items.tm_thunderbolt], [4000, 1], "6,000 CC charged once, 1 TM");
}

section("The shop page's request isn't one ad blockers stop");
{
  // EasyPrivacy (on by default in uBlock Origin) blocks any URL containing
  // "/tms?id=", so the TM shop never showed for players with a blocker.
  const page = fs.readFileSync(new URL("../public/dashboardshop/tms.js", import.meta.url), "utf8");
  assertTrue(page.includes("/api/tm-shop?id="), "the Shop page asks /api/tm-shop");
  const fetched = [...page.matchAll(/fetch\(\s*[`"']([^`"']+)/g)].map((m) => m[1]);
  assertTrue(fetched.length > 0 && fetched.every((u) => !u.includes("/tms?")), `no fetch URL contains /tms? (${fetched.join(", ")})`);
  const server = fs.readFileSync(new URL("../bot_final.js", import.meta.url), "utf8");
  assertTrue(server.includes('app.get(["/api/tm-shop", "/api/tms"]'), "the server answers the new path (and the old one for open tabs)");
}

section("buy dialog: which of my Pokémon can learn it (team members first)");
{
  const u = {
    pokemon: { 6: { normal: 2, shiny: 0 }, 25: { normal: 1, shiny: 1 }, 26: { normal: 1, shiny: 0 }, 145: { normal: 1, shiny: 0 }, 135: { normal: 1, shiny: 0 }, 181: { normal: 1, shiny: 0 }, 133: { normal: 3, shiny: 0 }, 180: { normal: 1, shiny: 0 } },
    training: { "181:normal": { exp: 60000 } },
    customPokemon: { c_TrainedPk1: { uid: "c_TrainedPk1", speciesId: 25, variant: "shiny", tmMoves: ["thunderbolt"], rev: 1 } },
    displayedPokemon: [{ id: 6, variant: "normal" }, { id: 26, variant: "normal" }],
    battleTeam: [{ id: 145, variant: "normal" }, { id: 135, variant: "normal" }, { id: 25, variant: "shiny" }, { id: 6, variant: "normal" }],
    showcaseTeam: [{ id: 180, variant: "normal" }],
  };
  const before = clone(u);
  const r = tmLearners(u, "tm_thunderbolt", { env: ON });
  assertTrue(r.ok, "lists learners");
  const keys = r.learners.map((l) => `${l.speciesId}:${l.variant}`);
  assertEqual(keys.slice(0, 4), ["26:normal", "145:normal", "135:normal", "25:shiny"], "Casual team first, then Ranked, in slot order");
  assertTrue(r.learners.slice(0, 4).every((l) => l.priority) && r.learners.slice(4).every((l) => !l.priority), "only Casual/Ranked members are priority");
  assertTrue(!keys.includes("6:normal") && !keys.includes("133:normal"), "Pokémon that can’t learn it are left out, even on a team");
  const rest = r.learners.slice(4);
  assertTrue(rest.every((l, i) => i === 0 || rest[i - 1].level >= l.level), "the rest by Level, highest first");
  assertEqual(r.learners.find((l) => l.speciesId === 180)?.teams, ["showcase"], "Showcase is tagged but not prioritised");
  assertEqual(r.learners.find((l) => l.speciesId === 25 && l.variant === "shiny")?.known, true, "a copy trained with the TM counts as already knowing it");
  assertEqual(r.learners.find((l) => l.speciesId === 25 && l.variant === "normal")?.known, false, "an untrained Pikachu doesn’t know it");
  assertEqual(r.learners.length, tmShopView(u, { env: ON }).tms.find((t) => t.item === "tm_thunderbolt").teaches + 1, "one row per owned species + Variant (the count is per species)");
  assertEqual(u, before, "read-only: the player is unchanged");
  assertEqual(tmLearners(u, "tm_nope", { env: ON }).code, "bad_item", "unknown TM refused");
  assertEqual(tmLearners(u, "tm_thunderbolt", { env: OFF }).code, "disabled", "nothing while TMs are off");
  const server = fs.readFileSync(new URL("../bot_final.js", import.meta.url), "utf8");
  assertTrue(server.includes('app.get("/api/tm-shop/learners"'), "route lives under /api/tm-shop/ (blocklist-safe)");
}

finish();
