// ===========================================================
// Regions — named sets of Pokémon sharing a home region (see CONTEXT.md).
// No DOM access, so node tests (and later the bot) can import this too.
// ===========================================================

// [{ name: "Kanto", ids: [1, 2, ...] }, ...], regions ordered by their lowest ID.
export function getRegions(pokemonData) {
  const byName = new Map();
  const ids = Object.keys(pokemonData).map(Number).sort((a, b) => a - b);
  for (const id of ids) {
    const name = pokemonData[id].region;
    if (!byName.has(name)) byName.set(name, { name, ids: [] });
    byName.get(name).ids.push(id);
  }
  return [...byName.values()];
}

// Pokédex completion for one region: distinct Pokémon registered in the
// player's Pokédex (ever caught, either variant; never drops).
// pokedex: { id: 1 normal | 2 shiny | 3 both } from /api/user-pokemon.
export function countRegistered(region, pokedex) {
  return region.ids.filter((id) => (Number(pokedex?.[id]) & 3) > 0).length;
}

// Distinct Pokémon of a region owned right now (the Collection).
export function countOwned(region, ownedPokemon) {
  return region.ids.filter((id) => {
    const entry = ownedPokemon[id];
    return Number(entry?.normal ?? 0) + Number(entry?.shiny ?? 0) > 0;
  }).length;
}
