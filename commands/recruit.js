// ==========================================================
// 🎯 /recruit – manual random Pokémon/trainer recruitment
// Coop's Collection Discord Bot (Refactored for safeReply + atomic saves + Pokemon Cache)
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
import { getPokemonCached } from "../utils/pokemonCache.js";
import { getFlattenedTrainers } from "../utils/dataLoader.js";
import { selectRandomPokemon, selectRandomTrainer } from "../utils/weightedRandom.js";
import { safeReply } from "../utils/safeReply.js";
import { getTrainerKey } from "../utils/trainerFileHandler.js";
import { atomicSave } from "../utils/saveManager.js";

// ==========================================================
// ⏱️ Constants
// ==========================================================
const RECRUIT_COOLDOWN_MS = 1000 * 30;  // 30 second cooldown
const RECRUIT_COST_CC = 100;

// ==========================================================
// 🧩 Command Definition
// ==========================================================
export default {
  data: new SlashCommandBuilder()
    .setName("recruit")
    .setDescription("Recruit a Pokémon or Trainer! (Costs 100 CC)"),

  async execute(interaction, trainerData, saveTrainerDataLocal, saveDataToDiscord, reloadUserFromDiscord, ensureUserInitialized) {
    // ✅ Defer reply immediately
    await interaction.deferReply({ flags: 64 });

    const id = interaction.user.id;
    const user = await ensureUserInitialized(id, interaction.user.username, trainerData, reloadUserFromDiscord);

    // ==========================================================
    // ⏱️ Check cooldown
    // ==========================================================
    const lastRecruit = user.lastRecruit || 0;
    const timeSinceLastRecruit = Date.now() - lastRecruit;
    
    if (timeSinceLastRecruit < RECRUIT_COOLDOWN_MS) {
      const secondsRemaining = Math.ceil((RECRUIT_COOLDOWN_MS - timeSinceLastRecruit) / 1000);
      return safeReply(interaction, {
        content: `⏱️ Wait ${secondsRemaining}s before recruiting again.`,
        ephemeral: true
      });
    }

    // ==========================================================
    // 💰 CC Check
    // ==========================================================
    if (user.cc < RECRUIT_COST_CC) {
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
        { label: "Trainer", value: "trainer", emoji: "🎭" }
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
    // 🕐 Collector setup
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

        // ✅ Check CC again right before the roll (atomic check)
        if (user.cc < RECRUIT_COST_CC) {
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
          content: "⏱️ Recruitment timed out – try again later.",
          ephemeral: true
        });
      }
    });
  }
};

// ==========================================================
// 🐾 Pokémon Recruitment - Atomic save + Pokemon Cache
// ==========================================================
async function recruitPokemon(i, user, trainerData, saveTrainerDataLocal, saveDataToDiscord) {
  // ✅ Atomic check + deduct
  if (user.cc < RECRUIT_COST_CC) {
    return safeReply(i, {
      content: "❌ You need **100 CC** to recruit! Earn more using `/daily`.",
      ephemeral: true
    });
  }

  const allPokemon = await getPokemonCached();
  const pool = allPokemon.filter((p) => p.generation <= 5);
  const pick = selectRandomPokemon(pool);

  const shiny = rollForShiny(user.tp || 0);
  const record = user.pokemon[pick.id] ?? { normal: 0, shiny: 0 };
  shiny ? record.shiny++ : record.normal++;
  user.pokemon[pick.id] = record;

  // ✅ Deduct AFTER successful selection
  user.cc -= RECRUIT_COST_CC;
  user.lastRecruit = Date.now();

  // ✅ Atomic save - both must succeed or rollback
  try {
    await atomicSave(trainerData, saveTrainerDataLocal, saveDataToDiscord);
  } catch (err) {
    // Rollback on failure
    user.cc += RECRUIT_COST_CC;
    console.error("❌ Recruitment save failed:", err);
    return safeReply(i, {
      content: "❌ Failed to complete recruitment. Please try again.",
      ephemeral: true
    });
  }

  // ✅ Only show success after both saves succeed
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
// 🎭 Trainer Recruitment - Atomic save
// ==========================================================
async function recruitTrainer(i, user, trainerData, saveTrainerDataLocal, saveDataToDiscord) {
  // ✅ Atomic check + deduct
  if (user.cc < RECRUIT_COST_CC) {
    return safeReply(i, {
      content: "❌ You need **100 CC** to recruit! Earn more using `/daily`.",
      ephemeral: true
    });
  }

  const flatTrainers = await getFlattenedTrainers();
  const pick = selectRandomTrainer(flatTrainers);
  const file = getTrainerKey(pick);  // ✅ Use standardized key handler

  user.trainers[file] = (user.trainers[file] || 0) + 1;

  // ✅ Deduct AFTER successful selection
  user.cc -= RECRUIT_COST_CC;
  user.lastRecruit = Date.now();

  // ✅ Atomic save
  try {
    await atomicSave(trainerData, saveTrainerDataLocal, saveDataToDiscord);
  } catch (err) {
    // Rollback on failure
    user.cc += RECRUIT_COST_CC;
    console.error("❌ Recruitment save failed:", err);
    return safeReply(i, {
      content: "❌ Failed to complete recruitment. Please try again.",
      ephemeral: true
    });
  }

  // ✅ Only show success after save succeeds
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("🎭 Trainer Recruited!")
    .setDescription(`You recruited **${pick.name}**!`)
    .setThumbnail(`${spritePaths.trainers}${file}`)
    .setFooter({ text: `-100 CC | Balance: ${user.cc} CC` });

  await safeReply(i, { embeds: [embed], ephemeral: true });
}