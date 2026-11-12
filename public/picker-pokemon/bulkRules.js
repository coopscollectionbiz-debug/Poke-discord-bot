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

// What Donate Duplicates offers, per variant (shinies included).
//
// copies: the per-copy rows from /api/user-pokemon
//         ([uid, id, shiny, level, at, trained, teamBits, exp]). With them
//         this is the server's rule (utils/bulkDonate.js
//         donatableDuplicates): never a copy on a team, never a TM-trained
//         copy, and never the best untrained copy (highest EXP, ties by
//         uid). Each row names its copies, lowest Level first:
//         { pokeId, variant, count, uids, copies: [{ uid, level }] }.
//         Without copy rows (older payloads) the counts alone are used:
//         every untrained copy past the first, with no uids.
export function duplicateRows(pokemon, pokemonData, trained = {}, copies = null) {
  if (Array.isArray(copies)) return duplicateRowsFromCopies(pokemonData, copies);
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

const byExpThenUid = (a, b) => a.exp - b.exp || (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0);

function duplicateRowsFromCopies(pokemonData, copies) {
  const lines = new Map(); // "id:variant" → untrained copies
  for (const [uid, id, shiny, level, , isTrained, teams, exp] of copies) {
    if (isTrained || !pokemonData[id]) continue; // server rejects unknown IDs
    const key = `${Number(id)}:${shiny ? "shiny" : "normal"}`;
    if (!lines.has(key)) lines.set(key, []);
    lines.get(key).push({ uid, level, teams, exp: Number(exp ?? 0) });
  }
  const rows = [];
  for (const [key, list] of lines) {
    list.sort(byExpThenUid);
    const best = list.at(-1);
    const give = list.filter((c) => !c.teams && c !== best);
    if (!give.length) continue;
    const [pid, variant] = key.split(":");
    rows.push({
      pokeId: Number(pid),
      variant,
      count: give.length,
      uids: give.map((c) => c.uid),
      copies: give.map((c) => ({ uid: c.uid, level: c.level })),
    });
  }
  return rows.sort((a, b) => a.pokeId - b.pokeId || (a.variant === "normal" ? -1 : 1));
}

// Rows trimmed to the copies still ticked in the confirmation.
export function pickedRows(rows, picked) {
  return rows
    .map((r) => (r.uids ? { ...r, uids: r.uids.filter((u) => picked.has(u)) } : r))
    .map((r) => (r.uids ? { ...r, count: r.uids.length } : r))
    .filter((r) => r.count > 0);
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
    // Donate Duplicates keeps the best copy AND any team copy, so with a
    // team copy it may leave two: only promise "down to 1" when it unlocks.
    return {
      title: "🔒 More Than One Copy",
      message: unlocks
        ? `You have ${have}. Use Donate Duplicates to bring it down to 1, then select it.`
        : `You have ${have}. Multi-select only takes Pokémon you own one of. Turn it off and tap ${name} to donate a copy on its own.`,
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
