// ==========================================================
// tests/heldItemBattle.test.js — held items in battle (utils/battle/items.js
// + the hooks in utils/battle/effects.js) and in battle EXP (Lucky Egg).
// Scripted random numbers check exact numbers; seeded battles check
// determinism and that battles without items are unchanged. Synthetic
// players only.
// ==========================================================

import { assertTrue, assertEqual, section, finish } from "./harness.js";
import * as E from "../utils/battle/effects.js";
import { buildMon, simulateBattle, memberMoves } from "../utils/battle/sim.js";
import { autoMoveset } from "../utils/battle/moveset.js";
import { getSpecies } from "../utils/battle/data.js";
import { createRng } from "../utils/battle/rng.js";
import { ITEM_REGISTRY, isCombatItem, expMultiplierFor, canEvolve, Q } from "../utils/battle/items.js";
import { HELD_ITEM_IDS } from "../catalog/heldItems.js";
import { buildTeam, buildBattleTeam, runBattle } from "../utils/battle/runBattle.js";
import { teamPower } from "../utils/battle/power.js";
import { createNewUser } from "../utils/userSchema.js";
import { grantCatch, getTraining, expForLevel } from "../utils/training.js";
import { teamExp } from "../utils/battle/rewards.js";
import { LEVEL_CAP } from "../utils/battle/tuning.js";
import { normalizeBox } from "../services/box.js";

const draws = (...values) => {
  const next = () => {
    if (!values.length) throw new Error("the engine drew more random numbers than expected");
    return values.shift();
  };
  return { next, int: (n) => Math.floor(next() * n), left: () => values.length };
};
const NO_CRIT = 0.99, ROLL = 0.5;
const prep = (m, name) => E.prepareBattler(m, autoMoveset(m.speciesId, m.level), name);
const mon = (speciesId, { level = 50, item = null, name = null } = {}) => prep(buildMon({ speciesId, level, ...(item && { item }) }), name ?? `#${speciesId}`);
const move = (type, category = "Physical", power = 80, extra = {}) => ({ name: `${type} test`, type, category, power, accuracy: true, critRatio: 1, flags: {}, ...extra });
const use = (fx, mv, atk, def) => { fx.active = [atk, def]; return E.useMoveFx(fx, mv, atk, def, fx.rng); };
const ON = { HELD_ITEMS_ENABLED: "1", HELD_ITEMS_BATTLES_ENABLED: "1" };

// ------------------------------------------------------------------
section("Registry and catalog agree");
assertEqual(HELD_ITEM_IDS.length, 33, "33 launch items in the catalog");
assertEqual(HELD_ITEM_IDS.filter((id) => !ITEM_REGISTRY[id]), [], "every catalog item has a registry entry");
assertEqual(Object.keys(ITEM_REGISTRY).filter((id) => !HELD_ITEM_IDS.includes(id)), [], "the registry has no item the catalog lacks");
for (const deferred of ["choice_band", "choice_specs", "choice_scarf", "life_orb", "rocky_helmet", "assault_vest"]) {
  assertTrue(!ITEM_REGISTRY[deferred] && !HELD_ITEM_IDS.includes(deferred), `${deferred} is deferred (not active)`);
}
assertTrue(!isCombatItem("lucky_egg") && isCombatItem("leftovers"), "Lucky Egg is not a combat item; Leftovers is");

