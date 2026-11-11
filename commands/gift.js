// ==========================================================
// gift.js – Gift Coins, Pokémon, or Trainers to another user
// Coop's Collection Discord Bot (SafeReply Refactor + Trainer Key Standardization)
// ==========================================================

import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from "discord.js";
import {
  validateAmount,
  validateUserResources,
  validateNameQuery,
} from "../utils/validators.js";
import { findPokemonByName, getFlattenedTrainers } from "../utils/dataLoader.js";
import {
  createSuccessEmbed,
  createErrorEmbed,
} from "../utils/embedBuilders.js";
import { safeReply } from "../utils/safeReply.js";
import { getTrainerKey, findTrainerByQuery } from "../utils/trainerFileHandler.js";
import { saveAndAck, withSaveNote } from "../utils/saveManager.js";
import { ensureUserInitialized } from "../utils/userInitializer.js";
import { plainCount, removeCopies } from "../services/ownership.js";
import { lockUsers } from "../utils/userLocks.js";
import { ownsTrainer, grantTrainer, revokeTrainer, trainerCount } from "../services/assets.js";
import { trackProgress } from "../progression/achievements.js";

// Moves `amount` normal copies of one Pokémon. Returns why it can't, or null once moved.
// Separate from execute() so tests can run it without the save writing trainerData.json.
// TM safety (services/ownership.js, owner decision D-T8): only plain copies
// can be gifted; a copy with TM-trained moves never leaves its owner here.
export function giftPokemon(sender, recipient, key, name, amount) {
  const normal = sender.pokemon[key]?.normal || 0;
  const shiny = sender.pokemon[key]?.shiny || 0;

  // Only normals move, so only normals can cover the amount. Counting shinies
  // here let 1 normal + 3 shiny send 3 normals, creating 2 from nothing.
  if (normal < amount) return `❌ You don't have ${amount}× normal ${name} to gift. Shiny Pokémon can't be gifted.`;
  if (normal + shiny - amount === 0) return `⚠️ You can't gift your last ${name}.`;
  if (plainCount(sender, key, "normal") < amount) return `❌ Some of your ${name} have TM-trained moves, and TM-trained Pokémon can't be gifted.`;

  const removed = removeCopies(sender, { id: key, variant: "normal", n: amount });
  if (!removed.ok) return `❌ ${removed.error}`;
  if (!recipient.pokemon[key]) recipient.pokemon[key] = { normal: 0, shiny: 0 };
  recipient.pokemon[key].normal = (recipient.pokemon[key].normal || 0) + amount;
  return null;
}

// Moves one trainer sprite. Returns why it can't, or null once moved.
export function giftTrainer(sender, recipient, key, name) {
  if (!ownsTrainer(sender, key)) return `❌ You don't own ${name}.`;
  if (trainerCount(sender) <= 1) return `⚠️ You can't gift your only trainer sprite.`;
  if (ownsTrainer(recipient, key)) return `⚠️ They already own ${name}.`;
  revokeTrainer(sender, key);
  grantTrainer(recipient, key);
  trackProgress(recipient, [{ type: "trainers" }]); // achievements (inside lockUsers)
  return null;
}

// Moves CC. Returns why it can't, or null once moved.
export function giftCoins(sender, recipient, amount) {
  const check = validateUserResources(sender, "cc", amount);
  if (!check.valid) return `❌ ${check.error}`;
  sender.cc -= amount;
  recipient.cc = (recipient.cc || 0) + amount;
  return null;
}

