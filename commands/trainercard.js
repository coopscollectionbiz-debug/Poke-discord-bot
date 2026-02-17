// commands/trainercard.js

// ==========================================================
// 🤖 Coop’s Collection Discord Bot — Trainer Card Command
// ==========================================================
// Canvas removed
// Cleaned, de-duplicated, shiny-correct, and supports /dashboard
// ✅ PATCHED: supports new team format [{id, variant:"normal"|"shiny"}]
// ✅ PATCHED: lead sprite + team grid use TEAM VARIANT (not “do I own shiny?”)
// ✅ Backward compatible with legacy arrays like [1,2,3] and strings
// ✅ Uses CANONICAL FIELD: user.displayedPokemon (NOT user.currentTeam)
//    (currentTeam is only an API response alias of displayedPokemon)
// ==========================================================

import {
  SlashCommandBuilder,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  ComponentType,
  MessageFlags,
} from "discord.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { rollForShiny } from "../shinyOdds.js";
import { spritePaths, rarityEmojis } from "../spriteconfig.js";
import { getAllPokemon } from "../utils/dataLoader.js";
import { getRank } from "../utils/rankSystem.js";
import { ensureUserInitialized } from "../utils/userInitializer.js";
import { enqueueSave } from "../utils/saveQueue.js";

// Load trainer sprite data
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const trainerSpritesPath = path.join(__dirname, "../trainerSprites.json");
const trainerSprites = JSON.parse(fs.readFileSync(trainerSpritesPath, "utf-8"));

// Build fast lookup: sprite filename -> { key, tier }
const spriteToTrainer = (() => {
  const map = new Map();

  for (const [key, entry] of Object.entries(trainerSprites || {})) {
    const tier = String(entry?.tier || "common");
    if (!Array.isArray(entry?.sprites)) continue;

    for (const s of entry.sprites) {
      if (typeof s !== "string") continue;

      const filename = s.toLowerCase(); // "acerola-masters.png"
      const basename = filename.replace(/\.(png|gif)$/i, ""); // "acerola-masters"

      if (!map.has(filename)) map.set(filename, { key, tier });
      if (!map.has(basename)) map.set(basename, { key, tier });
    }
  }

  return map;
})();

// ==========================================================
// ✅ TEAM NORMALIZATION (BACKEND SAFE)
// ==========================================================
function normVariant(v) {
  const s = String(v ?? "normal").toLowerCase().trim();
  return s === "shiny" ? "shiny" : "normal";
}

function toTeamObj(entry) {
  if (typeof entry === "number") {
    return Number.isInteger(entry) ? { id: entry, variant: "normal" } : null;
  }

  if (typeof entry === "string") {
    const n = Number(entry);
    return Number.isInteger(n) ? { id: n, variant: "normal" } : null;
  }

  if (entry && typeof entry === "object") {
    const id = Number(entry.id);
    if (!Number.isInteger(id)) return null;

    // allow legacy shapes: {id, shiny:true} or {id, isShiny:true}
    const legacyIsShiny =
      entry.variant == null && (entry.shiny === true || entry.isShiny === true);

    return { id, variant: legacyIsShiny ? "shiny" : normVariant(entry.variant) };
  }

  return null;
}