// ------------------------------------------------------------------
section("Battles without items are unchanged");
{
  // Members carry no `item` field: the battler is byte-identical to before.
  const plain = buildMon({ speciesId: 6, level: 50 });
  assertTrue(!("item" in plain), "a member without an item builds a battler with no item field");
  // Non-combat or no-effect items must not change a battle at all: Lucky Egg
  // stays on the legacy loop; Eviolite on fully evolved Pokémon goes to the
  // effects engine, which must give the same result with the same draws.
  const rng = createRng(77);
  const ids = Array.from({ length: 649 }, (_, i) => i + 1).filter((id) => getSpecies(id) && !canEvolve(id) && id !== 292);
  let same = 0;
  const N = 400;
  for (let i = 0; i < N; i++) {
    const team = Array.from({ length: 6 }, () => ({ speciesId: ids[rng.int(ids.length)], level: 50 }));
    const seed = rng.int(2 ** 31);
    const a = simulateBattle({ sides: [{ members: team }, { members: team.slice().reverse() }], seed, surge: null });
    const b = simulateBattle({ sides: [{ members: team.map((m) => ({ ...m, item: "eviolite" })) }, { members: team.slice().reverse().map((m) => ({ ...m, item: "lucky_egg" })) }], seed, surge: null });
    if (a.winner === b.winner && a.turns === b.turns && JSON.stringify(a.snapshots) === JSON.stringify(b.snapshots)) same++;
  }
  assertEqual(same, N, `inert items (Eviolite on fully evolved, Lucky Egg) change nothing in ${N} seeded battles (engine routing + RNG neutral)`);
}

{
  // The routing rule depends on this: with no ability and no item, the
  // effects engine reproduces the legacy loop exactly (same draws, same result).
  const rng = createRng(4242);
  const ids = Array.from({ length: 1025 }, (_, i) => i + 1).filter((id) => getSpecies(id) && id !== 292);
  let diff = 0;
  const N = 300;
  for (let i = 0; i < N; i++) {
    const sides = [0, 1].map(() => ({ members: Array.from({ length: 6 }, () => ({ speciesId: ids[rng.int(ids.length)], level: 50 })) }));
    const seed = rng.int(2 ** 31);
    const legacy = simulateBattle({ sides, seed, surge: null });
    const teams = sides.map((s) => s.members.map((m) => E.prepareBattler(buildMon(m), memberMoves(m), `#${m.speciesId}`)));
    const fx = E.simulateBattleFx({ teams, rng: createRng(seed) });
    if (legacy.winner !== fx.winner || legacy.turns !== fx.turns || JSON.stringify(legacy.snapshots) !== JSON.stringify(fx.snapshots)) diff++;
  }
  assertEqual(diff, 0, `the effects engine with no abilities/items matches the legacy loop (${N} battles)`);
}

// ------------------------------------------------------------------
section("Leftovers / Black Sludge (end of turn)");
{
  const fx = E.createField(draws());
  const a = mon(143, { item: "leftovers", name: "Snorlax" });
  const b = mon(6, { name: "Charizard" });
  fx.active = [a, b];
  a.hp = a.maxHp - 100;
  E.runResidual(fx);
  assertEqual(a.maxHp - a.hp, 100 - Math.floor(a.maxHp / 16), "heals ⌊maxHP/16⌋ at the end of the turn");
  assertTrue(fx.notes.includes("Snorlax restored a little HP using its Leftovers!"), "the battle log says so");
  fx.notes.length = 0;
  a.hp = a.maxHp - 3;
  E.runResidual(fx);
  assertEqual(a.hp, a.maxHp, "never heals above max HP");
  a.hp = a.maxHp; fx.notes.length = 0;
  E.runResidual(fx);
  assertEqual(fx.notes.length, 0, "no note at full HP");
  a.hp = 0;
  E.runResidual(fx);
  assertEqual(a.hp, 0, "never heals a fainted Pokémon");

  const fx2 = E.createField(draws());
  const muk = mon(89, { item: "black_sludge", name: "Muk" });
  const pika = mon(25, { item: "black_sludge", name: "Pikachu" });
  fx2.active = [muk, pika];
  muk.hp -= 50;
  const before = pika.hp;
  E.runResidual(fx2);
  assertEqual(muk.maxHp - muk.hp, 50 - Math.floor(muk.maxHp / 16), "Black Sludge heals a Poison type ⌊maxHP/16⌋");
  assertEqual(before - pika.hp, Math.floor(pika.maxHp / 8), "…and hurts anyone else ⌊maxHP/8⌋");
}

