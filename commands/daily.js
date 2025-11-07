// ==========================================================
// 🕐 /daily – Global Reset (Midnight UTC) + Dual Reward (Pokémon + Trainer)
// + Epic+ Broadcast via utils/rareSightings.js
// ==========================================================

import {
  SlashCommandBuilder,
  PermissionFlagsBits,
} from "discord.js";
import { spritePaths } from "../spriteconfig.js";
import { rollForShiny } from "../shinyOdds.js";
import { getPokemonCached } from "../utils/pokemonCache.js";
import { getFlattenedTrainers } from "../utils/dataLoader.js";
import {
  selectRandomPokemonForUser,
  selectRandomTrainerForUser,
} from "../utils/weightedRandom.js";
import {
  createSuccessEmbed,
  createPokemonRewardEmbed,
  createTrainerRewardEmbed,
} from "../utils/embedBuilders.js";
import { safeReply } from "../utils/safeReply.js";
import { atomicSave } from "../utils/saveManager.js";
import { ensureUserInitialized } from "../utils/userInitializer.js";
import { postRareSightings } from "../utils/rareSightings.js";

// ==========================================================
// ⚖️ Constants
// ==========================================================
const DAILY_TP_REWARD = 50;
const DAILY_CC_REWARD = 25;

// ==========================================================
// 🌍 Global Reset Helper (Midnight UTC)
// ==========================================================
function hasClaimedToday(user) {
  if (!user.lastDaily) return false;
  const last = new Date(user.lastDaily);
  const now = new Date();
  return (
    last.getUTCFullYear() === now.getUTCFullYear() &&
    last.getUTCMonth() === now.getUTCMonth() &&
    last.getUTCDate() === now.getUTCDate()
  );
}

// ==========================================================
// 🧩 Command Definition
// ==========================================================
export default {
  data: new SlashCommandBuilder()
    .setName("daily")
    .setDescription("Claim your daily TP, CC, and receive both a Pokémon and Trainer!")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction, trainerData, saveTrainerDataLocal, saveDataToDiscord, client) {
    await interaction.deferReply({ ephemeral: true });

    const id = interaction.user.id;
    const user = await ensureUserInitialized(id, interaction.user.username, trainerData, client);

    // 🕐 Global Reset Check
    if (hasClaimedToday(user)) {
      return safeReply(interaction, {
        content: "❌ You’ve already claimed your daily reward today! Try again after **midnight UTC**.",
        ephemeral: true,
      });
    }

    // 💰 Base Rewards
    user.tp += DAILY_TP_REWARD;
    user.cc += DAILY_CC_REWARD;
    user.lastDaily = Date.now();

    // 🎁 Generate Dual Rewards
    const allPokemon = await getPokemonCached();
    const flatTrainers = await getFlattenedTrainers();

    const pokemonPick = selectRandomPokemonForUser(allPokemon, user);
    const trainerPick = selectRandomTrainerForUser(flatTrainers, user);
    const shiny = rollForShiny(user.tp || 0);

    // Update user data
    user.pokemon ??= {};
    user.pokemon[pokemonPick.id] ??= { normal: 0, shiny: 0 };
    shiny ? user.pokemon[pokemonPick.id].shiny++ : user.pokemon[pokemonPick.id].normal++;

    user.trainers ??= {};
    user.trainers[trainerPick.filename] = (user.trainers[trainerPick.filename] || 0) + 1;

    // 💾 Save
    try {
      await atomicSave(trainerData, saveTrainerDataLocal, saveDataToDiscord);
    } catch (err) {
      console.error("❌ Failed to save daily rewards:", err);
      return safeReply(interaction, {
        content: "❌ Failed to save rewards. Please try again.",
        ephemeral: true,
      });
    }

    // 🖼️ Sprites
    const pokemonSprite = `${shiny ? spritePaths.shiny : spritePaths.pokemon}${pokemonPick.id}.gif`;
    const trainerSprite = `${spritePaths.trainers}${trainerPick.filename}.png`;

    // 🧱 Embeds
    const successEmbed = createSuccessEmbed(
      "🎁 Daily Claimed!",
      `You earned **${DAILY_TP_REWARD} TP** and **${DAILY_CC_REWARD} CC**!\n` +
        `You also received both a Pokémon and a Trainer reward!`
    );

    const pokemonEmbed = createPokemonRewardEmbed(pokemonPick, shiny, pokemonSprite);
    const trainerEmbed = createTrainerRewardEmbed(trainerPick, trainerSprite);

    // 🪩 Send ephemeral result to user
    await interaction.editReply({
      embeds: [successEmbed, pokemonEmbed, trainerEmbed],
      components: [],
    });

    // ======================================================
    // 🌟 Rare Sightings Broadcast (Epic+ and all Shinies)
    // ======================================================
    await postRareSightings(client, pokemonPick, interaction.user, true, shiny);
    await postRareSightings(client, trainerPick, interaction.user, false, false);
  },
};