function normalizeTeam(rawTeam, maxSize = 6) {
  const arr = Array.isArray(rawTeam) ? rawTeam : [];
  const mapped = arr.map(toTeamObj).filter(Boolean);

  // unique by (id+variant)
  const seen = new Set();
  const out = [];

  for (const slot of mapped) {
    const clean = { id: Number(slot.id), variant: normVariant(slot.variant) };
    const k = `${clean.id}:${clean.variant}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(clean);
    if (out.length >= maxSize) break;
  }

  return out;
}

function pickFallbackTeamFromOwned(user, maxSize = 6) {
  const ownedIds = Object.keys(user.pokemon || {})
    .map((x) => Number(x))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);

  const out = [];
  for (const id of ownedIds) {
    const entry = user.pokemon?.[id];
    const normal = Number(entry?.normal ?? 0);
    const shiny = Number(entry?.shiny ?? 0);

    // Prefer normal if you have it; otherwise use shiny.
    const variant = normal > 0 ? "normal" : shiny > 0 ? "shiny" : "normal";
    out.push({ id, variant });
    if (out.length >= maxSize) break;
  }
  return out;
}

function ensureTrailingSlash(s) {
  const str = String(s || "");
  return str.endsWith("/") ? str : `${str}/`;
}

// spritePaths.pokemon is expected to be ".../pokemon/"
// spritePaths.shiny is expected to be ".../pokemon/shiny/" OR ".../shiny/"
// We normalize safely to always build valid URLs.
function getPokemonSprite(id, variant) {
  const v = normVariant(variant);

  if (v === "shiny") {
    if (spritePaths?.shiny) {
      // if it already contains "/shiny/" assume it is the shiny folder base
      const base = ensureTrailingSlash(spritePaths.shiny);
      return `${base}${id}.gif`;
    }
    // fallback: assume pokemon base + "shiny/"
    return `${ensureTrailingSlash(spritePaths.pokemon)}shiny/${id}.gif`;
  }

  // normal
  // most configs: spritePaths.pokemon = ".../pokemon/" so add "normal/"
  return `${ensureTrailingSlash(spritePaths.pokemon)}normal/${id}.gif`;
}

// ==========================================================
// SLASH COMMAND
// ==========================================================
export default {
  data: new SlashCommandBuilder()
    .setName("trainercard")
    .setDescription("View or create your Trainer Card!"),

  async execute(interaction, trainerData, _saveTrainerDataLocal, saveDataToDiscord, client) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

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

    return showTrainerCard(interaction, user, trainerData, saveDataToDiscord);
  },
};

// ==========================================================
// 🌿 Starter Selection (logic preserved; PATCHED to write new team format)
// ==========================================================
export async function starterSelection(interaction, user, trainerData, saveDataToDiscord) {
  try {
    const allPokemon = await getAllPokemon();
    const starGen = [
      { name: "Kanto", ids: [1, 4, 7] },
      { name: "Johto", ids: [152, 155, 158] },
      { name: "Hoenn", ids: [252, 255, 258] },
      { name: "Sinnoh", ids: [387, 390, 393] },
      { name: "Unova", ids: [495, 498, 501] },
    ];

    const allStarters = starGen
      .flatMap((g) => g.ids.map((id) => allPokemon.find((p) => p.id === id)))
      .filter(Boolean);

    if (!allStarters.length) throw new Error("Starter data missing.");

    let index = 0;

    const buildStarterEmbed = () => {
      const p = allStarters[index];
      return new EmbedBuilder()
        .setTitle("🌟 Choose Your Starter")
        .setDescription(`**${p.name}** #${p.id}`)
        .setImage(getPokemonSprite(p.id, "normal"))
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
      components: [buttons()],
    });

    const msg = await interaction.fetchReply();
    const collector = msg.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 120000,
      filter: (i) => i.user.id === interaction.user.id,
    });

    collector.on("collect", async (i) => {
      if (i.customId === "select_starter") {
        const p = allStarters[index];

        const shiny = rollForShiny(user.tp || 0);

        user.pokemon ??= {};
        user.pokemon[p.id] ??= { normal: 0, shiny: 0 };
        if (shiny) user.pokemon[p.id].shiny += 1;
        else user.pokemon[p.id].normal += 1;

        // ✅ Write CANONICAL variant-safe team immediately
        user.displayedPokemon = [{ id: p.id, variant: shiny ? "shiny" : "normal" }];

        user.onboardingStage = "trainer_selection";

        trainerData[interaction.user.id] = user;
        await enqueueSave(trainerData);

        collector.stop("chosen");
        return trainerSelection(interaction, user, trainerData, saveDataToDiscord);
      }

      index += i.customId === "next_starter" ? 1 : -1;
      index = Math.max(0, Math.min(index, allStarters.length - 1));

      await i.update({
        embeds: [buildStarterEmbed()],
        components: [buttons()],
      });
    });
  } catch (err) {
    console.error("starterSelection error:", err);
    return interaction.editReply({ content: "❌ Starter selection failed." });
  }
}

