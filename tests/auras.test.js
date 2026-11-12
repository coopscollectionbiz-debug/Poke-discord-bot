// ==========================================================
// tests/auras.test.js — Auras: the catalog, unlocks (trainers, challenge
// wins, achievements, backfill), equipping, what the renderer draws, the CC
// shop, admin grants, and art Auras end to end (PNG decode → backdrop → card).
// Synthetic players only; art comes from tests/fixtures/auras.
// ==========================================================

import path from "path";
import { fileURLToPath } from "url";
import { loadImage, createCanvas } from "@napi-rs/canvas";
import fs from "fs";
import { assertTrue, assertEqual, section, finish } from "./harness.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
process.env.AURA_ART_DIR = path.join(HERE, "fixtures", "auras"); // gymBlaine + shopShimmer have art

const { AURAS, getAura, SHOP_PRICES, TIER_AURA } = await import("../catalog/auras.js");
const A = await import("../services/auras.js");
const { grantTrainer, revokeTrainer } = await import("../services/assets.js");
const { createNewUser, validateUserSchema } = await import("../utils/userSchema.js");
const { CHALLENGES } = await import("../utils/challenge/roster.js");
const { getAchievement } = await import("../catalog/achievements.js");
const { parseChange, applyChange, KINDS, BULK_KINDS } = await import("../services/adminChanges.js");
const { decodePng, loadAuraArt } = await import("../utils/render/auraArt.js");
const { hasBackdrop, backdropTint, createBackdrop, drawTierSky, regionBackdrop } = await import("../utils/render/trainerBackdrop.js");
const { trainerCardView, renderTrainerCard } = await import("../utils/render/trainerCard.js");

const player = (trainers = [], extra = {}) => Object.assign(createNewUser("42", "Tester"), { trainers: [...trainers], displayedTrainer: trainers[0] ?? null }, extra);

section("Catalog");
{
  const ids = AURAS.map((a) => a.id);
  assertEqual(new Set(ids).size, ids.length, "Aura ids are unique");
  assertTrue(ids.every((id) => /^[a-z][A-Za-z0-9]*$/.test(id)), "ids are camelCase (they name art folders)");
  assertTrue(AURAS.filter((a) => a.kind === "shop").every((a) => SHOP_PRICES.includes(a.price)), "every shop Aura costs 25k, 50k or 100k CC");
  assertTrue(AURAS.filter((a) => a.challenge).every((a) => CHALLENGES[a.challenge]), "every challenge Aura names a real challenge");
  const e4 = CHALLENGES.elite4.opponents.map((o) => o.key);
  assertEqual(AURAS.filter((a) => a.kind === "elite4").map((a) => a.opponent).sort(), [...e4].sort(), "one Aura per Elite Four member");
  assertEqual(AURAS.filter((a) => a.kind === "gym").length, Object.values(CHALLENGES).filter((c) => c.kind === "gym").length, "one Aura per Gym Leader");
  assertTrue(AURAS.filter((a) => a.achievement).every((a) => getAchievement(a.achievement)), "every milestone Aura names a real achievement");
  assertEqual(Object.values(TIER_AURA).map((id) => getAura(id).look), ["epic", "legendary", "mythic"], "the tier Auras draw the tier backdrops");
}

section("Unlocks: trainers (stored, permanent, backfilled)");
{
  const u = player();
  assertTrue(grantTrainer(u, "acerola.png"), "grant an Epic trainer");
  assertTrue(u.auras.owned.tierEpic >= 0, "…stores the Epic Aura");
  grantTrainer(u, "youngster.png");
  assertEqual(Object.keys(u.auras.owned), ["tierEpic"], "a Common trainer unlocks nothing");
  revokeTrainer(u, "acerola.png");
  assertTrue(A.ownsAura(u, "tierEpic"), "giving the trainer away keeps the Aura");

  const old = player(["cynthia-masters.png", "alder.png"]); // owned before Auras existed
  assertEqual(old.auras, undefined, "an old record has no Aura field");
  const fixed = validateUserSchema(old, "42", "Tester");
  assertEqual(Object.keys(fixed.auras.owned).sort(), ["tierLegendary", "tierMythic"], "loading backfills the tier Auras of trainers owned");
  const plain = validateUserSchema(player(["youngster.png"]), "43", "Tester");
  assertEqual(plain.auras, undefined, "loading never creates the field for a player with nothing to store");
}

