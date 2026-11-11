// ==========================================================
// tests/megaBattle.test.js — Mega Evolution M2 through the real battle
// path: runBattle → buildTeam (resolveBattleMega, fail-closed) → buildMon →
// effects engine → EXP/Elo → rendering. Synthetic players only.
// ==========================================================

import { assertTrue, assertEqual, section, finish } from "./harness.js";

const { runBattle, buildTeam } = await import("../utils/battle/runBattle.js");
const { buildMon, simulateBattle } = await import("../utils/battle/sim.js");
const { computeStats } = await import("../utils/battle/stats.js");
const { teamPower } = await import("../utils/battle/power.js");
const { teamExp } = await import("../utils/battle/rewards.js");
const { renderBattleFrame, turnText } = await import("../utils/battle/render.js");
const { resolveBattleMega } = await import("../services/megaTeam.js");
const { getMega, megaBattleProfile, megaBattleEligibility } = await import("../utils/megas.js");
const { ABILITY_REGISTRY } = await import("../utils/battle/abilities.js");
const { createNewUser } = await import("../utils/userSchema.js");
const { getSpecies } = await import("../utils/battle/data.js");
const G = await import("../config/generations.js");
const C = await import("../utils/speciesCatalog.js");
const ZA = await import("../config/megaBattleProfiles.js");

const ON = { MEGA_EVOLUTION_ENABLED: "1", MEGA_BATTLES_ENABLED: "1" };
const NOW = new Date(Date.UTC(2026, 10, 10, 12));
const clone = (o) => JSON.parse(JSON.stringify(o));
const quietWarn = console.warn;
console.warn = () => {};

function trainer(id, mons, { mega = null, unlock = true, variant = "normal" } = {}) {
  const u = createNewUser(id, `T${id}`);
  u.training = {};
  for (const [s, lv, v = "normal"] of mons) {
    u.pokemon[s] ??= { normal: 0, shiny: 0 };
    u.pokemon[s][v] += 1;
    u.training[`${s}:${v}`] = { exp: lv ** 3 };
  }
  u.displayedPokemon = mons.map(([s, , v = "normal"]) => ({ id: s, variant: v, ...(mega && mega.species === s && (mega.variant ?? "normal") === v && { mega: mega.form }) }));
  if (mega && unlock) u.megaUnlocks = { [`${mega.species}:${mega.unlockVariant ?? mega.variant ?? variant}`]: { forms: { [mega.form]: { at: 1, stone: null } }, preferred: null } };
  return u;
}
const battle = (A, B, { seed = 11, env = ON, mode = "open" } = {}) => runBattle({ trainerData: { A, B }, challengerId: "A", defenderId: "B", mode, seed, now: NOW, env });
const foe = () => trainer("B", [[143, 60], [9, 55]]);

