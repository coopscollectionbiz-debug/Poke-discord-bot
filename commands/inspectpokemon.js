// ==========================================================
// inspectpokemon.js (SafeReply Refactor)
// Coop's Collection Discord Bot
// ==========================================================

import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, MessageFlags } from "discord.js";
import { spritePaths } from "../spriteconfig.js";
import { findPokemonByName } from "../utils/dataLoader.js";
import { validateNameQuery } from "../utils/validators.js";
import { safeReply } from "../utils/safeReply.js";
import { getTraining } from "../utils/training.js";
import { getSpecies, getMove } from "../utils/battle/data.js";
import { computeStats } from "../utils/battle/stats.js";
import { autoMoveset } from "../utils/battle/moveset.js";

const statLine = (s) => `HP ${s.hp} · Atk ${s.atk} · Def ${s.def} · SpA ${s.spa} · SpD ${s.spd} · Spe ${s.spe}`;

// Level, stats at that Level, and auto-picked moves for each variant the
// player owns; base stats when they own none.
export function battleInfo(user, speciesId) {
  const species = getSpecies(speciesId);
  const owned = ["normal", "shiny"].filter((v) => (user?.pokemon?.[speciesId]?.[v] ?? 0) > 0);
  if (!owned.length) return `Base stats: ${statLine(species.baseStats)}`;
  return owned.map((variant) => {
    const { level } = getTraining(user, speciesId, variant);
    const moves = autoMoveset(speciesId, level).map((m) => getMove(m).name).join(", ");
    const label = variant === "shiny" ? `✨ shiny Lv ${level}` : `Lv ${level}`;
    return `**Your ${label}** · ${statLine(computeStats(species.baseStats, level))}\nMoves: ${moves}`;
  }).join("\n\n");
}

// ==========================================================
// 🧩 Command definition
// ==========================================================
export default {
  data: new SlashCommandBuilder()
    .setName("inspectpokemon")
    .setDescription("Inspect details about a specific Pokémon by name or ID.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption((option) =>
      option
        .setName("name")
        .setDescription("Pokémon name or Pokédex ID.")
        .setRequired(true)
    ),

  async execute(interaction, trainerData, saveTrainerDataLocal, saveDataToDiscord, client) {
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
    const spriteUrl = `${spritePaths.pokemon}${pokemon.id}.gif`;

    const embed = new EmbedBuilder()
      .setTitle(`${pokemon.name}  #${pokemon.id}`)
      .setDescription(
        `**Rarity:** ${pokemon.rarity?.toUpperCase() ?? "Unknown"}\n` +
          (pokemon.type ? `**Type:** ${pokemon.type}\n` : "") +
          (pokemon.generation ? `**Generation:** ${pokemon.generation}\n` : "") +
          (getSpecies(pokemon.id) ? `\n${battleInfo(trainerData[interaction.user.id], pokemon.id)}` : "")
      )
      .setImage(spriteUrl)
      .setColor(0x1abc9c)
      .setFooter({ text: "Pokémon data sourced from Coop's Collection" })
      .setTimestamp();

    await safeReply(interaction, { embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
