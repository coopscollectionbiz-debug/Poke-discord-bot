// ==========================================================
// 🗓️ Coop's Collection — /daily (UTC Reset + Rarity Colors + Custom Emojis v16)
// ==========================================================
// Rewards:
//   • TWO Pokémon (rank-buffed)
//   • +500 CC
//   • +100 TP
//   • 10% Evolution Stone chance
//   • Pokémon embeds colored by rarity
//   • Custom emoji for CC + TP
//   • Reset every day at 00:00 UTC
// ==========================================================

import {
  SlashCommandBuilder,
  EmbedBuilder
} from "discord.js";

import { safeReply } from "../utils/safeReply.js";
import { enqueueSave } from "../utils/saveQueue.js";
import { getAllPokemon } from "../utils/dataLoader.js";
import { selectRandomPokemonForUser } from "../utils/weightedRandom.js";
import { rollForShiny } from "../shinyOdds.js";
import { broadcastReward } from "../utils/broadcastReward.js";
import { spritePaths, rarityEmojis, rarityColors } from "../spriteconfig.js";

// ==========================================================
// CONSTANTS
// ==========================================================
const DAILY_CC = 500;
const DAILY_TP = 100;
const EVOLUTION_STONE_CHANCE = 0.10;

// Custom server emojis
const COIN_EMOJI = "<:coopcoin:1437892112959148093>";
const TP_EMOJI   = "<:tp_icon:1437892250922123364>";

// Permanent daily embed color (Option D)
const DAILY_COLOR = "#F7C843";

// Returns YYYY-MM-DD (UTC)
function getUTCDateString() {
  return new Date().toISOString().split("T")[0];
}

export const data = new SlashCommandBuilder()
  .setName("daily")
  .setDescription("Claim your daily reward (2 Pokémon + CC + TP + stone chance)");


