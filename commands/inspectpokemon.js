// ==========================================================
// inspectpokemon.js (SafeReply Refactor)
// Coop's Collection Discord Bot
// ==========================================================

import { pokemonSpriteUrl } from "../utils/sprites.js";
import { SlashCommandBuilder, EmbedBuilder, MessageFlags, AttachmentBuilder } from "discord.js";
import { cardImage } from "../utils/render/stage.js";
import { slotView } from "../utils/render/teamView.js";
import { renderInspectCard } from "../utils/render/inspectCard.js";
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
    `**Tier:** ${String(pokemon.tier ?? "unknown").toUpperCase()}\n` +
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
        content: `Pokémon **${input}** not found.`,
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
      .setTimestamp();

    // Rendered cards (utils/render/inspectCard.js); the embed above is the fallback.
    try {
      const files = [];
      for (const [i, slot] of inspectSlots(trainerData[interaction.user.id], pokemon).entries()) {
        const eyebrow = slot.level == null ? "NOT IN YOUR COLLECTION" : slot.shiny ? "YOUR SHINY" : "YOUR POKÉMON";
        const card = await cardImage((animate) => renderInspectCard(slot, { eyebrow, animate }), `pokemon-${i + 1}`);
        files.push(new AttachmentBuilder(card.buffer, { name: card.name }));
      }
      return await safeReply(interaction, { files, flags: MessageFlags.Ephemeral });
    } catch (err) {
      console.warn("⚠️ inspect card render failed; sending embed:", err?.message || err);
    }

    await safeReply(interaction, { embeds: [embed], flags: MessageFlags.Ephemeral });
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
