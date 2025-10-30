// ==========================================================
// 🗺️ /quest — complete a quest for a random reward
// Coop's Collection Discord Bot
// ==========================================================

import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import fs from "fs/promises";
import { spritePaths } from "../spriteconfig.js";
import { rollForShiny } from "../shinyOdds.js"; // ✅ fixed import path

// ==========================================================
// 📦 Load Pokémon data safely (Render compatible)
// ==========================================================
const pokemonData = JSON.parse(
  await fs.readFile(new URL("../pokemonData.json", import.meta.url))
);

// ✅ Convert to iterable array
const allPokemon = Object.values(pokemonData);

// ==========================================================
// 🧩 Command Definition
// ==========================================================
export default {
  data: new SlashCommandBuilder()
    .setName("quest")
    .setDescription("Complete a quest and receive a Pokémon or trainer reward!"),

  async execute(interaction, trainerData, saveTrainerData) {
    await interaction.deferReply({ flags: 64 });
    const id = interaction.user.id;

    // ✅ Ensure user schema exists
    trainerData[id] ??= {
      tp: 0,
      cc: 0,
      pokemon: {},
      trainers: {}
    };

    const user = trainerData[id];

    // ✅ 70% Pokémon reward, 30% Trainer reward
    const rewardType = Math.random() < 0.7 ? "pokemon" : "trainer";

    // ==========================================================
    // 🐾 Pokémon Reward
    // ==========================================================
    if (rewardType === "pokemon") {
      // 🎲 Random Pokémon from Gen 1–5
      const pool = allPokemon.filter(p => p.generation <= 5);
      const pick = pool[Math.floor(Math.random() * pool.length)];

      // ✨ Shiny roll
      const shiny = rollForShiny(user.tp);

      // ✅ Increment owned count
      const record = user.pokemon[pick.id] ?? { normal: 0, shiny: 0 };
      shiny ? record.shiny++ : record.normal++;
      user.pokemon[pick.id] = record;

      await saveTrainerData(trainerData);

      // ✅ Embed (unified sprite path)
      const spriteUrl = shiny
        ? `${spritePaths.shiny}${pick.id}.gif`
        : `${spritePaths.pokemon}${pick.id}.gif`;

      const embed = new EmbedBuilder()
        .setColor(shiny ? 0xffd700 : 0x00ae86)
        .setTitle("🏆 Quest Complete!")
        .setDescription(
          shiny
            ? `✨ You discovered a **Shiny ${pick.name}!**`
            : `You found a **${pick.name}!**`
        )
        .setThumbnail(spriteUrl)
        .setFooter({ text: "Complete more quests for rarer rewards!" });

      await interaction.editReply({ embeds: [embed] });
    }

    // ==========================================================
    // 🧍 Trainer Reward
    // ==========================================================
    else {
      const trainerPool = ["youngster-gen4.png", "lass-gen4.png"];
      const file = trainerPool[Math.floor(Math.random() * trainerPool.length)];

      user.trainers[file] = (user.trainers[file] || 0) + 1;
      await saveTrainerData(trainerData);

      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle("🏆 Quest Complete!")
        .setDescription(`You recruited a new trainer: **${file.replace(".png", "")}!**`)
        .setThumbnail(`${spritePaths.trainers}${file}`)
        .setFooter({ text: "Equip it anytime with /trainercard!" });

      await interaction.editReply({ embeds: [embed] });
    }
  }
};
