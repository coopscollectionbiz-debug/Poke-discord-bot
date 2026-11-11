// ==========================================================
// tests/megaAbilities.test.js — Mega Evolution M2: every implemented
// ability, stat stages, weather, terrain, burn, entry and end-of-turn
// effects of the effects engine (utils/battle/effects.js), checked with
// scripted random numbers against an independent copy of Coop's damage
// formula. The last section requires that every ability the registry calls
// "implemented" was exercised here.
// ==========================================================

import { Dex } from "@pkmn/dex";
import { assertTrue, assertEqual, section, finish } from "./harness.js";

const E = await import("../utils/battle/effects.js");
const { buildMon } = await import("../utils/battle/sim.js");
const { getMove } = await import("../utils/battle/data.js");
const { autoMoveset } = await import("../utils/battle/moveset.js");
const { ABILITY_REGISTRY } = await import("../utils/battle/abilities.js");
const { megaBattleProfile } = await import("../utils/megas.js");
const { computeStats } = await import("../utils/battle/stats.js");

const covered = new Set();
const covers = (...names) => names.forEach((n) => covered.add(n));
const draws = (...values) => {
  const next = () => {
    if (!values.length) throw new Error("the engine drew more random numbers than expected");
    return values.shift();
  };
  return { next, int: (n) => Math.floor(next() * n), left: () => values.length };
};
const NO_CRIT = 0.99, CRIT = 0, ROLL = 0.5, HIT = 0;
const ROLLF = 0.8 + 0.5 * 0.2;

/** Independent copy of Coop's damage formula (legacy sim + documented M2 modifiers). */
function ref({ level = 50, power, a, d, stab = 1, eff = 1, crit = false, roll = ROLLF, final = 1 }) {
  const base = Math.floor(Math.floor((Math.floor((2 * level) / 5 + 2) * power * a) / d) / 50) + 2;
  return Math.max(1, Math.floor(base * stab * eff * (crit ? 2 : 1) * roll * final));
}

const prep = (m, name) => E.prepareBattler(m, autoMoveset(m.speciesId, m.level), name);
const tank = (m, real) => { if (!real) { m.maxHp = 99999; m.hp = 99999; } return m; };
const megaMon = (formId, level = 50, { real = false } = {}) => {
  const p = megaBattleProfile(formId);
  return tank(prep(buildMon({ speciesId: p.species, level, battleProfile: p }), p.name), real);
};
const mon = (speciesId, { level = 50, ability = null, types = null, name = null, real = false } = {}) => {
  const m = buildMon({ speciesId, level });
  if (ability) m.ability = ability;
  if (types) m.types = types;
  return tank(prep(m, name ?? `#${speciesId}`), real);
};
const move = (type, category = "Physical", power = 80, flags = {}, extra = {}) => ({ name: `${type} test`, type, category, power, accuracy: true, critRatio: 1, flags, ...extra });
const field = (rng = draws(), setup = () => {}) => { const fx = E.createField(rng); setup(fx); return fx; };
const use = (fx, mv, atk, def, rng = fx.rng) => { fx.active = [atk, def]; return E.useMoveFx(fx, mv, atk, def, rng); };
const phys = (m) => [m.atk, m.def];

// ------------------------------------------------------------------
section("Stat stages (reusable)");
assertEqual([-6, -2, -1, 0, 1, 2, 6].map((s) => E.stageMult(s)), [0.25, 0.5, 2 / 3, 1, 1.5, 2, 4], "atk–spe stage multipliers: 2/(2−n) and (2+n)/2, ±6");
assertEqual([-6, -1, 0, 1, 6].map((s) => E.stageMult(s, true)), [3 / 9, 0.75, 1, 4 / 3, 3], "accuracy/evasion multipliers: 3/(3−n) and (3+n)/3");
{
  const fx = field();
  const m = mon(143);
  fx.boost(m, { atk: 2 }, m);
  fx.boost(m, { atk: 6 }, m);
  fx.boost(m, { atk: 1 }, m);
  assertEqual([m.stages.atk, fx.stat(m, "atk"), fx.notes.at(-1)], [6, m.atk * 4, "#143's Attack won't go any higher!"], "stages clamp at +6 (and say so); the stat uses the stage");
  const a = mon(143), b = mon(143);
  fx.boost(b, { def: -1 }, a);
  const r = use(field(draws(NO_CRIT, ROLL)), move("Normal"), a, b);
  assertEqual(r.damage, ref({ power: 80, a: a.atk, d: Math.floor(b.def * (2 / 3)), stab: 1.5 }), "−1 Defense raises damage taken by the stage multiplier");
}
{
  const a = mon(143), b = mon(143);
  a.stages.atk = -2; b.stages.def = 2;
  const r = use(field(draws(CRIT, ROLL)), move("Normal"), a, b);
  assertEqual(r.damage, ref({ power: 80, a: a.atk, d: b.def, stab: 1.5, crit: true }), "critical hits ignore the attacker's drops and the target's boosts");
}
{
  const a = mon(143), b = mon(143);
  a.stages.accuracy = -6;
  const r = use(field(draws(0.4)), move("Normal", "Physical", 80, {}, { accuracy: 100 }), a, b);
  assertEqual(r.missed, true, "−6 accuracy: a 100% move needs a roll below 33%; 0.4 misses");
}