// ------------------------------------------------------------------
section("Valid Mega: temporary battle form");
{
  const A = trainer("A", [[6, 60], [25, 40]], { mega: { species: 6, form: "mega-charizard-x" } });
  const before = clone(A);
  const team = buildTeam(A, { env: ON });
  const p = megaBattleProfile("mega-charizard-x");
  assertEqual([team[0].speciesId, team[0].variant, team[0].level, team[0].megaForm, team[0].name, team[0].baseName], [6, "normal", 60, "mega-charizard-x", "Mega Charizard X", "Charizard"], "the Mega member keeps species 6, the normal line and Level 60; adds form, Mega name and base name");
  assertEqual([team[1].name, "megaForm" in team[1]], ["Pikachu", false], "other members are unchanged");
  const mon = buildMon(team[0]);
  const s = computeStats(p.baseStats, 60);
  assertEqual([mon.types, mon.atk, mon.def, mon.spa, mon.spd, mon.spe, mon.maxHp, mon.ability], [["Fire", "Dragon"], s.atk, s.def, s.spa, s.spd, s.spe, s.hp, "Tough Claws"], "battler: Mega Charizard X's Fire/Dragon typing and Mega stats at the base Level; ability Tough Claws");
  assertEqual(mon.maxHp, computeStats(getSpecies(6).baseStats, 60).hp, "HP equals the base form's HP (Mega Evolution doesn't change base HP for battle-eligible forms)");
  const r = battle(A, foe());
  assertTrue(r.ok && r.sides[0].members[0].megaForm === "mega-charizard-x", "runBattle uses the Mega member");
  assertEqual(r.result.log[0][0]?.preNotes === undefined || Array.isArray(r.result.log[0][0].preNotes), true, "log events keep the legacy shape (extra notes only when something triggered)");
  assertEqual([A.pokemon, A.megaUnlocks, A.displayedPokemon, A.items], [before.pokemon, before.megaUnlocks, before.displayedPokemon, before.items], "counts, unlocks, stored team and items unchanged after the battle");
  assertTrue(Object.keys(A.training).every((k) => /^\d+:(normal|shiny)$/.test(k)) && A.training["6:normal"].exp >= before.training["6:normal"].exp, "EXP goes to the base line key 6:normal; no Mega training key is ever created");
  assertTrue(!JSON.stringify(A).includes("battleProfile") && !JSON.stringify(A).includes("\"atk\""), "no Mega battle stats are written to the player record");
}

section("Fail-closed: any invalid Mega slot battles as its base form");
const failCases = [
  ["battles switched off (master only)", () => trainer("A", [[6, 60]], { mega: { species: 6, form: "mega-charizard-x" } }), { MEGA_EVOLUTION_ENABLED: "1" }],
  ["everything off", () => trainer("A", [[6, 60]], { mega: { species: 6, form: "mega-charizard-x" } }), {}],
  ["not unlocked", () => trainer("A", [[6, 60]], { mega: { species: 6, form: "mega-charizard-x" }, unlock: false }), ON],
  ["unlocked on the shiny line, slot is the normal line", () => trainer("A", [[6, 60]], { mega: { species: 6, form: "mega-charizard-x", unlockVariant: "shiny" } }), ON],
  ["base line not owned", () => { const u = trainer("A", [[6, 60], [25, 40]], { mega: { species: 6, form: "mega-charizard-x" } }); u.pokemon[6].normal = 0; return u; }, ON],
  ["form of another species", () => { const u = trainer("A", [[25, 60]]); u.displayedPokemon[0].mega = "mega-charizard-x"; u.megaUnlocks = { "25:normal": { forms: { "mega-charizard-x": { at: 1, stone: null } } } }; return u; }, ON],
  ["two Mega slots (corrupt stored team)", () => { const u = trainer("A", [[6, 60], [150, 70]], { mega: { species: 6, form: "mega-charizard-x" } }); u.displayedPokemon[1].mega = "mega-mewtwo-y"; u.megaUnlocks["150:normal"] = { forms: { "mega-mewtwo-y": { at: 1, stone: null } } }; return u; }, ON],
  ["blocked form (Mega Rayquaza)", () => trainer("A", [[384, 70]], { mega: { species: 384, form: "mega-rayquaza" } }), ON],
  ["unverified Z-A profile, acceptance off (Mega Meganium)", () => trainer("A", [[154, 50]], { mega: { species: 154, form: "mega-meganium" } }), ON, true],
  ["unverified Z-A profile, acceptance off (Mega Dragonite)", () => trainer("A", [[149, 60]], { mega: { species: 149, form: "mega-dragonite" } }), ON, true],
  ["MEGA_FORMS excludes it", () => trainer("A", [[6, 60]], { mega: { species: 6, form: "mega-charizard-x" } }), { ...ON, MEGA_FORMS: "mega-venusaur" }],
  ["generation not live (Mega Greninja)", () => trainer("A", [[658, 60]], { mega: { species: 658, form: "mega-greninja" } }), ON],
];
for (const [label, make, env, zaOff] of failCases) {
  const u = make();
  if (zaOff) ZA.setZaAcceptanceForTesting(false);
  const team = buildTeam(u, { env });
  ZA.setZaAcceptanceForTesting(true);
  assertTrue(team.length > 0 && team.every((m) => !m.megaForm && !m.battleProfile), `fail-closed: ${label} → every slot battles as its base form`);
}
for (const [sp, lvl, form] of [[154, 50, "mega-meganium"], [149, 60, "mega-dragonite"]]) {
  const m = buildTeam(trainer("A", [[sp, lvl]], { mega: { species: sp, form } }), { env: ON })[0];
  assertTrue(m.megaForm === form && m.battleProfile?.formId === form, `accepted Z-A profile: ${form} battles as its Mega`);
}
assertEqual(resolveBattleMega(trainer("A", [[6, 60], [150, 70]]), { env: ON }), null, "a team without Mega slots resolves to null (nothing to check)");
assertEqual(resolveBattleMega(failCases[2][1](), { env: ON }).reason, "not unlocked on that line", "refusals carry an internal reason (logged, never shown to players)");

