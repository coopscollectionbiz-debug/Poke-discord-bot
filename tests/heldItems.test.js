// ==========================================================
// tests/heldItems.test.js — held-item unlocks, team-scoped equipment, the
// Item Clause, Mega slots, the starter grant, the dashboard API (auth,
// replay, stale tabs, concurrency, rate limit, shop) and load-time repair.
// Synthetic players only; nothing touches real data.
// ==========================================================

import fs from "fs";
import { assertTrue, assertEqual, section, finish } from "./harness.js";
import {
  ensureStarterHeldItems, starterPending, applyEquip, checkEquip, teamEquipment, equipmentRev, reconcileTeamEquipment,
  normalizeEquipment, battleItems, describeLoadout, clearTeamEquipment, ownedHeldItems,
} from "../services/heldItems.js";
import { createHeldItemHandlers, createRateLimiter } from "../services/heldItemsApi.js";
import { STARTER_HELD_ITEMS } from "../catalog/heldItems.js";
import { getCatalogItem, listCatalog, isHeldItem, MEGA_STONE_IDS } from "../catalog/items.js";
import { grantItem, consumeItem, normalizeInventory, getQuantity } from "../services/inventory.js";
import { validateUserSchema, createNewUser } from "../utils/userSchema.js";
import { lockUser } from "../utils/userLocks.js";
import { heldItemCapabilities, isHeldItemCapabilityEnabled } from "../config/features.js";

const ON = { HELD_ITEMS_ENABLED: "1", HELD_ITEMS_BATTLES_ENABLED: "1" };
const ID = "123456789";
function player({ items = {}, display = [6, 25, 143], battle = [143, 94] } = {}) {
  const u = createNewUser(ID, "Tester");
  for (const s of new Set([...display, ...(battle ?? [])])) u.pokemon[s] = { normal: 1, shiny: 0 };
  u.displayedPokemon = display.map((id) => ({ id, variant: "normal" }));
  if (battle) u.battleTeam = battle.map((id) => ({ id, variant: "normal" }));
  Object.assign(u.items, items);
  return u;
}
const ownAll = () => Object.fromEntries(listCatalog().filter(isHeldItem).map((e) => [e.id, 1]));

// ------------------------------------------------------------------
section("Feature flags (default off, staged audience)");
assertEqual(heldItemCapabilities({}), { dashboard: false, starter: false, shop: false, battles: false }, "everything is off with no flags");
assertEqual(heldItemCapabilities({ HELD_ITEMS_ENABLED: "1" }), { dashboard: true, starter: true, shop: true, battles: false }, "master on: battles stay opt-in");
assertTrue(isHeldItemCapabilityEnabled("dashboard", { HELD_ITEMS_ENABLED: "1", HELD_ITEMS_TESTERS: ID }, ID) && !isHeldItemCapabilityEnabled("dashboard", { HELD_ITEMS_ENABLED: "1", HELD_ITEMS_TESTERS: ID }, "99999"), "tester allowlist: only listed players");
assertTrue(!isHeldItemCapabilityEnabled("shop", { HELD_ITEMS_ENABLED: "1", HELD_ITEMS_SHOP_ENABLED: "0" }), "a sub-switch can turn one part off");

// ------------------------------------------------------------------
section("Ownership is a unique unlock in the existing inventory");
{
  const u = player();
  const env = { HELD_ITEMS_ENABLED: "1" };
  assertTrue(!grantItem(u, "leftovers", 1).ok, "no grant while the feature is off (admin /addinventory, rewards)");
  assertTrue(grantItem(u, "leftovers", 1, { env }).ok, "grant when on");
  const again = grantItem(u, "leftovers", 1, { env });
  assertTrue(!again.ok && again.code === "already_owned", "a second copy is refused (maxStack 1)");
  assertEqual(getQuantity(u, "leftovers"), 1, "exactly one unlock");
  assertTrue(grantItem(u, "evolution_stone", 3).ok && grantItem(u, "evolution_stone", 3).ok && getQuantity(u, "evolution_stone") === 6, "ordinary stackable items are unchanged");
  assertEqual(getCatalogItem("charcoal").category, "held", "the old placeholder Charcoal id is now the active held item (no duplicate id)");
  assertEqual(new Set(listCatalog().map((e) => e.id)).size, listCatalog().length, "catalog ids are unique");
}

