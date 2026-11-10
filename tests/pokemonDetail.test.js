// ==========================================================
// tests/pokemonDetail.test.js — B2, GET /api/pokemon/detail's service
// (services/pokemonDetail.js): same numbers as the Discord cards, read-only.
// ==========================================================

import { assertEqual, assertTrue, section, finish } from "./harness.js";
import { pokemonDetail } from "../services/pokemonDetail.js";
import { slotView } from "../utils/render/teamView.js";
import { pokemonPower } from "../utils/battle/power.js";
import { autoMoveset } from "../utils/battle/moveset.js";
import { getMove } from "../utils/battle/data.js";

const clone = (o) => JSON.parse(JSON.stringify(o));
const user = () => ({
  pokemon: { 6: { normal: 1, shiny: 1 }, 25: { normal: 2, shiny: 0 } },
  training: { "6:normal": { exp: 58 ** 3 }, "6:shiny": { exp: 36 ** 3 }, "25:normal": { exp: 16 ** 3 } },
  displayedPokemon: [{ id: 25, variant: "normal" }, { id: 6, variant: "normal" }],
  battleTeam: [{ id: 6, variant: "shiny" }],
});

section("owned Pokémon: the Discord cards' numbers");
{
  const u = user();
  const before = clone(u);
  const { status, body } = pokemonDetail(u, 6);
  assertEqual(status, 200, "found");
  assertEqual([body.name, body.types, body.tier, body.region], ["Charizard", ["Fire", "Flying"], "legendary", "Kanto"], "species facts");
  const ref = slotView(u, { speciesId: 6, variant: "normal", level: 58 }, 0);
  assertEqual([body.copies.normal.level, body.copies.normal.stats, body.copies.normal.power], [58, ref.stats, ref.statTotal], "stats and Power equal slotView (/showteam, /inspectpokemon)");
  assertEqual(body.copies.normal.power, pokemonPower(6, 58), "Power equals the dashboard sort's Power");
  assertEqual(body.copies.normal.power50, pokemonPower(6, 50), "Lv 50 (ranked) Power");
  assertEqual(body.copies.normal.moves.map((m) => m.name), autoMoveset(6, 58).map((m) => getMove(m).name), "the battle moveset, with types");
  assertTrue(body.copies.normal.moves.every((m) => m.type), "moves carry their type");
  assertEqual([body.copies.normal.teams, body.copies.shiny.teams], [{ display: 2, battle: null }, { display: null, battle: 1 }], "team slots per copy");
  assertEqual(body.evolvesFrom, [{ id: 5, name: "Charmeleon" }], "evolves from");
  assertEqual(body.megaForms, [], "Mega forms hidden while Mega Evolution is off");
  assertEqual(u, before, "read-only: nothing written to the player");
}

section("unowned and unknown");
{
  const { status, body } = pokemonDetail(user(), 1);
  assertEqual([status, Object.keys(body.copies), body.owned], [200, [], { normal: 0, shiny: 0 }], "unowned live species: facts and base stats, no copies");
  assertTrue(body.baseTotal > 0, "base stat total");
  assertEqual(pokemonDetail(user(), 99999).status, 404, "unknown species");
  assertEqual(pokemonDetail(user(), "abc").status, 404, "not a number");
  assertEqual(pokemonDetail(user(), 700).status, 404, "unowned species of a generation that isn't live");
}

section("Mega forms when Mega teams are on");
{
  const { body } = pokemonDetail(user(), 6, { env: { MEGA_EVOLUTION_ENABLED: "1" } });
  assertTrue(body.megaForms.some((f) => f.id === "mega-charizard-x") && body.megaForms.every((f) => f.unlocked.normal === false), "listed, locked (none unlocked)");
}

finish();