// ==========================================================
// 🧩 EXECUTE DAILY
// ==========================================================
export async function execute(
  interaction,
  trainerData,
  saveTrainerDataLocal,
  saveDataToDiscord,
  client
) {
  try {
    await interaction.deferReply({ ephemeral: true }).catch(() => {});

    const userId = interaction.user.id;
    const today = getUTCDateString();

    // ======================================================
    // ENSURE USER EXISTS
    // ======================================================
    trainerData[userId] ??= {};
    const user = trainerData[userId];

    user.cc ??= 0;
    user.tp ??= 0;
    user.items ??= { evolution_stone: 0 };
    user.items.evolution_stone ??= 0;
    user.pokemon ??= {};
    user.lastDaily ??= "1970-01-01";

    // ======================================================
    // DAILY CLAIM CHECK
    // ======================================================
    if (user.lastDaily === today) {
      return safeReply(interaction, {
        content: `⏳ You've already claimed your daily today!\nResets at **00:00 UTC**.`,
        ephemeral: true,
      });
    }

    // ======================================================
    // LOAD POKÉMON DATA
    // ======================================================
    const allPokemon = await getAllPokemon();
    if (!Array.isArray(allPokemon) || allPokemon.length === 0) {
      return safeReply(interaction, {
        content: "❌ Pokémon data unavailable.",
        ephemeral: true,
      });
    }

    // ======================================================
    // TWO RANK-BUFFED ROLLS
    // ======================================================
    const pick1 = selectRandomPokemonForUser(allPokemon, user, "pokeball");
    const pick2 = selectRandomPokemonForUser(allPokemon, user, "pokeball");

    if (!pick1 || !pick2) {
      return safeReply(interaction, {
        content: "❌ Daily failed — no Pokémon could be selected.",
        ephemeral: true
      });
    }

    const shiny1 = rollForShiny(user.tp);
    const shiny2 = rollForShiny(user.tp);

    const sprite1 = shiny1
      ? `${spritePaths.shiny}${pick1.id}.gif`
      : `${spritePaths.pokemon}${pick1.id}.gif`;

    const sprite2 = shiny2
      ? `${spritePaths.shiny}${pick2.id}.gif`
      : `${spritePaths.pokemon}${pick2.id}.gif`;

    // ======================================================
    // ADD TO INVENTORY
    // ======================================================
    const addMon = (pick, shiny) => {
      user.pokemon[pick.id] ??= { normal: 0, shiny: 0 };
      if (shiny) user.pokemon[pick.id].shiny++;
      else user.pokemon[pick.id].normal++;
    };

    addMon(pick1, shiny1);
    addMon(pick2, shiny2);

    // ======================================================
    // BROADCAST RARES + SHINIES
    // ======================================================
    const maybeBroadcast = async (pick, shiny) => {
      const rarity = (pick.tier || pick.rarity || "common").toLowerCase();
      if (shiny || ["rare", "epic", "legendary", "mythic"].includes(rarity)) {
        await broadcastReward(client, {
          user: interaction.user,
          type: "pokemon",
          item: pick,
          shiny,
          source: "daily"
        }).catch(() => {});
      }
    };

    await maybeBroadcast(pick1, shiny1);
    await maybeBroadcast(pick2, shiny2);

    // ======================================================
    // CURRENCY + STONE
    // ======================================================
    user.cc += DAILY_CC;
    user.tp += DAILY_TP;

    let stoneAwarded = false;
    if (Math.random() < EVOLUTION_STONE_CHANCE) {
      user.items.evolution_stone++;
      stoneAwarded = true;
    }

    user.lastDaily = today;

    // SAVE
    await enqueueSave(trainerData);

    // ======================================================
    // BUILD EMBEDS (RARITY COLORS)
    // ======================================================
    const rarity1 = (pick1.tier || pick1.rarity || "common").toLowerCase();
    const rarity2 = (pick2.tier || pick2.rarity || "common").toLowerCase();

    const emoji1 = rarityEmojis[rarity1] ?? "";
    const emoji2 = rarityEmojis[rarity2] ?? "";

    const color1 = rarityColors[rarity1] ?? "#5bc0de";
    const color2 = rarityColors[rarity2] ?? "#5bc0de";

    const embed1 = new EmbedBuilder()
      .setTitle(`🎁 Pokémon #1 ${shiny1 ? "✨" : ""}`)
      .setColor(color1)
      .setDescription(
        `${emoji1} **${pick1.name}**\n` +
        `Rarity: **${rarity1.toUpperCase()}**`
      )
      .setImage(sprite1);

    const embed2 = new EmbedBuilder()
      .setTitle(`🎁 Pokémon #2 ${shiny2 ? "✨" : ""}`)
      .setColor(color2)
      .setDescription(
        `${emoji2} **${pick2.name}**\n` +
        `Rarity: **${rarity2.toUpperCase()}**`
      )
      .setImage(sprite2);

    // ======================================================
    // SUMMARY EMBED (PERMANENT COLOR — OPTION D)
    // ======================================================
    const summary = new EmbedBuilder()
      .setTitle("🗓️ Daily Rewards")
      .setColor(DAILY_COLOR)
      .addFields(
        {
          name: `${COIN_EMOJI} CC`,
          value: `+${DAILY_CC}`
        },
        {
          name: `${TP_EMOJI} TP`,
          value: `+${DAILY_TP}`
        },
        {
          name: "📊 New Balance",
          value: `${COIN_EMOJI} ${user.cc}  |  ${TP_EMOJI} ${user.tp}`
        }
      );

    if (stoneAwarded) {
      summary.addFields({
        name: "💎 Evolution Stone",
        value: "You received **1x Evolution Stone**!"
      });
      summary.setThumbnail(`${spritePaths.items}evolution_stone.png`);
    }

    return safeReply(interaction, {
      embeds: [embed1, embed2, summary],
      ephemeral: true
    });

  } catch (err) {
    console.error("❌ /daily ERROR:", err);

    return safeReply(interaction, {
      content: "❌ An error occurred processing your daily reward.",
      ephemeral: true
    });
  }
}