// ------------------------------------------------------------------
section("Sitrus Berry (once per battle)");
{
  const fx = E.createField(draws(NO_CRIT, ROLL, NO_CRIT, ROLL));
  const atk = mon(6, { level: 50 });
  const def = mon(143, { item: "sitrus_berry", name: "Snorlax" });
  def.hp = Math.floor(def.maxHp / 2) + 5;
  const hpBefore = def.hp;
  const r = use(fx, move("Fire", "Special", 40), atk, def);
  assertEqual(def.hp, hpBefore - r.damage + Math.floor(def.maxHp / 4), "falls to ≤ 50% → heals ⌊maxHP/4⌋ right after the hit");
  assertTrue(def.itemUsed === true && (r.notes ?? []).some((t) => /Sitrus Berry/.test(t)), "marked used; the log names it");
  const hp2 = def.hp;
  def.hp = Math.min(def.hp, Math.floor(def.maxHp / 2));
  const hp3 = def.hp;
  use(fx, move("Fire", "Special", 40), atk, def);
  assertTrue(def.hp < hp3, "a second drop below 50% does not heal again in the same battle");
  void hp2;
  // Next battle: a fresh battler (prepareBattler) is ready again.
  const again = mon(143, { item: "sitrus_berry" });
  assertTrue(again.itemUsed === false, "the next battle starts with the berry ready");
}

// ------------------------------------------------------------------
section("Focus Sash / Focus Band (hang on with 1 HP)");
{
  const big = () => mon(6, { level: 100 });
  const fx = E.createField(draws(NO_CRIT, ROLL, NO_CRIT, ROLL));
  const sash = mon(10, { level: 5, item: "focus_sash", name: "Caterpie" });
  const r1 = use(fx, move("Fire", "Special", 150), big(), sash);
  assertEqual(sash.hp, 1, "at full HP, a KO hit leaves 1 HP");
  assertTrue((r1.notes ?? []).includes("Caterpie hung on using its Focus Sash!"), "the log says so");
  use(fx, move("Fire", "Special", 150), big(), sash);
  assertEqual(sash.hp, 0, "once per battle: the next KO hit knocks it out");

  const fx2 = E.createField(draws(NO_CRIT, ROLL));
  const sash2 = mon(10, { level: 5, item: "focus_sash" });
  sash2.hp -= 1;
  use(fx2, move("Fire", "Special", 150), big(), sash2);
  assertEqual(sash2.hp, 0, "not at full HP → no effect");

  // Multi-hit: the Sash saves the first lethal hit only; the second hit lands.
  const fx3 = E.createField(draws(NO_CRIT, ROLL, NO_CRIT, ROLL));
  const sash3 = mon(10, { level: 5, item: "focus_sash" });
  const r3 = use(fx3, move("Normal", "Physical", 150, { multihit: 2 }), big(), sash3);
  assertEqual([sash3.hp, r3.hits], [0, 2], "a multi-hit move's second hit still knocks it out");

  // Focus Band: one extra draw only on a lethal hit, 10% to survive, every time.
  const fx4 = E.createField(draws(NO_CRIT, ROLL, 0.05, NO_CRIT, ROLL, 0.05, NO_CRIT, ROLL, 0.5));
  const band = mon(10, { level: 5, item: "focus_band", name: "Caterpie" });
  use(fx4, move("Fire", "Special", 150), big(), band);
  assertEqual(band.hp, 1, "draw < 0.1 → survives with 1 HP");
  use(fx4, move("Fire", "Special", 150), big(), band);
  assertEqual(band.hp, 1, "not once per battle: it can save again (draw < 0.1)");
  use(fx4, move("Fire", "Special", 150), big(), band);
  assertEqual([band.hp, fx4.rng.left()], [0, 0], "draw ≥ 0.1 → knocked out; exactly one extra draw per lethal hit");

  const fx5 = E.createField(draws(NO_CRIT, ROLL));
  const band2 = mon(143, { item: "focus_band" });
  use(fx5, move("Fire", "Special", 20), mon(10, { level: 5 }), band2);
  assertEqual(fx5.rng.left(), 0, "a non-lethal hit draws nothing extra");
}

