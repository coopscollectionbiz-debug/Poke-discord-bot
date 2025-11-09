// ==========================================================
// 🕐 /daily – Global Reset (Midnight UTC) + Dual Reward (Pokémon + Trainer)
// + Epic+ Broadcast via utils/rareSightings.js
// ==========================================================

import {
  SlashCommandBuilder,
  PermissionFlagsBits
} from "discord.js";
import { spritePaths } from "../spriteconfig.js";
import { rollForShiny } from "../shinyOdds.js";
import { getPokemonCached } from "../utils/pokemonCache.js";
import { getFlattenedTrainers } from "../utils/dataLoader.js";
import {
  selectRandomPokemonForUser,
  selectRandomTrainerForUser
} from "../utils/weightedRandom.js";
import {
  createSuccessEmbed,
  createPokemonRewardEmbed,
  createTrainerRewardEmbed
} from "../utils/embedBuilders.js";
import { safeReply } from "../utils/safeReply.js";
import { atomicSave } from "../utils/saveManager.js";
import { ensureUserInitialized } from "../utils/userInitializer.js";
import { updateUserRole } from "../utils/updateUserRole.js";
import { broadcastReward } from "../utils/broadcastReward.js";

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
    .setDefaultMemberPermissions(null),

  async execute(interaction, trainerData, saveTrainerDataLocal, saveDataToDiscord, client) {
    try {
      await interaction.deferReply({ ephemeral: true });

      const id = interaction.user.id;
      const user = await ensureUserInitialized(id, interaction.user.username, trainerData, client);

      // ✅ Ensure essential fields exist
      user.tp ??= 0;
      user.cc ??= 0;
      user.pokemon ??= {};
      user.trainers ??= {};
      user.daily ??= { lastUsed: null, streak: 0, rewards: [] };
      user.displayedTrainer ??= null;

      // 🕐 Global Reset Check
      if (hasClaimedToday(user)) {
        return safeReply(interaction, {
          content: "❌ You’ve already claimed your daily reward today! Try again after **midnight UTC**.",
          ephemeral: true
        });
      }

      // 💰 Base Rewards
      user.tp += DAILY_TP_REWARD;
      user.cc += DAILY_CC_REWARD;
      user.lastDaily = Date.now();

      const member = await interaction.guild.members.fetch(interaction.user.id);
      await updateUserRole(member, user.tp, interaction.channel);

      // 🎁 Generate Dual Rewards
      const allPokemon = await getPokemonCached();
      const flatTrainers = await getFlattenedTrainers();

      if (!Array.isArray(allPokemon) || allPokemon.length === 0) {
        console.error("❌ /daily: getPokemonCached() returned no data");
        return safeReply(interaction, {
          content: "❌ Pokémon data missing. Please notify staff.",
          ephemeral: true
        });
      }
      if (!Array.isArray(flatTrainers) || flatTrainers.length === 0) {
        console.error("❌ /daily: getFlattenedTrainers() returned no data");
        return safeReply(interaction, {
          content: "❌ Trainer data missing. Please notify staff.",
          ephemeral: true
        });
      }

      const pokemonPick = selectRandomPokemonForUser(allPokemon, user);
      const trainerPick = selectRandomTrainerForUser(flatTrainers, user);
      if (!pokemonPick || !trainerPick) {
        console.error("❌ /daily: selectRandom* returned undefined", { pokemonPick, trainerPick });
        return safeReply(interaction, {
          content: "❌ Daily reward generation failed. Try again later.",
          ephemeral: true
        });
      }

      const shiny = rollForShiny(user.tp || 0);

      // ✅ Update user data
      user.pokemon[pokemonPick.id] ??= { normal: 0, shiny: 0 };
      shiny ? user.pokemon[pokemonPick.id].shiny++ : user.pokemon[pokemonPick.id].normal++;
      user.trainers[trainerPick.filename] = (user.trainers[trainerPick.filename] || 0) + 1;

      // 💾 Save before showing embeds
      try {
        await atomicSave(trainerData, saveTrainerDataLocal, saveDataToDiscord);
      } catch (err) {
        console.error("❌ Failed to save daily rewards:", err);
        return safeReply(interaction, {
          content: "❌ Failed to save rewards. Please try again.",
          ephemeral: true
        });
      }

      // 🖼️ Sprites
      const pokemonSprite = shiny
        ? `${spritePaths.shiny}${pokemonPick.id}.gif`
        : `${spritePaths.pokemon}${pokemonPick.id}.gif`;

      const trainerFile =
        (trainerPick.sprites && trainerPick.sprites[0]) ||
        trainerPick.spriteFile ||
        trainerPick.filename ||
        `${trainerPick.id}.png`;

      const trainerSprite = `${spritePaths.trainers}${trainerFile.toLowerCase()}`;

      // 🧱 Embeds
      const successEmbed = createSuccessEmbed(
        "🎁 Daily Claimed!",
        `You earned **${DAILY_TP_REWARD} TP** and **${DAILY_CC_REWARD} CC**!\nYou also received both a Pokémon and a Trainer reward!`
      );

      const pokemonEmbed = createPokemonRewardEmbed(pokemonPick, shiny, pokemonSprite);
      const trainerEmbed = createTrainerRewardEmbed(trainerPick, trainerSprite);

      // 🪩 Send result
      await interaction.editReply({
        embeds: [successEmbed, pokemonEmbed, trainerEmbed],
        components: []
      });

      // 🗣️ Add trainer message after embed
      await interaction.followUp({
        content: `👥 You recruited **${trainerPick.name || trainerPick.filename}** to your team!\n💡 Use **/changetrainer** to equip a different trainer.`,
        ephemeral: true
      });

      // 🌐 Global broadcasts
      try {
        await broadcastReward(client, {
          user: interaction.user,
          type: "pokemon",
          item: pokemonPick,
          shiny,
          source: "daily"
        });

        await broadcastReward(client, {
          user: interaction.user,
          type: "trainer",
          item: trainerPick,
          shiny: false,
          source: "daily"
        });
      } catch (err) {
        console.error("❌ broadcastReward failed (daily):", err.message);
      }
    } catch (err) {
      console.error("❌ /daily error stack:", err);
      return safeReply(interaction, {
        content: `❌ Error executing /daily: ${err.message}`,
        ephemeral: true
      });
    }
  }
};
