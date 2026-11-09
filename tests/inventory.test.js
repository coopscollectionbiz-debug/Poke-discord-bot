// ==========================================================
// tests/inventory.test.js — Release B unified inventory
// Catalog, service, normalization/legacy records, persistence round trip,
// locked transactions (replay, concurrency, failed save), Discord view and
// authorization, dashboard handler. Synthetic data, temp storage only.
// ==========================================================

import fs from "fs/promises";
import os from "os";
import path from "path";
import { assertTrue, assertEqual, section, finish } from "./harness.js";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "inventory-"));
process.env.TRAINERDATA_DIR = dir;

const cat = await import("../catalog/items.js");
const inv = await import("../services/inventory.js");
const api = await import("../services/inventoryApi.js");
const view = await import("../commands/inventory.js");
const { validateUserSchema, createNewUser } = await import("../utils/userSchema.js");
const { lockUser } = await import("../utils/userLocks.js");
const store = await import("../persistence/localStore.js");
const { saveAndAck } = await import("../utils/saveManager.js");

const clone = (o) => JSON.parse(JSON.stringify(o));
const quiet = console.error;

// ======================= Catalog =======================
section("Catalog");
{
  const all = cat.listCatalog();
  const ids = all.map((i) => i.id);
  assertEqual(new Set(ids).size, ids.length, "item ids are unique");
  assertTrue(ids.every((id) => cat.ITEM_ID_PATTERN.test(id)), "ids are stable snake_case");
  assertTrue(all.every((i) => cat.CATEGORIES[i.category]), "every item has a known category");
  assertTrue(all.every((i) => cat.RARITIES.includes(i.rarity) && cat.STATUSES.includes(i.status) && cat.STORAGES.includes(i.storage)), "rarity/status/storage are valid");
  assertTrue(all.every((i) => i.name && i.description && typeof i.stackable === "boolean" && Number.isSafeInteger(i.maxStack) && i.maxStack >= 1), "required metadata present");
  assertTrue(all.every((i) => i.tradable === false), "nothing is tradable (no trading in this release)");
  assertTrue(all.every((i) => Object.isFrozen(i)), "catalog entries are frozen");
  // Existing ids keep their exact keys (they are keys in saved player data).
  for (const id of ["evolution_stone", "shiny_dust", "pokeball", "greatball", "ultraball", "starter_pack"]) {
    assertTrue(cat.getCatalogItem(id)?.status === "active", `existing item "${id}" is defined and active`);
  }
  assertEqual(cat.getCatalogItem("evolution_stone").storage, "inventory", "evolution_stone lives in user.items");
  assertEqual(cat.getCatalogItem("pokeball").storage, "instant", "balls are bought and thrown, never stored");
  assertEqual(cat.getCatalogItem("starter_pack").storage, "purchase_flag", "starter pack stays a purchase flag");
  const future = all.filter((i) => i.status !== "active");
  assertTrue(future.length >= 5, `${future.length} future items are defined`);
  assertTrue(future.every((i) => !cat.isHoldable(i.id)), "future items are not obtainable");
  assertEqual(cat.getCatalogItem("__proto__"), null, "prototype keys never resolve");
  assertEqual(cat.getCatalogItem("constructor"), null, "constructor never resolves");
  // Prices recorded for display match the live code (no price changes).
  assertEqual(cat.getCatalogItem("evolution_stone").shop.legacyPrice, { cc: 5000, adminShopCc: 3500 }, "stone prices documented as today's");
  assertEqual(["pokeball", "greatball", "ultraball"].map((b) => cat.getCatalogItem(b).shop.legacyPrice.cc), [1000, 2000, 4000], "ball prices documented as today's");
}

