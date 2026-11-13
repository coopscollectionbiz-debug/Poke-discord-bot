// ==========================================================
// tests/pokemonSearch.test.js: /pokedex autocomplete and typo match
// (utils/pokemonSearch.js) on the real Gen 1–5 names.
// ==========================================================

import fs from "fs";
import { assertTrue, assertEqual, section, finish } from "./harness.js";
import { autocompleteChoices, closestPokemon, searchKey } from "../utils/pokemonSearch.js";

const data = JSON.parse(fs.readFileSync(new URL("../pokemonData.json", import.meta.url), "utf8"));
const list = Object.entries(data).filter(([k]) => /^\d+$/.test(k) && Number(k) <= 649).map(([k, p]) => ({ id: Number(k), name: p.name }));
const name = (r) => (r.match ? r.match.name : r.suggestions.map((p) => p.name));

section("autocomplete");
{
  const c = autocompleteChoices("fer", list, { owned: new Set([160]) });
  assertEqual(c[0], { name: "Feraligatr · #0160 · owned", value: "160" }, "owned first, value is the dex number");
  assertTrue(c.length <= 25 && c.every((x) => x.name.length <= 100), "at most 25 choices, Discord-length names");
  assertTrue(autocompleteChoices("", list).length === 25, "empty text: the first 25");
  assertEqual(autocompleteChoices("#25", list)[0].value, "25", "a dex number finds the Pokémon");
  assertEqual(searchKey("Mr. Mime"), "mrmime", "punctuation and spaces are ignored");
}

section("typo match");
{
  assertEqual(name(closestPokemon("Charmelon", list)), "Charmeleon", "one letter missing: opens directly");
  assertEqual(name(closestPokemon("mewtoo", list)), "Mewtwo", "one letter wrong: opens directly");
  assertEqual(name(closestPokemon("char", list)), ["Charmander", "Charmeleon", "Charizard"], "part of several names: three suggestions");
  assertEqual(name(closestPokemon("feral", list)), "Feraligatr", "part of one name: opens directly");
  assertTrue(Array.isArray(name(closestPokemon("pikchu", list))) && name(closestPokemon("pikchu", list))[0] === "Pikachu", "two close names: Did you mean, best first");
  assertEqual(name(closestPokemon("zzzz", list)), [], "nothing close: no suggestions");
}

finish();