// ------------------------------------------------------------------
section("Every held item has its official icon file");
{
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const held = listCatalog().filter(isHeldItem);
  const bad = held.filter((e) => {
    const f = new URL(`../public/sprites/${e.icon}`, import.meta.url);
    return !e.icon || !fs.existsSync(f) || !fs.readFileSync(f).subarray(0, 8).equals(PNG);
  }).map((e) => e.id);
  assertEqual(bad, [], `all ${held.length} held items point at an existing PNG in public/sprites/items/held`);
  const sizes = held.map((e) => { const b = fs.readFileSync(new URL(`../public/sprites/${e.icon}`, import.meta.url)); return [e.id, b.readUInt32BE(16), !!e.held.iconSmooth]; });
  assertEqual(sizes.filter(([, w, smooth]) => (w === 30) === smooth).map(([id]) => id), [], "30×30 pixel icons render pixelated; only larger HD icons (Fairy Feather) are marked smooth");

  // Mega Stones: the Mega-slot placeholder shows the official stone icon.
  const stones = MEGA_STONE_IDS.map((id) => getCatalogItem(id));
  const badStones = stones.filter((e) => {
    if (!e.icon) return true;
    const b = fs.readFileSync(new URL(`../public/sprites/${e.icon}`, import.meta.url));
    return !b.subarray(0, 8).equals(PNG) || (b.readUInt32BE(16) > 30) !== e.iconSmooth;
  }).map((e) => e.id);
  assertEqual(badStones, [], `all ${stones.length} Mega Stones have a valid icon (HD ones scale smoothly)`);
  const u = player({ display: [6] });
  u.displayedPokemon[0].mega = "mega-charizard-x";
  assertEqual(describeLoadout(u, "display")[0].megaSlot.icon, "/public/sprites/items/megastones/megastone_charizarditex.png", "the Mega slot placeholder carries its stone's icon");
}

// ------------------------------------------------------------------
section("Starter grant: eight unlocks, exactly once, never overwriting");
{
  const env = { HELD_ITEMS_ENABLED: "1" };
  const u = player({ items: { focus_sash: 1, evolution_stone: 4 } });
  const before = JSON.stringify({ pokemon: u.pokemon, cc: u.cc, d: u.displayedPokemon, b: u.battleTeam });
  assertTrue(!ensureStarterHeldItems(u, { env: {} }).changed, "feature off → nothing granted");
  assertTrue(starterPending(u, { env }), "pending while not granted");
  const r = ensureStarterHeldItems(u, { env });
  assertEqual(r.granted.sort(), STARTER_HELD_ITEMS.filter((i) => i !== "focus_sash").sort(), "grants the 7 missing items, skips the one already owned");
  assertEqual(STARTER_HELD_ITEMS.map((i) => getQuantity(u, i)), STARTER_HELD_ITEMS.map(() => 1), "all eight owned once");
  assertEqual(getQuantity(u, "evolution_stone"), 4, "other inventory untouched");
  assertEqual(JSON.stringify({ pokemon: u.pokemon, cc: u.cc, d: u.displayedPokemon, b: u.battleTeam }), before, "Pokémon, CC and teams untouched");
  for (let i = 0; i < 3; i++) ensureStarterHeldItems(u, { env });
  assertEqual(STARTER_HELD_ITEMS.map((i) => getQuantity(u, i)), STARTER_HELD_ITEMS.map(() => 1), "repeated grants (restart/retry) change nothing");
  assertTrue(!starterPending(u, { env }) && u.heldItemGrants.starter === 1, "versioned entitlement recorded");
  const fresh = createNewUser("555555", "New");
  ensureStarterHeldItems(fresh, { env });
  assertEqual(ownedHeldItems(fresh).sort(), [...STARTER_HELD_ITEMS].sort(), "a brand-new player gets the same eight");
  assertTrue(!STARTER_HELD_ITEMS.some((i) => getCatalogItem(i).held.boostsType), "no type-boosting item in the starter set");
}