// ------------------------------------------------------------------
section("Offence: types and power");
{
  const a = megaMon("mega-pinsir"), b = mon(143);
  covers("Aerilate");
  const r = use(field(draws(NO_CRIT, ROLL)), move("Normal", "Physical", 80), a, b);
  assertEqual(r.damage, ref({ power: 96, a: a.atk, d: b.def, stab: 1.5 }), "Aerilate: Normal → Flying (STAB for Bug/Flying Mega Pinsir) at 1.2× power");
  const g = megaMon("mega-gardevoir"); covers("Pixilate");
  assertEqual(use(field(draws(NO_CRIT, ROLL)), move("Normal", "Special", 90), g, mon(143)).damage, ref({ power: 108, a: g.spa, d: mon(143).spd, stab: 1.5 }), "Pixilate: Normal → Fairy, 1.2×, Fairy STAB");
  const gl = megaMon("mega-glalie"); covers("Refrigerate");
  const dragon = mon(149);
  assertEqual(use(field(draws(NO_CRIT, ROLL)), move("Normal", "Physical", 100), gl, dragon).eff, 4, "Refrigerate: Normal → Ice (4× on Dragonite)");
  const fe = mon(160, { ability: "Dragonize" }); covers("Dragonize");
  assertEqual(use(field(draws(NO_CRIT, ROLL)), move("Normal", "Physical", 80), fe, mon(143)).damage, ref({ power: 96, a: fe.atk, d: mon(143).def, stab: 1 }), "Dragonize (Z-A): Normal → Dragon, 1.2× (no STAB for base Feraligatr's Water type)");
  const notNormal = use(field(draws(NO_CRIT, ROLL)), move("Fire", "Physical", 80), a, b);
  assertEqual(notNormal.damage, ref({ power: 80, a: a.atk, d: b.def }), "-ate abilities leave non-Normal moves alone");
}
{
  const lu = megaMon("mega-lucario"); covers("Adaptability");
  const t = mon(143);
  assertEqual(use(field(draws(NO_CRIT, ROLL)), move("Fighting", "Physical", 80), lu, t).damage, ref({ power: 80, a: lu.atk, d: t.def, stab: 2, eff: 2 }), "Adaptability: STAB 2× instead of 1.5×");
}
{
  const ma = megaMon("mega-mawile"), md = megaMon("mega-medicham"), t = mon(143); covers("Huge Power", "Pure Power");
  assertEqual(use(field(draws(NO_CRIT, ROLL)), move("Steel"), ma, t).damage, ref({ power: 80, a: ma.atk * 2, d: t.def, stab: 1.5 }), "Huge Power doubles Attack for physical moves");
  assertEqual(use(field(draws(NO_CRIT, ROLL)), move("Psychic", "Special"), md, t).damage, ref({ power: 80, a: md.spa, d: t.spd, stab: 1.5 }), "Pure Power doesn't touch special moves");
  assertEqual(use(field(draws(NO_CRIT, ROLL)), move("Fighting"), md, t).damage, ref({ power: 80, a: md.atk * 2, d: t.def, stab: 1.5, eff: 2 }), "Pure Power doubles Attack for physical moves");
}
{
  const sc = megaMon("mega-scizor"), t = mon(143); covers("Technician");
  assertEqual(use(field(draws(NO_CRIT, ROLL)), move("Steel", "Physical", 40), sc, t).damage, ref({ power: 60, a: sc.atk, d: t.def, stab: 1.5 }), "Technician: 40-power move → 60");
  assertEqual(use(field(draws(NO_CRIT, ROLL)), move("Steel", "Physical", 61), sc, t).damage, ref({ power: 61, a: sc.atk, d: t.def, stab: 1.5 }), "Technician: no boost above 60 power");
}
const flagCases = [
  ["mega-charizard-x", "Tough Claws", "contact", 1.3],
  ["mega-sharpedo", "Strong Jaw", "bite", 1.5],
  ["mega-blastoise", "Mega Launcher", "pulse", 1.5],
  ["mega-camerupt", "Sheer Force", "secondary", 1.3],
];
for (const [form, ability, flag, mult] of flagCases) {
  const a = megaMon(form), t = mon(143);
  covers(ability);
  const cat = flag === "pulse" ? "Special" : "Physical";
  const [as, ds] = cat === "Physical" ? ["atk", "def"] : ["spa", "spd"];
  const w = use(field(draws(NO_CRIT, ROLL)), move("Normal", cat, 80, { [flag]: true }), a, t).damage;
  const wo = use(field(draws(NO_CRIT, ROLL)), move("Normal", cat, 80, {}), a, t).damage;
  assertEqual([w, wo], [ref({ power: Math.round(80 * mult), a: a[as], d: t[ds] }), ref({ power: 80, a: a[as], d: t[ds] })], `${ability}: ${mult}× power for ${flag} moves only`);
}
{
  const cr = mon(740, { ability: "Iron Fist" }), ab = mon(359, { ability: "Sharpness" }), t = mon(143); covers("Iron Fist", "Sharpness");
  assertEqual(use(field(draws(NO_CRIT, ROLL)), move("Fighting", "Physical", 75, { punch: true }), cr, t).damage, ref({ power: 90, a: cr.atk, d: t.def, stab: 1.5, eff: 2 }), "Iron Fist: punching moves 1.2×");
  assertEqual(use(field(draws(NO_CRIT, ROLL)), move("Dark", "Physical", 70, { slicing: true }), ab, t).damage, ref({ power: 105, a: ab.atk, d: t.def, stab: 1.5 }), "Sharpness: slicing moves 1.5×");
}
{
  const py = mon(668, { ability: "Fire Mane" }), t = mon(143); covers("Fire Mane");
  assertEqual(use(field(draws(NO_CRIT, ROLL)), move("Fire", "Special", 90), py, t).damage, ref({ power: 90, a: Math.floor(py.spa * 1.5), d: t.spd, stab: 1.5 }), "Fire Mane (Z-A): attacking stat 1.5× for Fire moves");
}
{
  const a = mon(143, { ability: "Protean" }), t = mon(9); covers("Protean");
  const fx = field(draws(NO_CRIT, ROLL, NO_CRIT, ROLL));
  const r1 = use(fx, move("Electric", "Special", 90), a, t);
  assertEqual([a.types, r1.damage, r1.notes], [["Electric"], ref({ power: 90, a: a.spa, d: t.spd, stab: 1.5, eff: 2 }), ["#143 transformed into the Electric type!"]], "Protean: becomes the move's type first, so the move gets STAB");
  use(fx, move("Ice", "Special", 90), a, t);
  assertEqual(a.types, ["Electric"], "Protean: once per entry (Gen 9)");
}