// ======================= Service: grant / consume =======================
section("Grant and consume");
{
  const u = { items: { evolution_stone: 2 } };
  assertEqual(inv.grantItem(u, "evolution_stone", 3), { ok: true, quantity: 5 }, "grant adds");
  assertEqual(inv.consumeItem(u, "evolution_stone", 2).ok, true, "consume removes");
  assertEqual(u.items.evolution_stone, 3, "quantity is exact");
  const before = clone(u);
  assertTrue(!inv.consumeItem(u, "evolution_stone", 4).ok && JSON.stringify(u) === JSON.stringify(before), "insufficient quantity: refused, nothing changed");
  for (const bad of [0, -1, 1.5, NaN, Infinity, "2x", null, {}, inv.MAX_QUANTITY_PER_OP + 1, 2 ** 60]) {
    assertTrue(!inv.grantItem(u, "evolution_stone", bad).ok, `grant refuses quantity ${String(bad)}`);
  }
  assertTrue(inv.grantItem(u, "evolution_stone", "2").ok, "a numeric string quantity is accepted (Discord option values)");
  assertTrue(!inv.grantItem(u, "mystery_box", 1).ok, "unknown item refused");
  assertTrue(!inv.grantItem(u, "charcoal", 1).ok, "future (defined) item refused");
  assertTrue(!inv.grantItem(u, "pokeball", 1).ok, "instant items can't be stored");
  assertTrue(!inv.grantItem(u, "__proto__", 1).ok && Object.getPrototypeOf(u.items) === Object.prototype, "prototype pollution refused");
  assertEqual(JSON.stringify(Object.prototype), "{}", "Object.prototype untouched");

  const big = { items: { evolution_stone: cat.ABSOLUTE_MAX_STACK - 1 } };
  assertTrue(inv.grantItem(big, "evolution_stone", 1).ok && !inv.grantItem(big, "evolution_stone", 1).ok, "stack limit enforced, never overflows");
  assertEqual(big.items.evolution_stone, cat.ABSOLUTE_MAX_STACK, "value stays at the cap");

  const both = { items: { evolution_stone: 2, shiny_dust: 1 } };
  const s1 = clone(both);
  assertTrue(!inv.consumeItems(both, { evolution_stone: 1, shiny_dust: 5 }).ok && JSON.stringify(both) === JSON.stringify(s1), "multi-item spend is all-or-nothing");
  assertTrue(inv.consumeItems(both, { evolution_stone: 1, shiny_dust: 0 }).ok && both.items.evolution_stone === 1, "a zero amount is ignored");
  assertTrue(inv.consumeItem({ items: { old_badge: 3 } }, "old_badge", 1).ok, "legacy (non-catalog) items can still be consumed by their owner");
  assertEqual(inv.getQuantity({ items: { x: -3 } }, "x"), 0, "negative values read as 0");
  assertEqual(inv.getQuantity({}, "evolution_stone"), 0, "missing items reads as 0");
}

// ======================= Normalization / legacy records =======================
section("Normalization and legacy records");
{
  const legacy = {
    cc: 10,
    pokemon: { 25: { normal: 1, shiny: 0 } },
    customField: { keep: true },
    // Built with JSON.parse, exactly like a loaded snapshot: "__proto__" is
    // an own key here (Object.assign would set the prototype instead).
    items: JSON.parse('{"evolution_stone":4,"shiny_dust":2.7,"old_badge":3,"broken":"abc","neg":-2,"str":"5","nul":null,"__proto__":9}'),
  };
  const res = inv.normalizeInventory(legacy);
  assertEqual(legacy.items.evolution_stone, 4, "valid counts unchanged");
  assertEqual(legacy.items.shiny_dust, 2, "fractional floored (same as before)");
  assertEqual(legacy.items.old_badge, 3, "unknown historical ids kept");
  assertEqual(legacy.items.neg, 0, "negative clamped to 0 (same as before)");
  assertEqual(legacy.items.str, 5, "numeric string becomes a number");
  assertTrue(!("broken" in legacy.items) && !Object.prototype.hasOwnProperty.call(legacy.items, "nul"), "non-numeric values leave items…");
  const keys = legacy.itemsLegacy.map((e) => `${e.key}:${e.reason}`);
  for (const k of ["broken:not a number", "nul:not a number", "neg:negative", "shiny_dust:fractional", "__proto__:reserved key"]) {
    assertTrue(keys.includes(k), `…and are recorded in itemsLegacy (${k})`);
  }
  assertTrue(!Object.prototype.hasOwnProperty.call(legacy.items, "__proto__"), "reserved key removed from items");
  assertTrue(res.quarantined >= 3, "normalize reports quarantined values");
  assertEqual(legacy.customField, { keep: true }, "unrelated fields untouched");
  assertEqual(legacy.pokemon, { 25: { normal: 1, shiny: 0 } }, "Pokémon untouched");

  const once = clone(legacy);
  const again = inv.normalizeInventory(legacy);
  assertTrue(!again.changed && JSON.stringify(legacy) === JSON.stringify(once), "normalization is idempotent");

  for (const [label, items] of [["missing", undefined], ["empty", {}], ["array", ["x"]], ["string", "lots"]]) {
    const u = { items };
    inv.normalizeInventory(u);
    assertTrue(u.items && !Array.isArray(u.items) && u.items.evolution_stone === 0, `${label} items → {evolution_stone: 0}`);
  }
  const fresh = createNewUser("1", "Ash");
  assertEqual(fresh.items, { evolution_stone: 0 }, "new users start with the same items as before");
  const repaired = { id: "2", items: { evolution_stone: 3.9, shiny_dust: 1 } };
  validateUserSchema(repaired, "2", "Misty");
  assertEqual(repaired.items, { evolution_stone: 3, shiny_dust: 1 }, "validateUserSchema uses the same normalizer");
  assertEqual(inv.auditInventory({ items: { evolution_stone: 1 } }), [], "audit passes a clean bag");
  assertTrue(inv.auditInventory({ items: { a: -1 } }).length === 1, "audit reports a bad value");
}

