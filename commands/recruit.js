// ==========================================================
// 🎯 /recruit — manual random Pokémon/trainer recruitment
// Coop's Collection Discord Bot (Refactored for safeReply)
// ==========================================================
import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle
} from "discord.js";
import { spritePaths } from "../spriteconfig.js";
import { rollForShiny } from "../shinyOdds.js";
import { ensureUserData } from "../utils/trainerDataHelper.js";
import { getAllPokemon, getFlattenedTrainers } from "../utils/dataLoader.js";
import { selectRandomPokemon, selectRandomTrainer } from "../utils/weightedRandom.js";
import { safeReply } from "../utils/safeReply.js";

// ==========================================================
// 🧩 Command Definition
// ==========================================================
export default {
  data: new SlashCommandBuilder()
    .setName("recruit")
    .setDescription("Recruit a Pokémon or Trainer! (Costs 100 CC)"),

  async execute(interaction, trainerData, saveTrainerDataLocal, saveDataToDiscord) {
    await safeReply(interaction, {
      content: "⏳ Preparing recruitment menu...",
      ephemeral: true
    });

    const id = interaction.user.id;
    const user = ensureUserData(trainerData, id, interaction.user.username);

    // ==========================================================
    // 💰 CC Check
    // ==========================================================
    if (user.cc < 100) {
      return safeReply(interaction, {
        content: "❌ You need **100 CC** to recruit! Earn more using `/daily`.",
        ephemeral: true
      });
    }

    // ==========================================================
    // 🎮 Recruitment Menu UI
    // ==========================================================
    const menu = new StringSelectMenuBuilder()
      .setCustomId("recruit_type")
      .setPlaceholder("Choose what to recruit (100 CC cost)")
      .addOptions(
        { label: "Pokémon", value: "pokemon", emoji: "🐾" },
        { label: "Trainer", value: "trainer", emoji: "🎓" }
      );

    const cancel = new ButtonBuilder()
      .setCustomId("cancel_recruit")
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Secondary);

    await safeReply(interaction, {
      embeds: [
        new EmbedBuilder()
          .setColor(0x00ae86)
          .setTitle("🎯 Recruitment Time!")
          .setDescription(
            `Each recruitment costs **100 CC**.\n\nSelect what type of recruit you want to attempt:`
          )
      ],
      components: [
        new ActionRowBuilder().addComponents(menu),
        new ActionRowBuilder().addComponents(cancel)
      ],
      ephemeral: true
    });

    // ==========================================================
    // 🕒 Collector setup
    // ==========================================================
    const collector = interaction.channel.createMessageComponentCollector({
      filter: (i) => i.user.id === id,
      time: 120000
    });

    collector.on("collect", async (i) => {
      if (i.customId === "cancel_recruit") {
        collector.stop();
        return safeReply(i, {
          content: "❌ Recruitment cancelled.",
          ephemeral: true
        });
      }

      if (i.customId === "recruit_type") {
        const choice = i.values[0];
        collector.stop();

        // Check CC again right before the roll
        if (user.cc < 100) {
          return safeReply(i, {
            content: "❌ You need **100 CC** to recruit! Earn more using `/daily`.",
            ephemeral: true
          });
        }

        if (choice === "pokemon") {
          await recruitPokemon(i, user, trainerData, saveTrainerDataLocal, saveDataToDiscord);
        } else {
          await recruitTrainer(i, user, trainerData, saveTrainerDataLocal, saveDataToDiscord);
        }
      }
    });

    collector.on("end", async (_, reason) => {
      if (reason === "time") {
        await safeReply(interaction, {
          content: "⌛ Recruitment timed out — try again later.",
          ephemeral: true
        });
      }
    });
  }
};

// ==========================================================
// 🐾 Pokémon Recruitment - Refactored to use helpers + safeReply
// ==========================================================
async function recruitPokemon(i, user, trainerData, saveTrainerDataLocal, saveDataToDiscord) {
  const allPokemon = await getAllPokemon();
  const pool = allPokemon.filter((p) => p.generation <= 5);
  const pick = selectRandomPokemon(pool);

  const shiny = rollForShiny(user.tp);
  const record = user.pokemon[pick.id] ?? { normal: 0, shiny: 0 };
  shiny ? record.shiny++ : record.normal++;
  user.pokemon[pick.id] = record;

  // Deduct 100 CC only after success
  user.cc = Math.max(0, user.cc - 100);
  await saveTrainerDataLocal(trainerData);
  await saveDataToDiscord(trainerData);

  const spriteUrl = shiny
    ? `${spritePaths.shiny}${pick.id}.gif`
    : `${spritePaths.pokemon}${pick.id}.gif`;

  const embed = new EmbedBuilder()
    .setColor(shiny ? 0xffd700 : 0x00ae86)
    .setTitle("🎯 Pokémon Recruited!")
    .setDescription(
      shiny
        ? `✨ You recruited a **Shiny ${pick.name}!**`
        : `You recruited a **${pick.name}!**`
    )
    .setThumbnail(spriteUrl)
    .setFooter({ text: `-100 CC | Balance: ${user.cc} CC` });

  await safeReply(i, { embeds: [embed], ephemeral: true });
}

// ==========================================================
// 🎓 Trainer Recruitment - Refactored to use helpers + safeReply
// ==========================================================
async function recruitTrainer(i, user, trainerData, saveTrainerDataLocal, saveDataToDiscord) {
  const flatTrainers = await getFlattenedTrainers();
  const pick = selectRandomTrainer(flatTrainers);
  const file = pick.filename || pick.file;

  user.trainers[file] = (user.trainers[file] || 0) + 1;

  // Deduct 100 CC only after success
  user.cc = Math.max(0, user.cc - 100);
  await saveTrainerDataLocal(trainerData);
  await saveDataToDiscord(trainerData);

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("🎓 Trainer Recruited!")
    .setDescription(`You recruited **${pick.name}**!`)
    .setThumbnail(`${spritePaths.trainers}${file}`)
    .setFooter({ text: `-100 CC | Balance: ${user.cc} CC` });

  await safeReply(i, { embeds: [embed], ephemeral: true });
}
