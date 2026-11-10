// ==========================================================
// tests/megaCardsTeam.test.js — Mega Evolution Phase M1: virtual Mega cards,
// team validation, the battle boundary, and regression proofs that teams
// without Megas behave exactly as before (compared against verbatim copies
// of the pre-M1 production code).
// ==========================================================

import fs from "fs";
import { assertTrue, assertEqual, section, finish } from "./harness.js";

const G = await import("../config/generations.js");
const C = await import("../utils/speciesCatalog.js");
const { buildMegaCards, useMegaStone } = await import("../services/mega.js");
const { prepareTeamSelection, normalizeDisplayedTeam, megaBattleBoundary } = await import("../services/megaTeam.js");
const { toTeamObj } = await import("../utils/economyRules.js");
const { getMega, megaSpritePath } = await import("../utils/megas.js");
const { getTraining, resetLevelIfGone } = await import("../utils/training.js");
const { buildTeam, runBattle } = await import("../utils/battle/runBattle.js");
const { computeMetrics, normalizeProgression } = await import("../progression/achievements.js");
const { listAchievements } = await import("../catalog/achievements.js");
const { giftPokemon } = await import("../commands/gift.js");
const { bulkDonate } = await import("../utils/bulkDonate.js");

const ON = { MEGA_EVOLUTION_ENABLED: "1" };
const clone = (o) => JSON.parse(JSON.stringify(o));
const T0 = Date.UTC(2026, 10, 10, 12);
const base = () => ({
  id: "300000000000000001", name: "Card Tester", cc: 0, tp: 0,
  pokemon: { 6: { normal: 2, shiny: 1 }, 25: { normal: 1, shiny: 0 }, 150: { normal: 1, shiny: 0 }, 248: { normal: 0, shiny: 0 }, 384: { normal: 1, shiny: 0 } },
  training: { "6:normal": { exp: 125000 }, "6:shiny": { exp: 27000 }, "150:normal": { exp: 343000 } },
  items: { megastone_charizarditex: 1, megastone_charizarditey: 1, megastone_mewtwonitey: 1 },
  displayedPokemon: [{ id: 6, variant: "normal" }, { id: 25, variant: "normal" }],
});
const unlocked = () => {
  const u = base();
  for (const [line, stoneId, formId] of [["6:normal", "megastone_charizarditex", "mega-charizard-x"], ["6:normal", "megastone_charizarditey", "mega-charizard-y"]]) useMegaStone(u, { line, stoneId, formId, now: T0 }, { env: ON });
  u.megaUnlocks["248:normal"] = { forms: { "mega-tyranitar": { at: T0, stone: "megastone_tyranitarite" } }, preferred: null }; // dormant line (0 copies)
  return u;
};

