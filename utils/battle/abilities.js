// ==========================================================
// utils/battle/abilities.js — the ability registry (Mega Evolution M2).
//
// One entry per ability: a status, the source of the rule, and hooks the
// battle engine (utils/battle/effects.js) calls at fixed points. Nothing
// here is Mega-specific: any battler with an `ability` uses it. Ordinary
// Pokémon have no ability in Coop's battles today (unchanged), so this file
// only affects battles that contain a Mega (and Shedinja inside such a
// battle, whose Wonder Guard is expressed here with the same rule as the
// legacy engine).
//
// status:
//   "implemented" — modelled and covered by tests/megaAbilities.test.js
//   "no-effect"   — nothing in Coop's battle format can trigger it (reason)
// Rules follow Pokémon Showdown (Gen 9 mechanics, the same source as the
// type chart and the Mega data); "Future" (Legends: Z-A) rules are marked.
//
// Hook context `c` (see effects.js): { fx, self, foe, attacker, target,
// move, mt (move type), power, eff, damage, hpBefore, note(text), rng }.
// Multipliers return a number (1 = no change); predicates return booleans.
// ==========================================================

const SHOWDOWN = "Pokémon Showdown data (@pkmn/dex 0.10.12), Gen 9 rules";
const FUTURE = "Pokémon Showdown 'Future' (Legends: Z-A) rule — unverified official data";
const ate = (type) => ({
  onModifyType: (c) => (c.move.type === "Normal" ? { type, mult: 1.2 } : null),
});
const flagBoost = (flag, mult) => ({ onBasePower: (c) => (c.move.flags?.[flag] ? mult : 1) });
const setWeather = (kind) => ({ onEntry: (c) => c.fx.setWeather(kind, c.self) });
const absorb = (type, then) => ({
  breakable: true,
  onTryHit: (c) => {
    if (c.mt !== type) return null;
    then?.(c);
    return { immune: true };
  },
});

