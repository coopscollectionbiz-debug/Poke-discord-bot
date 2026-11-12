// ==========================================================
// tests/ownership.test.js — TM system phase T0 (services/ownership.js)
//
// No player can have a customized (TM-trained) copy yet, so these tests
// build user.customPokemon records by hand to prove that every path that
// removes or transforms copies protects them: plain copies first, never an
// automatic pick of a trained copy, explicit uid + confirmed rev required,
// nothing changes on a refusal, and invariant I-1 always holds.
// ==========================================================

import { assertTrue, assertEqual, section, finish } from "./harness.js";
import {
  plainCount, customCopiesOf, removeCopies, canRemoveCopies, transformCopy, canTransformCopy,
  pruneEmptyLine, wipeCollection, ownershipProblems,
} from "../services/ownership.js";
import { bulkDonate, donateOne } from "../utils/bulkDonate.js";
import { giftPokemon } from "../commands/gift.js";

const clone = (o) => JSON.parse(JSON.stringify(o));
const rec = (uid, speciesId, variant, extra = {}) => ({ uid, speciesId, variant, rev: 1, tmMoves: ["dragonclaw"], history: [], createdAt: 1, ...extra });

// 3 normal Charizards: B and C trained, one plain (the audit's example).
function charizards() {
  return {
    pokemon: { 6: { normal: 3, shiny: 0 }, 5: { normal: 2, shiny: 0 } },
    training: { "6:normal": { exp: 64000 }, "5:normal": { exp: 27000 } },
    customPokemon: {
      c_BBBBBBBBBB: rec("c_BBBBBBBBBB", 6, "normal", { tmMoves: ["thunderpunch"] }),
      c_CCCCCCCCCC: rec("c_CCCCCCCCCC", 6, "normal", { tmMoves: ["solarbeam"] }),
    },
    movesets: { display: { "u:c_BBBBBBBBBB": ["thunderpunch"] }, battle: {} },
    displayedPokemon: [],
    cc: 0,
    items: { evolution_stone: 0 },
  };
}
const pokemonData = { 4: { name: "Charmander", tier: "common" }, 5: { name: "Charmeleon", tier: "uncommon" }, 6: { name: "Charizard", tier: "rare" } };
const economy = { ccByTier: { common: 250, uncommon: 500, rare: 1000 }, shinyDustByTier: { rare: 12 }, normalDustChanceByTier: {}, normalDustWeeklyCap: 8, rollDust: () => 0 };
const notOnTeam = () => false;

section("plain counts");
{
  const u = charizards();
  assertEqual(plainCount(u, 6, "normal"), 1, "3 Charizards with 2 trained → 1 plain");
  assertEqual(customCopiesOf(u, 6, "normal").length, 2, "2 customized records");
  assertEqual(plainCount({ pokemon: { 6: { normal: 2 } } }, 6, "normal"), 2, "no customPokemon field → every copy is plain");
  const s = charizards();
  s.customPokemon.c_BBBBBBBBBB.suspended = true;
  assertEqual(plainCount(s, 6, "normal"), 2, "a suspended record does not count as customized");
}

section("DS-1/DS-2: removal uses plain copies first and fails closed");
{
  const u = charizards();
  const r = removeCopies(u, { id: 6, variant: "normal", n: 1 });
  assertTrue(r.ok && r.removedCustom.length === 0, "donating 1 removes the plain copy");
  assertEqual(u.pokemon[6].normal, 2, "count 3 → 2");
  assertEqual(Object.keys(u.customPokemon).sort(), ["c_BBBBBBBBBB", "c_CCCCCCCCCC"], "both trained copies remain");

  const v = charizards();
  const before = clone(v);
  const r2 = removeCopies(v, { id: 6, variant: "normal", n: 2 });
  assertEqual(r2.code, "custom_copies_protected", "donating 2 without naming a trained copy is refused");
  assertEqual(r2.protected.map((c) => c.tmMoves[0]).sort(), ["solarbeam", "thunderpunch"], "the refusal lists the trained copies and their TM moves");
  assertEqual(v, before, "a refusal changes nothing");
}

