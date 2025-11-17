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
const DAILY_TP_REWARD = 100;
const DAILY_CC_REWARD = 500;
let lastDailySave = 0; // 🧠 Debounce control (1 minute)

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

      // ✅ Ensure essential fields
      user.tp ??= 0;
      user.cc ??= 0;
      user.pokemon ??= {};
      user.trainers ??= {};
      user.daily ??= { lastUsed: null, streak: 0, rewards: [] };
      user.displayedTrainer ??= null;

      // 🕐 Already claimed check
      if (hasClaimedToday(user)) {
        return safeReply(interaction, {
          content: "❌ You’ve already claimed your daily reward today! Try again after **midnight UTC**.",
          ephemeral: true
        });
      }

      // 💰 Base rewards
      user.tp += DAILY_TP_REWARD;
      user.cc += DAILY_CC_REWARD;
      user.lastDaily = Date.now();

      const member = await interaction.guild.members.fetch(interaction.user.id);
      await updateUserRole(member, user.tp, interaction.channel);

      // 🎁 Generate rewards
      const allPokemon = await getPokemonCached();
      const flatTrainers = await getFlattenedTrainers();
      if (!Array.isArray(allPokemon) || allPokemon.length === 0)
        return safeReply(interaction, { content: "❌ Pokémon data missing.", ephemeral: true });
      if (!Array.isArray(flatTrainers) || flatTrainers.length === 0)
        return safeReply(interaction, { content: "❌ Trainer data missing.", ephemeral: true });

      const pokemonPick = selectRandomPokemonForUser(allPokemon, user);
      const trainerPick = selectRandomTrainerForUser(flatTrainers, user);
      const shiny = rollForShiny(user.tp || 0);

      // ✅ Update user data
      user.pokemon[pokemonPick.id] ??= { normal: 0, shiny: 0 };
      shiny ? user.pokemon[pokemonPick.id].shiny++ : user.pokemon[pokemonPick.id].normal++;
      user.trainers[trainerPick.filename] = (user.trainers[trainerPick.filename] || 0) + 1;

      // 💾 Local save (always immediate)
      await atomicSave(trainerData, saveTrainerDataLocal, saveDataToDiscord)
        .catch(err => console.error("❌ Local save failed:", err));

      // 💾 Debounced Discord save (max 1× per minute)
      const now = Date.now();
      if (now - lastDailySave > 60_000) {
        lastDailySave = now;
        await saveDataToDiscord(trainerData).catch(err =>
          console.warn("⚠️ Debounced Discord save failed:", err.message)
        );
      } else {
        console.log("💾 Skipped Discord backup (debounced save)");
      }

      // 🖼️ Sprites + embeds
      const pokemonSprite = shiny
        ? `${spritePaths.shiny}${pokemonPick.id}.gif`
        : `${spritePaths.pokemon}${pokemonPick.id}.gif`;
      const trainerSprite = `${spritePaths.trainers}${trainerPick.filename}`;

      const successEmbed = createSuccessEmbed(
        "🎁 Daily Claimed!",
        `You earned **${DAILY_TP_REWARD} TP** and **${DAILY_CC_REWARD} CC**!\n` +
          `You also received both a Pokémon and a Trainer reward!\nUse **/changetrainer** to equip a different trainer.`
      );

      const pokemonEmbed = createPokemonRewardEmbed(pokemonPick, shiny, pokemonSprite);
      const trainerEmbed = createTrainerRewardEmbed(trainerPick, trainerSprite);

      // 🪩 Send embeds
      await interaction.editReply({
        embeds: [successEmbed, pokemonEmbed, trainerEmbed],
        components: []
      });

      // 🌍 Global reward broadcasts
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

      console.log(`✅ Daily completed for ${interaction.user.username}`);
    } catch (err) {
      console.error("❌ /daily error stack:", err);
      return safeReply(interaction, {
        content: `❌ Error executing /daily: ${err.message}`,
        ephemeral: true
      });
    }
  }
};