export const ABILITY_REGISTRY = Object.freeze({
  // ---------------- offence: power, stats, type ----------------
  "Adaptability": { status: "implemented", source: SHOWDOWN, stab: () => 2 },
  "Aerilate": { status: "implemented", source: SHOWDOWN, ...ate("Flying") },
  "Pixilate": { status: "implemented", source: SHOWDOWN, ...ate("Fairy") },
  "Refrigerate": { status: "implemented", source: SHOWDOWN, ...ate("Ice") },
  "Dragonize": { status: "implemented", source: FUTURE, ...ate("Dragon") },
  "Huge Power": { status: "implemented", source: SHOWDOWN, onModifyAtk: (c) => (c.move.category === "Physical" ? 2 : 1) },
  "Pure Power": { status: "implemented", source: SHOWDOWN, onModifyAtk: (c) => (c.move.category === "Physical" ? 2 : 1) },
  "Technician": { status: "implemented", source: SHOWDOWN, onBasePower: (c) => (c.power <= 60 ? 1.5 : 1) },
  "Tough Claws": { status: "implemented", source: SHOWDOWN, ...flagBoost("contact", 1.3) },
  "Iron Fist": { status: "implemented", source: SHOWDOWN, ...flagBoost("punch", 1.2) },
  "Strong Jaw": { status: "implemented", source: SHOWDOWN, ...flagBoost("bite", 1.5) },
  "Mega Launcher": { status: "implemented", source: SHOWDOWN, ...flagBoost("pulse", 1.5) },
  "Sharpness": { status: "implemented", source: SHOWDOWN, ...flagBoost("slicing", 1.5) },
  "Sheer Force": { status: "implemented", source: SHOWDOWN, ...flagBoost("secondary", 1.3), note: "Secondary effects aren't simulated, so only the 1.3× power applies." },
  "Fire Mane": { status: "implemented", source: FUTURE, onModifyAtk: (c) => (c.mt === "Fire" ? 1.5 : 1) },
  "Sand Force": {
    status: "implemented", source: SHOWDOWN, weatherImmune: ["sand"],
    onBasePower: (c) => (c.fx.weatherIs("sand") && ["Rock", "Ground", "Steel"].includes(c.mt) ? 1.3 : 1),
  },
  "Solar Power": {
    status: "implemented", source: SHOWDOWN,
    onModifyAtk: (c) => (c.move.category === "Special" && c.fx.weatherIs("sun") ? 1.5 : 1),
    onResidual: (c) => { if (c.fx.weatherIs("sun")) c.fx.chip(c.self, 8, `${c.self.name} was hurt by its Solar Power!`); },
  },
  "Mega Sol": { status: "implemented", source: FUTURE, ownWeather: "sun" },
  "Flash Fire": {
    status: "implemented", source: SHOWDOWN, breakable: true,
    onTryHit: (c) => {
      if (c.mt !== "Fire") return null;
      if (!c.target.flashFire) { c.target.flashFire = true; c.note(`${c.target.name}'s Flash Fire raised the power of its Fire-type moves!`); }
      else c.note(`It doesn't affect ${c.target.name}...`);
      return { immune: true, silent: true };
    },
    onModifyAtk: (c) => (c.attacker.flashFire && c.mt === "Fire" ? 1.5 : 1),
  },
  "Skill Link": { status: "implemented", source: SHOWDOWN, multihit: "max" },
  "Parental Bond": { status: "implemented", source: SHOWDOWN, multihit: "parental" },
  "No Guard": { status: "implemented", source: SHOWDOWN, noGuard: true },
  "Scrappy": {
    status: "implemented", source: SHOWDOWN, blocksIntimidate: true,
    ignoresGhostImmunity: ["Normal", "Fighting"],
  },
  "Mold Breaker": { status: "implemented", source: SHOWDOWN, moldBreaker: true, onEntry: (c) => c.note(`${c.self.name} breaks the mold!`) },
  "Protean": {
    status: "implemented", source: SHOWDOWN, note: "Gen 9: once per entry.",
    onBeforeMove: (c) => {
      if (c.attacker.proteanUsed || (c.attacker.types.length === 1 && c.attacker.types[0] === c.mt)) return;
      c.attacker.types = [c.mt];
      c.attacker.proteanUsed = true;
      c.note(`${c.attacker.name} transformed into the ${c.mt} type!`);
    },
  },
  "Fairy Aura": { status: "implemented", source: SHOWDOWN, aura: "Fairy", onEntry: (c) => c.note(`${c.self.name} is radiating a fairy aura!`) },
  "Aura Break": { status: "implemented", source: SHOWDOWN, breakable: true, auraBreak: true, onEntry: (c) => c.note(`${c.self.name} reversed all other Pokémon's auras!`) },

  // ---------------- defence ----------------
  "Thick Fat": { status: "implemented", source: SHOWDOWN, breakable: true, onSourceModifyAtk: (c) => (c.mt === "Fire" || c.mt === "Ice" ? 0.5 : 1) },
  "Filter": { status: "implemented", source: SHOWDOWN, breakable: true, onFinalDamage: (c) => (c.eff > 1 ? 0.75 : 1) },
  "Multiscale": { status: "implemented", source: SHOWDOWN, breakable: true, onFinalDamage: (c) => (c.target.hp === c.target.maxHp ? 0.5 : 1) },
  "Aura Guard": { status: "implemented", source: FUTURE, breakable: true, onFinalDamage: (c) => (c.move.flags?.contact ? 0.5 : 1) },
  "Shell Armor": { status: "implemented", source: SHOWDOWN, breakable: true, critImmune: true },
  "Levitate": { status: "implemented", source: SHOWDOWN, breakable: true, grounded: false, ...absorb("Ground") },
  "Bulletproof": {
    status: "implemented", source: SHOWDOWN, breakable: true,
    onTryHit: (c) => (c.move.flags?.bullet ? { immune: true } : null),
  },
  "Volt Absorb": {
    status: "implemented", source: SHOWDOWN,
    ...absorb("Electric", (c) => c.fx.heal(c.target, 4, `${c.target.name} restored HP using its Volt Absorb!`)),
  },
  "Lightning Rod": {
    status: "implemented", source: SHOWDOWN,
    ...absorb("Electric", (c) => c.fx.boost(c.target, { spa: 1 }, c.target, "Lightning Rod")),
  },
  "Storm Drain": {
    status: "implemented", source: SHOWDOWN,
    ...absorb("Water", (c) => c.fx.boost(c.target, { spa: 1 }, c.target, "Storm Drain")),
  },
  "Eelevate": {
    status: "implemented", source: FUTURE, grounded: false, ...absorb("Ground"),
    onSourceKO: (c) => {
      const best = ["atk", "def", "spa", "spd", "spe"].reduce((b, s) => (c.fx.stat(c.self, s) > c.fx.stat(c.self, b) ? s : b), "atk");
      c.fx.boost(c.self, { [best]: 1 }, c.self, "Eelevate");
    },
  },
  "Wonder Guard": {
    status: "implemented", source: "Coop legacy rule (Shedinja), same as Showdown", breakable: true, nonMega: true,
    onTryHit: (c) => (c.eff <= 1 ? { immune: true } : null),
  },
  "Innards Out": {
    status: "implemented", source: SHOWDOWN,
    onFaintedBy: (c) => c.fx.damage(c.attacker, c.damage, `${c.attacker.name} was hurt by ${c.target.name}'s Innards Out!`, c.target),
  },

  // ---------------- weather, terrain, entry ----------------
  "Drought": { status: "implemented", source: SHOWDOWN, ...setWeather("sun") },
  "Sand Stream": { status: "implemented", source: SHOWDOWN, ...setWeather("sand") },
  "Snow Warning": { status: "implemented", source: SHOWDOWN, ...setWeather("snow"), note: "Gen 9: snow (Ice-types' Defense ×1.5; no chip damage)." },
  "Delta Stream": { status: "implemented", source: SHOWDOWN, ...setWeather("winds"), note: "Only Mega Rayquaza, which stays blocked." },
  "Electric Surge": { status: "implemented", source: SHOWDOWN, onEntry: (c) => c.fx.setTerrain("electric", c.self) },
  "Swift Swim": { status: "implemented", source: SHOWDOWN, onModifySpe: (c) => (c.fx.weatherIs("rain") ? 2 : 1), note: "No Mega or Coop battler can set rain yet." },
  "Intimidate": {
    status: "implemented", source: SHOWDOWN,
    onEntry: (c) => {
      if (!c.foe || c.foe.hp <= 0) return;
      c.note(`${c.self.name}'s Intimidate!`);
      if (c.fx.hasAbility(c.foe, (a) => a.blocksIntimidate)) { c.note(`${c.foe.name}'s ${c.foe.ability} prevents it from being intimidated!`); return; }
      c.fx.boost(c.foe, { atk: -1 }, c.self, "Intimidate");
    },
  },
  "Inner Focus": { status: "implemented", source: SHOWDOWN, breakable: true, blocksIntimidate: true },
  "Trace": {
    status: "implemented", source: SHOWDOWN,
    onEntry: (c) => {
      const theirs = c.foe?.ability;
      const entry = theirs && ABILITY_REGISTRY[theirs];
      if (!entry || entry.noTrace || theirs === "Trace") return;
      c.self.ability = theirs;
      c.note(`${c.self.name} traced ${c.foe.name}'s ${theirs}!`);
      entry.onEntry?.({ ...c, self: c.self });
    },
  },

  // ---------------- stat stages ----------------
  "Speed Boost": {
    status: "implemented", source: SHOWDOWN,
    note: "Activates at the end of every turn: battlers only enter at the start of a turn in Coop (no mid-turn switching), which matches Showdown's 'first full turn' rule.",
    onResidual: (c) => c.fx.boost(c.self, { spe: 1 }, c.self, "Speed Boost"),
  },
  "Contrary": { status: "implemented", source: SHOWDOWN, invertsBoosts: true, breakable: true },
  "Defiant": { status: "implemented", source: SHOWDOWN, onFoeLoweredStat: (c) => c.fx.boost(c.self, { atk: 2 }, c.self, "Defiant") },
  "Berserk": {
    status: "implemented", source: SHOWDOWN,
    onDamagingHit: (c) => { if (c.hpBefore > c.target.maxHp / 2 && c.target.hp > 0 && c.target.hp <= c.target.maxHp / 2) c.fx.boost(c.target, { spa: 1 }, c.target, "Berserk"); },
  },
  "Soul-Heart": { status: "implemented", source: SHOWDOWN, onAnyFaint: (c) => c.fx.boost(c.self, { spa: 1 }, c.self, "Soul-Heart") },
  "Thermal Exchange": {
    status: "implemented", source: SHOWDOWN, breakable: true, statusImmune: ["brn"],
    onDamagingHit: (c) => { if (c.mt === "Fire" && c.target.hp > 0) c.fx.boost(c.target, { atk: 1 }, c.target, "Thermal Exchange"); },
  },

  // ---------------- status ----------------
  "Flame Body": {
    status: "implemented", source: SHOWDOWN,
    onDamagingHit: (c) => { if (c.move.flags?.contact && c.attacker.hp > 0 && c.rng.next() < 0.3) c.fx.setStatus(c.attacker, "brn", c.target, `${c.attacker.name} was burned by ${c.target.name}'s Flame Body!`); },
  },
  "Spicy Spray": {
    status: "implemented", source: FUTURE,
    onDamagingHit: (c) => { if (c.attacker.hp > 0) c.fx.setStatus(c.attacker, "brn", c.target, `${c.attacker.name} was burned by ${c.target.name}'s Spicy Spray!`); },
  },

  // ---------------- no effect in Coop's battle format ----------------
  "Unseen Fist": { status: "no-effect", reason: "Ignores protection; no protecting moves are simulated." },
  "Piercing Drill": { status: "no-effect", reason: "Hits through protection; no protecting moves are simulated." },
  "Stalwart": { status: "no-effect", reason: "Ignores redirection; singles battles have none." },
  "Infiltrator": { status: "no-effect", reason: "Ignores screens and substitutes; none are simulated." },
  "Regenerator": { status: "no-effect", reason: "Heals on switching out; battlers only leave by fainting." },
  "Insomnia": { status: "no-effect", reason: "Prevents sleep; no move or ability causes sleep." },
  "Steadfast": { status: "no-effect", reason: "Speed up on flinch; flinching isn't simulated." },
  "Prankster": { status: "no-effect", reason: "Priority for status moves; movesets hold only damaging moves." },
  "Magic Bounce": { status: "no-effect", reason: "Reflects status moves; movesets hold only damaging moves." },
  "Shadow Tag": { status: "no-effect", reason: "Prevents switching; there is no voluntary switching." },
  "Healer": { status: "no-effect", reason: "Cures an ally in doubles; battles are singles." },
  "Commander": { status: "no-effect", reason: "Doubles-only interaction with Dondozo." },
  "Bad Dreams": { status: "no-effect", reason: "Damages sleeping foes; no move or ability causes sleep." },
});

// Showdown's notrace / breakable lists for the abilities above (Trace can't
// copy Trace, Commander, Wonder Guard is copyable).
for (const name of ["Trace", "Commander"]) ABILITY_REGISTRY[name].noTrace = true;
// No-effect entries document their rule source too (Showdown; nothing in Coop triggers it).
for (const a of Object.values(ABILITY_REGISTRY)) a.source ??= SHOWDOWN;

export const getAbility = (name) => (typeof name === "string" && Object.prototype.hasOwnProperty.call(ABILITY_REGISTRY, name) ? ABILITY_REGISTRY[name] : null);
export const isAbilityImplemented = (name) => getAbility(name)?.status === "implemented";
export const isAbilityKnown = (name) => !!getAbility(name);
