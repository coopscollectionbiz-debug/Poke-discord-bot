// ==========================================================
// /addinventory – Add a specific Pokémon or Trainer to a user's inventory
// ==========================================================

import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import { safeReply } from "../utils/safeReply.js";
import { findPokemonByName, getFlattenedTrainers } from "../utils/dataLoader.js";
import { getTrainerKey, findTrainerByQuery } from "../utils/trainerFileHandler.js";
import { atomicSave } from "../utils/saveManager.js";

export default {
  data: new SlashCommandBuilder()
    .setName("addinventory")
    .setDescription("Add a specific Pokémon or Trainer to a user's inventory.")
    .addUserOption(option => option.setName("user").setDescription("The target user").setRequired(true))
    .addStringOption(option =>
      option.setName("type").setDescription("pokemon or trainer").addChoices(
        { name: "Pokemon", value: "pokemon" },
        { name: "Trainer", value: "trainer" }
      ).setRequired(true)
    )
    .addStringOption(option => option.setName("name").setDescription("Name of the Pokémon or Trainer.").setRequired(true))
    .addBooleanOption(option => option.setName("shiny").setDescription("Add as shiny (for Pokémon only).").setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction, trainerData, saveTrainerDataLocal, saveDataToDiscord, reloadUserFromDiscord, ensureUserInitialized) {
    // ✅ Defer reply immediately
    await interaction.deferReply({ ephemeral: true });

    if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
      return safeReply(interaction, { content: "⛔ You do not have permission to use this command.", ephemeral: true });
    }

    const targetUser = interaction.options.getUser("user");
    const type = interaction.options.getString("type");
    const name = interaction.options.getString("name");
    const shiny = interaction.options.getBoolean("shiny") || false;
    const userData = await ensureUserInitialized(targetUser.id, targetUser.username, trainerData, reloadUserFromDiscord);

    try {
      if (type === "pokemon") {
        const pokemon = await findPokemonByName(name);
        if (!pokemon) {
          return safeReply(interaction, { content: `⛔ Pokémon "${name}" not found.`, ephemeral: true });
        }

        if (!userData.pokemon[pokemon.id]) {
          userData.pokemon[pokemon.id] = { normal: 0, shiny: 0 };
        }
        shiny ? userData.pokemon[pokemon.id].shiny++ : userData.pokemon[pokemon.id].normal++;

        await atomicSave(trainerData, saveTrainerDataLocal, saveDataToDiscord);

        return safeReply(interaction, {
          content: `✅ Added **${shiny ? "Shiny " : ""}${pokemon.name}** to **${targetUser.username}**'s inventory.`,
          ephemeral: true
        });
      }

      if (type === "trainer") {
        const allTrainers = await getFlattenedTrainers();
        const trainer = findTrainerByQuery(allTrainers, name);
        
        if (!trainer) {
          return safeReply(interaction, { content: `⛔ Trainer "${name}" not found.`, ephemeral: true });
        }

        // ✅ Use standardized trainer key handler
        const trainerKey = getTrainerKey(trainer);
        userData.trainers[trainerKey] = true;
        
        await atomicSave(trainerData, saveTrainerDataLocal, saveDataToDiscord);

        return safeReply(interaction, {
          content: `✅ Added **${trainer.name}** to **${targetUser.username}**'s inventory.`,
          ephemeral: true
        });
      }

      return safeReply(interaction, { content: "⛔ Invalid type. Must be either 'pokemon' or 'trainer'.", ephemeral: true });
    } catch (err) {
      console.error("❌ Add inventory error:", err);
      return safeReply(interaction, {
        content: `❌ Error: ${err.message}`,
        ephemeral: true
      });
    }
  }
};