// ------------------------------------------------------------------
section("Team-scoped equipment and the Item Clause");
{
  const u = player({ items: ownAll() });
  const eq = (teamId, line, itemId, move = false) => applyEquip(u, { teamId, line, itemId, move });
  assertTrue(eq("display", "6:normal", "leftovers").ok, "Display: Charizard holds Leftovers");
  assertTrue(eq("battle", "143:normal", "leftovers").ok, "Battle: Snorlax holds the SAME Leftovers unlock");
  assertEqual(getQuantity(u, "leftovers"), 1, "still one unlock; nothing consumed");
  const dup = eq("display", "25:normal", "leftovers");
  assertTrue(!dup.ok && dup.code === "item_clause" && dup.holder === "6:normal", "a second holder on the same team is refused (Item Clause) and names the holder");
  const mv = eq("display", "25:normal", "leftovers", true);
  assertTrue(mv.ok && mv.from === "6:normal", "move: Pikachu takes it from Charizard in one step");
  assertEqual(teamEquipment(u, "display"), { "25:normal": "leftovers" }, "Charizard holds nothing now");
  assertEqual(teamEquipment(u, "battle"), { "143:normal": "leftovers" }, "the Battle team is untouched by the move");
  assertTrue(eq("display", "25:normal", "focus_sash").ok && teamEquipment(u, "display")["25:normal"] === "focus_sash", "replace: the old item is simply free again");
  assertTrue(eq("display", "25:normal", null).ok && !teamEquipment(u, "display")["25:normal"], "remove");
  assertEqual(getQuantity(u, "focus_sash"), 1, "removing never deletes the unlock");
  const rev = equipmentRev(u);
  assertTrue(eq("battle", "143:normal", "leftovers").ok && equipmentRev(u) === rev, "re-equipping the same item is a no-op (no rev bump)");
  assertEqual(checkEquip(u, { teamId: "display", line: "94:normal", itemId: "leftovers" }).code, "not_member", "only members of the SAVED team can hold items");
  assertEqual(checkEquip(u, { teamId: "display", line: "25:normal", itemId: "thick_club" }).code, "wrong_species", "species items: refused on other species");
  assertEqual(checkEquip(player(), { teamId: "display", line: "6:normal", itemId: "leftovers" }).code, "not_owned", "not unlocked → refused");
  assertEqual(checkEquip(u, { teamId: "display", line: "6:normal", itemId: "choice_band" }).code, "bad_item", "deferred items (Choice Band) can't be equipped");
  assertEqual(checkEquip(u, { teamId: "battle:x", line: "6:normal", itemId: "leftovers" }).code, "bad_team", "future team ids aren't editable yet");
  const noBattle = player({ items: ownAll(), battle: null });
  delete noBattle.battleTeam;
  assertEqual(checkEquip(noBattle, { teamId: "battle", line: "6:normal", itemId: "leftovers" }).code, "no_team", "no Battle team set → refused");
}

// ------------------------------------------------------------------
section("Mega slots hold their Mega Stone, not a regular item");
{
  const u = player({ items: ownAll() });
  applyEquip(u, { teamId: "display", line: "6:normal", itemId: "leftovers" });
  applyEquip(u, { teamId: "battle", line: "143:normal", itemId: "leftovers" });
  u.displayedPokemon[0].mega = "mega-charizard-x";
  assertEqual(checkEquip(u, { teamId: "display", line: "6:normal", itemId: "expert_belt" }).code, "mega_slot", "equip refused on a Mega slot");
  const lo = describeLoadout(u, "display");
  assertTrue(lo[0].item === null && lo[0].megaSlot?.stone === "megastone_charizarditex", "the loadout shows the Mega Stone placeholder (derived, never owned or bought)");
  const removed = reconcileTeamEquipment(u, "display");
  assertEqual(removed.map((r) => r.reason), ["mega_slot"], "saving a team with the Mega clears that team's assignment");
  assertEqual(teamEquipment(u, "battle"), { "143:normal": "leftovers" }, "other teams are untouched");
  assertEqual(getQuantity(u, "leftovers"), 1, "the unlock is preserved");
  delete u.displayedPokemon[0].mega;
  assertTrue(checkEquip(u, { teamId: "display", line: "6:normal", itemId: "leftovers" }).ok, "Mega off → the slot accepts items again");
}

