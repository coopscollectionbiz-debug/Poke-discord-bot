// ==========================================================
// 🤖 Coop’s Collection Discord Bot — Trainer Card Command
// ==========================================================
// Canvas removed
// Cleaned, de-duplicated, shiny-correct, and supports /dashboard
// ==========================================================

import {
  SlashCommandBuilder,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  ComponentType
} from "discord.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { rollForShiny } from "../shinyOdds.js";
import { spritePaths, rarityEmojis } from "../spriteconfig.js";
import { getAllPokemon } from "../utils/dataLoader.js";
import { getRank } from "../utils/rankSystem.js";
import { ensureUserInitialized } from "../utils/userInitializer.js";

// Load trainer sprite data
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const trainerSpritesPath = path.join(__dirname, "../trainerSprites.json");
const trainerSprites = JSON.parse(fs.readFileSync(trainerSpritesPath, "utf-8"));

// ==========================================================
// SLASH COMMAND
// ==========================================================
export default {
  data: new SlashCommandBuilder()
    .setName("trainercard")
    .setDescription("View or create your Trainer Card!"),

  async execute(interaction, trainerData, saveTrainerDataLocal, saveDataToDiscord, client) {
    await interaction.deferReply({ ephemeral: true });

    const user = await ensureUserInitialized(
      interaction.user.id,
      interaction.user.username,
      trainerData,
      client
    );

    if (!user.onboardingComplete) {
      if (!user.onboardingStage || user.onboardingStage === "starter_selection") {
        return starterSelection(interaction, user, trainerData, saveDataToDiscord);
      }
      if (user.onboardingStage === "trainer_selection") {
        return trainerSelection(interaction, user, trainerData, saveDataToDiscord);
      }
    }

    return showTrainerCard(interaction, user);
  }
};

// ==========================================================
// 🌿 Starter Selection (unchanged, full logic preserved)
// ==========================================================
export async function starterSelection(interaction, user, trainerData, saveDataToDiscord) {
  try {
    const allPokemon = await getAllPokemon();
    const starGen = [
      { name: "Kanto", ids: [1, 4, 7] },
      { name: "Johto", ids: [152, 155, 158] },
      { name: "Hoenn", ids: [252, 255, 258] },
      { name: "Sinnoh", ids: [387, 390, 393] },
      { name: "Unova", ids: [495, 498, 501] }
    ];

    const allStarters = starGen
      .flatMap(g => g.ids.map(id => allPokemon.find(p => p.id === id)))
      .filter(Boolean);

    if (!allStarters.length) throw new Error("Starter data missing.");

    let index = 0;

    const buildStarterEmbed = () => {
      const p = allStarters[index];
      return new EmbedBuilder()
        .setTitle("🌟 Choose Your Starter")
        .setDescription(`**${p.name}** #${p.id}`)
        .setImage(`${spritePaths.pokemon}normal/${p.id}.gif`)
        .setColor(0x5865f2)
        .setFooter({ text: `Starter ${index + 1} / ${allStarters.length}` });
    };

    const buttons = () =>
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("prev_starter")
          .setEmoji("⬅️")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(index === 0),

        new ButtonBuilder()
          .setCustomId("select_starter")
          .setLabel(`Choose ${allStarters[index].name}`)
          .setStyle(ButtonStyle.Success),

        new ButtonBuilder()
          .setCustomId("next_starter")
          .setEmoji("➡️")
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(index === allStarters.length - 1)
      );

    await interaction.editReply({
      embeds: [buildStarterEmbed()],
      components: [buttons()]
    });

    const msg = await interaction.fetchReply();
    const collector = msg.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 120000,
      filter: i => i.user.id === interaction.user.id
    });

    collector.on("collect", async i => {
      if (i.customId === "select_starter") {
        const p = allStarters[index];

        const shiny = rollForShiny(user.tp || 0);
        user.pokemon[p.id] = { normal: shiny ? 0 : 1, shiny: shiny ? 1 : 0 };
        user.displayedPokemon = [p.id];
        user.onboardingStage = "trainer_selection";

        trainerData[interaction.user.id] = user;
        await saveDataToDiscord(trainerData);

        collector.stop("chosen");
        return trainerSelection(interaction, user, trainerData, saveDataToDiscord);
      }

      index += i.customId === "next_starter" ? 1 : -1;
      index = Math.max(0, Math.min(index, allStarters.length - 1));

      await i.update({
        embeds: [buildStarterEmbed()],
        components: [buttons()]
      });
    });
  } catch (err) {
    console.error("starterSelection error:", err);
    return interaction.editReply({ content: "❌ Starter selection failed." });
  }
}