// ------------------------------------------------------------------
section("Hits, accuracy, crits");
{
  const h = megaMon("mega-heracross"), t = mon(143); covers("Skill Link");
  const fx = field(draws(...Array(5).fill([NO_CRIT, ROLL]).flat()));
  const r = use(fx, { ...move("Bug", "Physical", 25), multihit: [2, 5] }, h, t);
  assertEqual([r.hits, fx.rng.left()], [5, 0], "Skill Link: 2–5-hit moves always hit 5 times (no hit-count roll)");
  const tk = use(field(draws(HIT, ...Array(3).fill([NO_CRIT, ROLL]).flat())), { ...move("Fighting", "Physical", 10, {}, { accuracy: 90 }), multihit: 3, multiaccuracy: true, risingPower: true }, h, t);
  assertEqual(tk.hits, 3, "Skill Link: Triple Kick-style moves skip the per-hit accuracy checks");
}
{
  const k = megaMon("mega-kangaskhan"), t = mon(143); covers("Parental Bond");
  const fx = field(draws(NO_CRIT, ROLL, NO_CRIT, ROLL));
  const r = use(fx, move("Normal", "Physical", 80), k, t);
  const one = ref({ power: 80, a: k.atk, d: t.def, stab: 1.5 });
  assertEqual([r.hits, r.damage], [2, one + ref({ power: 80, a: k.atk, d: t.def, stab: 1.5, final: 0.25 })], "Parental Bond: single-hit moves strike twice, the second at 0.25×");
  const multi = use(field(draws(0.1, NO_CRIT, ROLL, NO_CRIT, ROLL)), { ...move("Normal", "Physical", 25), multihit: [2, 5] }, k, t);
  assertEqual(multi.hits, 2, "Parental Bond doesn't add hits to multi-hit moves");
}
{
  const p = megaMon("mega-pidgeot"), t = mon(143); covers("No Guard");
  const r = use(field(draws(NO_CRIT, ROLL)), move("Flying", "Special", 110, {}, { accuracy: 70 }), p, t);
  assertTrue(!r.missed && r.damage > 0, "No Guard: a 70%-accurate move hits without an accuracy roll");
  const r2 = use(field(draws(NO_CRIT, ROLL)), move("Normal", "Physical", 80, {}, { accuracy: 50 }), t, p);
  assertTrue(!r2.missed, "No Guard also makes moves aimed at its holder hit");
}
{
  const s = megaMon("mega-slowbro"), a = mon(143); covers("Shell Armor");
  const fx = field(draws(ROLL));
  const r = use(fx, { ...move("Normal"), critRatio: 3 }, a, s);
  assertEqual([r.crit, fx.rng.left()], [false, 0], "Shell Armor: no crit roll at all");
}
{
  const lo = megaMon("mega-lopunny"), g = mon(94); covers("Scrappy");
  const r = use(field(draws(NO_CRIT, ROLL)), move("Normal", "Physical", 80), lo, g);
  assertEqual([r.eff, r.damage > 0], [1, true], "Scrappy: Normal moves hit Ghost-types (neutral against Gengar)");
  const plain = use(field(draws()), move("Normal", "Physical", 80), mon(143), g);
  assertEqual(plain.eff, 0, "…while a battler without Scrappy still can't");
}

