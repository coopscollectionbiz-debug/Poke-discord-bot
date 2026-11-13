// ==========================================================
// tests/megaPresentation.test.js — Mega Evolution Phase M3: every player-
// facing surface shows the same, validated form.
//
// /showteam, the inspect card, the trainer card, the EXP card, battle
// images, the leaderboard and the dashboard cards all follow the battle
// engine's fail-closed resolution (services/megaTeam.js resolveBattleMega):
// a slot appears as a Mega only when it would battle as one. Sprites come
// from the Mega manifest and never fall back to base-form art. Megas never
// touch Pokédex counts. With Mega off nothing changes (the pixel gate in
// tools/dev/visual-regression.mjs covers the images themselves).
// ==========================================================

import { assertTrue, assertEqual, section, finish } from "./harness.js";

const { createNewUser } = await import("../utils/userSchema.js");
const { allMegas, getMega, megaSpriteRecord } = await import("../utils/megas.js");
const ZA = await import("../config/megaBattleProfiles.js");
const { spriteFileFor, loadStaticSprite } = await import("../utils/render/sprites.js");
const { loadAnimatedSprite, renderBattleFrame } = await import("../utils/battle/render.js");
const { buildTeamView, buildShowcaseView, slotView } = await import("../utils/render/teamView.js");
const { normalizeBox } = await import("../services/box.js");
const { normalizeShowcase } = await import("../services/showcaseTeam.js");
// Live records get their Showcase at load (filled once from the Casual team).
const launched = (u) => { normalizeBox(u); normalizeShowcase(u); return u; };
const { renderShowteam } = await import("../utils/render/showteam.js");
const { renderInspectCard } = await import("../utils/render/inspectCard.js");
const { trainerCardView, renderTrainerCard, TRAINER_CARD_SIZE } = await import("../utils/render/trainerCard.js");
const { expView, renderExpCard } = await import("../utils/render/expCard.js");
const { buildShowteamComponents } = await import("../commands/showteam.js");
const { runBattle, buildTeam } = await import("../utils/battle/runBattle.js");
const { leaderboardView } = await import("../utils/render/leaderboardCard.js");
const { nationalCompletion, dexProgress } = await import("../utils/render/dexProgress.js");
const { buildMegaCards } = await import("../services/mega.js");
const { createMegaHandlers } = await import("../services/megaApi.js");
const D = await import("../utils/megaDisplay.js");

const OFF = {};
const TEAMS = { MEGA_EVOLUTION_ENABLED: "1" }; // cards + Teams, battles off
const ON = { MEGA_EVOLUTION_ENABLED: "1", MEGA_BATTLES_ENABLED: "1" };
const quiet = console.warn;
console.warn = () => {};

/** team: [[species, variant, level, megaFormId?]]; extra: [[species, variant, formId]] unlocked but not on the Team. */
function player(id, team, extra = []) {
  const u = createNewUser(id, `P${id}`);
  u.training = {};
  u.megaUnlocks = {};
  const unlock = (s, v, f) => {
    u.megaUnlocks[`${s}:${v}`] ??= { forms: {}, preferred: null };
    u.megaUnlocks[`${s}:${v}`].forms[f] = { at: 1, stone: null };
  };
  for (const [s, v, level, mega] of team) {
    u.pokemon[s] ??= { normal: 0, shiny: 0 };
    u.pokemon[s][v] += 1;
    u.training[`${s}:${v}`] = { exp: level ** 3 };
    if (mega) unlock(s, v, mega);
  }
  for (const [s, v, f] of extra) unlock(s, v, f);
  u.displayedPokemon = team.map(([s, v, , mega]) => (mega ? { id: s, variant: v, mega } : { id: s, variant: v }));
  return u;
}
const strip = (u) => ({ ...u, displayedPokemon: u.displayedPokemon.map(({ id, variant }) => ({ id, variant })) });
const pngSize = (b) => ({ w: b.readUInt32BE(16), h: b.readUInt32BE(20) });

