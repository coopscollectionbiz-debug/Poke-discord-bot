// ==========================================================
// /daily — Coop’s Collection (Race-Safe v18.0)
// ==========================================================

import { pokemonSpriteUrl } from "../utils/sprites.js";
import { trackProgress } from "../progression/achievements.js";
import { grantItem, normalizeInventory } from "../services/inventory.js";
import {
  SlashCommandBuilder,
  EmbedBuilder,
  AttachmentBuilder,
  MessageFlags
} from "discord.js";

import { safeReply } from "../utils/safeReply.js";
import { saveAndAck, withSaveNote } from "../utils/saveManager.js";
import { getAcquirablePokemon } from "../utils/dataLoader.js";
import { selectRandomPokemonForUser } from "../utils/weightedRandom.js";
import { rollForShiny } from "../shinyOdds.js";
import { grantCatch } from "../utils/training.js";
import { broadcastReward } from "../utils/broadcastReward.js";
import { ensureUserInitialized } from "../utils/userInitializer.js";
import { spritePaths, rarityEmojis, rarityColors } from "../spriteconfig.js";
import { logEvent } from "../utils/eventLog.js";
import { getRank } from "../utils/rankSystem.js";
import { cardImage } from "../utils/render/stage.js";
import { catchView } from "../utils/render/catchCard.js";

import { dexProgress } from "../utils/render/dexProgress.js";
import { threaded } from "../utils/render/renderers.js";
import { liveEffects } from "../services/liveEvents.js";
import { scaleEarned, applyLimits, boostedWeights, pickWeighted, hasCatchEffects } from "../utils/liveEventRules.js";

// ==========================================================
// Constants
// ==========================================================
const DAILY_CC = 1000;
const DAILY_TP = 100;
const EVOLUTION_STONE_CHANCE = 0.25;

const COIN_EMOJI = "<:coopcoin:1437892112959148093>";
const TP_EMOJI   = "<:tp_icon:1437892250922123364>";
const DAILY_COLOR = "#F7C843";

// ==========================================================
// 🕛 UTC date helper
// ==========================================================
function getUTCDateString() {
  return new Date().toISOString().split("T")[0];
}

// ==========================================================
// Slash Command Definition
// ==========================================================
export const data = new SlashCommandBuilder()
  .setName("daily")
  .setDescription("Claim your daily reward (2 Pokémon + CC + TP + stone chance)");

