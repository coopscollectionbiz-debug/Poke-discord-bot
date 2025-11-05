// ==========================================================
// /addinventory — Add a specific Pokémon or Trainer to a user's inventory
// ==========================================================

import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import { safeReply } from "../utils/safeReply.js";
import { ensureUserData } from "../utils/trainerDataHelper.js";
import { findPokemonByName, getFlattenedTrainers } from "../utils/dataLoader.js";

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

  async execute(interaction, trainerData, saveTrainerDataLocal, saveDataToDiscord) {
    if (!interaction.member?.permissions?.has(PermissionFlagsBits.Administrator)) {
      return safeReply(interaction, { content: "⛔ You do not have permission to use this command.", ephemeral: true });
    }

    const targetUser = interaction.options.getUser("user");
    const type = interaction.options.getString("type");
    const name = interaction.options.getString("name");
    const shiny = interaction.options.getBoolean("shiny");
    const userData = ensureUserData(trainerData, targetUser.id, targetUser.username);

    if (type === "pokemon") {
      const pokemon = await findPokemonByName(name);
      if (!pokemon) {
        return safeReply(interaction, { content: `⛔ Pokémon "${name}" not found.`, ephemeral: true });
      }

      if (!userData.pokemon[pokemon.id]) userData.pokemon[pokemon.id] = { normal: 0, shiny: 0 };
      shiny ? userData.pokemon[pokemon.id].shiny++ : userData.pokemon[pokemon.id].normal++;

      await saveTrainerDataLocal(trainerData);
      await saveDataToDiscord(trainerData);

      return safeReply(interaction, { content: `✅ Added **${shiny ? "Shiny " : ""}${pokemon.name}** to **${targetUser.username}**'s inventory.`, ephemeral: true });
    }

    if (type === "trainer") {
      const allTrainers = await getFlattenedTrainers();
      const trainer = allTrainers.find(t => t.name.toLowerCase() === name.toLowerCase());
      if (!trainer) {
        return safeReply(interaction, { content: `⛔ Trainer "${name}" not found.`, ephemeral: true });
      }

      userData.trainers[trainer.filename] = true;
      await saveTrainerDataLocal(trainerData);
      await saveDataToDiscord(trainerData);

      return safeReply(interaction, { content: `✅ Added **${trainer.name}** to **${targetUser.username}**'s inventory.`, ephemeral: true });
    }

    return safeReply(interaction, { content: "⛔ Invalid type. Must be either 'pokemon' or 'trainer'.", ephemeral: true });
  }
};
