// ==========================================================
// 🗺️ /quest — simulate completing a quest for a reward
// ==========================================================
import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import fs from "fs/promises";
import { spritePaths } from "../spriteconfig.js";
import { rollForShiny } from "../helpers/shinyOdds.js";
const pokemonData = JSON.parse(await fs.readFile(new URL("../pokemonData.json", import.meta.url)));

export default {
  data: new SlashCommandBuilder()
    .setName("quest")
    .setDescription("Complete a quest and receive a Pokémon or trainer reward!"),

  async execute(interaction, trainerData, saveTrainerData) {
    await interaction.deferReply({ flags: 64 });
    const id = interaction.user.id;
    trainerData[id] ??= { tp: 0, cc: 0, pokemon: {}, trainers: {} };
    const user = trainerData[id];

    // 70% chance Pokémon, 30% trainer
    const rewardType = Math.random() < 0.7 ? "pokemon" : "trainer";

    if (rewardType === "pokemon") {
      const pool = Object.values(pokemonData).filter(p => p.generation <= 5);
      const pick = pool[Math.floor(Math.random() * pool.length)];
      const shiny = rollForShiny(user.tp);
      const record = user.pokemon[pick.id] ?? { normal: 0, shiny: 0 };
      shiny ? record.shiny++ : record.normal++;
      user.pokemon[pick.id] = record;
      await saveTrainerData();

      const embed = new EmbedBuilder()
        .setColor(shiny ? 0xffd700 : 0x00ae86)
        .setTitle("🏆 Quest Complete!")
        .setDescription(shiny
          ? `✨ You earned a **Shiny ${pick.name}!**`
          : `You earned a **${pick.name}!**`)
        .setThumbnail(`${shiny ? spritePaths.shiny : spritePaths.pokemon}${pick.id}.${shiny ? "gif" : "png"}`)
        .setFooter({ text: "Complete more quests for rarer rewards!" });
      await interaction.editReply({ embeds: [embed] });
    } else {
      const sprites = ["youngster-gen4.png", "lass-gen4.png"];
      const file = sprites[Math.floor(Math.random() * sprites.length)];
      user.trainers[file] = (user.trainers[file] || 0) + 1;
      await saveTrainerData();

      const embed = new EmbedBuilder()
        .setColor(0x00ae86)
        .setTitle("🏆 Quest Complete!")
        .setDescription(`You unlocked new trainer sprite: **${file}**`)
        .setThumbnail(`${spritePaths.trainers}${file}`)
        .setFooter({ text: "Equip it with /trainercard!" });
      await interaction.editReply({ embeds: [embed] });
    }
  }
};
