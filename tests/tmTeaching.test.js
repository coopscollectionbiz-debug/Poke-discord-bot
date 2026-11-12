// ==========================================================
// tests/tmTeaching.test.js — TM system phase T4: teaching TMs
// (services/tmTeaching.js) and keeping trained copies on team slots
// (services/ownership.js carryCopyUids).
// ==========================================================

import { assertTrue, assertEqual, section, finish } from "./harness.js";
import { teachOptions, teachTm } from "../services/tmTeaching.js";
import { carryCopyUids, transformCopy, plainCount, customCopiesOf, ownershipProblems } from "../services/ownership.js";
import { runInventoryTransaction } from "../services/inventory.js";
import { buildTeam, buildBattleTeam } from "../utils/battle/runBattle.js";
import { getSpecies } from "../utils/battle/data.js";
import { canLearnByTm } from "../utils/battle/tmData.js";

const ON = { TM_ENABLED: "1" };
const clone = (o) => JSON.parse(JSON.stringify(o));
const ids = (list) => list.map((m) => m.id);

// 3 untrained Charizards (Lv 50) on both teams, 1 Pikachu; TMs in the bag.
function player() {
  return {
    cc: 0,
    pokemon: { 6: { normal: 3, shiny: 0 }, 25: { normal: 1, shiny: 0 } },
    training: { "6:normal": { exp: 50 ** 3 }, "25:normal": { exp: 20 ** 3 } },
    displayedPokemon: [{ id: 6, variant: "normal" }, { id: 25, variant: "normal" }],
    battleTeam: [{ id: 6, variant: "normal" }],
    items: { evolution_stone: 0, tm_thunderpunch: 2, tm_flamethrower: 1, tm_surf: 1, tm_dragonclaw: 1, tm_overheat: 1 },
  };
}
const target = (o, key) => o.targets.find((t) => t.key === key);
const view = (u, uid = null) => {
  const o = teachOptions(u, { speciesId: 6, variant: "normal" }, { env: ON });
  const t = target(o, uid ?? "untrained");
  return { o, t, expect: Object.fromEntries(Object.entries(t.teams).map(([k, on]) => [k, ids(on.moves)])) };
};

section("switched off");
{
  const u = player();
  const before = clone(u);
  assertEqual(teachOptions(u, { speciesId: 6, variant: "normal" }).enabled, false, "options report disabled without TM_ENABLED");
  assertEqual(teachTm(u, { item: "tm_thunderpunch", pokeId: 6, variant: "normal" }).code, "disabled", "teaching refused");
  assertEqual(u, before, "nothing changed");
}

section("options");
{
  const { o, t } = view(player());
  assertEqual([o.targets.length, t.count, Object.keys(t.teams)], [1, 3, ["display", "battle"]], "one untrained group of 3, on both teams");
  const st = Object.fromEntries(o.tms.map((x) => [x.item, x.status.untrained]));
  assertEqual([st.tm_thunderpunch, st.tm_flamethrower, st.tm_surf, st.tm_dragonclaw], ["teachable", "known", "incompatible", "known"], "Thunder Punch teachable; Flamethrower and Dragon Claw already known at Lv 50; Surf incompatible");
  assertTrue(!o.tms.some((x) => x.item === "tm_overheat"), "held TMs are not offered");
}

section("teaching an untrained copy");
{
  const u = player();
  const { expect } = view(u);
  const r = teachTm(u, { item: "tm_thunderpunch", pokeId: 6, variant: "normal", uid: null, expect, equip: { display: { replace: expect.display[0] }, battle: "keep" } }, { env: ON });
  assertTrue(r.ok && r.created, "taught; a trained copy was created");
  assertEqual([u.items.tm_thunderpunch, u.pokemon[6].normal, plainCount(u, 6, "normal")], [1, 3, 2], "1 TM spent; still 3 Charizards, 2 untrained");
  const c = u.customPokemon[r.uid];
  assertEqual([c.tmMoves, c.rev, c.history[0].type, c.history[0].item], [["thunderpunch"], 1, "tm", "tm_thunderpunch"], "record: move, rev, history");
  // Individual copies (docs/adr/0001): the taught copy is the one in the Team slots; Pikachu's slot keeps its own copy.
  assertEqual([u.displayedPokemon[0].uid, u.battleTeam[0].uid], [r.uid, r.uid], "the Charizard in both teams' slots is the one taught");
  assertTrue(u.box[u.displayedPokemon[1].uid]?.id === 25 && u.displayedPokemon[1].uid !== r.uid, "Pikachu untouched (its slot names its own copy)");
  assertEqual(r.slotsChanged, ["display", "battle"], "reported");
  assertEqual(ids(r.teams.display), ["thunderpunch", ...expect.display.slice(1)], "Display: first move replaced by the tap");
  assertEqual(ids(r.teams.battle), expect.battle, "Battle: kept as it was");
  assertEqual(buildTeam(u)[0].moves.includes("thunderpunch"), true, "casual battles use it");
  assertEqual(buildBattleTeam(u)[0].moves?.includes("thunderpunch") ?? false, false, "ranked keeps its moves (Keep chosen)");
  assertEqual(ownershipProblems(u), [], "invariant I-1 holds");

  // Teaching the same trained copy again: no new record, slots unchanged.
  const v2 = view(u, r.uid);
  const r2 = teachTm(u, { item: "tm_thunderpunch", pokeId: 6, variant: "normal", uid: r.uid, rev: 1, expect: v2.expect, equip: { display: "keep", battle: "keep" } }, { env: ON });
  assertEqual(r2.code, "already_known", "a copy can't learn the same TM move twice");
  assertEqual(u.items.tm_thunderpunch, 1, "the TM is kept");
}