// ==========================================================
// 🧍 Trainer Selection (PATCHED to support trainers array schema)
// Your bot normalizes trainers to an array. So we store to array.
// ==========================================================
export async function trainerSelection(interaction, user, trainerData, saveDataToDiscord) {
  const trainers = [
    { id: "youngster-gen4.png", label: "Youngster" },
    { id: "lass-gen4.png", label: "Lass" },
  ];
  let index = 0;

  const embedFor = (t) =>
    new EmbedBuilder()
      .setTitle("🧍 Choose Your Trainer")
      .setDescription(`Confirm **${t.label}** as your Trainer.`)
      .setImage(`${ensureTrailingSlash(spritePaths.trainers)}${t.id}`)
      .setColor(0x5865f2)
      .setFooter({ text: `Page ${index + 1} / ${trainers.length}` });

  const buttonsFor = () =>
    new ActionRowBuilder().addComponents(
      ...(index > 0
        ? [
            new ButtonBuilder()
              .setCustomId("prev_trainer")
              .setLabel("⬅️ Back")
              .setStyle(ButtonStyle.Secondary),
          ]
        : []),

      ...(index < trainers.length - 1
        ? [
            new ButtonBuilder()
              .setCustomId("next_trainer")
              .setLabel("Next ➡️")
              .setStyle(ButtonStyle.Secondary),
          ]
        : []),

      new ButtonBuilder()
        .setCustomId("confirm_trainer")
        .setLabel(`Confirm ${trainers[index].label}`)
        .setStyle(ButtonStyle.Success)
    );

  await interaction.editReply({
    embeds: [embedFor(trainers[index])],
    components: [buttonsFor()],
  });

  const msg = await interaction.fetchReply();
  const collector = msg.createMessageComponentCollector({
    componentType: ComponentType.Button,
    filter: (i) => i.user.id === interaction.user.id,
    time: 120000,
  });

  collector.on("collect", async (i) => {
    if (i.customId === "confirm_trainer") {
      const t = trainers[index];

      // ✅ trainers is canonical array in your bot normalizeUserSchema()
      user.trainers = Array.isArray(user.trainers) ? user.trainers : [];
      if (!user.trainers.includes(t.id)) user.trainers.push(t.id);

      user.displayedTrainer = t.id;

      user.onboardingComplete = true;
      delete user.onboardingStage;

      trainerData[interaction.user.id] = user;
      await enqueueSave(trainerData);

      collector.stop("chosen");
      return showTrainerCard(interaction, user, trainerData, saveDataToDiscord);
    }

    index += i.customId === "next_trainer" ? 1 : -1;
    index = Math.max(0, Math.min(index, trainers.length - 1));

    await i.update({
      embeds: [embedFor(trainers[index])],
      components: [buttonsFor()],
    });
  });
}