section("Mega cards: separate, virtual, sharing the base Level");
let u = unlocked();
const countsBefore = clone(u.pokemon);
const cards = buildMegaCards(u, { env: ON });
const byId = Object.fromEntries(cards.map((c) => [c.cardId, c]));
const cx = byId["6:normal/mega-charizard-x"], cy = byId["6:normal/mega-charizard-y"];
assertTrue(!!cx && !!cy && cx.state === "active" && cy.state === "active", "Mega Charizard X and Y are two separate active cards");
assertEqual([cx.level, cy.level], [getTraining(u, 6, "normal").level, getTraining(u, 6, "normal").level], "both share the normal Charizard line's Level (50)");
assertEqual([cx.species, cx.variant, cx.line, cx.formId, cx.unlocked], [6, "normal", "6:normal", "mega-charizard-x", true], "a card references species, line, form and unlock status");
assertEqual([cx.types, cx.baseStats, cx.ability.name, cx.ability.verified], [["Fire", "Dragon"], { hp: 78, atk: 130, def: 111, spa: 130, spd: 85, spe: 100 }, "Tough Claws", true], "correct Mega stats, typing and ability metadata");
assertEqual(cx.sprite, "/public/sprites/pokemon/mega/normal/mega-charizard-x.gif", "the card uses the Mega sprite (normal line)");
assertEqual(byId["6:shiny/mega-charizard-x"]?.sprite, "/public/sprites/pokemon/mega/shiny/mega-charizard-x.gif", "a shiny-line card uses the shiny Mega sprite");
assertTrue(cards.every((c) => c.sprite !== `/public/sprites/pokemon/normal/${c.species}.gif` && c.sprite !== `/public/sprites/pokemon/shiny/${c.species}.gif`), "no card ever shows the base species sprite");
assertTrue(cards.every((c) => c.battle.battleReady === false && c.battle.reasons.includes("Mega battles are switched off")), "M2: with MEGA_BATTLES_ENABLED unset no card is battle-ready (battles are opt-in)");
const battleOn = buildMegaCards(u, { env: { ...ON, MEGA_BATTLES_ENABLED: "1" } });
assertTrue(battleOn.find((c) => c.cardId === "6:normal/mega-charizard-x").battle.battleReady === true, "M2: with battles switched on, a verified X/Y Mega card is battle-ready");
assertTrue(byId["6:normal/mega-charizard-x"].teamSelectable && !byId["6:normal/mega-charizard-x"].onTeam, "an active card is team-selectable");
const ty = byId["248:normal/mega-tyranitar"];
assertEqual([ty.state, ty.level, ty.teamSelectable], ["dormant", null, false], "an unlock on a line with zero copies is a dormant card: kept, no Level, not selectable");
assertEqual(u.pokemon, countsBefore, "building cards changes no Pokémon counts");
assertTrue(!Object.keys(u.pokemon).some((k) => /mega/.test(k)) && !("mega-charizard-x" in u.pokemon), "Mega cards create no ownership records");
const keys = [...new Set(listAchievements().map((a) => `${a.metric.kind}:${a.metric.key}`))];
const plain = base(); normalizeProgression(plain); const withU = clone(u); normalizeProgression(withU);
assertEqual(computeMetrics(withU, keys), computeMetrics(plain, keys), "Pokédex and every achievement metric are identical with and without Mega cards");

section("Locked previews and blocked forms");
assertTrue(byId["6:shiny/mega-charizard-x"]?.state === "locked" && byId["6:shiny/mega-charizard-x"].canUnlock === false, "shiny Charizard: X preview locked (no Charizardite X left)");
assertTrue(byId["150:normal/mega-mewtwo-y"]?.canUnlock === true && byId["150:normal/mega-mewtwo-x"]?.canUnlock === false, "Mewtwo X and Y are separate unlockable previews; only Y has a stone");
assertTrue(!cards.some((c) => c.formId === "mega-rayquaza"), "Mega Rayquaza (blocked) is never offered although Rayquaza is owned");
assertTrue(!cards.some((c) => getMega(c.formId).status !== "eligible" && c.state !== "blocked"), "no blocked form is rendered as available");
assertTrue(buildMegaCards(u, { env: { ...ON, MEGA_UNLOCKS_ENABLED: "0" } }).filter((c) => c.state === "locked").every((c) => c.canUnlock === false), "with unlocking switched off no preview offers an unlock");
assertTrue(!buildMegaCards({ pokemon: { 658: { normal: 1, shiny: 0 } } }, { env: ON }).length, "species of unreleased generations get no previews (generation gates still apply)");

section("Preferred form");
u.megaUnlocks["6:normal"].preferred = "mega-charizard-y";
assertEqual(buildMegaCards(u, { env: ON }).filter((c) => c.preferred).map((c) => c.cardId), ["6:normal/mega-charizard-y"], "the preferred form is flagged on its card");

section("Dormant → active again when the line is re-acquired");
const d = unlocked();
d.pokemon[6].normal = 0; resetLevelIfGone(d, 6, "normal");
assertTrue(buildMegaCards(d, { env: ON }).filter((c) => c.line === "6:normal" && c.unlocked).every((c) => c.state === "dormant" && !c.teamSelectable), "after losing every normal Charizard the X/Y cards are dormant");
d.pokemon[6].normal = 1;
assertTrue(buildMegaCards(d, { env: ON }).filter((c) => c.line === "6:normal" && c.unlocked).every((c) => c.state === "active"), "owning one again reactivates them automatically");

