// ==========================================================
// /battle — challenge another trainer's Team to an automatic Battle.
// Open battle: runs immediately, no CC. Wager battle: the Defender must
// accept first (see the wager flow below).
// ==========================================================

import { SlashCommandBuilder, MessageFlags } from "discord.js";
import { randomInt } from "crypto";
import { ensureUserInitialized } from "../utils/userInitializer.js";
import { logEvent } from "../utils/eventLog.js";
import { battleBlock, runBattle, withBothLocks } from "../utils/battle/runBattle.js";
import { playBattle } from "../utils/battle/playback.js";

export const data = new SlashCommandBuilder()
  .setName("battle")
  .setDescription("Battle another trainer's Team")
  .addUserOption((o) => o.setName("opponent").setDescription("Who to battle").setRequired(true))
  .addIntegerOption((o) =>
    o.setName("wager").setDescription("CC each of you puts in the pot (they must accept)").setMinValue(1));

export function refusal(reason, opponentId) {
  return {
    self: "You can't battle yourself.",
    bot: "You can't battle a bot.",
    no_team_challenger: "Set a Team on your dashboard before battling.",
    no_team_defender: `<@${opponentId}> hasn't set a team yet.`,
    cap_daily: "You've used all 10 battles for today. Battles reset at midnight UTC.",
    cap_opponent: `You've battled <@${opponentId}> 3 times today. Try someone else.`,
    defender_cap_daily: "No battles left today.",
    defender_cap_opponent: "You two have battled 3 times today.",
  }[reason] ?? "That battle can't happen right now.";
}

export function displayNames(interaction, opponent) {
  return {
    [interaction.user.id]: interaction.member?.displayName ?? interaction.user.username,
    [opponent.id]: interaction.options.getMember("opponent")?.displayName ?? opponent.username,
  };
}

export async function execute(interaction, trainerData, _saveLocal, _saveDiscord, lockUser, enqueueSave, client) {
  const opponent = interaction.options.getUser("opponent", true);
  const wager = interaction.options.getInteger("wager");
  const challengerId = interaction.user.id;
  const refuse = (reason) => interaction.reply({ content: refusal(reason, opponent.id), flags: MessageFlags.Ephemeral });

  if (opponent.bot) return refuse("bot");
  if (wager != null) {
    return interaction.reply({ content: "Wager battles are coming soon.", flags: MessageFlags.Ephemeral });
  }

  await ensureUserInitialized(challengerId, interaction.user.username, trainerData, client);
  const mode = "open";
  const early = battleBlock({ trainerData, challengerId, defenderId: opponent.id, mode });
  if (early) return refuse(early);

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const seed = randomInt(0, 2 ** 31 - 1);
  const outcome = await withBothLocks(lockUser, challengerId, opponent.id, async () => {
    const out = runBattle({ trainerData, challengerId, defenderId: opponent.id, mode, seed });
    // Save before the replay starts, so a crash mid-animation can't lose results.
    if (out.ok) await enqueueSave(trainerData, { force: true });
    return out;
  });
  if (!outcome.ok) return interaction.editReply(refusal(outcome.reason, opponent.id));

  logEvent("battle", challengerId, {
    defenderId: opponent.id, mode, seed, winnerId: outcome.winnerId, turns: outcome.result.turns, surge: !!outcome.surge,
  });
  await interaction.editReply("⚔️ Your battle is starting below.");
  await playBattle(interaction.channel, outcome, displayNames(interaction, opponent));
}