// ==========================================================
// EXECUTION
// ==========================================================
export async function execute(
  interaction,
  trainerData,
  saveTrainerDataLocal,
  saveDataToDiscord,
  lockUser,
  enqueueSave,
  client
)
 {

  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const userId = interaction.user.id;

    // ======================================================
    // ⭐ Lock entire daily to prevent race conditions
    // ======================================================
    return lockUser(userId, async () => {

      // Ensure user exists & is initialized
      let user = await ensureUserInitialized(
        userId,
        interaction.user.username,
        trainerData,
        client
      );

      const today = getUTCDateString();

      // ======================================================
      // Already claimed?
      // ======================================================
      if (user.lastDaily === today) {
        return safeReply(interaction, {
          content: "⏳ You've already claimed your daily today!\nResets at **00:00 UTC**.",
          ephemeral: true
        });
      }

      // ======================================================
      // Load Pokémon pool
      // ======================================================
      const allPokemon = await getAcquirablePokemon(); // live generations only
      if (!Array.isArray(allPokemon) || allPokemon.length === 0) {
        return safeReply(interaction, {
          content: "❌ Pokémon data unavailable.",
          flags: MessageFlags.Ephemeral
        });
      }

      // ======================================================
      // Draw 2 Pokémon — rank aware
      // ======================================================
      const pick1 = selectRandomPokemonForUser(allPokemon, user, "pokeball");
      const pick2 = selectRandomPokemonForUser(allPokemon, user, "pokeball");

      if (!pick1 || !pick2) {
        return safeReply(interaction, {
          content: "❌ Daily failed — no Pokémon could be selected.",
          flags: MessageFlags.Ephemeral
        });
      }

      const shiny1 = rollForShiny(user.tp);
      const shiny2 = rollForShiny(user.tp);

      // ======================================================
      // Initialize inventory safety
      // ======================================================
      user.pokemon ??= {};
      normalizeInventory(user); // idempotent; guarantees items.evolution_stone

      // ======================================================
      // Apply Pokémon to inventory
      // ======================================================
      // Each catch's result (catch Level, first catch or duplicate EXP) is shown on the card.
      const rankBefore = getRank(user.tp);
      const caught1 = grantCatch(user, pick1.id, shiny1 ? "shiny" : "normal");
      const caught2 = grantCatch(user, pick2.id, shiny2 ? "shiny" : "normal");

      // ======================================================
      // Apply CC + TP
      // ======================================================
      const dailyCC = scaleEarned(DAILY_CC, liveEffects().cc); // a Live event's CC multiplier
      user.cc += dailyCC;
      user.tp += DAILY_TP;

      // ======================================================
      // Evolution stone roll
      // ======================================================
      let stoneAwarded = false;
      if (Math.random() < EVOLUTION_STONE_CHANCE) {
        // Same 1-stone reward as before, through the inventory service.
        stoneAwarded = grantItem(user, "evolution_stone", 1).ok;
      }

      user.lastDaily = today;
      // Release C: achievement progress (Pokémon, shinies, TP/rank).
      trackProgress(user, [{ type: "pokemon" }, { type: "shiny", n: (shiny1 ? 1 : 0) + (shiny2 ? 1 : 0) }, { type: "tp" }, { type: "daily", day: Math.floor(Date.parse(today) / 86_400_000) }]);

      // ======================================================
      // Rare & shiny broadcast system
      // ======================================================
      const maybeBroadcast = async (pick, isShiny) => {
        const rarity = (pick.tier || pick.rarity || "common").toLowerCase();
        if (!isShiny && !["rare", "epic", "legendary", "mythic"].includes(rarity))
          return;

        try {
          await broadcastReward(client, {
            user: interaction.user,
            type: "pokemon",
            item: pick,
            shiny: isShiny,
            source: "daily"
          });
        } catch (err) {
          console.warn("⚠️ Broadcast failed:", err);
        }
      };

      // Fire-and-forget: broadcasts are informational, don't block the command
      maybeBroadcast(pick1, shiny1);
      maybeBroadcast(pick2, shiny2);

      // ======================================================
      // Atomic save
      // ======================================================
      const saveAck = await saveAndAck(trainerData);

      // 📜 Event log — daily claim is a major faucet: fixed CC/TP plus
      // two Pokemon and a stone roll. Track what hit so admins can see
      // per-day accrual and any shiny/stone luck.
      logEvent("daily_claim", userId, {
        ccAwarded: dailyCC,
        tpAwarded: DAILY_TP,
        stoneAwarded,
        pokemon: [
          {
            pokemonId: pick1.id,
            pokemonName: pick1.name,
            tier: (pick1.tier || "common").toLowerCase(),
            shiny: shiny1,
          },
          {
            pokemonId: pick2.id,
            pokemonName: pick2.name,
            tier: (pick2.tier || "common").toLowerCase(),
            shiny: shiny2,
          },
        ],
      });

      // ======================================================
      // Build embeds
      // ======================================================
      const sprite1 = pokemonSpriteUrl(pick1.id, shiny1);
      const sprite2 = pokemonSpriteUrl(pick2.id, shiny2);

      const rarity1 = (pick1.tier || "common").toLowerCase();
      const rarity2 = (pick2.tier || "common").toLowerCase();

      const embed1 = new EmbedBuilder()
        .setTitle(`🎁 Pokémon #1 ${shiny1 ? "✨" : ""}`)
        .setColor(rarityColors[rarity1] ?? "#5bc0de")
        .setDescription(`${rarityEmojis[rarity1] ?? ""} **${pick1.name}**`)
        .setImage(sprite1);

      const embed2 = new EmbedBuilder()
        .setTitle(`🎁 Pokémon #2 ${shiny2 ? "✨" : ""}`)
        .setColor(rarityColors[rarity2] ?? "#5bc0de")
        .setDescription(`${rarityEmojis[rarity2] ?? ""} **${pick2.name}**`)
        .setImage(sprite2);

      const summary = new EmbedBuilder()
        .setTitle("🗓️ Daily Rewards")
        .setColor(DAILY_COLOR)
        .addFields(
          { name: `${COIN_EMOJI} CC`, value: `+${dailyCC}` },
          { name: `${TP_EMOJI} TP`, value: `+${DAILY_TP}` },
          { name: "📊 New Balance", value: `${COIN_EMOJI} ${user.cc}  |  ${TP_EMOJI} ${user.tp}` }
        );

      if (stoneAwarded) {
        summary.addFields({
          name: "💎 Evolution Stone",
          value: "You received **1× Evolution Stone**!"
        });
        summary.setThumbnail(`${spritePaths.items}evolution_stone.png`);
      }
      if (saveAck.note) summary.setDescription(saveAck.note);

      // One rewards card; the three embeds above are the fallback.
      try {
        const view = (pick, shiny, result) => catchView(user, {
          id: pick.id, variant: shiny ? "shiny" : "normal", catchResult: result, trainerName: interaction.user.username,
        });
        const rankAfter = getRank(user.tp);
        const dailyView = {
          pokemon: [view(pick1, shiny1, caught1), view(pick2, shiny2, caught2)],
          cc: dailyCC,
          tp: DAILY_TP,
          stone: stoneAwarded,
          balance: { cc: user.cc, tp: user.tp },
          rankUp: rankAfter && rankAfter !== rankBefore ? rankAfter : null,
          dex: dexProgress(user, [pick1.id, pick2.id]), // today's regions + national, after both catches
        };
        const card = await cardImage((animate) => threaded.daily(dailyView, { animate }), "daily");
        return safeReply(interaction, {
          ...(saveAck.note ? { content: saveAck.note } : {}),
          files: [new AttachmentBuilder(card.buffer, { name: card.name })],
          flags: MessageFlags.Ephemeral
        });
      } catch (err) {
        console.warn("⚠️ /daily card render failed; sending embeds:", err?.message || err);
      }

      return safeReply(interaction, {
        embeds: [embed1, embed2, summary],
        flags: MessageFlags.Ephemeral
      });
    });

  } catch (err) {
    console.error("❌ /daily ERROR:", err);

    return safeReply(interaction, {
      content: "❌ An error occurred processing your daily reward.",
      flags: MessageFlags.Ephemeral
    });
  }
}
