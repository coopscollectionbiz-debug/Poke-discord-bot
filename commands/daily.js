// ==========================================================
// 🕒 /daily — claim daily TP, CC, and one random reward
// ==========================================================
import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder
} from "discord.js";
import fs from "fs/promises";
import { spritePaths } from "../spriteconfig.js";
import { rollForShiny } from "../helpers/shinyOdds.js";
const pokemonData = JSON.parse(await fs.readFile(new URL("../pokemonData.json", import.meta.url)));
const trainerSprites = JSON.parse(await fs.readFile(new URL("../trainerSprites.json", import.meta.url)));

// rarity weighting tables
const POKEMON_RARITY_WEIGHTS = { common: 60, uncommon: 24, rare: 10, epic: 4, legendary: 1.5, mythic: 0.5 };
const TRAINER_RARITY_WEIGHTS = { common: 65, uncommon: 22, rare: 8, epic: 3, legendary: 1, mythic: 1 };

// daily timing and base rewards
const DAILY_COOLDOWN_MS = 1000 * 60 * 60 * 24;
const DAILY_TP_REWARD = 50;
const DAILY_CC_REWARD = 25;

export default {
  data: new SlashCommandBuilder()
    .setName("daily")
    .setDescription("Claim your daily TP, CC, and choose a random reward!"),

  async execute(interaction, trainerData, saveTrainerData) {
    const id = interaction.user.id;
    // ensure user schema is initialized
    trainerData[id] ??= { tp: 0, cc: 0, pokemon: {}, trainers: {}, lastDaily: 0 };
    const user = trainerData[id];

    // cooldown check
    const now = Date.now();
    if (now - (user.lastDaily || 0) < DAILY_COOLDOWN_MS) {
      const next = new Date(user.lastDaily + DAILY_COOLDOWN_MS);
      return interaction.reply({
        content: `⏰ Already claimed!\nNext reset: **${next.toLocaleString()}**`,
        flags: 64
      });
    }

    // grant TP & CC
    user.tp += DAILY_TP_REWARD;
    user.cc += DAILY_CC_REWARD;
    user.lastDaily = now;
    await saveTrainerData();

    // ask which reward type to claim
    const menu = new StringSelectMenuBuilder()
      .setCustomId("daily_type")
      .setPlaceholder("Choose your bonus!")
      .addOptions(
        { label: "Pokémon", value: "pokemon", emoji: "🐾" },
        { label: "Trainer", value: "trainer", emoji: "🎓" }
      );

    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x00ae86)
          .setTitle("🎁 Daily Claimed!")
          .setDescription(`You earned **${DAILY_TP_REWARD} TP** and **${DAILY_CC_REWARD} CC**.\nChoose your bonus:`)
      ],
      components: [new ActionRowBuilder().addComponents(menu)],
      flags: 64
    });

    const collector = interaction.channel.createMessageComponentCollector({
      filter: i => i.user.id === id,
      time: 120000
    });

    collector.on("collect", async i => {
      collector.stop();
      if (i.values[0] === "pokemon") await giveRandomPokemon(i, user, saveTrainerData);
      else await giveRandomTrainer(i, user, saveTrainerData);
    });

    collector.on("end", (_, reason) => {
      if (reason === "time")
        interaction.editReply({ content: "⌛ Time’s up — try again later!", components: [], embeds: [] });
    });
  }
};

// helper: weighted random choice
function weightedRandomChoice(list, weights) {
  const bag = [];
  for (const item of list) bag.push(...Array(Math.round(weights[item.rarity?.toLowerCase()] || 1)).fill(item));
  return bag[Math.floor(Math.random() * bag.length)];
}

// reward Pokémon (adds to count-based schema)
async function giveRandomPokemon(inter, user, saveTrainerData) {
  const pool = Object.values(pokemonData).filter(p => p.generation <= 5);
  const mon = weightedRandomChoice(pool, POKEMON_RARITY_WEIGHTS);
  const shiny = rollForShiny(user.tp);
  const record = user.pokemon[mon.id] ?? { normal: 0, shiny: 0 };
  shiny ? record.shiny++ : record.normal++;
  user.pokemon[mon.id] = record;
  await saveTrainerData();

  await inter.update({
    embeds: [
      new EmbedBuilder()
        .setColor(shiny ? 0xffd700 : 0x00ae86)
        .setTitle("🎁 Pokémon Reward!")
        .setDescription(shiny ? `✨ Shiny **${mon.name}** obtained!` : `You received **${mon.name}**!`)
        .setThumbnail(`${shiny ? spritePaths.shiny : spritePaths.pokemon}${mon.id}.${shiny ? "gif" : "png"}`)
    ],
    components: []
  });
}

// reward Trainer (adds to filename-based schema)
async function giveRandomTrainer(inter, user, saveTrainerData) {
  const pick = weightedRandomChoice(Object.values(trainerSprites), TRAINER_RARITY_WEIGHTS);
  user.trainers[pick.filename] = (user.trainers[pick.filename] || 0) + 1;
  await saveTrainerData();

  await inter.update({
    embeds: [
      new EmbedBuilder()
        .setColor(0x00ae86)
        .setTitle("🎁 Trainer Reward!")
        .setDescription(`You unlocked **${pick.name}**`)
        .setThumbnail(`${spritePaths.trainers}${pick.filename}`)
    ],
    components: []
  });
}