// ------------------------------------------------------------------
section("Defence");
{
  const v = megaMon("mega-venusaur"), f = mon(6); covers("Thick Fat");
  assertEqual(use(field(draws(NO_CRIT, ROLL)), move("Fire", "Special", 90), f, v).damage, ref({ power: 90, a: Math.floor(f.spa * 0.5), d: v.spd, stab: 1.5, eff: 2 }), "Thick Fat halves the attacker's stat for Fire moves");
  assertEqual(use(field(draws(NO_CRIT, ROLL)), move("Water", "Special", 90), f, v).damage, ref({ power: 90, a: f.spa, d: v.spd, eff: 0.5 }), "…not for other types");
}
{
  const ag = megaMon("mega-aggron"), f = mon(6); covers("Filter");
  assertEqual(use(field(draws(NO_CRIT, ROLL)), move("Fighting", "Physical", 80), f, ag).damage, ref({ power: 80, a: f.atk, d: ag.def, eff: 2, final: 0.75 }), "Filter: super-effective damage 0.75×");
  assertEqual(use(field(draws(NO_CRIT, ROLL)), move("Normal", "Physical", 80), f, ag).damage, ref({ power: 80, a: f.atk, d: ag.def, eff: 0.5 }), "…other damage unchanged");
}
{
  const dr = mon(149, { ability: "Multiscale" }), a = mon(143); covers("Multiscale");
  const full = use(field(draws(NO_CRIT, ROLL)), move("Normal"), a, dr).damage;
  assertEqual(full, ref({ power: 80, a: a.atk, d: dr.def, stab: 1.5, final: 0.5 }), "Multiscale halves damage at full HP");
  assertEqual(use(field(draws(NO_CRIT, ROLL)), move("Normal"), a, dr).damage, ref({ power: 80, a: a.atk, d: dr.def, stab: 1.5 }), "…and not once damaged");
}
{
  const lz = mon(448, { ability: "Aura Guard" }), a = mon(143); covers("Aura Guard");
  assertEqual(use(field(draws(NO_CRIT, ROLL)), move("Normal", "Physical", 80, { contact: true }), a, lz).damage, ref({ power: 80, a: a.atk, d: lz.def, stab: 1.5, eff: 0.5, final: 0.5 }), "Aura Guard (Z-A): contact damage 0.5×");
}
{
  const la = megaMon("mega-latias"), a = mon(143); covers("Levitate");
  const r = use(field(draws()), move("Ground", "Physical", 100), a, la);
  assertEqual([r.eff, r.damage, r.absorbed], [0, 0, true], "Levitate: immune to Ground moves");
  const mb = megaMon("mega-gyarados"); covers("Mold Breaker");
  const r2 = use(field(draws(NO_CRIT, ROLL)), move("Ground", "Physical", 100), mb, la);
  assertTrue(r2.damage > 0, "Mold Breaker ignores Levitate");
  const ve = megaMon("mega-venusaur"), m2 = megaMon("mega-ampharos");
  assertEqual(use(field(draws(NO_CRIT, ROLL)), move("Fire", "Special", 90), m2, ve).damage, ref({ power: 90, a: m2.spa, d: ve.spd, eff: 2 }), "Mold Breaker ignores Thick Fat");
}
{
  const ch = mon(652, { ability: "Bulletproof" }), a = mon(143); covers("Bulletproof");
  assertEqual(use(field(draws()), move("Grass", "Special", 80, { bullet: true }), a, ch).damage, 0, "Bulletproof: immune to ball/bomb moves");
  assertTrue(use(field(draws(NO_CRIT, ROLL)), move("Grass", "Special", 80), a, ch).damage > 0, "…hit by others");
}
{
  const z = mon(807, { ability: "Volt Absorb" }), a = mon(25); covers("Volt Absorb");
  z.hp = 10;
  const fx = field(draws());
  const r = use(fx, move("Electric", "Special", 90), a, z);
  assertEqual([r.damage, z.hp, r.notes?.[0]], [0, 10 + Math.floor(z.maxHp / 4), "#807 restored HP using its Volt Absorb!"], "Volt Absorb: immune and heals 1/4 max HP");
}
{
  const sc = megaMon("mega-sceptile"), a = mon(25); covers("Lightning Rod");
  const r = use(field(draws()), move("Electric", "Special", 90), a, sc);
  assertEqual([r.damage, sc.stages.spa], [0, 1], "Lightning Rod: immune to Electric, +1 Sp. Atk");
  const td = mon(978, { ability: "Storm Drain" }); covers("Storm Drain");
  assertEqual([use(field(draws()), move("Water", "Special", 90), a, td).damage, td.stages.spa], [0, 1], "Storm Drain: immune to Water, +1 Sp. Atk");
}
{
  const he = mon(485, { ability: "Flash Fire" }), a = mon(6); covers("Flash Fire");
  const r = use(field(draws()), move("Fire", "Special", 90), a, he);
  assertEqual([r.damage, he.flashFire], [0, true], "Flash Fire: immune to Fire and activates");
  const t = mon(143);
  assertEqual(use(field(draws(NO_CRIT, ROLL)), move("Fire", "Special", 90), he, t).damage, ref({ power: 90, a: Math.floor(he.spa * 1.5), d: t.spd, stab: 1.5 }), "…then its own Fire moves use 1.5× Sp. Atk");
}
{
  const ee = mon(604, { ability: "Eelevate" }), a = mon(51); covers("Eelevate");
  assertEqual(use(field(draws()), move("Ground", "Physical", 100), a, ee).damage, 0, "Eelevate (Z-A): immune to Ground");
  const fx = field(); const weak = mon(10, { level: 1, real: true });
  fx.active = [ee, weak];
  E.useMoveFx(fx, move("Electric", "Special", 200), ee, weak, draws(NO_CRIT, ROLL));
  ABILITY_REGISTRY.Eelevate.onSourceKO({ fx, self: ee, note: (t) => fx.note(t) });
  assertEqual(Object.values(ee.stages).filter((x) => x === 1).length, 1, "…and +1 to its highest stat after a knockout");
}
{
  const sh = mon(292, { real: true }), a = mon(143); covers("Wonder Guard");
  sh.ability = "Wonder Guard";
  assertEqual(use(field(draws()), move("Water"), a, sh).damage, 0, "Wonder Guard (Shedinja): neutral hits do nothing (same rule as the legacy engine)");
  assertTrue(use(field(draws(NO_CRIT, ROLL)), move("Fire", "Special", 40), a, sh).damage === 1, "…super-effective hits land");
  assertTrue(use(field(draws(NO_CRIT, ROLL)), move("Water"), megaMon("mega-gyarados"), mon(292, { ability: "Wonder Guard" })).damage > 0, "Mold Breaker breaks Wonder Guard (a neutral Water move damages Shedinja)");
}
{
  const vi = mon(71, { ability: "Innards Out", real: true }), a = mon(143, { real: true }); covers("Innards Out");
  vi.hp = 30;
  const fx = field(draws(NO_CRIT, ROLL));
  use(fx, move("Normal", "Physical", 200), a, vi);
  assertEqual([vi.hp, a.maxHp - a.hp], [0, 30], "Innards Out: the attacker loses HP equal to the HP the holder had left");
}