section("trained copy already on teams; another untrained copy learns");
{
  const u = player();
  const a = view(u);
  const first = teachTm(u, { item: "tm_thunderpunch", pokeId: 6, variant: "normal", uid: null, expect: a.expect, equip: { display: "keep", battle: "keep" } }, { env: ON });
  u.items.tm_surf = 0;
  // the remaining untrained copies are on no team now
  const b = view(u);
  assertEqual(b.t.teams, {}, "untrained Charizards are on no team (slots hold the trained copy)");
  const second = teachTm(u, { item: "tm_thunderpunch", pokeId: 6, variant: "normal", uid: null, expect: {}, equip: {} }, { env: ON });
  assertTrue(second.ok && second.created && second.uid !== first.uid, "a second trained copy");
  assertEqual([u.displayedPokemon[0].uid, u.battleTeam[0].uid], [first.uid, first.uid], "slots holding the first trained copy stay");
  assertEqual([customCopiesOf(u, 6, "normal").length, plainCount(u, 6, "normal")], [2, 1], "2 trained + 1 untrained");
}

section("refusals keep the TM and change nothing");
{
  const base = player();
  const { expect } = view(base);
  const req = (over = {}) => ({ item: "tm_thunderpunch", pokeId: 6, variant: "normal", uid: null, expect, equip: { display: "keep", battle: "keep" }, ...over });
  const cases = [
    ["already_known", req({ item: "tm_flamethrower" })],
    ["incompatible", req({ item: "tm_surf" })],
    ["not_usable", req({ item: "tm_overheat" })],
    ["unknown_tm", req({ item: "tm_solarbeam" })],
    ["unknown_tm", req({ item: "evolution_stone" })],
    ["no_tm", req({ item: "tm_bodyslam" })],
    ["unowned", req({ pokeId: 150 })],
    ["stale_copy", req({ uid: "c_ZZZZZZZZZZ", rev: 0 })],
    ["stale_moves", req({ expect: { ...expect, display: [...expect.display].reverse() } })],
    ["stale_moves", req({ expect: { display: expect.display } })],
    ["bad_equip", req({ equip: { display: "keep" } })],
    ["bad_equip", req({ equip: { display: "add", battle: "keep" } })],
    ["bad_equip", req({ equip: { display: { replace: "surf" }, battle: "keep" } })],
  ];
  for (const [code, r] of cases) {
    const u = clone(base);
    const before = clone(u);
    const out = teachTm(u, r, { env: ON });
    assertEqual(out.code, code, `refused: ${code}`);
    assertEqual(u, before, `  …record unchanged (${code})`);
  }
  // rev mismatch on a trained copy
  const u = clone(base);
  const t = teachTm(u, req(), { env: ON });
  const v = view(u, t.uid);
  const before = clone(u);
  assertEqual(teachTm(u, { item: "tm_thunderpunch", pokeId: 6, variant: "normal", uid: t.uid, rev: 0, expect: v.expect, equip: { display: "keep", battle: "keep" } }, { env: ON }).code, "stale_copy", "an old rev is refused");
  assertEqual(u, before, "  …unchanged");
}

section("a move learned later by level-up can be taught early");
{
  const u = player();
  u.training["6:normal"].exp = 20 ** 3; // Lv 20
  const later = getSpecies(6).levelMoves.find(([at, m]) => at > 20 && canLearnByTm(6, m))?.[1];
  assertTrue(!!later, `Charizard has a TM move it learns after Lv 20 (${later})`);
  u.items[`tm_${later}`] = 1;
  const { expect } = view(u);
  const r = teachTm(u, { item: `tm_${later}`, pokeId: 6, variant: "normal", uid: null, expect, equip: { display: "keep", battle: "keep" } }, { env: ON });
  assertTrue(r.ok, "taught early");
}

