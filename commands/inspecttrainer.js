// ==========================================================
// 👀 /inspecttrainer — view details for owned trainer sprite
// ==========================================================
import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import trainerSprites from "../trainerSprites.json" assert { type: "json" };

export default {
  data: new SlashCommandBuilder()
    .setName("inspecttrainer")
    .setDescription("Inspect a trainer sprite you own.")
    .addStringOption(o =>
      o.setName("filename").setDescription("Trainer filename (e.g. lass-gen4.png)").setRequired(true)
    ),

  async execute(interaction, trainerData) {
    const file = interaction.options.getString("filename", true);
    const user = trainerData[interaction.user.id];
    if (!user?.trainers?.[file])
      return interaction.reply({ content: `❌ You don’t own **${file}**.`, flags: 64 });

    const meta = trainerSprites[file] || {};
    const count = user.trainers[file];
    const active = user.trainer === file;

    const embed = new EmbedBuilder()
      .setColor(0xff9900)
      .setTitle(meta.name || file)
      .setDescription(
        `Rarity: ${meta.rarity ?? "unknown"}\nOwned ×${count}${active ? " • ✅ Active" : ""}`
      )
      .setImage(`https://poke-discord-bot.onrender.com/public/sprites/trainers_2/${file}`)
      .setFooter({ text: "Use /showtrainers to browse all owned sprites." });

    await interaction.reply({ embeds: [embed], flags: 64 });
  }
};
