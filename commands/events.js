// ==========================================================
// /events — what Live events are on and coming up, and the player's
// "Use Live event" choice for Poké Balls and /recruit while a Catch boost
// or Catch limit runs (docs/design/live-events.md).
// ==========================================================

import { SlashCommandBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } from "discord.js";
import { eventsEmbed, playerView } from "../services/liveEventsPlayer.js";
import { setOptIn } from "../services/liveEvents.js";
import { lockUser } from "../utils/userLocks.js";
import { saveAndAck } from "../utils/saveManager.js";
import { safeReply } from "../utils/safeReply.js";

const TOGGLE = "live_events_paid";

const buttons = (choice) =>
  choice
    ? [new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(TOGGLE)
          .setLabel(choice.on ? "Stop using it for Poké Balls and /recruit" : "Use it for Poké Balls and /recruit")
          .setStyle(choice.on ? ButtonStyle.Secondary : ButtonStyle.Primary),
      )]
    : [];

export default {
  data: new SlashCommandBuilder()
    .setName("events")
    .setDescription("See the Live events that are on now and coming up"),

  async execute(interaction, trainerData) {
    const id = interaction.user.id;
    const user = trainerData[id] ?? {};
    const reply = () => ({ embeds: [eventsEmbed(user)], components: buttons(playerView(user).paidChoice) });
    await safeReply(interaction, { ...reply(), flags: MessageFlags.Ephemeral });
    if (!trainerData[id]) return; // no record yet: nothing to choose

    const msg = await interaction.fetchReply().catch(() => null);
    const collector = msg?.createMessageComponentCollector?.({
      componentType: ComponentType.Button,
      time: 120_000,
      filter: (b) => b.user.id === id && b.customId === TOGGLE,
    });
    collector?.on("collect", async (b) => {
      const choice = playerView(trainerData[id]).paidChoice;
      if (!choice) return b.update({ embeds: [eventsEmbed(trainerData[id])], components: [] });
      await lockUser(id, () => setOptIn(trainerData[id], !choice.on));
      const ack = await saveAndAck(trainerData);
      await b.update({ ...reply(), content: ack?.note || undefined });
    });
    collector?.on("end", () => interaction.editReply({ components: [] }).catch(() => {}));
  },
};
