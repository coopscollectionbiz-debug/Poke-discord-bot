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

// Pokédex completion for one region: distinct Pokémon owned in at least one variant.
export function countOwned(region, ownedPokemon) {
  return region.ids.filter((id) => {
    const entry = ownedPokemon[id];
    return Number(entry?.normal ?? 0) + Number(entry?.shiny ?? 0) > 0;
  }).length;
}