section("Gifts and donations never move or copy unlocks");
const g = unlocked();
const recipient = { pokemon: {} };
assertEqual(giftPokemon(g, recipient, "6", "Charizard", 1), null, "gift one normal Charizard");
assertTrue(!("megaUnlocks" in recipient) && recipient.pokemon[6].normal === 1, "the recipient receives one Charizard and no unlock");
assertEqual(Object.keys(g.megaUnlocks["6:normal"].forms), ["mega-charizard-x", "mega-charizard-y"], "the sender keeps both unlocks");
assertTrue(!buildMegaCards(recipient, { env: ON }).some((c) => c.unlocked), "the recipient has no unlocked Mega cards (only an unlock preview)");
const pokemonData = JSON.parse(fs.readFileSync(new URL("../pokemonData.json", import.meta.url), "utf8"));
const dn = unlocked();
const donated = bulkDonate({ user: dn, mode: "duplicates", items: [{ pokeId: 6, variant: "normal", count: 1 }], pokemonData, economy: { ccByTier: {}, shinyDustByTier: {}, normalDustWeeklyCap: 0, normalDustChanceByTier: {}, rollDust: () => 0 }, isOnTeam: () => false });
assertTrue(!donated?.error && dn.pokemon[6].normal === 1, "a duplicate Charizard is donated");
assertEqual(JSON.stringify(dn.megaUnlocks), JSON.stringify(unlocked().megaUnlocks), "donating leaves unlocks untouched (not duplicated, not removed)");

section("Team: one Mega, base/Mega exclusion, unlocked, owned, gated");
u = unlocked();
const ok = (team, env = ON) => prepareTeamSelection(u, team, { env });
let t = ok([{ id: 6, variant: "normal", mega: "mega-charizard-x" }, { id: 25, variant: "normal" }]);
assertEqual(t, { ok: true, team: [{ id: 6, variant: "normal", mega: "mega-charizard-x" }, { id: 25, variant: "normal" }] }, "a Mega card takes one slot; the team keeps line identity and the form");
assertEqual(ok([{ id: 6, variant: "normal", mega: "mega-charizard-x" }, { id: 6, variant: "shiny", mega: "mega-charizard-x" }]).code, "too_many_megas", "two Mega cards are refused");
assertEqual(ok([{ id: 6, variant: "normal" }, { id: 6, variant: "normal", mega: "mega-charizard-y" }]).code, "base_and_mega", "a base Pokémon and its own Mega are refused");
assertEqual(ok([{ id: 6, variant: "shiny" }, { id: 6, variant: "normal", mega: "mega-charizard-x" }]).ok, true, "the OTHER line of the same species may sit next to a Mega (normal and shiny are separate lines)");
assertEqual(ok([{ id: 150, variant: "normal", mega: "mega-mewtwo-x" }]).code, "not_unlocked", "a locked Mega can't be selected");
assertEqual(ok([{ id: 6, variant: "shiny", mega: "mega-charizard-x" }]).code, "not_unlocked", "the normal line's unlock doesn't work for the shiny line");
assertEqual(ok([{ id: 248, variant: "normal", mega: "mega-tyranitar" }]).code, "unowned", "a dormant Mega (base line absent) can't be selected");
u.megaUnlocks["384:normal"] = { forms: { "mega-rayquaza": { at: T0, stone: null } }, preferred: null };
assertEqual(ok([{ id: 384, variant: "normal", mega: "mega-rayquaza" }]).code, "blocked", "a blocked Mega can't be selected even with a (bad-data) unlock record");
assertEqual(ok([{ id: 25, variant: "normal", mega: "mega-charizard-x" }]).code, "wrong_species", "a form of another species is refused");
assertEqual(ok([{ id: 6, variant: "normal", mega: 5 }]).code, "bad_mega", "a malformed mega field is refused");
assertEqual(ok([{ id: 6, variant: "normal", mega: "mega-charizard-x" }], {}).code, "disabled", "Mega teams refused while the feature is off");
assertEqual(ok([{ id: 6, variant: "normal", mega: "mega-charizard-x" }], { ...ON, MEGA_TEAMS_ENABLED: "0" }).code, "disabled", "…and while only team selection is switched off");
assertEqual(ok([{ id: 6, variant: "normal" }, { id: 25, variant: "normal" }], {}).ok, true, "teams without Megas work with the feature off");
assertEqual(ok(Array.from({ length: 7 }, (_, i) => i + 1)).code, "bad_size", "7 unique slots: refused by the size rule before ownership, as before");

