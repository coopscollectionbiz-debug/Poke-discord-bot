// ==========================================================
// 🕒 /daily — claim daily TP, CC, and one random reward
// Coop's Collection Discord Bot
// ==========================================================
import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder
} from "discord.js";
import { spritePaths } from "../spriteconfig.js";
import { rollForShiny } from "../shinyOdds.js";
import { ensureUserData } from "../utils/trainerDataHelper.js";
import { validateCooldown } from "../utils/validators.js";
import { getAllPokemon, getFlattenedTrainers } from "../utils/dataLoader.js";
import { selectRandomPokemon, selectRandomTrainer } from "../utils/weightedRandom.js";

// ==========================================================
// ⚖️ Constants
// ==========================================================
const DAILY_COOLDOWN_MS = 1000 * 60 * 60 * 24;
const DAILY_TP_REWARD = 50;
const DAILY_CC_REWARD = 25;

// ==========================================================
// 🧩 Command definition
// ==========================================================
export default {
  data: new SlashCommandBuilder()
    .setName("daily")
    .setDescription("Claim your daily TP, CC, and choose a random reward!"),

  async execute(interaction, trainerData, saveTrainerData) {
    const id = interaction.user.id;

    // Initialize schema using helper
    const user = ensureUserData(trainerData, id, interaction.user.username);

    // 🕒 Cooldown check using validator
    const cooldownCheck = validateCooldown(user.lastDaily, DAILY_COOLDOWN_MS);
    if (!cooldownCheck.valid) {
      return interaction.reply({
        content: cooldownCheck.error,
        ephemeral: true
      });
    }

    // 💰 Grant TP + CC
    user.tp += DAILY_TP_REWARD;
    user.cc += DAILY_CC_REWARD;
    user.lastDaily = Date.now();
    await saveTrainerData(trainerData);

    // 🎁 Prompt for bonus
    const menu = new StringSelectMenuBuilder()
      .setCustomId("daily_type")
      .setPlaceholder("Choose your bonus!")
      .addOptions(
        { label: "Pokémon", value: "pokemon", emoji: "🐾" },
        { label: "Trainer", value: "trainer", emoji: "🎓" }
      );

    const embed = new EmbedBuilder()
      .setColor(0x00ae86)
      .setTitle("🎁 Daily Claimed!")
      .setDescription(
        `You earned **${DAILY_TP_REWARD} TP** and **${DAILY_CC_REWARD} CC**.\nChoose your bonus:`
      );

    await interaction.reply({
      embeds: [embed],
      components: [new ActionRowBuilder().addComponents(menu)],
      ephemeral: true
    });

    // 🎮 Selection handler
    const collector = interaction.channel.createMessageComponentCollector({
      filter: i => i.user.id === id,
      time: 120000
    });

    collector.on("collect", async i => {
      collector.stop();
      if (i.values[0] === "pokemon") {
        await giveRandomPokemon(i, user, trainerData, saveTrainerData);
      } else {
        await giveRandomTrainer(i, user, trainerData, saveTrainerData);
      }
    });

    collector.on("end", async (_, reason) => {
      if (reason === "time") {
        await interaction.editReply({
          content: "⌛ Time's up — try again later!",
          embeds: [],
          components: []
        }).catch(() => {});
      }
    });
  }
};

// ==========================================================
// 🐾 Pokémon reward - Refactored to use helpers
// ==========================================================
async function giveRandomPokemon(i, user, trainerData, saveTrainerData) {
  const allPokemon = await getAllPokemon();
  const pool = allPokemon.filter(p => p.generation <= 5);
  const pick = selectRandomPokemon(pool);
  const shiny = rollForShiny(user.tp);

  const record = user.pokemon[pick.id] ?? { normal: 0, shiny: 0 };
  shiny ? record.shiny++ : record.normal++;
  user.pokemon[pick.id] = record;

  await saveTrainerData(trainerData);

  await i.update({
    embeds: [
      new EmbedBuilder()
        .setColor(shiny ? 0xffd700 : 0x00ae86)
        .setTitle("🎁 Pokémon Reward!")
        .setDescription(
          shiny
            ? `✨ You obtained a **Shiny ${pick.name}!**`
            : `You obtained a **${pick.name}!**`
        )
        .setThumbnail(
          `${shiny ? spritePaths.shiny : spritePaths.pokemon}${pick.id}.gif`
        )
    ],
    components: []
  });
}

// ==========================================================
// 🎓 Trainer reward - Refactored to use helpers
// ==========================================================
async function giveRandomTrainer(i, user, trainerData, saveTrainerData) {
  const flatTrainers = await getFlattenedTrainers();
  const pick = selectRandomTrainer(flatTrainers);
  user.trainers[pick.filename] = (user.trainers[pick.filename] || 0) + 1;

  await saveTrainerData(trainerData);

  await i.update({
    embeds: [
      new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle("🎁 Trainer Reward!")
        .setDescription(`You unlocked **${pick.name}**!`)
        .setThumbnail(`${spritePaths.trainers}${pick.filename}`)
    ],
    components: []
  });
}