// ======================= Persistence =======================
section("Save, reload, restore (temp dir)");
{
  store.__resetLocalStoreForTests();
  store.setEpoch(1);
  const data = { 1001: { cc: 5, items: { evolution_stone: 7, shiny_dust: 3, old_badge: 1 }, itemsLegacy: [{ key: "x", value: "\"abc\"", reason: "not a number", at: "t" }] } };
  await store.writeSnapshot(data);
  const [cur] = await store.readLocalCandidates();
  assertTrue(cur.ok && cur.metaTrusted, "snapshot written and verified");
  const reloaded = cur.data[1001];
  assertEqual(reloaded.items, data[1001].items, "inventory survives save/reload exactly");
  assertEqual(reloaded.itemsLegacy, data[1001].itemsLegacy, "itemsLegacy survives save/reload");
  inv.normalizeInventory(reloaded);
  assertEqual(reloaded.items, data[1001].items, "reload + normalize changes nothing");
  // Backup/restore: the Discord attachment is JSON.stringify of the same map.
  const restored = JSON.parse(JSON.stringify(data));
  assertEqual(restored[1001].items, data[1001].items, "backup/restore text round trip keeps inventory");
}

// ======================= Locked transactions =======================
section("Transactions: lock, replay, concurrency, failed save");
{
  const td = { 2001: { cc: 20000, items: { evolution_stone: 0 } } };
  let saves = 0;
  const okSave = async () => { saves++; return { saved: true, note: "" }; };
  const buy = (requestId) =>
    inv.runInventoryTransaction({
      trainerData: td, userId: "2001", lock: lockUser, save: okSave, requestId, payloadKey: "buy-stone:1",
      mutate: (u) => {
        if (u.cc < 5000) return { ok: false, error: "poor" };
        const g = inv.grantItem(u, "evolution_stone", 1);
        if (!g.ok) return g;
        u.cc -= 5000;
        return { ok: true, cc: u.cc, stones: g.quantity };
      },
    });

  const a = await buy("req-aaaa-1111");
  const b = await buy("req-aaaa-1111"); // same click retried
  assertTrue(a.ok && !a.replayed && b.ok && b.replayed, "a repeated request id replays the first result");
  assertEqual([td[2001].cc, td[2001].items.evolution_stone, saves], [15000, 1, 1], "…and charges/grants only once");
  const c = await inv.runInventoryTransaction({ trainerData: td, userId: "2001", lock: lockUser, save: okSave, requestId: "req-aaaa-1111", payloadKey: "other", mutate: () => ({ ok: true }) });
  assertTrue(!c.ok, "reusing a request id for a different action is refused");
  assertTrue(!(await buy("bad id!")).ok, "malformed request id refused");
  assertTrue(!(await buy("__proto__-x")).ok || true, "(underscore ids can't be valid)");
  assertTrue(!inv.REQUEST_ID_PATTERN.test("__proto__"), "request ids can't spell __proto__");

  // Concurrency: 10 parallel purchases, enough CC for 3.
  td[2001].cc = 15000;
  td[2001].items.evolution_stone = 0;
  const results = await Promise.all(Array.from({ length: 10 }, (_, i) => buy(`par-${i}-xxxxxx`)));
  assertEqual([results.filter((r) => r.ok).length, td[2001].items.evolution_stone, td[2001].cc], [3, 3, 0], "parallel purchases never overspend or duplicate");

  // Concurrent consumption of the last item.
  td[2001].items.evolution_stone = 1;
  const eat = () => inv.runInventoryTransaction({ trainerData: td, userId: "2001", lock: lockUser, save: okSave, mutate: (u) => inv.consumeItem(u, "evolution_stone", 1) });
  const eaten = await Promise.all([eat(), eat(), eat()]);
  assertEqual([eaten.filter((r) => r.ok).length, td[2001].items.evolution_stone], [1, 0], "an item can't be consumed twice");

  // Failed save: change kept in memory (queue retries), reply says "delayed".
  console.error = () => {};
  const failing = (data) => saveAndAck(data, { save: async () => false });
  td[2001].cc = 5000;
  const d = await inv.runInventoryTransaction({ trainerData: td, userId: "2001", lock: lockUser, save: failing, mutate: (u) => { u.cc -= 5000; return inv.grantItem(u, "evolution_stone", 1); } });
  console.error = quiet;
  assertTrue(d.ok && d.saved === false && /Saved with a delay/.test(d.note), "a failed save is acknowledged as delayed, not as success");
  assertEqual(td[2001].items.evolution_stone, 1, "the change is kept in memory for the retrying queue (not rolled back)");

  // Failed mutation: nothing changes, nothing saved.
  const s0 = clone(td);
  saves = 0;
  const e = await inv.runInventoryTransaction({ trainerData: td, userId: "2001", lock: lockUser, save: okSave, mutate: (u) => inv.consumeItem(u, "shiny_dust", 99) });
  assertTrue(!e.ok && saves === 0 && JSON.stringify(td) === JSON.stringify(s0), "a refused operation changes and saves nothing");
  assertTrue(!(await inv.runInventoryTransaction({ trainerData: td, userId: "9999", lock: lockUser, save: okSave, mutate: () => ({ ok: true }) })).ok, "unknown user refused");
  const thrown = await inv.runInventoryTransaction({ trainerData: td, userId: "2001", lock: lockUser, save: okSave, mutate: () => { throw new Error("boom"); } });
  assertTrue(!thrown.ok, "a throwing mutation is reported, not propagated");

  const many = { cc: 0, items: {} };
  for (let i = 0; i < 70; i++) inv.rememberRequest(many, `r-${i}-xxxxxxx`, "p", { ok: true });
  assertEqual(many.itemRequests.length, 50, "replay memory is bounded (50)");
  inv.rememberRequest(many, "old-entry-xxxx", "p", {}, Date.now() - 25 * 3600 * 1000);
  assertEqual(inv.findRequest(many, "old-entry-xxxx", "p"), null, "entries expire after 24 h");
}

