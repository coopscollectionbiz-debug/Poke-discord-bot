// ==========================================================
// 🗺️ /quest – complete a quest for a random reward (SafeReply + CC reward + atomic save)
// Coop's Collection Discord Bot
// ==========================================================

import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { spritePaths } from "../spriteconfig.js";
import { rollForShiny } from "../shinyOdds.js";
import { ensureUserData } from "../utils/trainerDataHelper.js";
import { getAllPokemon, getFlattenedTrainers } from "../utils/dataLoader.js";
import { safeReply } from "../utils/safeReply.js";
import { getTrainerKey } from "../utils/trainerFileHandler.js";
import { atomicSave } from "../utils/saveManager.js";

// ==========================================================
// ⏱️ Constants
// ==========================================================
const QUEST_COOLDOWN_MS = 1000 * 60;  // 1 minute cooldown
const QUEST_CC_REWARD = 50;

// ==========================================================
// 🧩 Command Definition
// ==========================================================
export default {
  data: new SlashCommandBuilder()
    .setName("quest")
    .setDescription("Complete a quest and receive a random reward! (70% Pokémon, 30% Trainer, +50 CC)"),

  async execute(interaction, trainerData, saveTrainerDataLocal, saveDataToDiscord) {
    await safeReply(interaction, {
      content: "🧭 Embarking on a quest... Rewards include Pokémon or Trainers! (70% Pokémon, 30% Trainer)",
      ephemeral: true
    });

    const id = interaction.user.id;
    const user = ensureUserData(trainerData, id, interaction.user.username);

    // ==========================================================
    // ⏱️ Check cooldown
    // ==========================================================
    const lastQuest = user.lastQuest || 0;
    const timeSinceLastQuest = Date.now() - lastQuest;
    
    if (timeSinceLastQuest < QUEST_COOLDOWN_MS) {
      const secondsRemaining = Math.ceil((QUEST_COOLDOWN_MS - timeSinceLastQuest) / 1000);
      return safeReply(interaction, {
        content: `⏱️ Wait ${secondsRemaining}s before starting another quest.`,
        ephemeral: true
      });
    }

    // ✅ Update cooldown BEFORE quest (prevents spam)
    user.lastQuest = Date.now();

    // ==========================================================
    // 🎲 Reward Type
    // ==========================================================
    const rewardType = Math.random() < 0.7 ? "pokemon" : "trainer";

    // ==========================================================
    // 🐾 Pokémon Reward
    // ==========================================================
    if (rewardType === "pokemon") {
      const allPokemon = await getAllPokemon();
      const pool = allPokemon.filter((p) => p.generation <= 5);
      const pick = pool[Math.floor(Math.random() * pool.length)];

      const shiny = rollForShiny(user.tp || 0);
      const record = user.pokemon[pick.id] ?? { normal: 0, shiny: 0 };
      shiny ? record.shiny++ : record.normal++;
      user.pokemon[pick.id] = record;

      // 💰 Reward CC
      user.cc = (user.cc || 0) + QUEST_CC_REWARD;

      // ✅ Atomic save
      try {
        await atomicSave(trainerData, saveTrainerDataLocal, saveDataToDiscord);
      } catch (err) {
        console.error("❌ Quest save failed:", err);
        return safeReply(interaction, {
          content: "❌ Failed to save quest reward. Please try again.",
          ephemeral: true,
        });
      }

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
        .setFooter({ text: `+${QUEST_CC_REWARD} CC | Balance: ${user.cc} CC` });

      await safeReply(interaction, { embeds: [embed], ephemeral: true });
    }

    // ==========================================================
    // 🧑 Trainer Reward
    // ==========================================================
    else {
      const flatTrainers = await getFlattenedTrainers();
      const pick = flatTrainers[Math.floor(Math.random() * flatTrainers.length)];
      const file = getTrainerKey(pick);  // ✅ Use standardized key handler

      user.trainers[file] = (user.trainers[file] || 0) + 1;
      user.cc = (user.cc || 0) + QUEST_CC_REWARD;

      // ✅ Atomic save
      try {
        await atomicSave(trainerData, saveTrainerDataLocal, saveDataToDiscord);
      } catch (err) {
        console.error("❌ Quest save failed:", err);
        return safeReply(interaction, {
          content: "❌ Failed to save quest reward. Please try again.",
          ephemeral: true,
        });
      }

      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle("🏆 Quest Complete!")
        .setDescription(`You recruited **${pick.name}**!`)
        .setThumbnail(`${spritePaths.trainers}${file}`)
        .setFooter({ text: `+${QUEST_CC_REWARD} CC | Balance: ${user.cc} CC` });

      await safeReply(interaction, { embeds: [embed], ephemeral: true });
    }
  }
};