section("Regression: identical results to the pre-M1 code for teams without Megas");
// Verbatim copies of the production (5157cfe6) code paths that M1 replaced.
function oldNormalizeTeam(user) {
  if (!Array.isArray(user.displayedPokemon)) user.displayedPokemon = [];
  if (user.displayedPokemon.length && typeof user.displayedPokemon[0] !== "object") {
    user.displayedPokemon = user.displayedPokemon.map((pid) => ({ id: Number(pid), variant: "normal" })).filter((t) => Number.isInteger(t.id));
  }
  user.displayedPokemon = user.displayedPokemon
    .map((t) => ({ id: Number(t?.id), variant: t?.variant === "shiny" ? "shiny" : "normal" }))
    .filter((t) => Number.isInteger(t.id))
    .filter((t) => { const owned = user.pokemon?.[t.id]; if (!owned) return false; return Number(owned?.[t.variant] || 0) > 0; });
  return user.displayedPokemon;
}
function oldPrepare(u, team) {
  const ownsVariant = (pid, variant) => { const p = u.pokemon?.[pid]; if (!p) return false; return (p[variant] ?? 0) > 0; };
  const parsed = team.map(toTeamObj).filter(Boolean);
  const dedupMap = new Map();
  for (const slot of parsed) { const key = `${slot.id}:${slot.variant}`; if (!dedupMap.has(key)) dedupMap.set(key, slot); }
  const normalized = [...dedupMap.values()];
  if (normalized.length === 0 || normalized.length > 6) return { ok: false, error: "Team must be 1–6 unique slots (unique = Pokémon + variant)." };
  const unowned = normalized.filter((slot) => !ownsVariant(slot.id, slot.variant));
  if (unowned.length) return { ok: false, error: `Unowned Pokémon slots: ${unowned.map((s) => `#${s.id} (${s.variant})`).join(", ")}` };
  return { ok: true, team: normalized };
}
let seed = 7;
const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2 ** 31; return seed % n; };
const pick = () => [
  () => rnd(30) + 1, () => String(rnd(30) + 1), () => ({ id: rnd(30) + 1, variant: ["normal", "shiny", "SHINY", undefined, "x"][rnd(5)] }),
  () => ({ id: rnd(30) + 1, shiny: rnd(2) === 1 }), () => ({ id: "abc" }), () => null, () => 1.5, () => [3], () => ({ id: rnd(30) + 1, variant: "normal", extra: 1 }),
][rnd(9)]();
let teamDiffs = 0, normDiffs = 0;
for (let i = 0; i < 2000; i++) {
  const owner = { pokemon: Object.fromEntries(Array.from({ length: 30 }, (_, k) => [k + 1, { normal: rnd(3), shiny: rnd(2) }])) };
  const team = Array.from({ length: rnd(9) }, pick);
  const a = oldPrepare(owner, team), b = prepareTeamSelection(owner, team, { env: {} });
  if (a.ok !== b.ok || (a.ok ? JSON.stringify(a.team) !== JSON.stringify(b.team) : a.error !== b.error)) teamDiffs++;
  const stored = Array.from({ length: rnd(8) }, pick);
  const o1 = { ...clone(owner), displayedPokemon: clone(stored) }, o2 = { ...clone(owner), displayedPokemon: clone(stored) };
  if (JSON.stringify(oldNormalizeTeam(o1)) !== JSON.stringify(normalizeDisplayedTeam(o2))) normDiffs++;
}
assertEqual([teamDiffs, normDiffs], [0, 0], "2,000 random teams: team validation and stored-team normalization are identical to the pre-M1 code (results and error messages)");