section("Every battle-eligible form builds a correct battler");
const eligible = Object.values((await import("../data/pokedex/megas.json", { with: { type: "json" } })).default.forms).filter((f) => megaBattleEligibility(f.id, { env: ON }).battleReady);
assertEqual(eligible.length, 70, "70 battle-eligible forms today: the 46 verified X/Y/ORAS forms of Gens 1–5 plus the 24 owner-accepted Z-A forms of Gens 1–5");
G.setGenerationsForTesting([6]); C.resetCatalogCachesForTesting();
assertTrue(megaBattleEligibility("mega-diancie", { env: ON }).battleReady, "…and Mega Diancie becomes battle-ready once Gen 6 is released (47)");
G.setGenerationsForTesting(null); C.resetCatalogCachesForTesting();
const bad = [];
for (const f of eligible) {
  const u = trainer("A", [[f.species, 50, f.variant?.value === "f" ? "normal" : "normal"]], { mega: { species: f.species, form: f.id } });
  const m = buildTeam(u, { env: ON })[0];
  const mon = buildMon(m);
  const s = computeStats(f.baseStats, 50);
  if (m.megaForm !== f.id || JSON.stringify(mon.types) !== JSON.stringify(f.types) || mon.atk !== s.atk || mon.spe !== s.spe || mon.ability !== f.ability) bad.push(f.id);
  if (!["implemented", "no-effect"].includes(ABILITY_REGISTRY[f.ability]?.status)) bad.push(`${f.id} ability`);
}
assertEqual(bad, [], "each eligible form: correct form, types, stats and ability; ability modelled or explicitly no-effect");
assertTrue(eligible.every((f) => (f.battleProfile.verified && f.battleProfile.confidence === "high") || (f.introducedIn.startsWith("Legends: Z-A") && megaBattleEligibility(f.id, { env: ON }).profileConfidence === "accepted")), "every battle-eligible form has a verified X/Y/ORAS profile or an owner-accepted Z-A profile");
assertTrue(["mega-charizard-x", "mega-charizard-y", "mega-mewtwo-x", "mega-mewtwo-y"].every((id) => eligible.some((f) => f.id === id)), "Charizard X/Y and Mewtwo X/Y are distinct battle forms");

section("Type changes matter: Mega Charizard X vs Charizard");
{
  const rockMove = { name: "Rock test", type: "Rock", category: "Physical", power: 80, accuracy: true, critRatio: 1 };
  const { effectiveness } = await import("../utils/battle/data.js");
  assertEqual([effectiveness("Rock", getSpecies(6).types), effectiveness("Rock", getMega("mega-charizard-x").types)], [4, 2], "Rock: 4× on Fire/Flying Charizard, only 2× on Fire/Dragon Mega Charizard X");
  const cx = buildMon(buildTeam(trainer("A", [[6, 60]], { mega: { species: 6, form: "mega-charizard-x" } }), { env: ON })[0]);
  assertEqual([effectiveness("Dragon", cx.types), effectiveness("Dragon", getSpecies(6).types)], [2, 1], "…and Dragon moves become super effective on it");
  void rockMove;
}