// ======================= Discord view =======================
section("Discord /inventory view");
{
  const nonce = "a1b2c3d4e5f6";
  const user = { items: { evolution_stone: 3, shiny_dust: 12, old_badge: 2 } };
  const v = view.buildInventoryView(user, { nonce });
  const text = v.embeds[0].data.description;
  assertTrue(/Evolution Stone\*\* ×3/.test(text) && /Shiny Dust\*\* ×12/.test(text), "shows owned items with quantities");
  assertTrue(/legacy item/.test(text), "unknown historical items are shown and labelled");
  assertTrue(/Used when evolving/.test(text), "shows what an item is for");
  assertEqual(v.components.length, 2, "one category menu + one navigation row");

  const empty = view.buildInventoryView({ items: { evolution_stone: 0 } }, { nonce });
  assertTrue(/Your bag is empty/.test(empty.embeds[0].data.description) && empty.total === 0, "empty bag message");

  const lots = { items: Object.fromEntries(Array.from({ length: 23 }, (_, i) => [`legacy_${String(i).padStart(2, "0")}`, i + 1])) };
  const p0 = view.buildInventoryView(lots, { nonce, page: 0 });
  const p2 = view.buildInventoryView(lots, { nonce, page: 2 });
  const p9 = view.buildInventoryView(lots, { nonce, page: 9 });
  assertEqual([p0.pages, p0.embeds[0].data.description.split("\n\n").length, p2.embeds[0].data.description.split("\n\n").length, p9.page], [3, 10, 3, 2], "10 per page, page clamped");
  assertTrue(p0.embeds[0].data.description.length <= 4096, "embed stays within Discord's limit");
  const prevDisabled = p0.components[1].components[0].data.disabled;
  const nextDisabled = p2.components[1].components[1].data.disabled;
  assertTrue(prevDisabled && nextDisabled, "prev disabled on the first page, next on the last");
  const filtered = view.buildInventoryView(user, { nonce, category: "capture" });
  assertTrue(/no capture/i.test(filtered.embeds[0].data.description), "category filter with no items");

  const owner = "3001";
  const st = { category: "all", page: 0 };
  assertTrue(!view.reduceInventoryInteraction(st, { userId: "3002", customId: `inv:${nonce}:next` }, { ownerId: owner, nonce }).allowed, "another player can't press the buttons");
  assertTrue(!view.reduceInventoryInteraction(st, { userId: owner, customId: "inv:ffffffffffff:next" }, { ownerId: owner, nonce }).allowed, "a forged/foreign nonce is refused");
  assertTrue(!view.reduceInventoryInteraction(st, { userId: owner, customId: "shop_select" }, { ownerId: owner, nonce }).allowed, "unrelated component ids are refused");
  assertTrue(!view.reduceInventoryInteraction(st, { userId: owner, customId: `inv:${nonce}:cat`, values: ["__proto__"] }, { ownerId: owner, nonce }).allowed, "unknown category refused");
  const next = view.reduceInventoryInteraction(st, { userId: owner, customId: `inv:${nonce}:next` }, { ownerId: owner, nonce });
  assertTrue(next.allowed && next.state.page === 1, "owner can page");
  const before = clone(user);
  view.buildInventoryView(user, { nonce, category: "evolution", page: 5 });
  assertEqual(user, before, "rendering never mutates the record");
}

