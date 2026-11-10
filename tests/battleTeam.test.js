// ==========================================================
// tests/battleTeam.test.js — the Battle team (B6–B8) and its protection.
// services/battleTeam.js + utils/economyRules.js isDisplayedVariant +
// utils/bulkDonate.js. Synthetic players only.
// ==========================================================

import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { assertTrue, assertEqual, section, finish } from "./harness.js";

const B = await import("../services/battleTeam.js");
const { prepareTeamSelection, normalizeDisplayedTeam } = await import("../services/megaTeam.js");
const { isDisplayedVariant } = await import("../utils/economyRules.js");
const { bulkDonate } = await import("../utils/bulkDonate.js");
const { useMegaStone } = await import("../services/mega.js");

const clone = (o) => JSON.parse(JSON.stringify(o));
const ON = { MEGA_EVOLUTION_ENABLED: "1" };
// 150 Mewtwo, 249 Lugia, 384 Rayquaza, 151 Mew: mythic tier. 6 Charizard, 149 Dragonite: legendary.
const player = () => ({
  id: "400000000000000001",
  name: "Battle Team Tester",
  pokemon: {
    6: { normal: 1, shiny: 1 }, 25: { normal: 2, shiny: 1 }, 94: { normal: 1, shiny: 0 },
    149: { normal: 1, shiny: 0 }, 150: { normal: 1, shiny: 0 }, 249: { normal: 1, shiny: 0 },
    384: { normal: 1, shiny: 0 }, 151: { normal: 0, shiny: 1 },
  },
  items: { megastone_charizarditex: 1 },
  displayedPokemon: [
    { id: 6, variant: "normal" }, { id: 25, variant: "shiny" }, { id: 150, variant: "normal" },
    { id: 94, variant: "normal" }, { id: 249, variant: "normal" }, { id: 149, variant: "normal" },
  ],
});

section("tier lookup");
assertTrue(B.isMythicTier(150) && B.isMythicTier(249) && B.isMythicTier(151), "Mewtwo, Lugia, Mew are mythic-tier");
assertTrue(!B.isMythicTier(6) && !B.isMythicTier(149) && !B.isMythicTier(25), "Charizard, Dragonite (legendary) and Pikachu are not");

section("prepareBattleTeamSelection (B8)");
{
  const u = player();
  const ok = B.prepareBattleTeamSelection(u, [{ id: 150, variant: "normal" }, { id: 6, variant: "normal" }, { id: 149, variant: "normal" }]);
  assertTrue(ok.ok && ok.team.length === 3, "one mythic + legendaries is allowed (legendary-tier is unlimited)");
  const two = B.prepareBattleTeamSelection(u, [{ id: 150, variant: "normal" }, { id: 384, variant: "normal" }]);
  assertTrue(!two.ok && two.status === 400 && two.code === "too_many_mythics", "two mythic-tier Pokémon are refused");
  assertTrue(/only one mythic-tier/.test(two.error) && /Mewtwo/.test(two.error) && /Rayquaza/.test(two.error), "the message names the mythics");
  const shinyMew = B.prepareBattleTeamSelection(u, [{ id: 151, variant: "shiny" }, { id: 249, variant: "normal" }]);
  assertTrue(!shinyMew.ok && shinyMew.code === "too_many_mythics", "a shiny mythic counts too");
  const unowned = B.prepareBattleTeamSelection(u, [{ id: 151, variant: "normal" }]);
  assertTrue(!unowned.ok && unowned.code === "unowned", "Display-team rules still apply first (ownership per variant)");
  const empty = B.prepareBattleTeamSelection(u, []);
  assertTrue(!empty.ok && empty.code === "bad_size", "an empty Battle team is refused (1–6 slots)");
  // Display-team validation is unchanged: two mythics are fine there.
  const disp = prepareTeamSelection(u, [{ id: 150, variant: "normal" }, { id: 249, variant: "normal" }, { id: 384, variant: "normal" }]);
  assertTrue(disp.ok && disp.team.length === 3, "the Display team has no mythic limit");
}

