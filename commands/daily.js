// ==========================================================
// 🕐 /daily – claim daily TP, CC, and one random reward
// Coop's Collection Discord Bot (SafeReply Refactor + Pokemon Cache)
// ==========================================================
import { SlashCommandBuilder, ActionRowBuilder, ComponentType } from "discord.js";
import { spritePaths } from "../spriteconfig.js";
import { rollForShiny } from "../shinyOdds.js";
import { ensureUserData } from "../utils/trainerDataHelper.js";
import { validateCooldown } from "../utils/validators.js";
import { getPokemonCached } from "../utils/pokemonCache.js";
import { getFlattenedTrainers } from "../utils/dataLoader.js";
import { selectRandomPokemon, selectRandomTrainer } from "../utils/weightedRandom.js";
import {
  createSuccessEmbed,
  createPokemonRewardEmbed,
  createTrainerRewardEmbed,
  createChoiceMenu,
} from "../utils/embedBuilders.js";
import { safeReply } from "../utils/safeReply.js";
import { createSafeCollector } from "../utils/safeCollector.js";
import { atomicSave } from "../utils/saveManager.js";

// ==========================================================
// ⚖️ Constants
// ==========================================================
const DAILY_COOLDOWN_MS = 1000 * 60 * 60 * 24;
const DAILY_TP_REWARD = 50;
const DAILY_CC_REWARD = 25;

// ==========================================================
// 🧩 Command definition (SafeReply Refactor + Pokemon Cache)
// ==========================================================
export default {
  data: new SlashCommandBuilder()
    .setName("daily")
    .setDescription("Claim your daily TP, CC, and choose a random reward!"),

  async execute(interaction, trainerData, saveTrainerDataLocal, saveDataToDiscord) {
    const id = interaction.user.id;

    // Initialize schema
    const user = ensureUserData(trainerData, id, interaction.user.username);

    // 🕐 Cooldown check
    const cooldownCheck = validateCooldown(user.lastDaily, DAILY_COOLDOWN_MS);
    if (!cooldownCheck.valid) {
      return safeReply(interaction, {
        content: cooldownCheck.error,
        ephemeral: true,
      });
    }

    // 💰 Grant TP + CC
    user.tp += DAILY_TP_REWARD;
    user.cc += DAILY_CC_REWARD;
    user.lastDaily = Date.now();
    
    try {
      await atomicSave(trainerData, saveTrainerDataLocal, saveDataToDiscord);
    } catch (err) {
      console.error("❌ Failed to save daily rewards:", err);
      return safeReply(interaction, {
        content: "❌ Failed to save rewards. Please try again.",
        ephemeral: true,
      });
    }

    // 🎁 Prompt for bonus
    const menu = createChoiceMenu("daily_type", "Choose your bonus!", [
      { label: "Pokémon", value: "pokemon", emoji: "🐾" },
      { label: "Trainer", value: "trainer", emoji: "🎭" },
    ]);

    const embed = createSuccessEmbed(
      "🎁 Daily Claimed!",
      `You earned **${DAILY_TP_REWARD} TP** and **${DAILY_CC_REWARD} CC**.\nChoose your bonus:`
    );

    await safeReply(interaction, {
      embeds: [embed],
      components: [new ActionRowBuilder().addComponents(menu)],
      ephemeral: true,
    });

    const collector = createSafeCollector(
      interaction,
      {
        filter: i => i.user.id === id,
        componentType: ComponentType.StringSelect,
        time: 120000
      },
      "daily"
    );

    let processed = false;

    collector.on("collect", async (i) => {
      if (processed) return;
      processed = true;
      collector.stop();
      if (i.values[0] === "pokemon") {
        await giveRandomPokemon(i, user, trainerData, saveTrainerDataLocal, saveDataToDiscord);
      } else {
        await giveRandomTrainer(i, user, trainerData, saveTrainerDataLocal, saveDataToDiscord);
      }
    });

    collector.on("end", async (_, reason) => {
      if (reason === "time") {
        await safeReply(interaction, {
          content: "❌ Time's up – try again later!",
          embeds: [],
          components: [],
          ephemeral: true,
        }).catch(() => {});
      }
    });
  },
};

// ==========================================================
// 🐾 Pokémon reward - SafeReply integrated + Pokemon Cache
// ==========================================================
async function giveRandomPokemon(i, user, trainerData, saveTrainerDataLocal, saveDataToDiscord) {
  const allPokemon = await getPokemonCached();
  const pool = allPokemon.filter((p) => p.generation <= 5);
  const pick = selectRandomPokemon(pool);
  const shiny = rollForShiny(user.tp || 0);

  const record = user.pokemon[pick.id] ?? { normal: 0, shiny: 0 };
  shiny ? record.shiny++ : record.normal++;
  user.pokemon[pick.id] = record;

  try {
    await atomicSave(trainerData, saveTrainerDataLocal, saveDataToDiscord);
  } catch (err) {
    console.error("❌ Failed to save pokemon reward:", err);
    return safeReply(i, {
      content: "❌ Failed to save reward. Please try again.",
      ephemeral: true,
    });
  }

  const spriteUrl = `${shiny ? spritePaths.shiny : spritePaths.pokemon}${pick.id}.gif`;
  const embed = createPokemonRewardEmbed(pick, shiny, spriteUrl);

  await i.update({ embeds: [embed], components: [] });
}

// ==========================================================
// 🎭 Trainer reward - SafeReply integrated
// ==========================================================
async function giveRandomTrainer(i, user, trainerData, saveTrainerDataLocal, saveDataToDiscord) {
  const flatTrainers = await getFlattenedTrainers();
  const pick = selectRandomTrainer(flatTrainers);
  user.trainers[pick.filename] = (user.trainers[pick.filename] || 0) + 1;

  try {
    await atomicSave(trainerData, saveTrainerDataLocal, saveDataToDiscord);
  } catch (err) {
    console.error("❌ Failed to save trainer reward:", err);
    return safeReply(i, {
      content: "❌ Failed to save reward. Please try again.",
      ephemeral: true,
    });
  }

  const spriteUrl = `${spritePaths.trainers}${pick.filename}`;
  const embed = createTrainerRewardEmbed(pick, spriteUrl);

  await i.update({ embeds: [embed], components: [] });
}