// ------------------------------------------------------------------
section("Bright Powder (accuracy ×0.9)");
{
  const fx = E.createField(draws());
  const atk = mon(6), def = mon(143, { item: "bright_powder" });
  fx.active = [atk, def];
  const p = E.prepareMove(fx, move("Fire", "Special", 90, { accuracy: 100 }), atk, def);
  assertEqual(p.accMult, Q(3686), "moves aimed at the holder: accuracy × 3686/4096");
  // 100-accuracy move: hits when draw < 0.9.
  const hit = E.createField(draws(0.89, NO_CRIT, ROLL));
  assertTrue(!use(hit, move("Fire", "Special", 40, { accuracy: 100 }), atk, mon(143, { item: "bright_powder" })).missed, "draw 0.89 < 0.9 → hits");
  const miss = E.createField(draws(0.9));
  assertTrue(use(miss, move("Fire", "Special", 40, { accuracy: 100 }), atk, mon(143, { item: "bright_powder" })).missed, "draw 0.90 → misses (it would hit without Bright Powder)");
  const sure = E.createField(draws(NO_CRIT, ROLL));
  assertTrue(!use(sure, move("Fire", "Special", 40, { accuracy: true }), atk, mon(143, { item: "bright_powder" })).missed && sure.rng.left() === 0, "moves that never miss are unaffected (no accuracy draw)");
  const own = E.createField(draws());
  const holder = mon(6, { item: "bright_powder" });
  own.active = [holder, def];
  assertEqual(E.prepareMove(own, move("Fire", "Special", 90, { accuracy: 100 }), holder, mon(143)).accMult, 1, "the holder's own moves are not affected");
}

// ------------------------------------------------------------------
section("Quick Claw (turn order)");
{
  const slow = mon(143, { item: "quick_claw", name: "Snorlax" }), fast = mon(101);
  const mv = move("Normal");
  const fx = E.createField(draws(0.1));
  assertEqual(E.firstToMoveFx(fx, [slow, fast], [mv, mv], fx.rng), 0, "draw < 0.2 → the slower holder moves first");
  assertTrue(fx.notes.includes("Snorlax's Quick Claw let it move first!"), "the log says so");
  const fx2 = E.createField(draws(0.5));
  assertEqual(E.firstToMoveFx(fx2, [slow, fast], [mv, mv], fx2.rng), 1, "draw ≥ 0.2 → normal Speed order");
  const fx3 = E.createField(draws());
  assertEqual(E.firstToMoveFx(fx3, [slow, fast], [mv, { ...mv, priority: 1 }], fx3.rng), 1, "a higher-priority move still goes first (no draw)");
  const fx4 = E.createField(draws());
  assertEqual(E.firstToMoveFx(fx4, [mon(143), fast], [mv, mv], fx4.rng), 1, "no holder → no draw at all");
}

