// ==========================================================
// inspectpokemon.js (SafeReply Refactor)
// Coop's Collection Discord Bot
// ==========================================================

import { pokemonSpriteUrl } from "../utils/sprites.js";
import { SlashCommandBuilder, EmbedBuilder, MessageFlags, AttachmentBuilder } from "discord.js";
import { cardImage } from "../utils/render/stage.js";
import { slotView } from "../utils/render/teamView.js";

import { spritePaths } from "../spriteconfig.js";
import { findPokemonByName } from "../utils/dataLoader.js";
import { validateNameQuery } from "../utils/validators.js";
import { safeReply } from "../utils/safeReply.js";
import { getTraining } from "../utils/training.js";
import { getSpecies, getMove } from "../utils/battle/data.js";
import { computeStats } from "../utils/battle/stats.js";
import { autoMoveset } from "../utils/battle/moveset.js";
import { chosenMoves } from "../services/movesets.js";
import { formatTypesLine } from "./pokedex.js";
import { threaded } from "../utils/render/renderers.js";

const statLine = (s) => `HP ${s.hp} · Atk ${s.atk} · Def ${s.def} · SpA ${s.spa} · SpD ${s.spd} · Spe ${s.spe}`;

// Level, stats at that Level, and moves for each variant the player owns
// (the Display team's chosen moveset, else the automatic one; the Battle
// team's too when it has its own); base stats when they own none.
export function battleInfo(user, speciesId) {
  const species = getSpecies(speciesId);
  const owned = ["normal", "shiny"].filter((v) => (user?.pokemon?.[speciesId]?.[v] ?? 0) > 0);
  if (!owned.length) return `Base stats: ${statLine(species.baseStats)}`;
  return owned.map((variant) => {
    const { level } = getTraining(user, speciesId, variant);
    const names = (ids) => ids.map((m) => getMove(m)?.name ?? m).join(", ");
    const display = chosenMoves(user, "display", speciesId, variant);
    const battle = chosenMoves(user, "battle", speciesId, variant);
    const moves = names(display ?? autoMoveset(speciesId, level));
    const label = variant === "shiny" ? `✨ shiny Lv ${level}` : `Lv ${level}`;
    const battleLine = battle ? `\nBattle team moves: ${names(battle)}` : "";
    return `**Your ${label}** · ${statLine(computeStats(species.baseStats, level))}\nMoves: ${moves}${battleLine}`;
  }).join("\n\n");
}

// Rarity, type, and region, with the field names pokemonData uses.
export function infoLines(pokemon) {
  return (
    `**Rarity:** ${String(pokemon.tier ?? "unknown").toUpperCase()}\n` +
    `**Type:** ${formatTypesLine(pokemon.types)}\n` +
    `**Region:** ${pokemon.region ?? "Unknown"}\n`
  );
}

// ==========================================================
// 🧩 Command definition
// ==========================================================
/** The "Your stats" cards (one per owned variant, or base stats): AttachmentBuilders. */
export async function inspectFiles(user, pokemon) {
  const files = [];
  for (const [i, slot] of inspectSlots(user, pokemon).entries()) {
    const eyebrow = slot.level == null ? "NOT IN YOUR COLLECTION" : slot.shiny ? "YOUR SHINY" : "YOUR POKÉMON";
    const card = await cardImage((animate) => threaded.inspect(slot, { eyebrow, animate }), `pokemon-${i + 1}`);
    files.push(new AttachmentBuilder(card.buffer, { name: card.name }));
  }
  return files;
}

/** Text fallback for "Your stats" when a card can't render. */
export function inspectText(user, pokemon) {
  return `**${pokemon.name}  #${pokemon.id}**
` + infoLines(pokemon) + (getSpecies(pokemon.id) ? `
${battleInfo(user, pokemon.id)}` : "");
}

// Three-teams split: /inspectpokemon is an alias of /pokedex that opens on
// "Your stats" (kept for about two weeks).
export default {
  data: new SlashCommandBuilder()
    .setName("inspectpokemon")
    .setDescription("Old name: opens /pokedex on Your stats.")
    .setDefaultMemberPermissions(null)
    .addStringOption((option) => option.setName("name").setDescription("Pokémon name or Pokédex number").setRequired(true).setAutocomplete(true)),
  async autocomplete(interaction, trainerData) {
    const { autocomplete } = await import("./pokedex.js");
    return autocomplete(interaction, trainerData);
  },
  async execute(interaction, trainerData, _saveTrainerDataLocal, _saveDataToDiscord, _lockUser, _enqueueSave, client) {
    const { runPokedex } = await import("./pokedex.js");
    return runPokedex(interaction, trainerData, client, { startOn: "stats" });
  },
};

/**
 * What /inspectpokemon draws: one card per variant the player owns (stats at
 * their Level, battle moves), or one base-stats card when they own neither.
 */
export function inspectSlots(user, pokemon) {
  const id = Number(pokemon.id);
  const owned = ["normal", "shiny"].filter((v) => (user?.pokemon?.[id]?.[v] ?? 0) > 0);
  if (owned.length) {
    // The card shows the Display team's chosen moves (displays use the Display team), else the automatic ones.
    return owned.map((variant) => {
      const member = { speciesId: id, variant, level: getTraining(user, id, variant).level };
      const moves = chosenMoves(user, "display", id, variant);
      if (moves) member.moves = moves;
      return { ...slotView(user, member, 0), slot: null };
    });
  }
  const base = slotView({}, { speciesId: id, variant: "normal", level: 1 }, 0);
  return [{ ...base, slot: null, level: null, expFrac: 0, stats: getSpecies(id)?.baseStats ?? null, moves: [] }];
}
