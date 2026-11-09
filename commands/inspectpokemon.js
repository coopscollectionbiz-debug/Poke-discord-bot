// ==========================================================
// inspectpokemon.js (SafeReply Refactor)
// Coop's Collection Discord Bot
// ==========================================================

import { pokemonSpriteUrl } from "../utils/sprites.js";
import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from "discord.js";
import { spritePaths } from "../spriteconfig.js";
import { findPokemonByName } from "../utils/dataLoader.js";
import { validateNameQuery } from "../utils/validators.js";
import { safeReply } from "../utils/safeReply.js";
import { getTraining, getMoveset } from "../utils/training.js";
import { getSpecies, getMove } from "../utils/battle/data.js";
import { computeStats } from "../utils/battle/stats.js";
import { formatTypesLine } from "./pokedex.js";

const statLine = (s) => `HP ${s.hp} · Atk ${s.atk} · Def ${s.def} · SpA ${s.spa} · SpD ${s.spd} · Spe ${s.spe}`;

// Level, stats at that Level, and Moveset for each variant the player owns;
// base stats when they own none.
export function battleInfo(user, speciesId) {
  const species = getSpecies(speciesId);
  const owned = ["normal", "shiny"].filter((v) => (user?.pokemon?.[speciesId]?.[v] ?? 0) > 0);
  if (!owned.length) return `Base stats: ${statLine(species.baseStats)}`;
  return owned.map((variant) => {
    const { level } = getTraining(user, speciesId, variant);
    const moves = getMoveset(user, speciesId, variant).map((m) => getMove(m).name).join(", ");
    const label = variant === "shiny" ? `✨ shiny Lv ${level}` : `Lv ${level}`;
    return `**Your ${label}** · ${statLine(computeStats(species.baseStats, level))}\nMoves: ${moves}`;
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
export default {
  data: new SlashCommandBuilder()
    .setName("inspectpokemon")
    .setDescription("Inspect details about a specific Pokémon by name or ID.")
    // Explicit null so re-registering clears the old admin-only setting;
    // Discord's docs don't say what an omitted field does on overwrite.
    .setDefaultMemberPermissions(null)
    .addStringOption((option) =>
      option
        .setName("name")
        .setDescription("Pokémon name or Pokédex ID.")
        .setRequired(true)
    ),

  async execute(interaction, trainerData, _saveTrainerDataLocal, _saveDataToDiscord, _lockUser, _enqueueSave, client) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const input = interaction.options.getString("name").trim();

    // Validate input
    const validation = validateNameQuery(input);
    if (!validation.valid) {
      return safeReply(interaction, {
        content: `❌ ${validation.error}`,
        flags: MessageFlags.Ephemeral,
      });
    }

    // Use helper to find Pokémon
    const pokemon = await findPokemonByName(validation.sanitized);

    if (!pokemon) {
      return safeReply(interaction, {
        content: `❌ Pokémon **${input}** not found.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    // ✅ Use hosted sprite URL (supports shiny later if needed)
    const spriteUrl = pokemonSpriteUrl(pokemon.id, false);

    const embed = new EmbedBuilder()
      .setTitle(`${pokemon.name}  #${pokemon.id}`)
      .setDescription(
        infoLines(pokemon) +
          (getSpecies(pokemon.id) ? `\n${battleInfo(trainerData[interaction.user.id], pokemon.id)}` : "")
      )
      .setImage(spriteUrl)
      .setColor(0x1abc9c)
      .setFooter({ text: "Pokémon data sourced from Coop's Collection" })
      .setTimestamp();

    await safeReply(interaction, { embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
