// ==========================================================
// /inspecttrainer: look at one trainer sprite (three-teams split).
// Open to everyone, always private:
//   • user:@someone  the trainer that player has equipped
//   • name:<trainer> any trainer (autocomplete)
//   • neither        your own equipped trainer
// Shows the name, tier, sprite, whether you own it, and how many players own
// it. Browsing a whole collection moved to the dashboard Trainers page
// (/showtrainers is retired). Read-only.
// ==========================================================

import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from "discord.js";
import { trainerImageUrl } from "../utils/trainerAssets.js";
import { getFlattenedTrainers } from "../utils/dataLoader.js";
import { ownsTrainer } from "../services/assets.js";
import { safeReply } from "../utils/safeReply.js";
import { searchKey } from "../utils/pokemonSearch.js";

const TIER_COLOR = { common: 0x9ca3af, uncommon: 0x10b981, rare: 0x3b82f6, epic: 0xa855f7, legendary: 0xfacc15, mythic: 0xef4444 };
const pretty = (key) => String(key).replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const bare = (file) => String(file ?? "").toLowerCase().replace(/^.*[\\/]/, "").replace(/\.(png|gif)$/i, "");

/** The trainer group a sprite file belongs to, or null. */
export function groupOfSprite(groups, file) {
  const want = bare(file);
  return groups.find((g) => g.sprites.some((s) => bare(s) === want)) ?? null;
}

/** How many players own at least one sprite of this group. */
export function ownersOf(trainerData, group) {
  let n = 0;
  for (const user of Object.values(trainerData ?? {})) {
    if (user && group.sprites.some((s) => ownsTrainer(user, s))) n++;
  }
  return n;
}

export async function autocomplete(interaction) {
  const q = searchKey(interaction.options.getFocused() ?? "");
  const groups = await getFlattenedTrainers();
  const hits = groups
    .map((g) => ({ g, k: searchKey(g.id) }))
    .filter(({ k }) => !q || k.includes(q))
    .sort((a, b) => (b.k.startsWith(q) - a.k.startsWith(q)) || a.k.localeCompare(b.k))
    .slice(0, 25)
    .map(({ g }) => ({ name: `${pretty(g.id)} · ${String(g.tier).toLowerCase()}`.slice(0, 100), value: g.id }));
  await interaction.respond(hits);
}

export default {
  data: new SlashCommandBuilder()
    .setName("inspecttrainer")
    .setDescription("Look at a trainer: a player's equipped one, or any trainer by name.")
    .setDefaultMemberPermissions(null)
    .addUserOption((o) => o.setName("user").setDescription("Show the trainer this player has equipped").setRequired(false))
    .addStringOption((o) => o.setName("name").setDescription("Any trainer by name").setRequired(false).setAutocomplete(true)),
  autocomplete,

  async execute(interaction, trainerData) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const target = interaction.options.getUser("user");
    const name = interaction.options.getString("name");
    const me = trainerData[interaction.user.id];
    const groups = await getFlattenedTrainers();

    let group = null, sprite = null, heading = null;
    if (name) {
      const k = searchKey(name);
      group = groups.find((g) => searchKey(g.id) === k) ?? groups.find((g) => searchKey(g.id).startsWith(k)) ?? null;
      if (!group) return safeReply(interaction, { content: `No trainer is called “${name}”.`, flags: MessageFlags.Ephemeral });
      sprite = group.sprites[0];
      heading = pretty(group.id);
    } else {
      const who = target ?? interaction.user;
      const user = trainerData[who.id];
      if (!user) return safeReply(interaction, { content: `${who.username} hasn't started playing yet.`, flags: MessageFlags.Ephemeral });
      if (!user.displayedTrainer) return safeReply(interaction, { content: `${target ? `${who.username} has` : "You have"} no trainer equipped.`, flags: MessageFlags.Ephemeral });
      sprite = user.displayedTrainer;
      group = groupOfSprite(groups, sprite);
      heading = `Equipped by ${target ? who.username : "you"}`;
    }

    const tier = String(group?.tier ?? "common").toLowerCase();
    const youOwn = group ? group.sprites.some((s) => ownsTrainer(me, s)) : ownsTrainer(me, sprite);
    const embed = new EmbedBuilder()
      .setAuthor({ name: heading })
      .setTitle(pretty(group?.id ?? bare(sprite)))
      .setColor(TIER_COLOR[tier] ?? 0x5865f2)
      .addFields(
        { name: "Tier", value: tier.charAt(0).toUpperCase() + tier.slice(1), inline: true },
        { name: "You", value: youOwn ? "Owned" : "Not owned", inline: true },
        { name: "Owned by", value: group ? `${ownersOf(trainerData, group).toLocaleString("en-US")} players` : "—", inline: true },
      )
      .setImage(trainerImageUrl(sprite));
    return safeReply(interaction, { embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
