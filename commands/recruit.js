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
  ButtonStyle,
  PermissionFlagsBits,
  MessageFlags
} from "discord.js";
import { spritePaths } from "../spriteconfig.js";
import { rollForShiny } from "../shinyOdds.js";
import { grantCatch } from "../utils/training.js";
import { getPokemonCached } from "../utils/pokemonCache.js";
import { getFlattenedTrainers } from "../utils/dataLoader.js";
import {
  selectRandomPokemonForUser,
  selectRandomTrainerForUser
} from "../utils/weightedRandom.js";
import { safeReply } from "../utils/safeReply.js";
import { getTrainerKey } from "../utils/trainerFileHandler.js";
import { saveAndAck, withSaveNote } from "../utils/saveManager.js";
import { ensureUserInitialized } from "../utils/userInitializer.js";
import { logEvent } from "../utils/eventLog.js";
import { lockUser } from "../utils/userLocks.js";
import { grantTrainer } from "../services/assets.js";
import { trackProgress } from "../progression/achievements.js";


// ==========================================================
// ⏱️ Constants
// ==========================================================
const RECRUIT_COOLDOWN_MS = 1000 * 30; // 30s cooldown
const RECRUIT_COST_CC = 100;

// ==========================================================
// 🧩 Command Definition
// ==========================================================
export default {
  data: new SlashCommandBuilder()
    .setName("recruit")
    .setDescription("Recruit a Pokémon or Trainer! (Costs 100 CC)")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  async execute(interaction, trainerData, _saveTrainerDataLocal, _saveDataToDiscord, _lockUser, _enqueueSave, client) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const id = interaction.user.id;
    const user = await ensureUserInitialized(id, interaction.user.username, trainerData, client);

    // ⏱️ Cooldown
    const lastRecruit = user.lastRecruit || 0;
    const timeSinceLastRecruit = Date.now() - lastRecruit;
    if (timeSinceLastRecruit < RECRUIT_COOLDOWN_MS) {
      const secondsRemaining = Math.ceil((RECRUIT_COOLDOWN_MS - timeSinceLastRecruit) / 1000);
      return safeReply(interaction, {
        content: `⏱️ Wait ${secondsRemaining}s before recruiting again.`,
        flags: MessageFlags.Ephemeral
      });
    }

    // 💰 CC Check
    if (user.cc < RECRUIT_COST_CC) {
      return safeReply(interaction, {
        content: "❌ You need **100 CC** to recruit! Earn more using `/daily`.",
        flags: MessageFlags.Ephemeral
      });
    }

    // 🎮 Recruitment Menu UI
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
          .setDescription("Each recruitment costs **100 CC**.\nSelect what type of recruit you want to attempt:")
      ],
      components: [
        new ActionRowBuilder().addComponents(menu),
        new ActionRowBuilder().addComponents(cancel)
      ],
      flags: MessageFlags.Ephemeral
    });

    // 🕐 Collector
    const collector = interaction.channel.createMessageComponentCollector({
      filter: (i) => i.user.id === id,
      time: 120000
    });

    collector.on("collect", async (i) => {
      if (i.customId === "cancel_recruit") {
        collector.stop();
        return safeReply(i, { content: "❌ Recruitment cancelled.", flags: MessageFlags.Ephemeral });
      }

      if (i.customId === "recruit_type") {
        const choice = i.values[0];
        collector.stop();

        if (user.cc < RECRUIT_COST_CC) {
          return safeReply(i, {
            content: "❌ You need **100 CC** to recruit! Earn more using `/daily`.",
            flags: MessageFlags.Ephemeral
          });
        }

        if (choice === "pokemon") {
          await recruitPokemon(i, trainerData);
        } else {
          await recruitTrainer(i, trainerData);
        }
      }
    });

    collector.on("end", async (_, reason) => {
      if (reason === "time") {
        await safeReply(interaction, {
          content: "⏱️ Recruitment timed out – try again later.",
          flags: MessageFlags.Ephemeral
        });
      }
    });
  }
};

// ==========================================================
// Shared: charge 100 CC and grant, all inside the user's lock.
// Awaits (catalog look-ups) happen before the lock; inside it the live
// record is re-checked, mutated in one synchronous block, then saved.
// ==========================================================
const NOT_ENOUGH_CC = "❌ You need **100 CC** to recruit! Earn more using `/daily`.";

