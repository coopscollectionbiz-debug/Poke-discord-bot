// ==========================================================
// bulkRules.js — which Pokémon the bulk donate buttons offer
// ==========================================================
//
// No DOM access, so tests/bulkRules.test.js runs it in Node.
// The server re-checks every row (utils/bulkDonate.js); these rules
// decide what the UI offers, so they must agree with it.
//
// pokemon:     the player's collection, { [id]: { normal, shiny } }
// pokemonData: id → { name, tier }
// savedTeam:   [{ id, variant }] as the server has it. Not the unsaved
//              Change Team edits, because the server checks the saved Team.
// trained:     { "6:normal": [trained copy, …] } from /api/user-pokemon.
//              Copies with TM-trained moves are never bulk-donated (TM
//              system, D-T10): only untrained copies count here.
// ==========================================================

const trainedCount = (trained, pid, variant) => (trained?.[`${Number(pid)}:${variant}`] ?? []).length;

function countsOf(pokemon, pid) {
  const entry = pokemon?.[pid];
  const normal = Number(entry?.normal ?? 0);
  const shiny = Number(entry?.shiny ?? 0);
  return { normal, shiny, any: normal + shiny };
}

// The variant of a Pokémon owned exactly once.
export function onlyVariant(pokemon, pid) {
  return countsOf(pokemon, pid).shiny === 1 ? "shiny" : "normal";
}

// Every UNTRAINED copy past the first, per variant (shinies included).
// Trained copies are always kept.
export function duplicateRows(pokemon, pokemonData, trained = {}) {
  const rows = [];
  const ids = Object.keys(pokemon || {}).map(Number).sort((a, b) => a - b);
  for (const pid of ids) {
    if (!pokemonData[pid]) continue; // server rejects unknown IDs
    const owned = countsOf(pokemon, pid);
    for (const variant of ["normal", "shiny"]) {
      const untrained = owned[variant] - trainedCount(trained, pid, variant);
      if (untrained > 1) rows.push({ pokeId: pid, variant, count: untrained - 1 });
    }
  }
  return rows;
}

// Why a card can't be picked in Multi-select, or null if it can.
export function multiSelectBlock(pid, { pokemon, pokemonData, savedTeam, trained = {} }) {
  const name = pokemonData[pid]?.name || `#${pid}`;
  const owned = countsOf(pokemon, pid);

  if (owned.normal > 1 || owned.shiny > 1) {
    const have = owned.normal > 1 ? `${owned.normal} ${name}` : `${owned.shiny} shiny ${name}`;
    // Say "then select it" only if what Donate Duplicates leaves can be selected.
    // A normal and a shiny, or a Team copy, stays locked.
    const left = { [pid]: { normal: Math.min(owned.normal, 1), shiny: Math.min(owned.shiny, 1) } };
    const unlocks = multiSelectBlock(pid, { pokemon: left, pokemonData, savedTeam }) === null;
    return {
      title: "🔒 More Than One Copy",
      message: `You have ${have}. Use Donate Duplicates to bring it down to 1${unlocks ? ", then select it" : ""}.`,
    };
  }
  if (owned.normal === 1 && owned.shiny === 1) {
    return {
      title: "🔒 You Own Both Variants",
      message: `You have a normal and a shiny ${name}. Turn off Multi-select and tap it to choose which one to donate.`,
    };
  }
  if (owned.any !== 1) return { title: "🔒 Not Owned", message: `You don’t own ${name}.` };

  const variant = onlyVariant(pokemon, pid);
  if (trainedCount(trained, pid, variant) > 0) {
    return { title: "🔒 TM-Trained", message: `Your ${name} has TM-trained moves. Turn off Multi-select and donate it on its own to confirm.` };
  }
  if (savedTeam.some((s) => s.id === Number(pid) && s.variant === variant)) {
    return { title: "🔒 On Your Team", message: `${name} is on your Team. Remove it from your Team first.` };
  }
  return null;
}

// How many TM-trained copies a Donate Duplicates list keeps (for its summary).
export function keptTrained(rows, trained = {}) {
  return rows.reduce((n, r) => n + trainedCount(trained, r.pokeId, r.variant), 0);
}