// ------------------------------------------------------------------
section("Weather and terrain");
{
  const cy = megaMon("mega-charizard-y"), t = mon(143); covers("Drought");
  const fx = field(); fx.active = [cy, t];
  E.runEntries(fx, [{ mon: cy, side: 0 }]);
  assertEqual([fx.weather.kind, fx.weather.turns, fx.notes[0]], ["sun", 5, "Mega Charizard Y's Drought: The sunlight turned harsh!"], "Drought sets 5 turns of sun on entry");
  assertEqual(use(fx, move("Fire", "Special", 90), cy, t, draws(NO_CRIT, ROLL)).damage, ref({ power: 90, a: cy.spa, d: t.spd, stab: 1.5, final: 1.5 }), "sun: Fire 1.5×");
  assertEqual(use(fx, move("Water", "Special", 90), t, cy, draws(NO_CRIT, ROLL)).damage, ref({ power: 90, a: t.spa, d: cy.spd, eff: 2, final: 0.5 }), "sun: Water 0.5×");
  for (let i = 0; i < 4; i++) E.runResidual(fx);
  assertEqual(fx.weather?.kind, "sun", "still sunny after 4 end-of-turns");
  E.runResidual(fx);
  assertEqual([fx.weather, fx.notes.at(-1)], [null, "The harsh sunlight faded."], "…ends after the 5th, with a message");
}
{
  const ty = megaMon("mega-tyranitar"), cy = megaMon("mega-charizard-y"), t = mon(143); covers("Sand Stream");
  const fx = field(); fx.active = [cy, ty];
  E.runEntries(fx, [{ mon: cy, side: 0 }, { mon: ty, side: 1 }]);
  assertEqual(fx.weather.kind, "sand", "both set weather on entry: faster first (Charizard Y 100 Spe > Tyranitar 71), so the slower Sand Stream wins");
  fx.active = [t, ty];
  E.runResidual(fx);
  assertEqual(t.maxHp - t.hp, Math.floor(t.maxHp / 16), "sandstorm: 1/16 chip to non-Rock/Ground/Steel");
  assertEqual(ty.hp, ty.maxHp, "…Rock-types are immune");
  assertEqual(use(fx, move("Water", "Special", 80), t, ty, draws(NO_CRIT, ROLL)).damage, ref({ power: 80, a: t.spa, d: Math.floor(ty.spd * 1.5), eff: 2 }), "sandstorm: Rock-types' Sp. Def 1.5×");
}
{
  const ga = megaMon("mega-garchomp"), st = megaMon("mega-steelix"), t = mon(143); covers("Sand Force");
  const fx = field(); fx.setWeather("sand", { name: "x", ability: "Sand Stream" });
  assertEqual(use(fx, move("Ground", "Physical", 90), ga, t, draws(NO_CRIT, ROLL)).damage, ref({ power: 117, a: ga.atk, d: t.def, stab: 1.5 }), "Sand Force: Ground/Rock/Steel 1.3× in sand");
  fx.active = [ga, st];
  E.runResidual(fx);
  assertEqual(ga.hp, ga.maxHp, "Sand Force: no sand chip (Garchomp is also Ground)");
  const p = mon(143, { ability: "Sand Force" }); fx.active = [p, t]; E.runResidual(fx);
  assertEqual(p.hp, p.maxHp, "Sand Force holder of another type is immune to sand chip");
}
{
  const ab = megaMon("mega-abomasnow"), t = mon(143), ice = mon(131, { types: ["Ice"] }); covers("Snow Warning");
  const fx = field(); fx.active = [ab, t];
  E.runEntries(fx, [{ mon: ab, side: 0 }]);
  assertEqual(fx.weather.kind, "snow", "Snow Warning sets snow (Gen 9)");
  E.runResidual(fx);
  assertEqual(t.hp, t.maxHp, "snow: no chip damage");
  assertEqual(use(fx, move("Fighting", "Physical", 80), t, ice, draws(NO_CRIT, ROLL)).damage, ref({ power: 80, a: t.atk, d: Math.floor(ice.def * 1.5), eff: 2 }), "snow: Ice-types' Defense 1.5×");
}
{
  const h = megaMon("mega-houndoom"), t = mon(143); covers("Solar Power");
  const fx = field(); fx.setWeather("sun", { name: "x", ability: "Drought" }); fx.active = [h, t];
  assertEqual(use(fx, move("Dark", "Special", 80), h, t, draws(NO_CRIT, ROLL)).damage, ref({ power: 80, a: Math.floor(h.spa * 1.5), d: t.spd, stab: 1.5 }), "Solar Power: Sp. Atk 1.5× in sun");
  E.runResidual(fx);
  assertEqual(h.maxHp - h.hp, Math.floor(h.maxHp / 8), "…and loses 1/8 max HP at the end of each sunny turn");
}
{
  const sw = megaMon("mega-swampert"), t = mon(143); covers("Swift Swim");
  const fx = field(); fx.active = [sw, t];
  const plain = E.speedOf(fx, sw);
  fx.weather = { kind: "rain", turns: 5 };
  assertEqual(E.speedOf(fx, sw), plain * 2, "Swift Swim: Speed 2× in rain");
  assertEqual(use(fx, move("Water", "Special", 80), sw, t, draws(NO_CRIT, ROLL)).damage, ref({ power: 80, a: sw.spa, d: t.spd, stab: 1.5, final: 1.5 }), "rain: Water 1.5×");
}
{
  const ra = megaMon("mega-rayquaza"), t = mon(143); covers("Delta Stream");
  const fx = field(); fx.active = [ra, t];
  E.runEntries(fx, [{ mon: ra, side: 0 }]);
  assertEqual(fx.weather.kind, "winds", "Delta Stream: strong winds (Mega Rayquaza stays blocked from battles)");
  assertEqual(use(fx, move("Ice", "Special", 80), t, ra, draws(NO_CRIT, ROLL)).eff, 2, "strong winds: Ice on Dragon/Flying Rayquaza is 2× (Flying weakness removed, Dragon weakness stays) instead of 4×");
  fx.setWeather("sun", { name: "x", ability: "Drought" });
  assertEqual(fx.weather.kind, "winds", "strong winds can't be replaced by ordinary weather");
  ra.hp = 0; E.runResidual(fx);
  assertEqual(fx.weather, null, "…and end when the setter is gone");
}
{
  const r = mon(26, { ability: "Electric Surge" }), t = mon(143), flyer = mon(18); covers("Electric Surge");
  const fx = field(); fx.active = [r, t];
  E.runEntries(fx, [{ mon: r, side: 0 }]);
  assertEqual([fx.terrain.kind, fx.terrain.turns], ["electric", 5], "Electric Surge: Electric Terrain for 5 turns");
  assertEqual(use(fx, move("Electric", "Special", 90), r, t, draws(NO_CRIT, ROLL)).damage, ref({ power: 117, a: r.spa, d: t.spd, stab: 1.5 }), "grounded user's Electric moves 1.3×");
  assertEqual(use(fx, move("Electric", "Special", 90), flyer, t, draws(NO_CRIT, ROLL)).damage, ref({ power: 90, a: flyer.spa, d: t.spd }), "…not for a Flying-type user (not grounded)");
}
{
  const me = mon(154, { ability: "Mega Sol" }), t = mon(143); covers("Mega Sol");
  assertEqual(use(field(draws(NO_CRIT, ROLL)), move("Fire", "Special", 90), me, t).damage, ref({ power: 90, a: me.spa, d: t.spd, final: 1.5 }), "Mega Sol (Z-A): its own moves act as in sun without any weather");
}
{
  const fl = mon(670, { ability: "Fairy Aura" }), zy = mon(718, { ability: "Aura Break" }), t = mon(143); covers("Fairy Aura", "Aura Break");
  const fx = field(); fx.active = [fl, t];
  assertEqual(use(fx, move("Fairy", "Special", 90), fl, t, draws(NO_CRIT, ROLL)).damage, ref({ power: 120, a: fl.spa, d: t.spd, stab: 1.5 }), "Fairy Aura: Fairy moves 4/3× (90 → 120)");
  fx.active = [fl, zy];
  assertEqual(use(fx, move("Fairy", "Special", 90), fl, zy, draws(NO_CRIT, ROLL)).damage, ref({ power: 68, a: fl.spa, d: zy.spd, stab: 1.5, eff: 2 }), "Aura Break reverses it to 0.75× (90 → 68)");
}

