import { SlashCommandBuilder, EmbedBuilder } from "discord.js";

const TRAINER_BASE_URL = "https://poke-discord-bot.onrender.com/public/sprites/trainers_2/";

export default {
  data: new SlashCommandBuilder()
    .setName("inspecttrainer")
    .setDescription("Inspect a trainer sprite by filename.")
    .addStringOption(opt =>
      opt.setName("filename")
        .setDescription("Trainer filename (e.g., 'lass-gen4.png')")
        .setRequired(true)
    ),

  async execute(interaction, trainerData) {
    await interaction.deferReply({ flags: 64 }); // ✅ Ephemeral

    const user = trainerData[interaction.user.id];
    const filename = interaction.options.getString("filename", true);

    if (!user?.trainers?.[filename]) {
      await interaction.editReply(`You don't own **${filename}**.`);
      return;
    }

    const count = user.trainers[filename];
    const url = `${TRAINER_BASE_URL}${filename}`;

    const embed = new EmbedBuilder()
      .setColor(0xff9900)
      .setTitle(`Trainer: ${filename}`)
      .setDescription(
        `Owned ×**${count}**${user.trainer === filename ? " • ✅ Active" : ""}`
      )
      .setImage(url)
      .setFooter({ text: "Use /showtrainers to browse all your sprites." });

    await interaction.editReply({ embeds: [embed] });
  },
};