section("EXP uses the base species; power rating uses the Mega's stats");
{
  const base = { speciesId: 3, variant: "normal", level: 50, name: "Venusaur" };
  const megaV = { ...base, megaForm: "mega-venusaur", battleProfile: megaBattleProfile("mega-venusaur"), name: "Mega Venusaur" };
  const me = [{ speciesId: 6, variant: "normal", level: 50 }];
  assertEqual(teamExp({ members: me, knockedOut: [megaV], won: true }), teamExp({ members: me, knockedOut: [base], won: true }), "knocking out Mega Venusaur gives the same EXP as Venusaur (base-species BST, D-10)");
  assertTrue(teamPower([megaV]) > teamPower([base]), "the power rating sees the Mega's stats (underdog surge accounts for it)");
  const A = trainer("A", [[6, 60]], { mega: { species: 6, form: "mega-charizard-y" } });
  const A2 = trainer("A", [[6, 60]]);
  const r1 = battle(A, trainer("B", [[3, 50]]), { seed: 5 });
  const r2 = battle(A2, trainer("B", [[3, 50]]), { seed: 5, env: {} });
  assertTrue(r1.exp.A[0].key === "6:normal" && r2.exp.A[0].key === "6:normal", "EXP lands on 6:normal in both cases");
  assertEqual(Object.keys(r1.exp).length, 1, "open battles still give EXP only to the challenger (no duplicate grants)");
}

section("Shiny lines use the shiny Mega sprite; rendering");
{
  const A = trainer("A", [[6, 60, "shiny"]], { mega: { species: 6, form: "mega-charizard-y", variant: "shiny" } });
  const team = buildTeam(A, { env: ON });
  assertEqual([team[0].variant, team[0].megaForm], ["shiny", "mega-charizard-y"], "a shiny line battles as the shiny Mega");
  const sprites = new Map();
  const sides = [{ name: "A", members: team }, { name: "B", members: buildTeam(foe(), { env: ON }) }];
  const gif = await renderBattleFrame({ sides, hpBefore: [[1], [1, 1]], screens: [["", ""]], sprites });
  assertTrue(Buffer.isBuffer(gif) && gif.length > 1000, "a frame with a Mega renders");
  assertTrue(sprites.has("mega/shiny/mega-charizard-y") && (await sprites.get("mega/shiny/mega-charizard-y")) !== null, "the shiny Mega sprite file is loaded (mega/shiny/mega-charizard-y.gif)");
  const sprites2 = new Map();
  await renderBattleFrame({ sides, hpBefore: [[0], [1, 1]], screens: [["", ""]], sprites: sprites2 });
  assertTrue(sprites2.has("mega/grayscale/mega-charizard-y"), "a fainted Mega uses its grayscale Mega sprite");
  const plainSprites = new Map();
  await renderBattleFrame({ sides: [{ name: "A", members: buildTeam(trainer("A", [[6, 60]]), { env: {} }) }, sides[1]], hpBefore: [[1], [1, 1]], screens: [["", ""]], sprites: plainSprites });
  assertTrue(plainSprites.has("normal/6") && ![...plainSprites.keys()].some((k) => k.startsWith("mega/")), "ordinary battlers load the same sprite keys as before");
  const t = turnText({ side: 0, slot: 0, targetSlot: 0, move: "Flamethrower", eff: 1, damage: 10, crit: false, missed: false, preNotes: ["Mega Charizard Y's Drought: The sunlight turned harsh!"], notes: [], endNotes: ["The harsh sunlight faded."] }, sides);
  assertEqual(t, ["Mega Charizard Y used Flamethrower!", "Mega Charizard Y's Drought: The sunlight turned harsh! The harsh sunlight faded."], "battle text shows entry, weather and end-of-turn messages");
  assertTrue(!/battleProfile|formId|resolve|reason|D-\d/.test(t.join(" ")), "no internal details in player-facing text");
}