// ------------------------------------------------------------------
section("Damage modifiers");
{
  const fx = E.createField(draws());
  const base = (item, mv, atkId = 6, defId = 3, opts = {}) => {
    const a = mon(atkId, { item, ...opts }), d = mon(defId);
    fx.active = [a, d];
    return E.expectedDamageFx(fx, mv, a, d);
  };
  const close = (x, y) => Math.abs(x - y) < 1e-9;
  const fire = move("Fire", "Special", 90);
  assertTrue(close(base("expert_belt", fire) / base(null, fire), Q(4915)), "Expert Belt: super-effective × 4915/4096");
  const neutral = move("Normal", "Physical", 80);
  assertTrue(close(base("expert_belt", neutral, 6, 143) / base(null, neutral, 6, 143), 1), "Expert Belt: no effect on neutral hits");
  assertTrue(close(base("charcoal", fire) / base(null, fire), Q(4915) * (Math.round(90 * Q(4915)) / 90) / Q(4915)), "Charcoal: Fire move power × 4915/4096 (rounded)");
  assertTrue(close(base("charcoal", neutral, 6, 143) / base(null, neutral, 6, 143), 1), "Charcoal: other types unchanged");
  assertTrue(close(base("muscle_band", neutral, 6, 143) / base(null, neutral, 6, 143), Math.round(80 * Q(4505)) / 80), "Muscle Band: physical power × 4505/4096");
  assertTrue(close(base("wise_glasses", neutral, 6, 143) / base(null, neutral, 6, 143), 1), "Wise Glasses: physical moves unchanged");
  const pika = move("Electric", "Special", 90);
  const lb = base("light_ball", pika, 25, 7) / base(null, pika, 25, 7);
  assertTrue(lb > 1.9 && lb <= 2, `Light Ball: Pikachu's Sp. Atk ×2 (ratio ${lb.toFixed(3)})`);
  assertTrue(close(base("light_ball", pika, 26, 7) / base(null, pika, 26, 7), 1), "Light Ball: no effect on Raichu");
  const tc = base("thick_club", neutral, 105, 143) / base(null, neutral, 105, 143);
  assertTrue(tc > 1.9 && tc <= 2, `Thick Club: Marowak's Attack ×2 (ratio ${tc.toFixed(3)})`);
  // Eviolite on the defender.
  const ev = (defId, item) => { const a = mon(6), d = mon(defId, { item }); fx.active = [a, d]; return E.expectedDamageFx(fx, neutral, a, d); };
  const evr = ev(1, "eviolite") / ev(1, null);
  assertTrue(evr < 0.68 && evr > 0.66, `Eviolite: Bulbasaur (can evolve) takes about 2/3 (ratio ${evr.toFixed(3)})`);
  assertTrue(close(ev(3, "eviolite") / ev(3, null), 1), "Eviolite: Venusaur (fully evolved) unchanged");
}

// ------------------------------------------------------------------
section("Shell Bell");
{
  const fx = E.createField(draws(NO_CRIT, ROLL));
  const a = mon(6, { item: "shell_bell", name: "Charizard" }), d = mon(143);
  a.hp = 10;
  const r = use(fx, move("Fire", "Special", 90), a, d);
  assertEqual(a.hp, 10 + Math.max(1, Math.floor(r.damage / 8)), "heals ⌊damage dealt / 8⌋ after the attack");
}

// ------------------------------------------------------------------
section("Determinism with items");
{
  const t = () => [{ speciesId: 143, level: 50, item: "leftovers" }, { speciesId: 25, level: 50, item: "focus_band" }, { speciesId: 6, level: 50, item: "quick_claw" }];
  const u = () => [{ speciesId: 3, level: 50, item: "sitrus_berry" }, { speciesId: 9, level: 50, item: "bright_powder" }, { speciesId: 65, level: 50, item: "focus_sash" }];
  const x = simulateBattle({ sides: [{ members: t() }, { members: u() }], seed: 12345, surge: null });
  const y = simulateBattle({ sides: [{ members: t() }, { members: u() }], seed: 12345, surge: null });
  assertEqual(JSON.stringify(x), JSON.stringify(y), "same teams + seed → identical battle, log and notes");
  assertTrue(JSON.stringify(x.log).includes("Leftovers") || JSON.stringify(x.turnNotes).includes("Leftovers"), "item activations appear in the battle log");
}