section("Stored team: Mega selection survives normalization only when valid");
u = unlocked();
u.displayedPokemon = [{ id: 6, variant: "normal", mega: "mega-charizard-x" }, { id: 25, variant: "normal", mega: "mega-pikachu" }, { id: 150, variant: "normal", mega: "mega-mewtwo-x" }];
normalizeDisplayedTeam(u);
assertEqual(u.displayedPokemon, [{ id: 6, variant: "normal", mega: "mega-charizard-x" }, { id: 25, variant: "normal" }, { id: 150, variant: "normal" }], "a valid Mega slot is kept; unknown or not-unlocked Mega fields are dropped (slot stays as base)");
const saved = JSON.parse(JSON.stringify(u));
normalizeDisplayedTeam(saved);
assertEqual(saved.displayedPokemon, u.displayedPokemon, "the Mega team survives serialization and re-normalization");
const v21 = clone(u); oldNormalizeTeam(v21);
assertEqual(v21.displayedPokemon, [{ id: 6, variant: "normal" }, { id: 25, variant: "normal" }, { id: 150, variant: "normal" }], "rollback: v21's normalizer strips the Mega field and keeps the base slot");

section("Battle boundary: a Mega team battles as base forms, nothing persistent changes");
const A = unlocked();
A.displayedPokemon = [{ id: 6, variant: "normal", mega: "mega-charizard-x" }, { id: 25, variant: "normal" }];
const B = { id: "B", name: "B", pokemon: { 19: { normal: 1, shiny: 0 } }, training: {}, displayedPokemon: [{ id: 19, variant: "normal" }] };
const bound = megaBattleBoundary(A, { env: ON });
assertEqual([bound.megaBattles, bound.requestedMega, bound.battlesAs.map((s) => s.form)], [false, "mega-charizard-x", ["base", "base"]], "the boundary reports: Mega requested, battled as base (MEGA_BATTLES_ENABLED not set)");
const boundOn = megaBattleBoundary(A, { env: { ...ON, MEGA_BATTLES_ENABLED: "1" } });
assertEqual([boundOn.megaBattles, boundOn.battlesAs.map((s) => s.form)], [true, ["mega-charizard-x", "base"]], "M2: with battles switched on, the unlocked Mega slot battles as Mega Charizard X");
assertEqual(buildTeam(A).map((m) => [m.speciesId, m.variant, "megaForm" in m]), [[6, "normal", false], [25, "normal", false]], "buildTeam gives the battle engine base Charizard (no Mega form, no Mega stats)");
const megaBefore = JSON.stringify(A.megaUnlocks), pokemonBefore = JSON.stringify(A.pokemon), itemsBefore = JSON.stringify(A.items), teamBefore = JSON.stringify(A.displayedPokemon);
let res, threw = null;
try { res = runBattle({ trainerData: { A, B }, challengerId: "A", defenderId: "B", mode: "open", seed: 42, now: new Date(T0) }); } catch (e) { threw = e; }
assertTrue(threw === null && res?.ok, "a battle with a Mega card on the team runs without errors");
assertEqual(res.sides[0].members.map((m) => m.speciesId), [6, 25], "the battle used base species ids");
assertEqual([JSON.stringify(A.megaUnlocks), JSON.stringify(A.pokemon), JSON.stringify(A.items), JSON.stringify(A.displayedPokemon)], [megaBefore, pokemonBefore, itemsBefore, teamBefore], "unlocks, counts, items and the stored Mega team are untouched by the battle");
const plainA = clone(A); plainA.displayedPokemon = [{ id: 6, variant: "normal" }, { id: 25, variant: "normal" }];
const resPlain = runBattle({ trainerData: { A: plainA, B: clone(B) }, challengerId: "A", defenderId: "B", mode: "open", seed: 42, now: new Date(T0) });
assertEqual(JSON.stringify(res.result.log), JSON.stringify(resPlain.result.log), "the battle log is identical to the same team without the Mega card (no accidental transformation)");
assertTrue(megaSpritePath("mega-charizard-x") !== "", "Mega sprite path resolves (battle rendering is covered by tests/megaBattle.test.js)");

finish();