section("DS-3/DS-4: an explicitly named trained copy with the confirmed rev");
{
  const u = charizards();
  u.displayedPokemon = [{ id: 6, variant: "normal", uid: "c_BBBBBBBBBB" }];
  const r = removeCopies(u, { id: 6, variant: "normal", n: 2, customUids: ["c_BBBBBBBBBB"], confirmRevs: { c_BBBBBBBBBB: 1 } });
  assertTrue(r.ok && r.removedCustom[0] === "c_BBBBBBBBBB", "plain + the named trained copy are removed");
  assertEqual(u.pokemon[6].normal, 1, "count 3 → 1");
  assertEqual(Object.keys(u.customPokemon), ["c_CCCCCCCCCC"], "the other trained copy is untouched");
  assertEqual(u.movesets.display["u:c_BBBBBBBBBB"], undefined, "its per-copy moveset is removed");
  assertEqual(u.displayedPokemon[0].uid, undefined, "team slots no longer reference it");

  const s = charizards();
  const before = clone(s);
  const stale = removeCopies(s, { id: 6, variant: "normal", n: 2, customUids: ["c_BBBBBBBBBB"], confirmRevs: { c_BBBBBBBBBB: 0 } });
  assertEqual(stale.code, "stale_confirmation", "an old rev is refused");
  assertEqual(s, before, "nothing changed");
  const missing = removeCopies(s, { id: 6, variant: "normal", n: 2, customUids: ["c_BBBBBBBBBB"] });
  assertEqual(missing.code, "stale_confirmation", "a uid without any confirmation is refused (AB-3)");
  const foreign = removeCopies(s, { id: 5, variant: "normal", n: 1, customUids: ["c_BBBBBBBBBB"], confirmRevs: { c_BBBBBBBBBB: 1 } });
  assertEqual(foreign.code, "unknown_copy", "a uid from another line is refused");
  const forged = removeCopies(s, { id: 6, variant: "normal", n: 2, customUids: ["__proto__"], confirmRevs: {} });
  assertEqual(forged.code, "unknown_copy", "a forged uid is refused");
  assertEqual(s, before, "still nothing changed");
}

section("removing the last copies");
{
  const u = { pokemon: { 25: { normal: 1, shiny: 0 } }, training: { "25:normal": { exp: 1000 } } };
  assertTrue(removeCopies(u, { id: 25, variant: "normal", n: 1 }).ok, "last plain copy removed");
  assertEqual(u.pokemon[25], undefined, "empty species entry pruned");
  assertEqual(u.training["25:normal"], undefined, "Level reset when the last copy is gone (as before)");
  assertEqual(canRemoveCopies(u, { id: 25, variant: "normal", n: 1 }).code, "not_owned", "can't remove what isn't owned");
  assertEqual(canRemoveCopies(u, { id: 25, variant: "normal", n: 0 }).code, "bad_request", "count must be ≥ 1");
  const keep = { pokemon: { 6: { normal: 0, shiny: 0 } }, customPokemon: { c_XXXXXXXXXX: rec("c_XXXXXXXXXX", 6, "normal") } };
  pruneEmptyLine(keep, 6);
  assertTrue(!!keep.pokemon[6], "an empty line that still has a customized record is never pruned");
}

section("DS-5/DS-6: bulk donation never includes trained copies");
{
  const u = charizards();
  const before = clone(u);
  const r = bulkDonate({ user: u, mode: "duplicates", items: [{ pokeId: 6, variant: "normal", count: 1 }], pokemonData, economy, isOnTeam: notOnTeam });
  assertTrue(!!r.error && /TM-trained/.test(r.error), "duplicates: 1 plain Charizard can't be donated (keeps 1 plain + trained)");
  assertEqual(u, before, "refused bulk changes nothing");

  const w = charizards();
  w.pokemon[6].normal = 4; // 2 plain + 2 trained
  const ok = bulkDonate({ user: w, mode: "duplicates", items: [{ pokeId: 6, variant: "normal", count: 1 }], pokemonData, economy, isOnTeam: notOnTeam });
  assertTrue(!ok.error && ok.donatedCopies === 1, "duplicates: with 2 plain, 1 can go");
  assertEqual([w.pokemon[6].normal, Object.keys(w.customPokemon).length], [3, 2], "the trained copies stay");

  const solo = { pokemon: { 4: { normal: 1, shiny: 0 } }, customPokemon: { c_SSSSSSSSSS: rec("c_SSSSSSSSSS", 4, "normal") }, cc: 0, items: {} };
  const ms = bulkDonate({ user: solo, mode: "multiselect", items: [{ pokeId: 4, variant: "normal", count: 1 }], pokemonData, economy, isOnTeam: notOnTeam });
  assertTrue(!!ms.error && /TM-trained/.test(ms.error), "multiselect: a lone trained copy is refused");
}

