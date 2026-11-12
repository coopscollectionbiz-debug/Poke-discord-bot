// ==========================================================
// /rankedcard: a player's Ranked team, Ranked rating and record as a card.
// Your own posts publicly; user:@someone answers privately. The card and
// its logic live in commands/showbattlecard.js (the old name, kept as an
// alias for about two weeks after the three-teams split).
// ==========================================================

import { SlashCommandBuilder } from "discord.js";
import { execute } from "./showbattlecard.js";

export const data = new SlashCommandBuilder()
  .setName("rankedcard")
  .setDescription("Show your Ranked card: Ranked team, rating, record and leaderboard position")
  .addUserOption((o) => o.setName("user").setDescription("See another player's Ranked card (only you see it)").setRequired(false));

export { execute };