section("Mega: one per team, allowed on both teams");
{
  const u = player();
  useMegaStone(u, { line: "6:normal", stoneId: "megastone_charizarditex", formId: "mega-charizard-x", now: Date.UTC(2026, 10, 10) }, { env: ON });
  const megaSlot = { id: 6, variant: "normal", mega: "mega-charizard-x" };
  const d = prepareTeamSelection(u, [megaSlot, { id: 25, variant: "shiny" }], { env: ON });
  const b = B.prepareBattleTeamSelection(u, [megaSlot, { id: 150, variant: "normal" }], { env: ON });
  assertTrue(d.ok && b.ok, "the same Mega line can be the Mega on the Display team and on the Battle team");
  const off = B.prepareBattleTeamSelection(u, [megaSlot], { env: {} });
  assertTrue(!off.ok && off.code === "disabled", "with Mega Evolution off, a Mega slot is refused on the Battle team as on the Display team");
}

section("cleaning and normalizeBattleTeam (B6)");
{
  const u = player();
  assertEqual(B.normalizeBattleTeam(u), undefined, "no battleTeam → nothing created");
  assertTrue(!("battleTeam" in u), "the field stays missing (missing = not set)");
  u.battleTeam = [{ id: 25, variant: "shiny" }, { id: 151, variant: "normal" }, 94, { id: "x" }];
  B.normalizeBattleTeam(u);
  assertEqual(u.battleTeam, [{ id: 25, variant: "shiny" }], "unowned variants and malformed slots are removed; legacy numbers only when the whole team is legacy");
  u.battleTeam = [94, 149];
  B.normalizeBattleTeam(u);
  assertEqual(u.battleTeam, [{ id: 94, variant: "normal" }, { id: 149, variant: "normal" }], "a legacy number team is converted");
  u.battleTeam = "oops";
  B.normalizeBattleTeam(u);
  assertTrue(!("battleTeam" in u), "a malformed battleTeam is treated as not set");
  const same = player();
  const before = clone(same.displayedPokemon);
  normalizeDisplayedTeam(same);
  assertEqual(same.displayedPokemon, before, "Display team normalization is unchanged");
}

section("applyMythicLimit and moveOverBattleTeam (B7)");
{
  const { kept, dropped } = B.applyMythicLimit(player().displayedPokemon);
  assertEqual(dropped, [{ id: 249, variant: "normal" }], "the first mythic (Mewtwo) is kept, later ones (Lugia) dropped");
  assertEqual(kept.map((s) => s.id), [6, 25, 150, 94, 149], "order is kept");

  const u = player();
  const r = B.moveOverBattleTeam(u, { now: 1234 });
  assertEqual(r, { copied: 5, dropped: [{ id: 249, variant: "normal" }] }, "move-over reports what it did");
  assertEqual(u.battleTeam.map((s) => s.id), [6, 25, 150, 94, 149], "battleTeam = Display team minus the second mythic");
  assertEqual(u.battleTeamMigration, { at: 1234, dropped: [{ id: 249, variant: "normal" }] }, "the notice record is stored");
  assertEqual(u.displayedPokemon.length, 6, "the Display team is untouched");
  const snap = clone(u);
  assertEqual(B.moveOverBattleTeam(u, { now: 9999 }), null, "idempotent: a second run does nothing");
  assertEqual(u, snap, "…and changes nothing");

  const fresh = { id: "x", pokemon: {}, displayedPokemon: [] };
  B.moveOverBattleTeam(fresh, { now: 1 });
  assertEqual(fresh.battleTeam, [], "a player with no Display team gets an empty Battle team (shows the empty state)");
  const ghost = { id: "y", pokemon: { 25: { normal: 1, shiny: 0 } }, displayedPokemon: [{ id: 25, variant: "shiny" }, { id: 25, variant: "normal" }] };
  B.moveOverBattleTeam(ghost, { now: 1 });
  assertEqual(ghost.battleTeam, [{ id: 25, variant: "normal" }], "ghost slots are not copied");
  const valid = B.prepareBattleTeamSelection(u, u.battleTeam);
  assertTrue(valid.ok, "a moved-over team passes the Battle team rules");
}