// ----------------------------------------------------------
section("Sprite resolution: Mega manifest only, never base-form art");
assertEqual(spriteFileFor("mega-charizard-x", "normal"), "sprites/pokemon/mega/normal/mega-charizard-x.gif", "Mega normal sprite comes from the Mega manifest");
assertEqual(spriteFileFor("mega-charizard-x", "shiny"), "sprites/pokemon/mega/shiny/mega-charizard-x.gif", "Mega shiny sprite is its own file");
assertEqual(spriteFileFor("mega-charizard-x", "grayscale"), "sprites/pokemon/mega/grayscale/mega-charizard-x.gif", "Mega fainted (grayscale) sprite is its own file");
assertTrue(spriteFileFor("mega-charizard-x", "normal") !== spriteFileFor("mega-charizard-y", "normal"), "X and Y resolve to different sprites");
assertEqual(spriteFileFor(6, "normal"), "sprites/pokemon/normal/6.gif", "species sprites resolve exactly as before");
const noSprite = allMegas().find((f) => !megaSpriteRecord(f.id));
assertTrue(!!noSprite && spriteFileFor(noSprite.id, "normal") === null, `a Mega without a sprite (${noSprite?.name}) resolves to nothing, not to its base form`);
assertTrue((await loadStaticSprite(noSprite.id, "normal")) === null && (await loadAnimatedSprite(noSprite.id, "normal")) === null, "…so the static and animated loaders return null (callers draw the placeholder)");
const sx = await loadStaticSprite("mega-charizard-x", "normal");
const ss = await loadStaticSprite("mega-charizard-x", "shiny");
const sg = await loadStaticSprite("mega-charizard-x", "grayscale");
assertTrue(!!sx && !!ss && !!sg, "Mega normal, shiny and grayscale sprites load from disk");
const anim = await loadAnimatedSprite("mega-charizard-x", "shiny");
assertTrue(!!anim && anim.width > 0, "the animated loader reads mega/shiny/<form>.gif");

// ----------------------------------------------------------
section("Team view: a slot shows as a Mega only when it battles as one");
const ash = player("300000000000000001", [[6, "normal", 60, "mega-charizard-x"], [25, "normal", 40], [150, "normal", 70]]);
const v = buildTeamView(ash, { displayName: "Ash", env: ON });
const s1 = v.slots[0];
assertEqual([s1.name, s1.spriteId, s1.id, s1.mega?.formId, s1.mega?.shortName], ["Mega Charizard X", "mega-charizard-x", 6, "mega-charizard-x", "Charizard X"], "slot 1: Mega name, Mega sprite id, base Pokédex number");
assertEqual(s1.types, ["Fire", "Dragon"], "slot 1 shows the Mega's types (Charizard X is Fire/Dragon)");
assertEqual(s1.level, buildTeamView(strip(ash), { env: ON }).slots[0].level, "the Mega shares its base line's Level");
const base = buildTeamView(strip(ash), { env: ON }).slots[0];
assertTrue(s1.stats.atk > base.stats.atk && s1.stats.hp === base.stats.hp, "stats at Level use the Mega's base stats (Attack up, HP unchanged)");
assertEqual(v.slots.map((s) => s.id), [6, 25, 150], "slot order is unchanged");
assertEqual(v.slots.slice(1).map((s) => [s.name, s.mega, s.spriteId]), [["Pikachu", null, 25], ["Mewtwo", null, 150]], "other slots are untouched");
assertEqual(v.megaNotice, null, "an active Mega needs no explanation");
assertTrue(v.power > buildTeamView(strip(ash), { env: ON }).power, "Team power uses the Mega's stats, as in battle");
const vy = buildTeamView(player("300000000000000002", [[6, "normal", 60, "mega-charizard-y"]]), { env: ON }).slots[0];
assertEqual([vy.name, vy.spriteId, vy.types], ["Mega Charizard Y", "mega-charizard-y", ["Fire", "Flying"]], "Mega Charizard Y is shown as Y, never X");
const shiny = buildTeamView(player("300000000000000003", [[282, "shiny", 50, "mega-gardevoir"]]), { env: ON }).slots[0];
assertEqual([shiny.name, shiny.shiny, shiny.variant, shiny.spriteId], ["Mega Gardevoir", true, "shiny", "mega-gardevoir"], "a shiny line shows its shiny Mega");

