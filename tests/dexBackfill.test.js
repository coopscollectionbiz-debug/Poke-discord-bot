// ==========================================================
// tests/dexBackfill.test.js: the bot's own Pokédex scan of its backup
// history (services/dexBackfill.js), driven with a fake channel.
// ==========================================================

import { assertTrue, assertEqual, section, finish } from "./harness.js";
import { runDexBackfill, speciesMasksOf, parseBackupText } from "../services/dexBackfill.js";
import { dexMask, addCopy } from "../services/box.js";

const A = "111111111111111111", B = "222222222222222222", GONE = "333333333333333333";

// Channel, newest first: 3 pages of 3 messages; page 2 has no backups (other posts).
function channel() {
  const backups = {
    m9: { [A]: { pokemon: { 1: { normal: 1, shiny: 0 } } } },
    m8: { [A]: { pokemon: { 4: { normal: 2, shiny: 0 }, "52:galar": { normal: 1 } } } },
    m7: "not json",
    m3: { data: { [B]: { pokemon: { 25: { normal: 0, shiny: 1 } } }, [GONE]: { pokemon: { 150: { normal: 1 } } } } },
    m2: { [A]: { pokemon: ["Totodile"] } }, // legacy name list: ignored
    m1: { [A]: { pokemon: { 7: { normal: 1, shiny: 0 } } } },
  };
  const pages = { null: { items: ["m9", "m8", "m7"], next: "m7" }, m7: { items: [], next: "m4" }, m4: { items: ["m3", "m2", "m1"], next: null } };
  const pageAfter = (cursor) => {
    // resume mid-page: cursor may be a backup id inside a page
    for (const [key, p] of Object.entries(pages)) {
      const i = p.items.indexOf(cursor);
      if (i >= 0 && i < p.items.length - 1) return { items: p.items.slice(i + 1), next: p.next };
      if (i >= 0 && i === p.items.length - 1) return pages[p.next] ?? { items: [], next: null };
      void key;
    }
    return pages[cursor ?? "null"] ?? { items: [], next: null };
  };
  let calls = 0;
  return {
    listPage: async (cursor) => { calls++; const p = pageAfter(cursor); return { items: p.items.map((id) => ({ id, at: 0, url: id })), next: p.next }; },
    download: async (url) => (typeof backups[url] === "string" ? backups[url] : JSON.stringify(backups[url])),
    calls: () => calls,
  };
}

section("reader");
{
  assertEqual(speciesMasksOf({ [A]: { pokemon: { 6: { normal: 1, shiny: 1 }, "52:galar": { normal: 1 } }, pokedex: { 9: 1 } } }), { [A]: { 6: 3, 9: 1 } }, "species + shiny bits; form keys never count; an existing Pokédex is kept");
  assertEqual(speciesMasksOf({ x: { pokemon: { 1: { normal: 1 } } } }), {}, "non-player keys ignored");
  assertEqual(parseBackupText(JSON.stringify({ data: { a: 1 } })), { a: 1 }, "wrapped snapshot unwrapped");
}

section("full scan");
{
  const td = { [A]: { pokemon: {} }, [B]: { pokemon: {} } };
  addCopy(td[A], 1, "normal");
  let saved = null, changes = 0;
  const ch = channel();
  const st = await runDexBackfill({ ...ch, trainerData: td, saveState: (s) => { saved = s; }, onChanged: () => { changes++; }, pauseMs: 0, log: () => {} });
  assertTrue(st.done && saved.done, "finished and recorded as done");
  assertEqual([dexMask(td[A], 1), dexMask(td[A], 4), dexMask(td[A], 7), dexMask(td[B], 25)], [1, 1, 1, 2], "every species ever in a backup is registered, shiny kept separate");
  assertTrue(!td[A].pokedex[52] && !td[GONE], "form keys never register; players who no longer exist are not created");
  assertEqual([st.backups, st.skipped, st.players], [5, 1, 2], "5 backups read, the broken one skipped, 2 players changed");
  assertTrue(changes >= 3, "a save is queued when a backup changed someone");
  assertTrue(!td[A].pokemon[4], "nothing but the Pokédex changes: no copies are created");
  const again = await runDexBackfill({ ...channel(), trainerData: td, state: saved, pauseMs: 0 });
  assertEqual(again.backups, 5, "a finished scan never runs again");
}

section("stop and resume");
{
  const td = { [A]: { pokemon: {} }, [B]: { pokemon: {} } };
  let saved = null, n = 0;
  const first = await runDexBackfill({ ...channel(), trainerData: td, saveState: (s) => { saved = s; n++; }, shouldStop: () => n >= 2, pauseMs: 0 });
  assertTrue(!first.done && saved.cursor, "stopped early (shutdown) with a cursor saved");
  const second = await runDexBackfill({ ...channel(), trainerData: td, state: saved, pauseMs: 0 });
  assertTrue(second.done, "resumed and finished");
  assertEqual([dexMask(td[A], 1), dexMask(td[A], 4), dexMask(td[A], 7), dexMask(td[B], 25)], [1, 1, 1, 2], "same result as one uninterrupted scan");
}

section("achievements");
{
  // An old backup from when the player had all 151 Kanto Pokémon; today they own one.
  const kanto = Object.fromEntries(Array.from({ length: 151 }, (_, i) => [i + 1, { normal: 1, shiny: 0 }]));
  const td = { [A]: { pokemon: {} } };
  addCopy(td[A], 25, "normal");
  const st = await runDexBackfill({
    listPage: async (c) => (c ? { items: [], next: null } : { items: [{ id: "old", url: "old" }], next: null }),
    download: async () => JSON.stringify({ [A]: { pokemon: kanto } }),
    trainerData: td, pauseMs: 0,
  });
  assertTrue(!!td[A].ach?.col_region_kanto_full && st.unlocks >= 1, "Kanto Pokédex Complete unlocks from the backup history");
  assertTrue(!td[A].ach?.col_species_100, "\"own at the same time\" achievements stay unearned");
}

finish();