section("add when under 4 moves; copy on no team");
{
  const u = { cc: 0, pokemon: { 25: { normal: 1, shiny: 0 } }, training: { "25:normal": { exp: 8 } }, displayedPokemon: [{ id: 25, variant: "normal" }], items: { tm_thunderbolt: 1 } };
  const o = teachOptions(u, { speciesId: 25, variant: "normal" }, { env: ON });
  const cur = ids(o.targets[0].teams.display.moves);
  assertTrue(cur.length < 4, `a low-level Pikachu has fewer than 4 moves (${cur.length})`);
  const r = teachTm(u, { item: "tm_thunderbolt", pokeId: 25, variant: "normal", uid: null, expect: { display: cur }, equip: { display: "add" } }, { env: ON });
  assertEqual(ids(r.teams.display), [...cur, "thunderbolt"], "added to the Display moves");
  const box = { cc: 0, pokemon: { 25: { normal: 1, shiny: 0 } }, displayedPokemon: [], items: { tm_thunderbolt: 1 } };
  const r2 = teachTm(box, { item: "tm_thunderbolt", pokeId: 25, variant: "normal", uid: null, expect: {}, equip: {} }, { env: ON });
  assertTrue(r2.ok && r2.slotsChanged.length === 0 && Object.keys(r2.teams).length === 0, "a box Pokémon just learns it");
}

section("replay: the same request id teaches once");
{
  const trainerData = { u1: player() };
  const { expect } = view(trainerData.u1);
  const args = {
    trainerData, userId: "u1", lock: (_id, fn) => fn(), save: async () => ({ saved: true, note: "" }),
    requestId: "teach1234-a", payloadKey: "teach-tm:tm_thunderpunch:6:normal:untrained",
    mutate: (u) => teachTm(u, { item: "tm_thunderpunch", pokeId: 6, variant: "normal", uid: null, expect, equip: { display: "keep", battle: "keep" } }, { env: ON }),
  };
  const a = await runInventoryTransaction(args);
  const b = await runInventoryTransaction(args);
  assertTrue(a.ok && b.ok && b.replayed, "second call is a replay");
  assertEqual([trainerData.u1.items.tm_thunderpunch, customCopiesOf(trainerData.u1, 6, "normal").length], [1, 1], "one TM spent, one trained copy");
}

section("team saves keep trained copies (older clients send no uid)");
{
  const u = player();
  const { expect } = view(u);
  const { uid } = teachTm(u, { item: "tm_thunderpunch", pokeId: 6, variant: "normal", uid: null, expect, equip: { display: "keep", battle: "keep" } }, { env: ON });
  const prev = u.displayedPokemon;
  const next = [{ id: 25, variant: "normal" }, { id: 6, variant: "normal" }];
  const pikachuUid = prev.find((s) => s.id === 25).uid;
  assertEqual(carryCopyUids(u, prev, next, [{ id: 25, variant: "normal" }, { id: 6, variant: "normal" }]), [{ id: 25, variant: "normal", uid: pikachuUid }, { id: 6, variant: "normal", uid }], "no uid field → each slot keeps its copy (reordered)");
  assertEqual(carryCopyUids(u, prev, next, [{ id: 25, variant: "normal" }, { id: 6, variant: "normal", uid: null }])[1], { id: 6, variant: "normal" }, "uid: null → deliberately untrained");
  assertEqual(carryCopyUids(u, prev, next, [{ id: 6, variant: "normal", uid: "c_ZZZZZZZZZZ" }])[1], { id: 6, variant: "normal" }, "an invalid uid is dropped, never invented");
  assertEqual(carryCopyUids(u, [], [{ id: 6, variant: "normal" }], [6]), [{ id: 6, variant: "normal" }], "a newly added line starts untrained");
}

section("taught moves survive evolution and shiny crafting");
{
  const u = { cc: 0, pokemon: { 5: { normal: 1, shiny: 0 } }, training: { "5:normal": { exp: 30 ** 3 } }, displayedPokemon: [], items: { tm_dragonclaw: 1 } };
  const r = teachTm(u, { item: "tm_dragonclaw", pokeId: 5, variant: "normal", uid: null, expect: {}, equip: {} }, { env: ON });
  assertTrue(r.ok, "Charmeleon learned Dragon Claw");
  assertTrue(transformCopy(u, { from: { id: 5, variant: "normal" }, to: { id: 6, variant: "normal" }, uid: r.uid, confirmRev: 1 }).ok, "it evolves");
  assertTrue(transformCopy(u, { from: { id: 6, variant: "normal" }, to: { id: 6, variant: "shiny" }, uid: r.uid, confirmRev: 2 }).ok, "then becomes shiny");
  assertEqual([u.customPokemon[r.uid].speciesId, u.customPokemon[r.uid].variant, u.customPokemon[r.uid].tmMoves], [6, "shiny", ["dragonclaw"]], "same copy: shiny Charizard with Dragon Claw");
}

finish();