section("Unlocks: challenge wins and achievements (proved by the record)");
{
  const u = player([], { challenge: { won: { blaine: 1, elite4: 3 } }, ach: { col_region_kanto_full: 9 } });
  const owned = A.ownedAuraIds(u);
  assertTrue(owned.has("gymBlaine"), "a cleared gym proves its Aura");
  assertTrue(["e4Lorelei", "e4Bruno", "e4Agatha", "e4Lance"].every((id) => owned.has(id)), "clearing the Elite Four proves all four members");
  assertTrue(owned.has("milestoneKanto"), "an unlocked achievement proves its milestone Aura");
  assertTrue(!owned.has("gymBrock") && !owned.has("champBlue"), "nothing else");

  const run = player();
  assertEqual(A.grantChallengeAuras(run, "elite4", ["lorelei", "bruno"]), ["e4Lorelei", "e4Bruno"], "a lost Elite Four run still stores the members beaten");
  assertEqual(A.grantChallengeAuras(run, "brock", []), [], "a lost gym stores nothing");
  assertEqual(A.grantChallengeAuras(run, "red", ["red"]), ["red"], "beating Red");
  const src = fs.readFileSync(path.join(HERE, "..", "utils", "challenge", "runChallenge.js"), "utf8");
  assertEqual((src.match(/beaten:? /g) ?? []).length >= 2 && (src.match(/grantChallengeAuras\(/g) ?? []).length, 1, "both settle paths (single fights and the Elite Four run) pass the beaten list to one grant");
}

section("Equipping and what the renderer draws");
{
  const u = player(["alain.png", "cynthia-masters.png"], { challenge: { won: { blaine: 1, brock: 1 } } });
  A.syncTierAuras(u);
  assertEqual(A.equippedAura(u), "auto", "Auto by default");
  assertEqual(A.auraLook(u), "rare", "Auto: the displayed trainer's own tier (Rare draws nothing)");
  assertEqual(A.equipAura(u, "tierMythic").ok, true, "equip an owned tier Aura");
  assertEqual(A.auraLook(u), "mythic", "…a Rare trainer now wears the Mythic backdrop");
  assertEqual(A.equipAura(u, "gymBrock").error, "This Aura's art isn't ready yet.", "an owned Aura without art can't be equipped");
  assertEqual(A.equipAura(u, "gymBlaine").ok, true, "an owned Aura with art can");
  assertEqual(A.auraLook(u), "art:gymBlaine", "…and is drawn as art");
  assertEqual(A.equipAura(u, "tierLegendary").status, 400, "an Aura not owned can't be equipped");
  assertEqual(A.equipAura(u, "nope").status, 404, "an unknown id is refused");
  A.equipAura(u, "none");
  assertEqual(A.auraLook(u), null, "None draws nothing");
  u.auras.equipped = "gymBrock"; // e.g. art removed after it was equipped
  assertEqual(A.auraLook(u), "rare", "an equipped Aura that can't be drawn falls back to Auto");
  assertEqual(A.auraLook(player()), null, "no trainer, no Aura");
}

section("CC shop");
{
  const u = player([], { cc: 30_000 });
  assertEqual(A.buyAura(u, "shopStarfield").error, "That Aura isn't for sale yet.", "no art, not for sale");
  assertEqual(A.buyAura(u, "gymBlaine").status, 404, "only shop Auras are sold");
  const r = A.buyAura(u, "shopShimmer");
  assertEqual([r.ok, r.cost, u.cc, A.ownsAura(u, "shopShimmer")], [true, 25_000, 5_000, true], "buying charges the price and grants it");
  assertEqual(A.buyAura(u, "shopShimmer").error, "You already own this Aura.", "no double buy");
  assertEqual(A.buyAura(player([], { cc: 100 }), "shopShimmer").error, "Requires 25,000 CC", "not enough CC");
  const view = A.auraView(player());
  assertEqual(view.auras.filter((a) => a.kind === "shop").map((a) => a.id), ["shopShimmer"], "the tab lists only shop Auras that have art");
  assertEqual(view.equipped, "auto", "view: Auto");
}

section("Events and admin grants");
{
  assertTrue(KINDS.includes("aura") && BULK_KINDS.includes("aura"), "Auras can be granted one by one and in bulk");
  const p = parseChange({ kind: "aura", op: "add", auraId: "eventWinterfest" });
  assertTrue(p.ok, "parse an event Aura grant");
  const u = player();
  assertTrue(applyChange(u, p.change).ok && A.ownsAura(u, "eventWinterfest"), "grant it");
  assertTrue(!applyChange(u, p.change).ok, "a second grant is skipped");
  const rm = parseChange({ kind: "aura", op: "remove", auraId: "eventWinterfest" }).change;
  assertTrue(applyChange(u, rm).ok && !A.ownsAura(u, "eventWinterfest"), "remove a stored Aura");
  const proved = player([], { challenge: { won: { blaine: 1 } } });
  assertTrue(!applyChange(proved, parseChange({ kind: "aura", op: "remove", auraId: "gymBlaine" }).change).ok, "an Aura the record proves can't be removed");
  assertEqual(parseChange({ kind: "aura", op: "add", auraId: "x" }).ok, false, "unknown Aura refused");
  const ev = getAura("eventSpooky");
  ev.retired = true; // simulate the event ending (catalog objects are frozen per array, not per entry)
  assertEqual(A.grantAura(player(), "eventSpooky"), false, "a retired event Aura is never granted again");
  assertTrue(!A.auraView(player()).auras.some((a) => a.id === "eventSpooky"), "…nor listed to those without it");
  ev.retired = false;
}

section("Art: PNG decode, backdrop, card");
{
  const file = path.join(process.env.AURA_ART_DIR, "gymBlaine", "back.png");
  const mine = decodePng(fs.readFileSync(file));
  const ref = await loadImage(file);
  const c = createCanvas(ref.width, ref.height);
  c.getContext("2d").drawImage(ref, 0, 0);
  const theirs = c.getContext("2d").getImageData(0, 0, ref.width, ref.height).data;
  assertEqual([mine.width, mine.height], [ref.width, ref.height], "decoded size");
  let diff = 0;
  for (let i = 0; i < theirs.length; i++) if (mine.data[i] !== theirs[i]) diff++;
  assertEqual(diff, 0, "the sync decoder matches the canvas decoder pixel for pixel");

  const art = loadAuraArt("gymBlaine");
  assertEqual([art.layers.back.fw, art.layers.back.fh, art.layers.back.n], [90, 105, 24], "24 frames of 90×105");
  assertEqual(loadAuraArt("shopStarfield"), null, "no folder, no art");
  assertTrue(hasBackdrop("art:gymBlaine") && !hasBackdrop("art:shopStarfield"), "hasBackdrop knows art looks");
  assertEqual(backdropTint("art:gymBlaine"), "#f97316", "tint from the palette");
  assertEqual(hasBackdrop("art:gymblaine"), false, "art ids are case-sensitive (never lower-cased)");

  const bd = createBackdrop({ tier: "art:gymBlaine", gridW: 100, gridH: 120, mask: new Uint8Array(12000), halo: { cx: 50 }, floorRow: 110, frames: 24 });
  const lit = (f) => { const d = bd.frame(f).getContext("2d").getImageData(0, 0, 100, 120).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n; };
  assertTrue(lit(0) > 40, "a frame draws the art");
  assertTrue(bd.frame(0) !== bd.frame(6), "frames step through the sheet");
  const sky = createCanvas(40, 40);
  assertTrue(drawTierSky(sky.getContext("2d"), "art:gymBlaine", { x: 0, y: 0, w: 40, h: 40 }), "the art's sky is drawn");
  const region = regionBackdrop({ tier: "art:gymBlaine", rect: { x: 0, y: 0, w: 400, h: 200 }, u: 2, occupied: () => false, from: [0, 200], to: [400, 0], floor: 190, frames: 24, variant: "row" });
  assertTrue(region && region.tint === "#f97316", "regions (VS halves, playback rows) take art looks, falling back to the panel art without a row.png");

  const u = player(["alain.png"], { challenge: { won: { blaine: 1 } } });
  const trainer = { name: "Alain", tier: "rare" };
  const plain = await renderTrainerCard(trainerCardView(u, { displayName: "T", trainer }));
  A.equipAura(u, "gymBlaine");
  const v = trainerCardView(u, { displayName: "T", trainer });
  assertEqual(v.aura, "art:gymBlaine", "the trainer card view carries the equipped Aura");
  const withAura = await renderTrainerCard(v);
  assertTrue(Buffer.compare(plain, withAura) !== 0, "…and the card draws it (a Rare trainer had no backdrop before)");
}

finish();