// ------------------------------------------------------------------
section("Entry and stat-change abilities");
{
  const mn = megaMon("mega-manectric"), t = mon(143); covers("Intimidate");
  const fx = field(); fx.active = [mn, t];
  E.runEntries(fx, [{ mon: mn, side: 0 }]);
  assertEqual([t.stages.atk, fx.notes], [-1, ["Mega Manectric's Intimidate!", "Mega Manectric's Intimidate: #143's Attack fell!"]], "Intimidate: −1 Attack to the foe on entry");
  const ga = megaMon("mega-gallade"); covers("Inner Focus");
  const fx2 = field(); fx2.active = [mn, ga];
  E.runEntries(fx2, [{ mon: mn, side: 0 }]);
  assertEqual(ga.stages.atk, 0, "Inner Focus blocks Intimidate (Gen 8+)");
  const lo = megaMon("mega-lopunny"); fx2.active = [mn, lo]; E.runEntries(fx2, [{ mon: mn, side: 0 }]);
  assertEqual(lo.stages.atk, 0, "Scrappy blocks Intimidate (Gen 8+)");
  const ct = mon(398, { ability: "Contrary" }); covers("Contrary"); fx2.active = [mn, ct]; E.runEntries(fx2, [{ mon: mn, side: 0 }]);
  assertEqual(ct.stages.atk, 1, "Contrary turns Intimidate's −1 into +1");
  const de = mon(870, { ability: "Defiant" }); covers("Defiant"); fx2.active = [mn, de]; E.runEntries(fx2, [{ mon: mn, side: 0 }]);
  assertEqual(de.stages.atk, 1, "Defiant: −1 from Intimidate, then +2 = +1");
}
{
  const al = megaMon("mega-alakazam"), mn = megaMon("mega-manectric"); covers("Trace");
  const fx = field(); fx.active = [al, mn];
  E.runEntries(fx, [{ mon: al, side: 0 }]);
  assertEqual([al.ability, mn.stages.atk], ["Intimidate", -1], "Trace copies the foe's Intimidate and it activates immediately");
  const al2 = megaMon("mega-alakazam"), plain = mon(143); fx.active = [al2, plain];
  E.runEntries(fx, [{ mon: al2, side: 0 }]);
  assertEqual(al2.ability, "Trace", "Trace does nothing against a battler without an ability");
}
{
  const bz = megaMon("mega-blaziken"), t = mon(143); covers("Speed Boost");
  const fx = field(); fx.active = [bz, t];
  const s0 = E.speedOf(fx, bz);
  E.runResidual(fx); E.runResidual(fx);
  assertEqual([bz.stages.spe, E.speedOf(fx, bz)], [2, s0 * 2], "Speed Boost: +1 Speed at every end of turn (affects turn order)");
}
{
  const dr = mon(780, { ability: "Berserk", real: true }), a = mon(143); covers("Berserk");
  dr.hp = Math.floor(dr.maxHp * 0.55);
  use(field(draws(NO_CRIT, ROLL)), move("Fighting", "Physical", 60), a, dr);
  assertTrue(dr.hp > 0 && dr.hp <= dr.maxHp / 2 && dr.stages.spa === 1, "Berserk: +1 Sp. Atk when a hit drops it from above half to half HP or below");
  use(field(draws(NO_CRIT, ROLL)), move("Normal", "Physical", 10), a, dr);
  assertEqual(dr.stages.spa, 1, "…only once per crossing (already below half)");
}
{
  const mg = mon(801, { ability: "Soul-Heart" }), a = mon(143), b = mon(10, { level: 1 }); covers("Soul-Heart");
  const fx = field(); fx.active = [mg, b];
  E.onAnyFaint(fx, b);
  assertEqual(mg.stages.spa, 1, "Soul-Heart: +1 Sp. Atk whenever another battler faints");
  void a;
}
{
  const bx = mon(998, { ability: "Thermal Exchange" }), f = mon(6); covers("Thermal Exchange");
  use(field(draws(NO_CRIT, ROLL)), move("Fire", "Special", 40), f, bx);
  assertEqual(bx.stages.atk, 1, "Thermal Exchange: +1 Attack when hit by a Fire move");
  const fx = field();
  assertEqual(fx.setStatus(bx, "brn", f, "x"), false, "…and can't be burned");
}