// ==========================================================
// 🧍 Trainer Selection (unchanged, cleaned formatting)
// ==========================================================
export async function trainerSelection(interaction, user, trainerData, saveDataToDiscord) {
  const trainers = [
    { id: "youngster-gen4.png", label: "Youngster" },
    { id: "lass-gen4.png", label: "Lass" }
  ];
  let index = 0;

  const embedFor = t =>
    new EmbedBuilder()
      .setTitle("🧍 Choose Your Trainer")
      .setDescription(`Confirm **${t.label}** as your Trainer.`)
      .setImage(`${spritePaths.trainers}${t.id}`)
      .setColor(0x5865f2)
      .setFooter({ text: `Page ${index + 1} / ${trainers.length}` });

  const buttonsFor = () =>
    new ActionRowBuilder().addComponents(
      ...(index > 0
        ? [
            new ButtonBuilder()
              .setCustomId("prev_trainer")
              .setLabel("⬅️ Back")
              .setStyle(ButtonStyle.Secondary)
          ]
        : []),

      ...(index < trainers.length - 1
        ? [
            new ButtonBuilder()
              .setCustomId("next_trainer")
              .setLabel("Next ➡️")
              .setStyle(ButtonStyle.Secondary)
          ]
        : []),

      new ButtonBuilder()
        .setCustomId("confirm_trainer")
        .setLabel(`Confirm ${trainers[index].label}`)
        .setStyle(ButtonStyle.Success)
    );

  await interaction.editReply({
    embeds: [embedFor(trainers[index])],
    components: [buttonsFor()]
  });

  const msg = await interaction.fetchReply();
  const collector = msg.createMessageComponentCollector({
    componentType: ComponentType.Button,
    filter: i => i.user.id === interaction.user.id,
    time: 120000
  });

  collector.on("collect", async i => {
    if (i.customId === "confirm_trainer") {
      const t = trainers[index];
      user.trainers ??= {};
      user.trainers[t.id] = true;
      user.displayedTrainer = t.id;

      user.onboardingComplete = true;
      delete user.onboardingStage;

      trainerData[interaction.user.id] = user;
      await saveDataToDiscord(trainerData);

      collector.stop("chosen");
      return showTrainerCard(interaction, user);
    }

    index += i.customId === "next_trainer" ? 1 : -1;
    await i.update({
      embeds: [embedFor(trainers[index])],
      components: [buttonsFor()]
    });
  });
}