// ==========================================================
// 🧾 SHOW TRAINER CARD  — VARIANT-SAFE + CANONICAL
// ==========================================================
export async function showTrainerCard(interaction, user, trainerData, saveDataToDiscord) {
  try {
    const username = interaction.user.username;
    const avatarURL = interaction.user.displayAvatarURL({ extension: "png", size: 128 });

    const allPokemon = await getAllPokemon();

    // ✅ CANONICAL: user.displayedPokemon (variant-safe objects)
    let team = normalizeTeam(user.displayedPokemon, 6);

    // fallback: owned list (prefers normal, else shiny)
    if (team.length === 0) team = pickFallbackTeamFromOwned(user, 6);

    // optional: persist the repaired canonical team so next call isn't empty
    // (safe because this does NOT invent Pokémon — it only uses owned)
    if (!Array.isArray(user.displayedPokemon) || user.displayedPokemon.length === 0) {
      user.displayedPokemon = team;
      if (trainerData) {
        trainerData[interaction.user.id] = user;
        await enqueueSave(trainerData);
      }
    }

    const leadSlot = team[0] || null;
    const leadId = leadSlot?.id ?? null;
    const leadVariant = leadSlot?.variant ?? "normal";
    const leadPokemon = leadId ? allPokemon.find((p) => p.id === Number(leadId)) : null;
    const leadSprite = leadPokemon ? getPokemonSprite(leadPokemon.id, leadVariant) : null;

    // resolved list for display
    const teamInfo = team
      .map((slot) => {
        const p = allPokemon.find((x) => x.id === Number(slot.id));
        if (!p) return null;
        return { slot, p };
      })
      .filter(Boolean);

    // --- Stats ---
    const rank = getRank(user.tp);
    const pokemonOwned = Object.keys(user.pokemon || {}).length;
    const shinyCount = Object.values(user.pokemon || {}).filter(
      (p) => Number(p?.shiny ?? 0) > 0
    ).length;
    const trainerCount = Array.isArray(user.trainers)
      ? user.trainers.length
      : Object.keys(user.trainers || {}).length;

    // Custom currency emojis
    const TP_EMOJI = "<:tp_icon:1437892250922123364>";
    const CC_EMOJI = "<:coopcoin:1437892112959148093>";

    // ==========================================================
    // 🎨 Trainer rarity → embed color mapping
    // ==========================================================
    const rarityColors = {
      common: 0x9ca3af,
      uncommon: 0x10b981,
      rare: 0x3b82f6,
      epic: 0xa855f7,
      legendary: 0xfacc15,
      mythic: 0xef4444,
    };

    // Trainer thumbnail
    const trainerPath = user.displayedTrainer
      ? `${ensureTrailingSlash(spritePaths.trainers)}${user.displayedTrainer}`
      : null;

    // Trainer info (name, rarity, emoji)
    const trainerInfo = (() => {
      if (!user.displayedTrainer) {
        return {
          name: "Unknown",
          rarityKey: "common",
          rarityLabel: "Common",
          emoji: rarityEmojis.common || "⚬",
        };
      }

      const file = path.basename(user.displayedTrainer).toLowerCase();
      const bare = file.replace(/\.(png|gif)$/i, "");
      const hit = spriteToTrainer.get(file) || spriteToTrainer.get(bare);

      const rarityKey = String(hit?.tier || "common").toLowerCase();
      const rarityLabel = rarityKey.charAt(0).toUpperCase() + rarityKey.slice(1);

      const displayName = hit?.key
        ? hit.key.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
        : bare.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

      return {
        name: displayName,
        rarityKey,
        rarityLabel,
        emoji: rarityEmojis[rarityKey] || "⚬",
      };
    })();

    // ==========================================================
    // 🧩 Build 3×2 Pokémon Grid (always 2 rows)
    // ==========================================================
    const rows = [teamInfo.slice(0, 3), teamInfo.slice(3, 6)];

    const teamFields = rows.map((row) => {
      const text =
        row.length > 0
          ? row
              .map(({ slot, p }) => {
                const shinyMark = normVariant(slot.variant) === "shiny" ? "✨ " : "";
                const tier = String(p.tier || p.rarity || "common").toLowerCase();
                const emoji = rarityEmojis[tier] || "⚬";
                return `${shinyMark}**${p.name}** ${emoji}`;
              })
              .join(" | ")
          : "—";

      return { name: " ", value: text, inline: false };
    });

    // ==========================================================
    // 📘 Build Trainer Card Embed
    // ==========================================================
    const embed = new EmbedBuilder()
      .setAuthor({ name: `${username}'s Trainer Card`, iconURL: avatarURL })
      .setColor(rarityColors[trainerInfo.rarityKey] || 0x5865f2)
      .setDescription(
        `🏆 **Rank:** ${rank}\n` +
          `${TP_EMOJI} **${user.tp ?? 0}** | ${CC_EMOJI} **${user.cc ?? 0}**\n\n` +
          `🧍 **Trainer:** ${trainerInfo.name} — ${trainerInfo.rarityLabel} ${trainerInfo.emoji}\n\n` +
          `📊 **Pokémon Owned:** ${pokemonOwned}\n` +
          `✨ **Shiny Pokémon:** ${shinyCount}\n` +
          `🧍 **Trainers:** ${trainerCount}\n\n` +
          `🌀 **Team:**`
      )
      .setFooter({ text: "Coop's Collection • /trainercard" });

    teamFields.forEach((f) => embed.addFields(f));

    embed.addFields({
      name: " ",
      value: "🪶 **Commands:**\n`/dashboard`",
      inline: false,
    });

    if (trainerPath) embed.setThumbnail(trainerPath);
    if (leadSprite) embed.setImage(leadSprite);

    await interaction.editReply({
      embeds: [embed],
      components: [],
    });
  } catch (err) {
    console.error("trainerCard error:", err);
    return interaction.editReply({ content: "❌ Failed to show Trainer Card." });
  }
}
