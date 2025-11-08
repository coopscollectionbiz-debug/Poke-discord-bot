// ==========================================================
// 🕐 /daily – Global Reset (Midnight UTC) + Dual Reward (Pokémon + Trainer)
// + Epic+ Broadcast via utils/rareSightings.js
// ==========================================================

import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType
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
    .setDescription("Claim your daily TP, CC, and receive both a Pokémon and Trainer!"),
    
  async execute(interaction, trainerData, saveTrainerDataLocal, saveDataToDiscord, client) {
    try {
      await interaction.deferReply({ ephemeral: true });

      const id = interaction.user.id;
      const user = await ensureUserInitialized(id, interaction.user.username, trainerData, client);

      // ✅ Ensure essential fields exist to prevent "entries is not iterable"
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

      // ✅ Guard against missing or malformed datasets
      if (!Array.isArray(allPokemon) || allPokemon.length === 0) {
        console.error("❌ /daily: getPokemonCached() returned no data or invalid array");
        return safeReply(interaction, { content: "❌ Pokémon data missing. Please notify staff.", ephemeral: true });
      }
      if (!Array.isArray(flatTrainers) || flatTrainers.length === 0) {
        console.error("❌ /daily: getFlattenedTrainers() returned no data or invalid array");
        return safeReply(interaction, { content: "❌ Trainer data missing. Please notify staff.", ephemeral: true });
      }

      const pokemonPick = selectRandomPokemonForUser(allPokemon, user);
      const trainerPick = selectRandomTrainerForUser(flatTrainers, user);

      // ✅ Guard against undefined picks
      if (!pokemonPick || !trainerPick) {
        console.error("❌ /daily: selectRandom* returned undefined", { pokemonPick, trainerPick });
        return safeReply(interaction, { content: "❌ Daily reward generation failed. Try again later.", ephemeral: true });
      }

      const shiny = rollForShiny(user.tp || 0);

      // ✅ Update user data safely
      user.pokemon[pokemonPick.id] ??= { normal: 0, shiny: 0 };
      shiny ? user.pokemon[pokemonPick.id].shiny++ : user.pokemon[pokemonPick.id].normal++;
      user.trainers[trainerPick.filename] = (user.trainers[trainerPick.filename] || 0) + 1;

      // 💾 Save before prompt so rewards persist even if user doesn't interact
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
      let cleanTrainerFile = trainerPick.filename.replace(/^trainers?_2\//, "").replace(/\.png$/i, "");
const trainerSprite = `${spritePaths.trainers}${cleanTrainerFile}.png`;


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

  // ======================================================
// 🧍 Equip Prompt for New Trainer (Final Stable Fix)
// ======================================================
try {
  const promptMessage = await interaction.followUp({
    content: `🎉 You obtained **${trainerPick.name || trainerPick.filename}!**\nWould you like to equip them as your displayed Trainer?`,
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`equip_${trainerPick.filename}`)
          .setLabel("Equip Trainer")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId("skip_equip")
          .setLabel("Skip")
          .setStyle(ButtonStyle.Secondary)
      ),
    ],
    ephemeral: true,
  });

  const collector = promptMessage.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: 15000,
    filter: i => i.user.id === interaction.user.id,
  });

  collector.on("collect", async i => {
    try {
      await i.deferUpdate();

      if (i.customId === `equip_${trainerPick.filename}`) {
        user.displayedTrainer = trainerPick.filename;

        // use direct saves (safer than atomicSave here)
        await saveTrainerDataLocal(trainerData);
        await saveDataToDiscord(trainerData);

        await i.followUp({
          content: `✅ **${trainerPick.name || trainerPick.filename}** equipped as your displayed Trainer!`,
          ephemeral: true,
        });
      } else if (i.customId === "skip_equip") {
        await i.followUp({
          content: "⏭️ Trainer kept in your collection.",
          ephemeral: true,
        });
      }

      // stop collector so buttons disable
      collector.stop("responded");
    } catch (err) {
      console.error("❌ Equip trainer failed:", err.message);
      try {
        await i.followUp({
          content: "❌ Failed to equip trainer. Please try again.",
          ephemeral: true,
        });
      } catch (e) {
        console.warn("⚠️ Could not send failure message:", e.message);
      }
    }
  });

  collector.on("end", async (_, reason) => {
    if (reason !== "responded") {
      try {
        await promptMessage.edit({ components: [] });
      } catch {}
    }
  });
} catch (err) {
  console.warn("⚠️ Equip prompt failed:", err.message);
}

    } catch (err) {
      console.error("❌ /daily error stack:", err);
      return safeReply(interaction, {
        content: `❌ Error executing /daily: ${err.message}`,
        ephemeral: true,
      });
    }
  },
};