// Gens 1–5 = national dex 1–649. (pokemonData has no `generation` field;
// filtering on it emptied the pool and broke every recruit.)
export const RECRUIT_MAX_DEX = 649;
export const recruitPool = (allPokemon) => allPokemon.filter((p) => Number(p.id) >= 1 && Number(p.id) <= RECRUIT_MAX_DEX);

/**
 * Charge the recruit cost and apply `grant(user)` atomically.
 * @returns {{ok:true}|{ok:false, reason:string}}
 */
export function chargeAndGrant(user, grant, now = Date.now()) {
  if (!user || !Number.isFinite(user.cc) || user.cc < RECRUIT_COST_CC) return { ok: false, reason: NOT_ENOUGH_CC };
  grant(user);
  user.cc -= RECRUIT_COST_CC;
  user.lastRecruit = now;
  return { ok: true };
}

// ==========================================================
// 🐾 Pokémon Recruitment
// ==========================================================
async function recruitPokemon(i, trainerData) {
  const pool = recruitPool(await getPokemonCached());
  if (!pool.length) {
    return safeReply(i, { content: "❌ Recruitment is unavailable right now. Please try again later.", flags: MessageFlags.Ephemeral });
  }

  await lockUser(i.user.id, async () => {
    const user = trainerData[i.user.id];
    const pick = selectRandomPokemonForUser(pool, user);
    const shiny = rollForShiny(user?.tp || 0);
    const res = chargeAndGrant(user, (u) => grantCatch(u, pick.id, shiny ? "shiny" : "normal"));
    if (!res.ok) return safeReply(i, { content: res.reason, flags: MessageFlags.Ephemeral });
    trackProgress(user, [{ type: "pokemon" }, { type: "shiny", n: shiny ? 1 : 0 }]); // achievements: after a successful grant, before the save

    const ack = await saveAndAck(trainerData);

    // 📜 Event log — recruit is a CC sink + Pokemon faucet
    logEvent("recruit", i.user.id, {
      rewardType: "pokemon",
      pokemonId: pick.id,
      pokemonName: pick.name,
      tier: (pick.tier || "common").toLowerCase(),
      shiny,
      ccSpent: RECRUIT_COST_CC,
    });

    const spriteUrl = shiny
      ? `${spritePaths.shiny}${pick.id}.gif`
      : `${spritePaths.pokemon}${pick.id}.gif`;

    const embed = new EmbedBuilder()
      .setColor(shiny ? 0xffd700 : 0x00ae86)
      .setTitle("🎯 Pokémon Recruited!")
      .setDescription(withSaveNote(shiny ? `✨ You recruited a **Shiny ${pick.name}!**` : `You recruited a **${pick.name}!**`, ack))
      .setThumbnail(spriteUrl)
      .setFooter({ text: `-100 CC | Balance: ${user.cc} CC` });

    return safeReply(i, { embeds: [embed], flags: MessageFlags.Ephemeral });
  });
}

// ==========================================================
// 🎭 Trainer Recruitment
// ==========================================================
async function recruitTrainer(i, trainerData) {
  const flatTrainers = await getFlattenedTrainers();

  await lockUser(i.user.id, async () => {
    const user = trainerData[i.user.id];
    const pick = selectRandomTrainerForUser(flatTrainers, user);
    const file = getTrainerKey(pick);
    const res = chargeAndGrant(user, (u) => grantTrainer(u, file));
    if (!res.ok) return safeReply(i, { content: res.reason, flags: MessageFlags.Ephemeral });
    trackProgress(user, [{ type: "trainers" }]); // achievements: after a successful grant, before the save

    const ack = await saveAndAck(trainerData);

    // 📜 Event log — recruit (trainer variant)
    logEvent("recruit", i.user.id, {
      rewardType: "trainer",
      trainerFile: file,
      trainerName: pick.name,
      tier: (pick.tier || "common").toLowerCase(),
      ccSpent: RECRUIT_COST_CC,
    });

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle("🎭 Trainer Recruited!")
      .setDescription(withSaveNote(`You recruited **${pick.name}**!`, ack))
      .setThumbnail(`${spritePaths.trainers}${file}`)
      .setFooter({ text: `-100 CC | Balance: ${user.cc} CC` });

    return safeReply(i, { embeds: [embed], flags: MessageFlags.Ephemeral });
  });
}