section("Reliability");
{
  const mk = () => [trainer("A", [[6, 60], [94, 55], [212, 50]], { mega: { species: 6, form: "mega-charizard-y" } }), trainer("B", [[248, 60], [3, 58]], { mega: { species: 248, form: "mega-tyranitar" } })];
  const [a1, b1] = mk(); const [a2, b2] = mk();
  const r1 = battle(a1, b1, { seed: 99 }), r2 = battle(a2, b2, { seed: 99 });
  assertEqual(JSON.stringify([r1.result, r1.exp, r1.rating]), JSON.stringify([r2.result, r2.exp, r2.rating]), "same seed → identical Mega battle (deterministic)");
  assertTrue(JSON.stringify(r1.result.log).includes("Drought") && JSON.stringify(r1.result.log).includes("Sand Stream"), "the log records both weather abilities (Drought vs Sand Stream)");

  // Random Mega vs Mega/plain battles: no crashes, sane HP, consistent knockouts.
  const forms = eligible.map((f) => f.id);
  let crashes = 0, insane = 0;
  for (let i = 0; i < 300; i++) {
    const fa = getMega(forms[i % forms.length]), fb = getMega(forms[(i * 7 + 3) % forms.length]);
    const A = trainer("A", [[fa.species, 20 + (i % 80)], [25, 30 + (i % 50)]], { mega: { species: fa.species, form: fa.id } });
    const B = trainer("B", i % 3 ? [[fb.species, 20 + ((i * 3) % 80)], [143, 40]] : [[292, 50], [9, 60]], i % 3 ? { mega: { species: fb.species, form: fb.id } } : {});
    try {
      const r = battle(A, B, { seed: 1000 + i });
      const hpOk = r.result.snapshots.flat(2).every((h) => h >= 0 && h <= 1);
      const koOk = r.result.endedBy === "turnCap" || r.result.knockouts.length >= Math.min(...[A, B].map((u) => u.displayedPokemon.length));
      if (!hpOk || !koOk) insane++;
    } catch { crashes++; }
  }
  assertEqual([crashes, insane], [0, 0], "300 random Mega battles (incl. Mega vs Mega and vs Shedinja): no crashes, HP within bounds, knockouts consistent");

  // Interruption: an error inside the battle leaves player data untouched.
  const [A, B] = mk();
  const strip = (u) => { const { battle: _b, ...rest } = u; return rest; };
  const before = JSON.stringify({ A: strip(A), B: strip(B) });
  const orig = ABILITY_REGISTRY.Drought.onEntry;
  ABILITY_REGISTRY.Drought.onEntry = () => { throw new Error("simulated crash inside the battle"); };
  let threw = false;
  try { battle(A, B, { seed: 1 }); } catch { threw = true; }
  ABILITY_REGISTRY.Drought.onEntry = orig;
  assertTrue(threw && JSON.stringify({ A: strip(A), B: strip(B) }) === before, "a crash mid-battle leaves both players' records unchanged (no EXP, no Mega state, no items)");
  assertTrue([A, B].every((u) => u.battle.wins === 0 && u.battle.losses === 0 && u.battle.rating === 1000 && u.battle.started === 0), "…only the pre-existing neutral daily battle record exists (no win, loss, rating change or counted battle; same as before M2)");

  // Restart: reload the players from JSON and battle again → same result.
  const [A3, B3] = mk();
  const saved = JSON.parse(JSON.stringify({ A3, B3 }));
  const r3 = battle(saved.A3, saved.B3, { seed: 99 });
  assertEqual(JSON.stringify(r3.result.log), JSON.stringify(r1.result.log), "after a save/reload (process restart) the same battle replays identically");

  // Invalid battle state: a member with an unknown ability or missing profile fields.
  const weird = simulateBattle({ sides: [{ members: [{ speciesId: 6, level: 50, name: "X", battleProfile: { ...megaBattleProfile("mega-charizard-x"), ability: "No Such Ability" } }] }, { members: [{ speciesId: 143, level: 50, name: "Snorlax" }] }], seed: 3, surge: null });
  assertTrue(weird.winner === 0 || weird.winner === 1, "an unknown ability name doesn't crash the engine (treated as no ability)");
  assertTrue(megaBattleEligibility("mega-zygarde", { env: ON }).reasons.includes("no sprite") && !megaBattleEligibility("mega-zygarde", { env: ON }).battleReady, "missing sprite metadata keeps a form out of battle");
}