// ------------------------------------------------------------------
section("Burn (reusable status) and contact abilities");
{
  const fx = field(); const a = mon(143, { real: true }), fire = mon(6);
  assertEqual([fx.setStatus(fire, "brn", a, "x"), fx.setStatus(a, "brn", fire, "burned"), fx.setStatus(a, "brn", fire, "again")], [false, true, false], "burn: Fire-types immune; one status at a time");
  const t = mon(143);
  assertEqual(use(field(draws(NO_CRIT, ROLL)), move("Normal", "Physical", 80), a, t).damage, ref({ power: 80, a: a.atk, d: t.def, stab: 1.5, final: 0.5 }), "burn halves physical damage");
  assertEqual(use(field(draws(NO_CRIT, ROLL)), move("Normal", "Special", 80), a, t).damage, ref({ power: 80, a: a.spa, d: t.spd, stab: 1.5 }), "…not special damage");
  fx.active = [a, t]; E.runResidual(fx);
  assertEqual(a.maxHp - a.hp, Math.floor(a.maxHp / 16), "burn: 1/16 max HP at the end of each turn");
}
{
  const he = mon(485, { ability: "Flame Body" }), a = mon(143); covers("Flame Body");
  use(field(draws(NO_CRIT, ROLL, 0.29)), move("Normal", "Physical", 40, { contact: true }), a, he);
  assertEqual(a.status, "brn", "Flame Body: contact → 30% burn (roll 0.29 burns)");
  const b = mon(143);
  use(field(draws(NO_CRIT, ROLL, 0.3)), move("Normal", "Physical", 40, { contact: true }), b, he);
  assertEqual(b.status, null, "…roll 0.30 doesn't");
  const c = mon(143), fx = field(draws(NO_CRIT, ROLL));
  use(fx, move("Normal", "Special", 40), c, he);
  assertEqual([c.status, fx.rng.left()], [null, 0], "…non-contact moves don't even roll");
}
{
  const sv = mon(952, { ability: "Spicy Spray" }), a = mon(143); covers("Spicy Spray");
  use(field(draws(NO_CRIT, ROLL)), move("Normal", "Special", 40), a, sv);
  assertEqual(a.status, "brn", "Spicy Spray (Z-A): any damaging hit burns the attacker");
}