section("Fail-closed display: base form everywhere, with a plain reason");
const asBase = (env, u = ash) => buildTeamView(u, { env });
const teamsOnly = asBase(TEAMS);
assertEqual([teamsOnly.slots[0].name, teamsOnly.slots[0].spriteId, teamsOnly.slots[0].mega], ["Charizard", 6, null], "battles off: Charizard is shown as Charizard");
assertEqual(teamsOnly.megaNotice, "Mega Charizard X is on this Team but battles as Charizard for now. Mega battles aren't available yet.", "…and the Team says why, in plain words");
const allOff = asBase(OFF);
assertEqual(JSON.stringify(allOff), JSON.stringify(buildTeamView(strip(ash), { env: OFF })), "Mega Evolution off: the view is exactly the view without any Mega (no notice, no fields)");
const za = player("300000000000000004", [[26, "normal", 50, "mega-raichu-x"]]);
const zaOk = asBase(ON, za);
assertEqual([zaOk.slots[0].name, zaOk.slots[0].spriteId, zaOk.megaNotice ?? null], ["Mega Raichu X", "mega-raichu-x", null], "an unlocked Legends: Z-A Mega (owner-accepted profile) is shown as its Mega");
ZA.setZaAcceptanceForTesting(false);
const zav = asBase(ON, za);
ZA.setZaAcceptanceForTesting(true);
assertEqual([zav.slots[0].name, zav.slots[0].spriteId], ["Raichu", 26], "acceptance off: an unverified Z-A Mega is shown as its base form");
assertTrue(/battle data hasn't been confirmed/.test(zav.megaNotice), "…with the reason that it can't battle yet");
const two = player("300000000000000005", [[6, "normal", 60, "mega-charizard-x"], [150, "normal", 70, "mega-mewtwo-x"]]);
assertEqual(asBase(ON, two).slots.map((s) => s.name), ["Charizard", "Mewtwo"], "two Megas in a stored Team: every slot shows its base form");
assertTrue(/Only one Mega/.test(asBase(ON, two).megaNotice), "…and the notice says only one Mega can be on a Team");
const notUnlocked = player("300000000000000006", [[6, "normal", 60]]);
notUnlocked.displayedPokemon[0].mega = "mega-charizard-x";
assertEqual(asBase(ON, notUnlocked).slots[0].name, "Charizard", "a Mega that isn't unlocked on that line is never shown");
const wrongLine = player("300000000000000007", [[6, "shiny", 60]], [[6, "normal", "mega-charizard-x"]]);
wrongLine.displayedPokemon[0].mega = "mega-charizard-x";
assertEqual(asBase(ON, wrongLine).slots[0].name, "Charizard", "an unlock on the normal line doesn't make the shiny line a Mega");
const blocked = player("300000000000000008", [[384, "normal", 70, "mega-rayquaza"]]);
assertEqual(asBase(ON, blocked).slots[0].name, "Rayquaza", "a blocked form (Mega Rayquaza) is never shown as a Mega");
const diancie = player("300000000000000009", [[719, "normal", 60, "mega-diancie"]]);
const dv = asBase(ON, diancie);
assertTrue(dv.slots.length === 0 || dv.slots[0].name === "Diancie", "an unreleased generation's Mega (Mega Diancie, Gen 6) is never shown as a Mega");
assertEqual(D.teamMegaStatus(ash, { env: OFF }), null, "teamMegaStatus says nothing while Mega Teams are hidden");

section("Player-facing text has no internal details");
const reasons = ["Mega battles are switched off", "more than one Mega slot in the stored team", "form doesn't belong to that Pokémon", "line not owned", "not unlocked on that line",
  "battle profile unverified (Legends: Z-A has no abilities in play)", "ability X is not modelled", "no sprite", "generation 6 is not live", "not in MEGA_FORMS", "Dragon Ascent acquisition rule is not built"];
const texts = reasons.map(D.playerMegaReason);
assertTrue(texts.every((t) => !/MEGA_|env|flag|profile|Showdown|modelled|sprite|allowlist|acquisition/i.test(t)), "reasons never mention flags, data sources or code");
assertTrue(texts.every((t) => t.endsWith(".") && t.length < 90), "each reason is one short sentence");

// ----------------------------------------------------------
section("Same form on every surface");
launched(ash); // the trainer card strip is the Showcase (three-teams split)
const tc = trainerCardView(ash, { displayName: "Ash", trainer: null });
assertTrue(JSON.stringify(tc.team) === JSON.stringify(buildShowcaseView(ash, { displayName: "Ash" }).slots), "the trainer card's strip is exactly /showcase's (process flags)");
process.env.MEGA_EVOLUTION_ENABLED = "1";
process.env.MEGA_BATTLES_ENABLED = "1";
const tcOn = trainerCardView(ash, { displayName: "Ash", trainer: null });
const lbOn = leaderboardView({ top: [{ userId: "A", rating: 1300, wins: 1, losses: 0 }], you: null }, { A: ash }, "A");
const battleTeam = buildTeam(ash);
delete process.env.MEGA_EVOLUTION_ENABLED;
delete process.env.MEGA_BATTLES_ENABLED;
assertEqual([tcOn.team[0].name, tcOn.team[0].spriteId], ["Mega Charizard X", "mega-charizard-x"], "trainer card: Mega Charizard X when it battles as one");
assertEqual(lbOn.top[0].lead, { id: "mega-charizard-x", variant: "normal" }, "leaderboard: a Mega lead shows as the Mega");
assertEqual([battleTeam[0].megaForm, tcOn.team[0].mega.formId, v.slots[0].mega.formId], ["mega-charizard-x", "mega-charizard-x", "mega-charizard-x"], "battle, trainer card and /showteam agree on the form");
assertEqual([tc.owned, tcOn.owned, tc.shinies], [3, 3, 0], "trainer card statistics are unchanged by a Mega (3 Pokémon owned, Mega not counted)");
assertEqual(tcOn.team.length, new Set(tcOn.team.map((s) => s.id)).size, "no duplicate slot for a Pokémon and its Mega");

const comps = buildShowteamComponents(v, { nonce: "n" });
const opts = comps[0].components[0].options.map((o) => o.data);
assertTrue(opts[0].label.includes("Mega Charizard X") && opts[0].description.startsWith("Mega · Fire / Dragon"), "/showteam's Inspect menu names the Mega and its types");
assertEqual(opts[1].description.startsWith("Mega"), false, "ordinary slots' menu entries are unchanged");

// ----------------------------------------------------------
section("Discord images render (real attachments, sizes within limits)");
const st = await renderShowteam(v, { layout: "refined" });
assertEqual(pngSize(st), { w: 1200, h: 920 }, "/showteam with a Mega: same 1200×920 card");
assertTrue(st.length < 8 * 2 ** 20, `/showteam PNG is far under Discord's attachment limit (${Math.round(st.length / 1024)} KB)`);
const stGif = await renderShowteam(v, { layout: "refined", animate: true });
assertTrue(stGif.subarray(0, 3).toString() === "GIF" && stGif.length < 8 * 2 ** 20, `animated /showteam with a Mega is a GIF under the limit (${Math.round(stGif.length / 1024)} KB)`);
assertEqual(pngSize(await renderInspectCard(s1, { owner: "Ash" })), { w: 1000, h: 440 }, "inspect card with a Mega: same 1000×440 card");
assertEqual(pngSize(await renderTrainerCard(trainerCardView(ash, { displayName: "Ash", trainer: null }))), { ...TRAINER_CARD_SIZE }, "trainer card: same size card");

const foe = player("300000000000000010", [[282, "shiny", 55, "mega-gardevoir"], [65, "normal", 50]]);
const td = { A: ash, B: foe };
const out = runBattle({ trainerData: td, challengerId: "A", defenderId: "B", mode: "open", seed: 77, now: new Date(Date.UTC(2026, 10, 10)), env: ON });
assertTrue(out.ok && out.sides[0].members[0].megaForm === "mega-charizard-x" && out.sides[1].members[0].megaForm === "mega-gardevoir", "a battle between two Mega Teams uses both Megas");
const ex = out.exp.A[0];
assertEqual([ex.key, ex.megaForm, ex.baseName], ["6:normal", "mega-charizard-x", "Charizard"], "EXP goes to the base line; the entry notes which Mega battled");
assertTrue(out.exp.A.slice(1).every((e) => !("megaForm" in e) && !("baseName" in e)), "ordinary members' EXP entries are unchanged (no new fields)");
const ev = expView(out, "A", { A: "Ash", B: "Bea" }, ash);
assertEqual([ev.members[0].name, ev.members[0].spriteId, ev.members[0].mega?.formId], ["Charizard X", "mega-charizard-x", "mega-charizard-x"], "EXP card: Mega sprite and name (with a MEGA tag)");
const forged = expView({ ...out, exp: { A: [{ ...ex, megaForm: "mega-mewtwo-x" }] } }, "A", { A: "Ash", B: "Bea" }, ash);
assertEqual([forged.members[0].mega, forged.members[0].spriteId], [null, 6], "EXP card ignores a Mega that doesn't belong to that Pokémon");
assertTrue((await renderExpCard(ev)).subarray(1, 4).toString() === "PNG", "EXP card with a Mega renders");

const sprites = new Map();
const sides = out.sides.map((s) => ({ name: s.userId, members: s.members }));
await renderBattleFrame({ sides, hpBefore: sides.map((s) => s.members.map(() => 1)), sprites });
assertTrue(sprites.has("mega/normal/mega-charizard-x") && sprites.has("mega/shiny/mega-gardevoir"), "battle images load the normal and shiny Mega sprites");
await renderBattleFrame({ sides, hpBefore: sides.map((s, i) => s.members.map((_, j) => (i === 0 && j === 0 ? 0 : 1))), sprites });
assertTrue(sprites.has("mega/grayscale/mega-charizard-x"), "a fainted Mega uses its grayscale Mega sprite");
assertTrue([...sprites.keys()].every((k) => !/^(normal|shiny|grayscale)\/(6|282)$/.test(k)), "the Mega slots never load their base form's sprite");

// ----------------------------------------------------------
section("Dashboard cards: three battle states, honest ability text");
const dash = player("300000000000000011", [[6, "normal", 60, "mega-charizard-x"], [26, "normal", 50], [150, "normal", 70]], [[26, "normal", "mega-raichu-x"], [248, "shiny", "mega-tyranitar"]]);
const cardsOn = buildMegaCards(dash, { env: ON });
const card = (id, env = ON) => buildMegaCards(dash, { env }).find((c) => c.formId === id && c.unlocked !== false) ?? null;
assertEqual(card("mega-charizard-x").battleStatus.state, "ready", "unlocked + owned + verified + battles on → Battle-ready");
assertEqual(card("mega-charizard-x", TEAMS).battleStatus, { state: "unavailable", label: "Unlocked · can't battle yet", detail: "Mega battles aren't available yet." }, "battles off → Unlocked, can't battle yet");
assertEqual(card("mega-raichu-x").battleStatus.state, "ready", "an owner-accepted Legends: Z-A Mega is Battle-ready with battles on");
ZA.setZaAcceptanceForTesting(false);
assertEqual(card("mega-raichu-x").battleStatus.state, "unavailable", "acceptance off: an unverified Z-A Mega is never Battle-ready");
ZA.setZaAcceptanceForTesting(true);
assertEqual(card("mega-tyranitar").battleStatus.state, "unavailable", "a dormant Mega (line not owned) can't battle");
const lockedCard = cardsOn.find((c) => c.state === "locked" && c.formId === "mega-mewtwo-y");
assertEqual(lockedCard?.battleStatus.state, "locked", "an unlockable preview is Locked, never shown as owned");
const zaLocked = () => buildMegaCards(player("300000000000000012", [[26, "normal", 40]]), { env: ON }).find((c) => c.formId === "mega-raichu-y");
assertTrue(!/can't battle yet/.test(zaLocked()?.battleStatus.detail ?? "") && zaLocked()?.battleStatus.state === "locked", "a locked accepted Z-A preview is simply Locked (it will battle once unlocked)");
ZA.setZaAcceptanceForTesting(false);
assertTrue(/can't battle yet/.test(zaLocked()?.battleStatus.detail ?? ""), "acceptance off: a locked Z-A preview says it won't battle yet");
ZA.setZaAcceptanceForTesting(true);
const acceptedOrVerified = (id) => getMega(id).battleProfile.verified || ZA.isAcceptedZaProfile(getMega(id));
assertTrue(cardsOn.every((c) => c.battleStatus.state !== "ready" || (c.unlocked && c.state === "active" && acceptedOrVerified(c.formId))), "no card claims Battle-ready unless unlocked, owned and verified or owner-accepted");
assertTrue(cardsOn.every((c) => c.shortName === c.name.replace(/^Mega /, "")), "cards carry the short form name");
const blockedCards = buildMegaCards(player("300000000000000013", [[384, "normal", 70, "mega-rayquaza"]]), { env: ON });
assertTrue(blockedCards.every((c) => c.formId !== "mega-rayquaza" || (c.state === "blocked" && !c.canUnlock && !c.teamSelectable)), "a blocked form is never unlockable or selectable");

section("Mega collection progress is separate from the Pokédex");
const p0 = D.megaCollectionProgress(player("300000000000000014", [[6, "normal", 10]]), { env: ON });
const p1 = D.megaCollectionProgress(dash, { env: ON });
assertEqual([p0.unlocked, p1.unlocked, p1.shiny], [0, 3, 1], "progress counts unlocked forms (Charizard X, Raichu X, shiny Tyranitar)");
assertTrue(p1.available > 60 && p1.available < allMegas().length, `available excludes blocked and unreleased forms (${p1.available})`);
assertEqual(D.megaCollectionProgress(blocked, { env: ON }).unlocked, 0, "a blocked form never counts as collected");
assertEqual(nationalCompletion(dash), nationalCompletion(strip({ ...dash, megaUnlocks: {} })), "National Pokédex completion is the same with or without Mega unlocks");
assertEqual(dexProgress(dash, [6, 26]), dexProgress({ ...dash, megaUnlocks: {} }, [6, 26]), "regional progress is unchanged too");
const handlers = createMegaHandlers({ getTrainerData: () => ({ "300000000000000011": dash }), lockUser: (_, fn) => fn(), save: async () => ({ saved: true }), getEnv: () => ON });
const view = handlers.view({ query: { id: "300000000000000011" }, isAuthorized: () => true });
assertEqual(view.body.progress, p1, "GET /api/mega includes the progress");
const offView = createMegaHandlers({ getTrainerData: () => ({ "300000000000000011": dash }), lockUser: (_, fn) => fn(), save: async () => ({}), getEnv: () => OFF }).view({ query: { id: "300000000000000011" }, isAuthorized: () => true });
assertEqual(offView.body, { success: true, enabled: false }, "…and with Mega off it still says only { enabled: false }");

console.warn = quiet;
finish();