// ------------------------------------------------------------------
section("Reconciliation and load-time repair (only removes assignments)");
{
  const u = player({ items: ownAll() });
  applyEquip(u, { teamId: "display", line: "6:normal", itemId: "leftovers" });
  applyEquip(u, { teamId: "display", line: "143:normal", itemId: "charcoal" });
  u.displayedPokemon = u.displayedPokemon.filter((s) => s.id !== 6); // left the team
  const items = JSON.stringify(u.items);
  assertEqual(reconcileTeamEquipment(u, "display").map((r) => r.reason), ["not_member"], "a Pokémon that left the team drops its assignment on that team");
  assertEqual(JSON.stringify(u.items), items, "no unlock removed");

  const bad = player({ items: { leftovers: 1 } });
  bad.equipment = { rev: "x", teams: { display: { "6:normal": "leftovers", "25:normal": "leftovers", "143:normal": "nope", __proto__x: 1, "bad": "leftovers" }, "battle:future-1": { "1:normal": "leftovers" }, "evil team": {} } };
  const n = normalizeEquipment(bad);
  assertTrue(n.changed, "corrupted fields are repaired");
  assertEqual(bad.equipment.rev > 0, true, "the revision is valid again (and bumped)");
  assertEqual(teamEquipment(bad, "display"), { "6:normal": "leftovers" }, "keeps the first holder; drops duplicates, unknown ids and bad keys");
  assertTrue(bad.equipment.teams["battle:future-1"] && !bad.equipment.teams["evil team"], "a well-formed future team id is kept as stored; a malformed one is quarantined");
  assertTrue(Array.isArray(bad.equipmentLegacy) && bad.equipmentLegacy.length >= 2, "dropped values are recorded in equipmentLegacy");
  assertEqual(JSON.stringify(normalizeEquipment(bad)), JSON.stringify({ changed: false, removed: [] }), "idempotent: a second run changes nothing");

  const legacy = player();
  normalizeEquipment(legacy);
  assertTrue(!("equipment" in legacy), "a record without the field stays without it (never created)");
  const junk = player();
  junk.equipment = [1, 2];
  normalizeEquipment(junk);
  assertTrue(!("equipment" in junk) && junk.equipmentLegacy.length === 1, "a non-object equipment field is quarantined");
  const lost = player({ items: { leftovers: 1 } });
  applyEquip(lost, { teamId: "display", line: "6:normal", itemId: "leftovers" });
  lost.items.leftovers = 0; // e.g. an admin correction
  normalizeEquipment(lost);
  assertEqual(teamEquipment(lost, "display"), {}, "an item no longer owned is unassigned on load");
  assertTrue(clearTeamEquipment(player({ items: ownAll() })) === false, "admin reset with no equipment: nothing to do");
}

// ------------------------------------------------------------------
section("Old versions keep the new data (rollback)");
{
  const u = player({ items: { leftovers: 1, evolution_stone: 2 } });
  u.equipment = { rev: 3, teams: { display: { "6:normal": "leftovers" } } };
  u.heldItemGrants = { starter: 1 };
  const snapshot = JSON.stringify({ e: u.equipment, g: u.heldItemGrants, i: u.items });
  validateUserSchema(u, ID, "Tester");
  normalizeInventory(u);
  assertEqual(JSON.stringify({ e: u.equipment, g: u.heldItemGrants, i: u.items }), snapshot, "schema validation and inventory repair keep equipment, grants and unlocks");
  const unknown = { items: { some_future_item: 1 } };
  normalizeInventory(unknown);
  assertEqual(unknown.items.some_future_item, 1, "unknown item ids with valid counts are kept (the rule older releases rely on)");
  assertTrue(!consumeItem(u, "leftovers", 2).ok && getQuantity(u, "leftovers") === 1, "inventory never goes below zero");
}

// ------------------------------------------------------------------
section("Battle-time validation is independent of what was stored");
{
  const u = player({ items: { leftovers: 1 } });
  u.equipment = { rev: 1, teams: { display: { "6:normal": "leftovers", "25:normal": "leftovers" }, battle: { "143:normal": "leftovers" } } };
  assertEqual([...battleItems(u, "display", { env: ON })], [["6:normal", "leftovers"]], "duplicate on one team: only the first slot battles with it");
  assertEqual([...battleItems(u, "battle", { env: ON })], [["143:normal", "leftovers"]], "the other team uses the same unlock");
  assertEqual([...battleItems(u, "display", { env: { HELD_ITEMS_ENABLED: "1" } })], [], "battles capability off → no items");
}