// ==========================================================
// 🧾 SHOW TRAINER CARD  — CLEAN VERSION
// ==========================================================
export async function showTrainerCard(interaction, user) {
  try {
    const username = interaction.user.username;
    const avatarURL = interaction.user.displayAvatarURL({ extension: "png", size: 128 });

    const allPokemon = await getAllPokemon();

    // --- Team Prep ---
    let displayed = Array.isArray(user.displayedPokemon) ? [...user.displayedPokemon] : [];
    displayed = displayed.slice(0, 6);

    if (displayed.length === 0) {
      const ownedIds = Object.keys(user.pokemon || {}).map(Number);
      displayed = ownedIds.slice(0, 6);
      user.displayedPokemon = displayed;
    }

    const leadId = displayed[0];
    const leadPokemon = allPokemon.find(p => p.id === leadId);

    let leadSprite = null;
    if (leadPokemon) {
      const shiny = user.pokemon?.[leadId]?.shiny > 0;
      leadSprite = shiny
  ? `${spritePaths.shiny}${leadId}.gif`
  : `${spritePaths.pokemon}${leadId}.gif`;

    }

    const pokemonInfo = displayed
      .map(id => allPokemon.find(p => p.id === id))
      .filter(Boolean);

    // --- Stats ---
    const rank = getRank(user.tp);
    const pokemonOwned = Object.keys(user.pokemon || {}).length;
    const shinyCount = Object.values(user.pokemon || {}).filter(p => p.shiny > 0).length;
    const trainerCount = Object.keys(user.trainers || {}).length;

    // ==========================================================
    // 🧩 Build 3×2 Pokémon Grid
    // ==========================================================
    const teamFields = [];
    const chunk = (arr, size) =>
      arr.length ? [arr.slice(0, size), ...chunk(arr.slice(size), size)] : [];

    const teamRows = chunk(pokemonInfo, 3);

    for (const row of teamRows) {
      const text = row
        .map(p => {
          const shiny = user.pokemon[p.id]?.shiny > 0;
          const shinyMark = shiny ? "✨ " : "";
          const tier = (p.tier || p.rarity || "common").toLowerCase();
          const emoji = rarityEmojis[tier] || "⚬";
          return `${shinyMark}**${p.name}** ${emoji}`;
        })
        .join(" | ");

      teamFields.push({ name: " ", value: text, inline: false });
    }

    const commandHelp =
  "\n\n> 🪶 **Commands:**\n" +
  "> `/dashboard` – Manage Pokémon & Trainers\n";

// Custom currency emojis
const TP_EMOJI = "<:tp_icon:1437892250922123364>";
const CC_EMOJI = "<:coopcoin:1437892112959148093>";

// ==========================================================
// 🎨 Trainer rarity → dashboard color mapping
// ==========================================================
const rarityColors = {
  common:    0x9ca3af,
  uncommon:  0x10b981,
  rare:      0x3b82f6,
  epic:      0xa855f7,
  legendary: 0xfacc15,
  mythic:    0xef4444
};

// ➤ Trainer sprite + lead Pokémon image
const trainerPath = user.displayedTrainer
  ? `${spritePaths.trainers}${user.displayedTrainer}`
  : null;

// Trainer info (name, rarity, emoji)
const trainerInfo = (() => {
  if (!user.displayedTrainer) {
    return {
      name: "Unknown",
      rarityKey: "common",
      rarityLabel: "Common",
      emoji: rarityEmojis.common
    };
  }

  const file = path.basename(user.displayedTrainer).toLowerCase(); // may-contest.png
  const key = file.replace(/\.(png|gif)$/i, "");                   // may-contest

  // Primary lookup (exact match)
  let entry = trainerSprites[key];

  // Safe fallback: strip generation suffix ONLY
  if (!entry) {
    const noGen = key.replace(/-gen\d+[a-z]*$/i, "");
    entry = trainerSprites[noGen];
  }

  const rarityKey = String(entry?.tier || entry?.rarity || "common").toLowerCase();
  const rarityLabel = rarityKey.charAt(0).toUpperCase() + rarityKey.slice(1);

  const displayName =
    entry?.name ||
    key
      .replace(/-gen\d+[a-z]*$/i, "")
      .replace(/[-_]+/g, " ")
      .replace(/\b\w/g, c => c.toUpperCase());

  return {
    name: displayName,
    rarityKey,
    rarityLabel,
    emoji: rarityEmojis[rarityKey] || "⚬"
  };
})();

// ==========================================================
// 📘 Build Trainer Card Embed
// ==========================================================
const embed = new EmbedBuilder()
  .setAuthor({ name: `${username}'s Trainer Card`, iconURL: avatarURL })
  .setColor(rarityColors[trainerInfo.rarityKey] || 0x5865f2)
  .setDescription(
    `🏆 **Rank:** ${rank}\n` +
    `${TP_EMOJI} **${user.tp}** | ${CC_EMOJI} **${user.cc || 0}**\n\n` +

    `🧍 **Trainer:** ${trainerInfo.name} — ${trainerInfo.rarityLabel} ${trainerInfo.emoji}\n\n`

    `📊 **Pokémon Owned:** ${pokemonOwned}\n` +
    `✨ **Shiny Pokémon:** ${shinyCount}\n` +
    `🧍 **Trainers:** ${trainerCount}\n\n` +

    `🌀 **Team:**`
  )
  .setFooter({ text: "Coop's Collection • /trainercard" });

// ➤ Add 2×3 Pokémon Team Grid
teamFields.forEach(f => embed.addFields(f));

// ➤ Add /dashboard Command
embed.addFields({
  name: " ",
  value: "🪶 **Commands:**\n`/dashboard`",
  inline: false
});

if (trainerPath) embed.setThumbnail(trainerPath);
if (leadSprite) embed.setImage(leadSprite);

await interaction.editReply({
  embeds: [embed],
  components: []
});

} catch (err) {
  console.error("trainerCard error:", err);
  return interaction.editReply({ content: "❌ Failed to show Trainer Card." });
}
}