// ==========================================================
// 🧩 Command Definition
// ==========================================================
export default {
  data: new SlashCommandBuilder()
    .setName("gift")
    .setDescription("Gift CC, Pokémon, or Trainer to another player.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption((option) =>
      option
        .setName("target")
        .setDescription("The user you want to gift to.")
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName("type")
        .setDescription("What do you want to send?")
        .setRequired(true)
        .addChoices(
          { name: "Collection Coins (CC)", value: "cc" },
          { name: "Pokémon", value: "pokemon" },
          { name: "Trainer", value: "trainer" }
        )
    )
    .addStringOption((option) =>
      option
        .setName("item")
        .setDescription("Pokémon name or Trainer name (ignored for CC).")
        .setRequired(false)
    )
    .addIntegerOption((option) =>
      option
        .setName("amount")
        .setDescription("How many coins or Pokémon to send (ignored for trainer).")
        .setMinValue(1)
        .setRequired(false)
    ),

  // ==========================================================
  // ⚙️ Command Execution (SafeReply Refactor)
  // ==========================================================
  async execute(interaction, trainerData, _saveTrainerDataLocal, _saveDataToDiscord, _lockUser, _enqueueSave, client) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const senderId = interaction.user.id;
    const receiver = interaction.options.getUser("target");
    const type = interaction.options.getString("type");
    const itemName = interaction.options.getString("item");
    const amount = interaction.options.getInteger("amount") || 1;

    // Basic validation
    if (!receiver)
      return safeReply(interaction, { content: "❌ Invalid user.", flags: MessageFlags.Ephemeral });

    if (receiver.id === senderId)
      return safeReply(interaction, {
        content: "⚠️ You can't gift yourself.",
        flags: MessageFlags.Ephemeral,
      });

    // Validate amount for CC/Pokemon
    if (type !== "trainer") {
      const amountValidation = validateAmount(amount, 1000000);
      if (!amountValidation.valid)
        return safeReply(interaction, {
          content: `❌ ${amountValidation.error}`,
          flags: MessageFlags.Ephemeral,
        });
    }

    const reply = (content) => safeReply(interaction, { content, flags: MessageFlags.Ephemeral });

    // ---- Look-ups that need awaits happen BEFORE any lock or mutation ----
    let pokemonTarget = null;
    let trainerTarget = null;
    try {
      if (type === "pokemon" || type === "trainer") {
        if (!itemName) return reply(`❌ You must specify which ${type === "pokemon" ? "Pokémon" : "Trainer"} to gift.`);
        const nameValidation = validateNameQuery(itemName);
        if (!nameValidation.valid) return reply(`❌ ${nameValidation.error}`);

        if (type === "pokemon") {
          try {
            pokemonTarget = await findPokemonByName(nameValidation.sanitized);
          } catch (err) {
            console.error("❌ Error finding Pokémon:", err);
            return reply("❌ Error searching for Pokémon. Please try again.");
          }
          if (!pokemonTarget) return reply(`⚠️ Pokémon \"${itemName}\" not found.`);
        } else {
          if (amount && amount !== 1) return reply("⚠️ Trainer gifts are always 1. Ignore the amount parameter.");
          const flatTrainers = await getFlattenedTrainers();
          trainerTarget = findTrainerByQuery(flatTrainers, nameValidation.sanitized);
          if (!trainerTarget) return reply(`⚠️ Trainer \"${itemName}\" not found.`);
        }
      }
    } catch (err) {
      console.error("❌ Gift command error:", err);
      return reply(`❌ An error occurred: ${err.message}`);
    }

    // ---- Both players locked: validate + move in one synchronous block, then save ----
    try {
      await lockUsers(senderId, receiver.id, async () => {
        const sender = await ensureUserInitialized(senderId, interaction.user.username, trainerData, client);
        const recipient = await ensureUserInitialized(receiver.id, receiver.username, trainerData, client);

        let refusal = null;
        let description = "";
        if (type === "cc") {
          refusal = giftCoins(sender, recipient, amount);
          description = `💰 ${interaction.user.username} sent **${amount.toLocaleString()} CC** to ${receiver.username}!`;
        } else if (type === "pokemon") {
          refusal = giftPokemon(sender, recipient, pokemonTarget.id.toString(), pokemonTarget.name, amount);
          description = `🧬 ${interaction.user.username} sent **${amount}× ${pokemonTarget.name}** to ${receiver.username}!`;
        } else if (type === "trainer") {
          refusal = giftTrainer(sender, recipient, getTrainerKey(trainerTarget), trainerTarget.name);
          description = `🧑‍🏫 ${interaction.user.username} sent the **${trainerTarget.name}** trainer sprite to ${receiver.username}!`;
        } else {
          refusal = "❌ Unknown gift type.";
        }
        if (refusal) return reply(refusal);

        // Save BEFORE confirming (D7); never claim success the disk didn't confirm (D14).
        const ack = await saveAndAck(trainerData);
        console.log(`✅ Gift: ${interaction.user.username} → ${receiver.username} (${type}${itemName ? " - " + itemName : ""})${ack.saved ? "" : " [save delayed]"}`);
        const embed = createSuccessEmbed("🎁 Gift Sent!", withSaveNote(description, ack), { color: 0x57f287 });
        return safeReply(interaction, { embeds: [embed], flags: MessageFlags.Ephemeral });
      });
    } catch (err) {
      console.error("❌ Gift command error:", err);
      return reply(`❌ An error occurred: ${err.message}`);
    }
  },
};
