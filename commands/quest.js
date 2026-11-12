// ==========================================================
// 🗺️ /quest – complete a quest for a random reward (SafeReply + CC reward + atomic save + Pokemon Cache)
// Coop's Collection Discord Bot
// ==========================================================

import { pokemonSpriteUrl } from "../utils/sprites.js";
import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, MessageFlags } from "discord.js";
import { spritePaths } from "../spriteconfig.js";
import { trainerImageUrl } from "../utils/trainerAssets.js";
import { rollForShiny } from "../shinyOdds.js";
import { grantCatch } from "../utils/training.js";
import { getPokemonCached } from "../utils/pokemonCache.js";
import { getFlattenedTrainers } from "../utils/dataLoader.js";
import { safeReply } from "../utils/safeReply.js";
import { getTrainerKey } from "../utils/trainerFileHandler.js";
import { saveAndAck, withSaveNote } from "../utils/saveManager.js";
import { ensureUserInitialized } from "../utils/userInitializer.js";
import { logEvent } from "../utils/eventLog.js";
import { lockUser } from "../utils/userLocks.js";
import { grantTrainer } from "../services/assets.js";
import { trackProgress } from "../progression/achievements.js";
import { recruitPool } from "./recruit.js";
import { catchAnnouncement } from "../utils/render/catchMessage.js";
import { liveEffects } from "../services/liveEvents.js";
import { scaleEarned, applyLimits, boostedWeights, pickWeighted, hasCatchEffects } from "../utils/liveEventRules.js";

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
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDescription("Complete a quest and receive a random reward! (70% Pokémon, 30% Trainer, +50 CC)"),

  async execute(interaction, trainerData, _saveTrainerDataLocal, _saveDataToDiscord, _lockUser, _enqueueSave, client) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const id = interaction.user.id;

    // Catalog look-ups (awaits) happen before the lock; the reward is picked
    // and granted inside it, in one synchronous block, then saved.
    const rewardType = Math.random() < 0.7 ? "pokemon" : "trainer";
    const pool = rewardType === "pokemon" ? recruitPool(await getPokemonCached()) : await getFlattenedTrainers();
    if (!pool.length) {
      return safeReply(interaction, { content: "❌ Quests are unavailable right now. Please try again later.", flags: MessageFlags.Ephemeral });
    }

    return lockUser(id, async () => {
      const user = await ensureUserInitialized(id, interaction.user.username, trainerData, client);

      // ⏱️ Cooldown
      const timeSinceLastQuest = Date.now() - (user.lastQuest || 0);
      if (timeSinceLastQuest < QUEST_COOLDOWN_MS) {
        const secondsRemaining = Math.ceil((QUEST_COOLDOWN_MS - timeSinceLastQuest) / 1000);
        return safeReply(interaction, {
          content: `⏱️ Wait ${secondsRemaining}s before starting another quest.`,
          flags: MessageFlags.Ephemeral
        });
      }

      // A free roll: Live event Catch limits and boosts shape the Pokémon pick.
      const fx = liveEffects();
      const questPool = rewardType === "pokemon" && applyLimits(pool, fx).length ? applyLimits(pool, fx) : pool;
      const pick = rewardType === "pokemon"
        ? pickWeighted(boostedWeights(questPool, fx, () => 1))
        : pool[Math.floor(Math.random() * pool.length)];
      const questCC = scaleEarned(QUEST_CC_REWARD, fx.cc); // a Live event's CC multiplier
      let embed;

      if (rewardType === "pokemon") {
        const shiny = rollForShiny(user.tp || 0);
        const caught = grantCatch(user, pick.id, shiny ? "shiny" : "normal");
        user.cc = (user.cc || 0) + questCC;
        user.lastQuest = Date.now();

        const ack = await saveAndAck(trainerData);

        // 📜 Event log — quest Pokemon reward
        logEvent("quest_claim", id, {
          rewardType: "pokemon",
          pokemonId: pick.id,
          pokemonName: pick.name,
          tier: (pick.tier || "common").toLowerCase(),
          shiny,
          ccAwarded: questCC,
        });

        embed = new EmbedBuilder()
          .setColor(shiny ? 0xffd700 : 0x00ae86)
          .setTitle("🏆 Quest Complete!")
          .setDescription(withSaveNote(shiny ? `✨ You discovered a **Shiny ${pick.name}!**` : `You found a **${pick.name}!**`, ack))
          .setThumbnail(pokemonSpriteUrl(pick.id, shiny))
          .setFooter({ text: `+${questCC} CC | Balance: ${user.cc} CC` });
        // The catch card, as random catches use (three-teams split); the embed if it can't render.
        const shown = await catchAnnouncement({ user, catcher: interaction.user, pokemonId: pick.id, shiny, catchResult: caught, eventNames: hasCatchEffects(fx) ? fx.catchEvents : [], fallback: () => ({ embeds: [embed] }) });
        const caption = withSaveNote(`🏆 Quest complete! +${questCC} CC · Balance: ${user.cc} CC`, ack);
        return safeReply(interaction, { ...shown.message, content: shown.message.embeds ? undefined : caption, flags: MessageFlags.Ephemeral });
      } else {
        const file = getTrainerKey(pick);
        grantTrainer(user, file);
        trackProgress(user, [{ type: "trainers" }]); // achievements (same lock, same save)
        user.cc = (user.cc || 0) + questCC;
        user.lastQuest = Date.now();

        const ack = await saveAndAck(trainerData);

        // 📜 Event log — quest Trainer reward
        logEvent("quest_claim", id, {
          rewardType: "trainer",
          trainerFile: file,
          trainerName: pick.name,
          tier: (pick.tier || "common").toLowerCase(),
          ccAwarded: questCC,
        });

        embed = new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle("🏆 Quest Complete!")
          .setDescription(withSaveNote(`You recruited **${pick.name}**!`, ack))
          .setThumbnail(trainerImageUrl(file))
          .setFooter({ text: `+${questCC} CC | Balance: ${user.cc} CC` });
      }

      return safeReply(interaction, { embeds: [embed], flags: MessageFlags.Ephemeral });
    });
  }
};