section("Generation independence");
assertTrue(!megaBattleEligibility("mega-greninja", { env: ON }).battleReady, "Gen 6 not live: Mega Greninja can't battle");
G.setGenerationsForTesting([6]); C.resetCatalogCachesForTesting();
const gren = megaBattleEligibility("mega-greninja", { env: ON });
assertTrue(gren.battleReady && gren.profileConfidence === "accepted" && !gren.abilityVerified, "Gen 6 live: Mega Greninja battles with its owner-accepted Z-A profile (still reported as unverified data)");
assertTrue(!megaBattleEligibility("mega-zeraora", { env: ON }).battleReady, "Gen 7 not live: Mega Zeraora still can't battle");
G.setGenerationsForTesting(null); C.resetCatalogCachesForTesting();

section("Z-A Megas (owner-accepted profiles, all generations) run in the engine");
const allGens = { env: ON, generationLive: () => true };
const accepted = Object.values((await import("../data/pokedex/megas.json", { with: { type: "json" } })).default.forms)
  .filter((f) => !f.battleProfile.verified && megaBattleEligibility(f.id, allGens).battleReady);
assertEqual([accepted.length, accepted.filter((f) => f.species >= 650).length], [46, 22], "46 Z-A forms can battle once their generations are live (22 of them Gen 6–9)");
assertTrue(!["mega-floette", "mega-zygarde", "mega-magearna-original"].some((id) => megaBattleEligibility(id, allGens).battleReady), "Floette, Zygarde and Original Color Magearna stay blocked");
assertTrue(["mega-dragonite", "mega-starmie", "mega-raichu-x", "mega-garchomp-z", "mega-emboar"].every((id) => megaBattleEligibility(id, allGens).battleReady), "Z-A Megas of Gen 1–5 Pokémon can battle too (owner decision)");
ZA.setZaAcceptanceForTesting(false);
assertTrue(!megaBattleEligibility("mega-dragonite", allGens).battleReady && !megaBattleEligibility("mega-greninja", allGens).battleReady, "with acceptance off, unverified Z-A profiles are refused again");
ZA.setZaAcceptanceForTesting(true);
let engineOk = true;
for (const f of accepted) {
  for (const foe of [143, 6, 248]) {
    for (let seed = 1; seed <= 5; seed++) {
      const r = simulateBattle({ sides: [{ members: [{ speciesId: f.species, level: 50, name: f.name, battleProfile: megaBattleProfile(f.id) }] }, { members: [{ speciesId: foe, level: 50, name: `#${foe}` }] }], seed, surge: null });
      if (!(r.winner === 0 || r.winner === 1) || !(r.turns > 0)) engineOk = false;
    }
  }
}
assertTrue(engineOk, `every accepted form finishes 15 battles (3 foes × 5 seeds) with a winner (${accepted.length * 15} battles)`);
const mirror = simulateBattle({ sides: [{ members: accepted.slice(0, 6).map((f) => ({ speciesId: f.species, level: 50, name: f.name, battleProfile: megaBattleProfile(f.id) })) }, { members: accepted.slice(6, 12).map((f) => ({ speciesId: f.species, level: 50, name: f.name, battleProfile: megaBattleProfile(f.id) })) }], seed: 9, surge: null });
assertTrue(mirror.winner === 0 || mirror.winner === 1, "a six-against-six battle of accepted Megas finishes");

console.warn = quietWarn;
finish();