// ------------------------------------------------------------------
section("runBattle: snapshot, team isolation, Power, EXP (Lucky Egg)");
{
  const NOW = new Date("2026-11-02T12:00:00Z");
  const trainer = (id, ids) => {
    const u = createNewUser(id, `T${id}`);
    for (const s of ids) grantCatch(u, s, "normal", () => 0.5);
    u.displayedPokemon = ids.map((s) => ({ id: s, variant: "normal" }));
    u.battleTeam = ids.map((s) => ({ id: s, variant: "normal" }));
    u.items.leftovers = 1; u.items.lucky_egg = 1; u.items.focus_sash = 1;
    return u;
  };
  const A = trainer("10001", [6, 25]);
  const B = trainer("10002", [19, 9]);
  A.equipment = { rev: 1, teams: { display: { "6:normal": "lucky_egg", "25:normal": "leftovers" }, battle: { "25:normal": "focus_sash" } } };

  const off = buildTeam(A, { env: {} });
  assertTrue(off.every((m) => !m.item), "battles capability off → no member holds an item");
  const disp = buildTeam(A, { env: ON });
  assertEqual(disp.map((m) => m.item ?? null), ["lucky_egg", "leftovers"], "casual battles use the Display team's items");
  const bat = buildBattleTeam(A, { env: ON });
  assertEqual(bat.map((m) => m.item ?? null), [null, "focus_sash"], "ranked battles use the Battle team's items (independent)");
  assertEqual(teamPower(disp), teamPower(off), "items never change team Power (surge input)");
  assertTrue(bat.every((m) => m.level === 50), "ranked Lv 50 normalization intact with items");

  // Item Clause, ownership and Mega slot are re-checked at battle time (fail-closed).
  const C = trainer("10003", [6, 25, 1]);
  C.equipment = { rev: 1, teams: { display: { "6:normal": "leftovers", "25:normal": "leftovers", "1:normal": "charcoal" } } };
  assertEqual(buildTeam(C, { env: ON }).map((m) => m.item ?? null), ["leftovers", null, null], "a duplicate (Item Clause) and an unowned item battle with nothing");
  C.displayedPokemon[0].mega = "mega-charizard-x";
  assertEqual(buildTeam(C, { env: ON })[0].item ?? null, null, "a slot set to Mega Evolve battles without a regular item");

  // EXP: the holder gets ⌊1.5 × base⌋; the others are unchanged.
  const td = { 10001: A, 10002: B };
  const before = { A: JSON.stringify(A.items), B: JSON.stringify(B.items) };
  const res = runBattle({ trainerData: td, challengerId: "10001", defenderId: "10002", mode: "open", seed: 9, now: NOW, env: ON });
  assertTrue(res.ok, "casual battle runs");
  const knocked = res.result.knockouts.filter((k) => k.bySide === 0).map((k) => res.sides[1].members[k.slot]);
  const plainGains = teamExp({ members: res.sides[0].members, knockedOut: knocked, won: res.result.winner === 0 });
  const got = res.exp["10001"];
  assertEqual(got[0].gained, Math.floor(plainGains[0] * 1.5), "Lucky Egg holder: ⌊1.5 × base EXP⌋");
  assertEqual(got[0].bonusFrom, "lucky_egg", "the EXP result names the bonus");
  assertEqual(got[1].gained, plainGains[1], "a team-mate without it: base EXP");
  assertEqual(expMultiplierFor(null), 1, "no item → ×1");
  assertEqual([JSON.stringify(A.items), JSON.stringify(B.items)], [before.A, before.B], "no item is ever used up by a battle");
  assertEqual(res.sides[0].members.map((m) => m.item ?? null), ["lucky_egg", "leftovers"], "the battle result records what each member held (snapshot)");

  // Max Level: EXP is still capped.
  const D = trainer("10004", [6]);
  D.training["6:normal"] = { exp: expForLevel(LEVEL_CAP) };
  normalizeBox(D); // a raised shared Level lands on the copy (services/box.js; copies hold EXP now)
  D.equipment = { rev: 1, teams: { display: { "6:normal": "lucky_egg" } } };
  runBattle({ trainerData: { 10004: D, 10002: B }, challengerId: "10004", defenderId: "10002", mode: "open", seed: 3, now: NOW, env: ON });
  assertEqual(getTraining(D, 6, "normal").level, LEVEL_CAP, "a max-Level holder stays at the Level cap");
  assertTrue(D.training["6:normal"].exp <= expForLevel(LEVEL_CAP), "…and its EXP never exceeds the cap");
}

finish();
