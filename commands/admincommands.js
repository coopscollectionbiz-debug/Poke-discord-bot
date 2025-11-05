import { SlashCommandBuilder } from 'discord.js';
import { ensureUserData } from '../utils/trainerDataHelper.js';
import { findPokemonByName, getFlattenedTrainers } from '../utils/dataLoader.js';
import { createSuccessEmbed, createErrorEmbed } from '../utils/embedBuilders.js';

// Helper Function to Check Admin Permissions
function isAdmin(interaction) {
  return interaction.member?.permissions?.has('ADMINISTRATOR');
}

// ===== Command: /resetuser =====
const resetUserCommand = {
  data: new SlashCommandBuilder()
    .setName('resetuser')
    .setDescription('Reset onboarding, Pokémon, and trainers for a user, but keep TP.')
    .addUserOption((option) => 
      option.setName('user').setDescription('The user to reset').setRequired(true)
    ),

  async execute(interaction, trainerData, saveTrainerDataLocal, saveDataToDiscord) {
    if (!isAdmin(interaction)) {
      return interaction.reply({ content: '⛔ You do not have permission to use this command.', ephemeral: true });
    }

    const targetUser = interaction.options.getUser('user');

    if (!trainerData[targetUser.id]) {
      return interaction.reply({ content: `⛔ ${targetUser.username} does not have a trainer profile.`, ephemeral: true });
    }

    const targetData = trainerData[targetUser.id];
    const preservedTP = targetData.tp;

    // Reset fields
    targetData.onboardingComplete = false;
    targetData.onboardingDate = null;
    targetData.pokemon = {};
    targetData.trainers = {};
    targetData.displayedPokemon = [];
    targetData.displayedTrainer = null;

    // Preserve TP
    targetData.tp = preservedTP;

    saveTrainerDataLocal(trainerData);
    saveDataToDiscord(trainerData);

    interaction.reply({
      embeds: [createSuccessEmbed('🔄 User Reset', `Trainer profile for **${targetUser.username}** has been reset. TP preserved.`)],
    });
  },
};

// ===== Command: /addinventory =====
const addInventoryCommand = {
  data: new SlashCommandBuilder()
    .setName('addinventory')
    .setDescription('Add a specific Pokémon or Trainer to a user\'s inventory.')
    .addUserOption((option) =>
      option.setName('user').setDescription('The target user').setRequired(true)
    )
    .addStringOption((option) =>
      option.setName('type').setDescription('pokemon or trainer').setChoices(
        { name: 'Pokemon', value: 'pokemon' },
        { name: 'Trainer', value: 'trainer' }
      ).setRequired(true)
    )
    .addStringOption((option) =>
      option.setName('name').setDescription('Name of the Pokémon or Trainer.').setRequired(true)
    )
    .addBooleanOption((option) =>
      option.setName('shiny').setDescription('Add as shiny (for Pokémon only).').setRequired(false)
    ),

  async execute(interaction, trainerData, saveTrainerDataLocal, saveDataToDiscord) {
    if (!isAdmin(interaction)) {
      return interaction.reply({ content: '⛔ You do not have permission to use this command.', ephemeral: true });
    }

    const targetUser = interaction.options.getUser('user');
    const type = interaction.options.getString('type');
    const name = interaction.options.getString('name');
    const shiny = interaction.options.getBoolean('shiny');

    const userData = ensureUserData(trainerData, targetUser.id, targetUser.username);

    if (type === 'pokemon') {
      const pokemon = await findPokemonByName(name);

      if (!pokemon) {
        return interaction.reply({ content: `⛔ Pokémon "${name}" not found.`, ephemeral: true });
      }

      if (!userData.pokemon[pokemon.id]) {
        userData.pokemon[pokemon.id] = { normal: 0, shiny: 0 };
      }

      if (shiny) {
        userData.pokemon[pokemon.id].shiny += 1;
      } else {
        userData.pokemon[pokemon.id].normal += 1;
      }

      saveTrainerDataLocal(trainerData);
      saveDataToDiscord(trainerData);

      return interaction.reply({ content: `✅ Added **${shiny ? 'Shiny ' : ''}${pokemon.name}** to **${targetUser.username}**'s inventory.` });
    }

    if (type === 'trainer') {
      const allTrainers = await getFlattenedTrainers();
      const trainer = allTrainers.find((t) => t.name.toLowerCase() === name.toLowerCase());

      if (!trainer) {
        return interaction.reply({ content: `⛔ Trainer "${name}" not found.`, ephemeral: true });
      }

      userData.trainers[trainer.filename] = true;

      saveTrainerDataLocal(trainerData);
      saveDataToDiscord(trainerData);

      return interaction.reply({ content: `✅ Added **${trainer.name}** to **${targetUser.username}**'s inventory.` });
    }

    return interaction.reply({ content: '⛔ Invalid type. Must be either "pokemon" or "trainer".', ephemeral: true });
  },
};

// ===== Command: /addcurrency =====
const addCurrencyCommand = {
  data: new SlashCommandBuilder()
    .setName('addcurrency')
    .setDescription('Add TP or CC to a user\'s account.')
    .addUserOption((option) =>
      option.setName('user').setDescription('The target user').setRequired(true)
    )
    .addStringOption((option) =>
      option.setName('type').setDescription('tp or cc').setChoices(
        { name: 'TP', value: 'tp' },
        { name: 'CC', value: 'cc' }
      ).setRequired(true)
    )
    .addIntegerOption((option) =>
      option.setName('amount').setDescription('The amount to add.').setRequired(true)
    ),

  async execute(interaction, trainerData, saveTrainerDataLocal, saveDataToDiscord) {
    if (!isAdmin(interaction)) {
      return interaction.reply({ content: '⛔ You do not have permission to use this command.', ephemeral: true });
    }

    const targetUser = interaction.options.getUser('user');
    const type = interaction.options.getString('type');
    const amount = interaction.options.getInteger('amount');

    const userData = ensureUserData(trainerData, targetUser.id, targetUser.username);

    if (type === 'tp') {
      userData.tp += amount;
    } else if (type === 'cc') {
      userData.cc = (userData.cc || 0) + amount;
    } else {
      return interaction.reply({ content: '⛔ Invalid currency type. Must be either "tp" or "cc".', ephemeral: true });
    }

    saveTrainerDataLocal(trainerData);
    saveDataToDiscord(trainerData);

    return interaction.reply({ content: `✅ Added ${amount} ${type.toUpperCase()} to **${targetUser.username}**.` });
  },
};

export { resetUserCommand, addInventoryCommand, addCurrencyCommand };