// ------------------------------------------------------------------
section("No-effect abilities are explicit, never silently 'working'");
const noEffect = Object.entries(ABILITY_REGISTRY).filter(([, a]) => a.status === "no-effect");
assertEqual(noEffect.length, 13, "13 abilities have no effect in Coop's battle format");
assertTrue(noEffect.every(([, a]) => typeof a.reason === "string" && a.reason.length > 10 && !Object.keys(a).some((k) => k.startsWith("on") || ["stab", "noGuard", "moldBreaker", "multihit"].includes(k))), "each has a reason and no hooks");
{
  const g = megaMon("mega-gengar"), t = mon(143);
  const fx = field(); fx.active = [g, t]; E.runEntries(fx, [{ mon: g, side: 0 }]); E.runResidual(fx);
  assertEqual([fx.notes, g.stages, t.stages], [[], { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, accuracy: 0, evasion: 0 }, { atk: 0, def: 0, spa: 0, spd: 0, spe: 0, accuracy: 0, evasion: 0 }], "Mega Gengar (Shadow Tag) battles with its stats and types only — nothing claims an effect");
}
{
  const m = mon(143, { ability: "Made Up Ability" });
  const r = use(field(draws(NO_CRIT, ROLL)), move("Normal"), m, mon(143));
  assertTrue(r.damage > 0 && !r.notes, "an unknown ability name is ignored safely (no crash, no effect)");
}

// ------------------------------------------------------------------
section("Registry metadata agrees with Showdown");
const breakMismatch = Object.entries(ABILITY_REGISTRY).filter(([n, a]) => a.status === "implemented" && !a.nonMega && !!a.breakable !== !!Dex.abilities.get(n).flags?.breakable).map(([n]) => n);
assertEqual(breakMismatch, [], "every implemented ability's Mold Breaker 'breakable' flag matches Showdown");
const traceMismatch = ["Trace", "Commander"].filter((n) => !(Dex.abilities.get(n).flags?.notrace || Dex.abilities.get(n).flags?.failroleplay));
assertEqual(traceMismatch, [], "abilities Trace can't copy match Showdown's notrace flags");
const moveFlags = (await import("fs")).default;
const flags = JSON.parse(moveFlags.readFileSync(new URL("../data/battle/move-flags.json", import.meta.url), "utf8")).moves;
assertTrue(flags.crunch?.bite && flags.firepunch?.punch && flags.aurasphere?.pulse && flags.aurasphere?.bullet && flags.xscissor?.slicing && flags.closecombat?.contact && !flags.flamethrower?.contact && flags.flamethrower?.secondary, "move flags spot-check (Crunch bite, Fire Punch punch, Aura Sphere pulse+bullet, X-Scissor slicing, Close Combat contact, Flamethrower secondary non-contact)");

section("Coverage: every implemented ability exercised");
const implemented = Object.entries(ABILITY_REGISTRY).filter(([, a]) => a.status === "implemented").map(([n]) => n).sort();
assertEqual(implemented.filter((n) => !covered.has(n)), [], `all ${implemented.length} implemented abilities are covered by this file`);
assertEqual(implemented.length, 57, "57 implemented (56 Mega abilities + Wonder Guard)");
void computeStats; void phys; void getMove;

finish();