section("protection: donate / evolve / convert refuse Battle team copies");
{
  const u = player();
  u.displayedPokemon = [{ id: 6, variant: "normal" }];
  u.battleTeam = [{ id: 94, variant: "normal" }];
  assertTrue(isDisplayedVariant(u, 6, "normal"), "Display team copy is protected (unchanged)");
  assertTrue(isDisplayedVariant(u, 94, "normal"), "Battle team copy is protected");
  assertTrue(!isDisplayedVariant(u, 94, "shiny") && !isDisplayedVariant(u, 25, "normal"), "other copies are not");
  assertTrue(B.isOnAnyTeam(u, 94, "normal") && !B.isOnAnyTeam(u, 25, "shiny"), "isOnAnyTeam agrees");
  delete u.battleTeam;
  assertTrue(!isDisplayedVariant(u, 94, "normal"), "no Battle team → only the Display team counts");

  const v = player();
  v.displayedPokemon = [];
  v.battleTeam = [{ id: 94, variant: "normal" }];
  const res = bulkDonate({
    user: v, mode: "multiselect", items: [{ pokeId: 94, variant: "normal", count: 1 }],
    pokemonData: { 94: { name: "Gengar", tier: "rare" } },
    economy: { ccByTier: { rare: 1000 }, shinyDustByTier: {}, normalDustChanceByTier: {}, normalDustWeeklyCap: 0, rollDust: () => 0 },
    isOnTeam: (pid, variant) => isDisplayedVariant(v, pid, variant),
  });
  assertTrue(res.error && /one of your teams/.test(res.error), "bulk donate refuses a Battle team copy");
  assertEqual(v.pokemon[94].normal, 1, "…and keeps it");
}

section("migration tool: dry run never writes; --out writes a copy");
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bt-mig-"));
  const file = path.join(dir, "trainerData.json");
  const data = { a: player(), b: { ...player(), battleTeam: [{ id: 25, variant: "normal" }] } };
  fs.writeFileSync(file, JSON.stringify(data));
  const before = fs.readFileSync(file, "utf8");
  const out = execFileSync(process.execPath, ["tools/migrate-battle-teams.mjs", file], { encoding: "utf8" });
  const rep = JSON.parse(out);
  assertTrue(rep.mode === "dry-run" && rep.migrated === 1 && rep.alreadyHad === 1 && rep.withDropped === 1 && rep.droppedBySpecies.Lugia === 1, "dry run reports one move-over with Lugia dropped");
  assertEqual(fs.readFileSync(file, "utf8"), before, "dry run leaves the input unchanged");
  const copy = path.join(dir, "migrated.json");
  execFileSync(process.execPath, ["tools/migrate-battle-teams.mjs", file, "--out", copy], { encoding: "utf8" });
  const m = JSON.parse(fs.readFileSync(copy, "utf8"));
  assertTrue(Array.isArray(m.a.battleTeam) && m.a.battleTeam.length === 5 && m.b.battleTeam.length === 1, "--out writes the migrated copy; existing Battle teams kept");
  assertEqual(fs.readFileSync(file, "utf8"), before, "the input is still unchanged");
  let refused = false;
  try { execFileSync(process.execPath, ["tools/migrate-battle-teams.mjs", file, "--out", file], { stdio: "ignore" }); } catch { refused = true; }
  assertTrue(refused, "refuses to overwrite the input");
  fs.rmSync(dir, { recursive: true, force: true });
}

finish();