section("single donation (donateOne)");
{
  const u = charizards();
  const r = donateOne({ user: u, pokeId: 6, variant: "normal", pokemonData, economy, isOnTeam: notOnTeam });
  assertTrue(!r.error && r.gainedCC === 1000, "the plain Charizard is donated for its usual 1,000 CC");
  assertEqual([u.pokemon[6].normal, u.cc, Object.keys(u.customPokemon).length], [2, 1000, 2], "trained copies untouched");
  const before = clone(u);
  const r2 = donateOne({ user: u, pokeId: 6, variant: "normal", pokemonData, economy, isOnTeam: notOnTeam });
  assertEqual(r2.code, "custom_copies_protected", "only trained copies left → refused, never auto-picked");
  assertEqual(u, before, "no CC, Dust or copies change on refusal");
  const team = donateOne({ user: charizards(), pokeId: 6, variant: "normal", pokemonData, economy, isOnTeam: () => true });
  assertTrue(/teams/.test(team.error), "team rule unchanged");
}

section("DS-10: a repeated donate request id donates once");
{
  const { runInventoryTransaction } = await import("../services/inventory.js");
  const trainerData = { u1: { pokemon: { 4: { normal: 3, shiny: 0 } }, cc: 0, items: { evolution_stone: 0 } } };
  let saves = 0;
  const args = {
    trainerData, userId: "u1", lock: (_id, fn) => fn(), save: async () => { saves++; return { saved: true, note: "" }; },
    requestId: "abcd1234-req", payloadKey: "donate:4:normal",
    mutate: (u) => {
      const r = donateOne({ user: u, pokeId: 4, variant: "normal", pokemonData, economy, isOnTeam: notOnTeam });
      return r.error ? { ok: false, error: r.error } : { ok: true, gainedCC: r.gainedCC };
    },
  };
  const a = await runInventoryTransaction(args);
  const b = await runInventoryTransaction(args);
  assertTrue(a.ok && !a.replayed && b.ok && b.replayed, "second call with the same id is a replay");
  assertEqual([trainerData.u1.pokemon[4].normal, trainerData.u1.cc], [2, 250], "one copy donated, CC paid once");
  const c = await runInventoryTransaction({ ...args, payloadKey: "donate:4:shiny" });
  assertTrue(!c.ok && /different action/.test(c.error), "the same id for a different donation is refused");
}

section("D4: gift moves plain copies only");
{
  const u = charizards();
  const rcpt = { pokemon: {} };
  const before = clone(u);
  const r = giftPokemon(u, rcpt, "6", "Charizard", 2);
  assertTrue(/TM-trained/.test(r), "gifting 2 when only 1 is plain is refused");
  assertEqual([u, rcpt], [before, { pokemon: {} }], "nothing moved");
  assertEqual(giftPokemon(u, rcpt, "6", "Charizard", 1), null, "gifting the 1 plain copy works");
  assertEqual([u.pokemon[6].normal, rcpt.pokemon[6].normal, Object.keys(u.customPokemon).length], [2, 1, 2], "trained copies stay with the sender");
}

