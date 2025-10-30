// ==========================================================
// 🎯 /recruit — manual random Pokémon/trainer recruitment
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
import { rollForShiny } from "../helpers/shinyOdds.js";
const pokemonData = JSON.parse(await fs.readFile(new URL("../pokemonData.json", import.meta.url)));
const trainerSprites = JSON.parse(await fs.readFile(new URL("../trainerSprites.json", import.meta.url)));

const POKEMON_RARITY_WEIGHTS = { common: 60, uncommon: 24, rare: 10, epic: 4, legendary: 1.5, mythic: 0.5 };
const TRAINER_RARITY_WEIGHTS = { common: 65, uncommon: 22, rare: 8, epic: 3, legendary: 1, mythic: 1 };

export default {
  data: new SlashCommandBuilder()
    .setName("recruit")
    .setDescription("Recruit a Pokémon or Trainer!"),

  async execute(interaction, trainerData, saveTrainerData) {
    await interaction.deferReply({ flags: 64 });
    const id = interaction.user.id;
    trainerData[id] ??= { tp: 0, cc: 0, pokemon: {}, trainers: {} };
    const user = trainerData[id];

    const menu = new StringSelectMenuBuilder()
      .setCustomId("recruit_type")
      .setPlaceholder("Choose what to recruit")
      .addOptions(
        { label: "Pokémon", value: "pokemon", emoji: "🐾" },
        { label: "Trainer", value: "trainer", emoji: "🎓" }
      );
    const cancel = new ButtonBuilder().setCustomId("cancel_recruit").setLabel("Cancel").setStyle(ButtonStyle.Secondary);

    await interaction.editReply({
      embeds: [new EmbedBuilder().setColor(0x00ae86).setTitle("Recruitment Time!").setDescription("Pick your target:")],
      components: [
        new ActionRowBuilder().addComponents(menu),
        new ActionRowBuilder().addComponents(cancel)
      ]
    });

    const collector = interaction.channel.createMessageComponentCollector({ filter: i => i.user.id === id, time: 120000 });
    collector.on("collect", async i => {
      if (i.customId === "cancel_recruit") {
        collector.stop(); return i.update({ content: "❌ Cancelled.", embeds: [], components: [] });
      }
      if (i.customId === "recruit_type") {
        const choice = i.values[0];
        collector.stop();
        if (choice === "pokemon") await recruitPokemon(i, user, saveTrainerData);
        else await recruitTrainer(i, user, saveTrainerData);
      }
    });
  }
};

function weightedRandomChoice(list, weights) {
  const bag = [];
  for (const item of list) bag.push(...Array(Math.round(weights[item.rarity?.toLowerCase()] || 1)).fill(item));
  return bag[Math.floor(Math.random() * bag.length)];
}

async function recruitPokemon(i, user, saveTrainerData) {
  const pool = Object.values(pokemonData).filter(p => p.generation <= 5);
  const pick = weightedRandomChoice(pool, POKEMON_RARITY_WEIGHTS);
  const shiny = rollForShiny(user.tp);
  const record = user.pokemon[pick.id] ?? { normal: 0, shiny: 0 };
  shiny ? record.shiny++ : record.normal++;
  user.pokemon[pick.id] = record;
  await saveTrainerData();

  await i.update({
    embeds: [
      new EmbedBuilder()
        .setColor(shiny ? 0xffd700 : 0x00ae86)
        .setTitle("🎯 Pokémon Recruited!")
        .setDescription(shiny ? `✨ You recruited a **Shiny ${pick.name}!**` : `You recruited a **${pick.name}!**`)
        .setThumbnail(`${shiny ? spritePaths.shiny : spritePaths.pokemon}${pick.id}.${shiny ? "gif" : "png"}`)
    ],
    components: []
  });
}

async function recruitTrainer(i, user, saveTrainerData) {
  const pick = weightedRandomChoice(Object.values(trainerSprites), TRAINER_RARITY_WEIGHTS);
  user.trainers[pick.filename] = (user.trainers[pick.filename] || 0) + 1;
  await saveTrainerData();

  await i.update({
    embeds: [
      new EmbedBuilder()
        .setColor(0x00ae86)
        .setTitle("🎓 Trainer Recruited!")
        .setDescription(`You recruited **${pick.name}**`)
        .setThumbnail(`${spritePaths.trainers}${pick.filename}`)
    ],
    components: []
  });
}
