// ==========================================================
// /luck: old name. The random-reward luck meter is now a row on the private
// /trainercard (three-teams split); kept as an alias for about two weeks.
// It opens your trainer card, which shows it.
// ==========================================================

import { SlashCommandBuilder } from "discord.js";
import trainercard from "./trainercard.js";

export default {
  data: new SlashCommandBuilder()
    .setName("luck")
    .setDescription("Old name: your luck meter is on /trainercard now."),
  execute: (...args) => trainercard.execute(...args),
};