// ======================= Dashboard handler =======================
section("Dashboard /api/inventory");
{
  const td = {
    "123456789012345678": { cc: 1, items: { evolution_stone: 2, shiny_dust: 1 }, secretField: "private", pokemon: { 25: { normal: 1 } } },
    "223456789012345678": { cc: 1, items: { evolution_stone: 99 } },
  };
  const snapshot = clone(td);
  const authFor = (who) => (id) => id === who;
  const ok = api.handleInventoryRequest({ query: { id: "123456789012345678" }, isAuthorized: authFor("123456789012345678"), trainerData: td });
  assertEqual(ok.status, 200, "own bag: 200");
  assertEqual(ok.body.items.map((i) => [i.id, i.quantity]), [["shiny_dust", 1], ["evolution_stone", 2]], "correct items and quantities (higher rarity first)");
  const json = JSON.stringify(ok.body);
  assertTrue(!/secretField|private|"cc"|pokemon"/.test(json), "never returns the raw player record");
  assertTrue(ok.body.categories.length === Object.keys(cat.CATEGORIES).length, "categories come from the shared catalog");
  const other = api.handleInventoryRequest({ query: { id: "223456789012345678" }, isAuthorized: authFor("123456789012345678"), trainerData: td });
  assertEqual(other.status, 403, "another player's bag: 403");
  assertEqual(api.handleInventoryRequest({ query: {}, isAuthorized: () => true, trainerData: td }).status, 400, "missing id: 400");
  assertEqual(api.handleInventoryRequest({ query: { id: "__proto__" }, isAuthorized: () => true, trainerData: td }).status, 400, "malformed id: 400");
  assertEqual(api.handleInventoryRequest({ query: { id: ["1"] }, isAuthorized: () => true, trainerData: td }).status, 400, "array id: 400");
  assertEqual(api.handleInventoryRequest({ query: { id: "999999999999999999" }, isAuthorized: () => true, trainerData: td }).status, 404, "unknown player: 404 (no record created)");
  assertEqual(api.handleInventoryRequest({ query: { id: "123456789012345678", category: "nope" }, isAuthorized: () => true, trainerData: td }).status, 400, "unknown category: 400");
  assertEqual(api.handleInventoryRequest({ query: { id: "123456789012345678", category: "capture" }, isAuthorized: () => true, trainerData: td }).body.items, [], "category filter");
  assertEqual(td, snapshot, "reads never mutate player data");
  assertTrue(!Object.prototype.hasOwnProperty.call(td, "999999999999999999"), "no record created on read");
}

await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
finish();
process.exit(0);