// ------------------------------------------------------------------
section("Dashboard API: auth, flags, replay, stale tabs, concurrency, shop");
{
  const td = {};
  let env = { HELD_ITEMS_ENABLED: "1" };
  let saves = 0;
  const events = [];
  const api = createHeldItemHandlers({
    getTrainerData: () => td, lockUser, save: async () => { saves++; return { saved: true, note: "" }; }, getEnv: () => env,
    logEvent: (t, id, d) => events.push([t, d]), allowWrite: createRateLimiter({ max: 1000 }),
  });
  td[ID] = player();
  td[ID].cc = 20000;
  const authed = () => true;
  let n = 0;
  const rid = () => `req-${String(++n).padStart(8, "0")}`;

  assertEqual(api.view({ query: { id: ID }, isAuthorized: () => false }).status, 403, "no session → 403");
  assertEqual(api.view({ query: { id: "abc" }, isAuthorized: authed }).status, 400, "bad id → 400");
  assertEqual(api.view({ query: { id: "999999" }, isAuthorized: authed }).status, 404, "unknown player → 404");
  assertEqual(api.view({ query: { id: ID }, isAuthorized: authed }).body.starterPending, true, "view says the starter grant is pending (and grants nothing itself)");
  assertEqual(getQuantity(td[ID], "leftovers"), 0, "GET never writes");

  const off = await (async () => { const e = env; env = {}; const r = await api.claimStarter({ body: { id: ID, requestId: rid() }, isAuthorized: authed }); env = e; return r; })();
  assertEqual([off.status, off.body.code], [403, "disabled"], "writes refuse while switched off");
  assertEqual((await api.claimStarter({ body: { id: ID }, isAuthorized: authed })).status, 400, "writes need a requestId");

  const c1 = await api.claimStarter({ body: { id: ID, requestId: "claim-0001" }, isAuthorized: authed });
  assertEqual(c1.body.granted.length, 8, "claim-starter grants the eight");
  const c2 = await api.claimStarter({ body: { id: ID, requestId: "claim-0001" }, isAuthorized: authed });
  assertTrue(c2.body.replayed === true, "the same requestId replays");
  const c3 = await api.claimStarter({ body: { id: ID, requestId: "claim-0002" }, isAuthorized: authed });
  assertEqual(c3.body.granted, [], "a new claim grants nothing more");

  const view = () => api.view({ query: { id: ID }, isAuthorized: authed }).body;
  const equip = (o) => api.equip({ body: { id: ID, requestId: rid(), team: "display", pokeId: 6, variant: "normal", expectedRev: view().rev, ...o }, isAuthorized: authed });
  const e1 = await equip({ itemId: "leftovers" });
  assertTrue(e1.status === 200 && e1.body.teams.display[0].item === "leftovers", "equip works and returns the updated loadout");
  const stale = await equip({ itemId: "focus_sash", expectedRev: 0 });
  assertTrue(stale.status === 409 && stale.body.code === "stale" && stale.body.teams.display[0].item === "leftovers", "a stale tab gets 409 + the current loadout; nothing overwritten");
  const clause = await equip({ pokeId: 25, itemId: "leftovers" });
  assertTrue(clause.status === 409 && clause.body.code === "item_clause" && clause.body.holder === "6:normal", "Item Clause enforced server-side");
  const moved = await equip({ pokeId: 25, itemId: "leftovers", move: true });
  assertTrue(moved.status === 200 && moved.body.change.from === "6:normal", "move within the team works");
  assertEqual((await equip({ itemId: "leftovers", team: "nope" })).status, 400, "unknown team → 400");
  assertEqual((await equip({ itemId: { x: 1 } })).status, 400, "bad item type → 400");
  assertEqual((await api.equip({ body: { id: ID, requestId: rid(), team: "display", pokeId: 6, variant: "normal", itemId: "leftovers" }, isAuthorized: authed })).status, 400, "missing expectedRev → 400");

  // Concurrency: 5 tabs try to put Leftovers on 5 different Pokémon at once
  // with the same (fresh) revision. Exactly one wins; the rest see "stale".
  td[ID].displayedPokemon = [6, 25, 143, 94, 1].map((id) => ({ id, variant: "normal" }));
  for (const s of [94, 1]) td[ID].pokemon[s] = { normal: 1, shiny: 0 };
  await equip({ pokeId: 25, itemId: null });
  const rev = view().rev;
  const racers = await Promise.all([6, 25, 143, 94, 1].map((pokeId) => api.equip({ body: { id: ID, requestId: rid(), team: "display", pokeId, variant: "normal", itemId: "leftovers", expectedRev: rev }, isAuthorized: authed })));
  assertEqual(racers.filter((r) => r.status === 200).length, 1, "5 concurrent equips with the same revision: exactly one succeeds");
  assertTrue(racers.filter((r) => r.status === 409).every((r) => r.body.code === "stale"), "…the others get 'stale' (no duplicate holder)");
  assertEqual(Object.values(teamEquipment(td[ID], "display")).filter((x) => x === "leftovers").length, 1, "one holder of Leftovers on the team");
  // Double click: the same requestId twice concurrently → one change.
  const dbl = { id: ID, requestId: "dbl-00000001", team: "display", pokeId: 143, variant: "normal", itemId: "expert_belt", expectedRev: view().rev };
  const [d1, d2] = await Promise.all([api.equip({ body: dbl, isAuthorized: authed }), api.equip({ body: dbl, isAuthorized: authed })]);
  assertTrue(d1.status === 200 && d2.status === 200 && (d1.body.replayed || d2.body.replayed), "double click: one change, one replay");

  // Shop
  const buy = (itemId, requestId = rid()) => api.buy({ body: { id: ID, itemId, requestId }, isAuthorized: authed });
  assertEqual((await buy("leftovers")).body.code, "not_for_sale", "starter items aren't sold");
  const ccBefore = td[ID].cc;
  const b1 = await buy("charcoal", "buy-00000001");
  assertTrue(b1.status === 200 && td[ID].cc === ccBefore - 3000 && getQuantity(td[ID], "charcoal") === 1, "buying charges the catalog price once");
  const b2 = await buy("charcoal", "buy-00000001");
  assertTrue(b2.body.replayed && td[ID].cc === ccBefore - 3000, "a retried purchase never charges twice");
  assertEqual((await buy("charcoal")).body.code, "already_owned", "buying an owned unlock is refused");
  td[ID].cc = 100;
  const poor = await buy("eviolite");
  assertTrue(poor.body.code === "insufficient_cc" && td[ID].cc === 100 && getQuantity(td[ID], "eviolite") === 0, "not enough CC: nothing changes");
  assertEqual((await buy("choice_band")).status, 400, "deferred items can't be bought");
  env = { HELD_ITEMS_ENABLED: "1", HELD_ITEMS_SHOP_ENABLED: "0" };
  assertEqual((await buy("eviolite")).status, 403, "shop switched off → 403");
  env = { HELD_ITEMS_ENABLED: "1" };
  assertTrue(events.some(([t]) => t === "held_item_purchase") && events.some(([t]) => t === "held_item_equip"), "purchases and equips are logged (analytics)");
  assertTrue(saves > 0, "every change is saved through the injected save");

  // Rate limit
  const tight = createHeldItemHandlers({ getTrainerData: () => td, lockUser, save: async () => ({ saved: true, note: "" }), getEnv: () => env, allowWrite: createRateLimiter({ max: 2 }) });
  const rl = [];
  for (let i = 0; i < 3; i++) rl.push((await tight.claimStarter({ body: { id: ID, requestId: rid() }, isAuthorized: authed })).status);
  assertEqual(rl, [200, 200, 429], "writes are rate limited per player");

  // A failed save: change kept in memory, reply says so, replay doesn't re-apply.
  const flaky = createHeldItemHandlers({ getTrainerData: () => td, lockUser, save: async () => ({ saved: false, note: "delayed" }), getEnv: () => env, allowWrite: createRateLimiter({ max: 1000 }) });
  td[ID].cc = 50000;
  const f1 = await flaky.buy({ body: { id: ID, itemId: "magnet", requestId: "flaky-000001" }, isAuthorized: authed });
  const f2 = await flaky.buy({ body: { id: ID, itemId: "magnet", requestId: "flaky-000001" }, isAuthorized: authed });
  assertTrue(f1.body.saved === false && f2.body.replayed && td[ID].cc === 47000, "save failure: reported honestly; the retry replays (charged once)");
}

finish();