section("EV/SH: evolution and shiny craft");
{
  // Charmeleon: 1 plain + 1 trained.
  const u = charizards();
  u.customPokemon.c_MMMMMMMMMM = rec("c_MMMMMMMMMM", 5, "normal", { tmMoves: ["dragonclaw"] });
  const r = transformCopy(u, { from: { id: 5, variant: "normal" }, to: { id: 6, variant: "normal" } });
  assertTrue(r.ok && r.movedCustom === null, "EV-2: without a uid the plain Charmeleon evolves");
  assertEqual([u.pokemon[5].normal, u.pokemon[6].normal, u.customPokemon.c_MMMMMMMMMM.speciesId], [1, 4, 5], "the trained Charmeleon stays a Charmeleon");

  const before = clone(u);
  const r2 = transformCopy(u, { from: { id: 5, variant: "normal" }, to: { id: 6, variant: "normal" } });
  assertEqual(r2.code, "choose_copy", "EV-3: only a trained copy left and no uid → refused");
  assertEqual(u, before, "nothing changed");

  const r3 = transformCopy(u, { from: { id: 5, variant: "normal" }, to: { id: 6, variant: "normal" }, uid: "c_MMMMMMMMMM", confirmRev: 1 });
  const m = u.customPokemon.c_MMMMMMMMMM;
  assertTrue(r3.ok && r3.movedCustom === "c_MMMMMMMMMM", "EV-1: the named trained copy evolves");
  assertEqual([m.speciesId, m.tmMoves, m.rev, m.history.at(-1).type], [6, ["dragonclaw"], 2, "evolve"], "same record: TM moves kept, rev bumped, history recorded");
  assertEqual(u.pokemon[5], undefined, "last Charmeleon gone → entry pruned");
  assertEqual(u.training["5:normal"], undefined, "its Level record reset");
  assertEqual(u.training["6:normal"].exp, 64000, "Charizard keeps the higher Level (carryLevel)");
  assertEqual(customCopiesOf(u, 6, "normal").length, 3, "EV-4: three distinct trained Charizards now");
  assertEqual(ownershipProblems(u), [], "I-1 holds");

  const s = charizards();
  const r4 = transformCopy(s, { from: { id: 6, variant: "normal" }, to: { id: 6, variant: "shiny" }, uid: "c_BBBBBBBBBB", confirmRev: 1 });
  assertTrue(r4.ok, "SH-1: a trained normal Charizard becomes shiny");
  assertEqual([s.pokemon[6], s.customPokemon.c_BBBBBBBBBB.variant, s.customPokemon.c_BBBBBBBBBB.tmMoves, plainCount(s, 6, "normal")], [{ normal: 2, shiny: 1 }, "shiny", ["thunderpunch"], 1], "moves kept; the plain normal is untouched");
  assertEqual(canTransformCopy(s, { from: { id: 6, variant: "shiny" }, to: { id: 6, variant: "shiny" } }).code, "bad_request", "a no-op transform is refused");
}

section("admin wipe");
{
  const u = charizards();
  wipeCollection(u);
  assertEqual([u.pokemon, u.customPokemon], [{}, undefined], "/resetuser removes copies and customized records");
}

section("DS-12/PS-7: random operations keep invariant I-1 and conserve copies");
{
  let seed = 7;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  let violations = 0, conserved = true, refusedChangedState = 0;
  for (let trial = 0; trial < 300; trial++) {
    const u = { pokemon: {}, training: {}, customPokemon: {} };
    let uidN = 0;
    for (let step = 0; step < 40; step++) {
      const id = 1 + rnd(3), variant = rnd(4) === 0 ? "shiny" : "normal";
      const total = () => Object.values(u.pokemon).reduce((t, e) => t + (e.normal ?? 0) + (e.shiny ?? 0), 0);
      const before = total();
      const snap = JSON.stringify(u);
      const op = rnd(5);
      let r = { ok: true }, delta = 0;
      if (op === 0) { u.pokemon[id] ??= { normal: 0, shiny: 0 }; u.pokemon[id][variant] += 1; delta = 1; }
      else if (op === 1 && plainCount(u, id, variant) > 0) {
        // simulate teaching: promote a plain copy (records are created only by T4 later)
        const uid = `c_${String(uidN++).padStart(10, "0")}`;
        (u.customPokemon ??= {})[uid] = rec(uid, id, variant); // the service drops an empty map
      } else if (op === 2) { const n = 1 + rnd(3); r = removeCopies(u, { id, variant, n }); delta = r.ok ? -n : 0; }
      else if (op === 3) {
        const named = customCopiesOf(u, id, variant)[0];
        const n = 1 + plainCount(u, id, variant);
        r = named ? removeCopies(u, { id, variant, n, customUids: [named.uid], confirmRevs: { [named.uid]: named.rev } }) : { ok: false };
        delta = r.ok ? -n : 0;
      } else if (op === 4) {
        const to = id === 3 ? { id: 1, variant } : { id: id + 1, variant: variant === "normal" && rnd(2) ? "shiny" : variant };
        const named = rnd(2) ? customCopiesOf(u, id, variant)[0] : null;
        r = transformCopy(u, { from: { id, variant }, to, uid: named?.uid ?? null, confirmRev: named?.rev });
      }
      if (!r.ok && JSON.stringify(u) !== snap) refusedChangedState++;
      if (total() !== before + delta) conserved = false;
      if (ownershipProblems(u).length) violations++;
    }
  }
  assertEqual(violations, 0, "I-1 never violated over 12,000 random operations");
  assertTrue(conserved, "copies are conserved: transforms move exactly one, removals remove exactly n");
  assertEqual(refusedChangedState, 0, "every refused operation left the record unchanged");
}

finish();
