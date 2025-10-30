// ==========================================================
// 🎯 /recruit — manual random Pokémon/trainer recruitment
// Coop's Collection Discord Bot
// ==========================================================
import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle
} from "discord.js";
import fs from "fs/promises";
import { spritePaths } from "../spriteconfig.js";
import { rollForShiny } from "../shinyOdds.js";

// ==========================================================
// 📦 Load Pokémon + Trainer data safely
// ==========================================================
const pokemonData = JSON.parse(
  await fs.readFile(new URL("../pokemonData.json", import.meta.url))
);
const trainerSprites = JSON.parse(
  await fs.readFile(new URL("../trainerSprites.json", import.meta.url))
);

// ✅ Convert datasets to iterable arrays
const allPokemon = Object.values(pokemonData);
const allTrainers = Object.values(trainerSprites);

// ==========================================================
// ⚖️ Rarity Weight Distributions
// ==========================================================
const POKEMON_RARITY_WEIGHTS = {
  common: 60,
  uncommon: 24,
  rare: 10,
  epic: 4,
  legendary: 1.5,
  mythic: 0.5
};

const TRAINER_RARITY_WEIGHTS = {
  common: 65,
  uncommon: 22,
  rare: 8,
  epic: 3,
  legendary: 1,
  mythic: 1
};

// ==========================================================
// 🧩 Command Definition
// ==========================================================
export default {
  data: new SlashCommandBuilder()
    .setName("recruit")
    .setDescription("Recruit a Pokémon or Trainer!"),

  async execute(interaction, trainerData, saveTrainerData) {
    await interaction.deferReply({ flags: 64 });
    const id = interaction.user.id;

    // ✅ Initialize user schema if missing
    trainerData[id] ??= { tp: 0, cc: 0, pokemon: {}, trainers: {} };
    const user = trainerData[id];

    // ==========================================================
    // 🎮 Recruitment menu UI
    // ==========================================================
    const menu = new StringSelectMenuBuilder()
      .setCustomId("recruit_type")
      .setPlaceholder("Choose what to recruit")
      .addOptions(
        { label: "Pokémon", value: "pokemon", emoji: "🐾" },
        { label: "Trainer", value: "trainer", emoji: "🎓" }
      );

    const cancel = new ButtonBuilder()
      .setCustomId("cancel_recruit")
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Secondary);

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x00ae86)
          .setTitle("🎯 Recruitment Time!")
          .setDescription("Select what type of recruit you want to attempt:")
      ],
      components: [
        new ActionRowBuilder().addComponents(menu),
        new ActionRowBuilder().addComponents(cancel)
      ]
    });

    // ==========================================================
    // 🕒 Collector setup
    // ==========================================================
    const collector = interaction.channel.createMessageComponentCollector({
      filter: i => i.user.id === id,
      time: 120000
    });

    collector.on("collect", async i => {
      if (i.customId === "cancel_recruit") {
        collector.stop();
        return i.update({
          content: "❌ Recruitment cancelled.",
          embeds: [],
          components: []
        });
      }

      if (i.customId === "recruit_type") {
        const choice = i.values[0];
        collector.stop();

        if (choice === "pokemon")
          await recruitPokemon(i, user, trainerData, saveTrainerData);
        else
          await recruitTrainer(i, user, trainerData, saveTrainerData);
      }
    });

    collector.on("end", async (_, reason) => {
      if (reason === "time") {
        await interaction.editReply({
          content: "⌛ Recruitment timed out — try again later.",
          embeds: [],
          components: []
        });
      }
    });
  }
};

// ==========================================================
// 🎲 Weighted random helper
// ==========================================================
function weightedRandomChoice(list, weights) {
  const bag = [];
  for (const item of list) {
    const rarity = item.rarity?.toLowerCase() || "common";
    const weight = weights[rarity] || 1;
    for (let n = 0; n < Math.round(weight); n++) bag.push(item);
  }
  return bag[Math.floor(Math.random() * bag.length)];
}

// ==========================================================
// 🐾 Pokémon Recruitment
// ==========================================================
async function recruitPokemon(i, user, trainerData, saveTrainerData) {
  const pool = allPokemon.filter(p => p.generation <= 5);
  const pick = weightedRandomChoice(pool, POKEMON_RARITY_WEIGHTS);

  const shiny = rollForShiny(user.tp);
  const record = user.pokemon[pick.id] ?? { normal: 0, shiny: 0 };
  shiny ? record.shiny++ : record.normal++;
  user.pokemon[pick.id] = record;

  await saveTrainerData(trainerData);

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
    .setFooter({ text: "Keep recruiting to expand your team!" });

  await i.update({ embeds: [embed], components: [] });
}

// ==========================================================
// 🎓 Trainer Recruitment
// ==========================================================
async function recruitTrainer(i, user, trainerData, saveTrainerData) {
  const pick = weightedRandomChoice(allTrainers, TRAINER_RARITY_WEIGHTS);
  const file = pick.filename || pick.file;

  user.trainers[file] = (user.trainers[file] || 0) + 1;
  await saveTrainerData(trainerData);

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("🎓 Trainer Recruited!")
    .setDescription(`You recruited **${pick.name}**!`)
    .setThumbnail(`${spritePaths.trainers}${file}`)
    .setFooter({ text: "Equip it with /trainercard!" });

  await i.update({ embeds: [embed], components: [] });
}
