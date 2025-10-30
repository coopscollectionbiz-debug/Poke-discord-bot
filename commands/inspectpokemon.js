// ==========================================================
// 🔍 /inspectpokemon — view full Pokédex entry + shiny toggle
// ==========================================================
import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} from "discord.js";
import fs from "fs/promises";
import { spritePaths } from "../spriteconfig.js";
const pokemonData = JSON.parse(await fs.readFile(new URL("../pokemonData.json", import.meta.url)));

export default {
  data: new SlashCommandBuilder()
    .setName("inspectpokemon")
    .setDescription("Inspect a Pokémon by name.")
    .addStringOption(o => o.setName("name").setDescription("Pokémon name").setRequired(true)),

  async execute(interaction, trainerData) {
    const name = interaction.options.getString("name", true).toLowerCase();
    const user = trainerData[interaction.user.id] || { pokemon: {} };

    // find Pokémon by name
    const entry = Object.entries(pokemonData).find(([, p]) => p.name.toLowerCase() === name);
    if (!entry)
      return interaction.reply({ content: "❌ Pokémon not found.", flags: 64 });

    const [id, data] = entry;
    let shiny = false;

    // function to render the embed
    const makeEmbed = () => {
      const sprite = shiny
        ? `${spritePaths.shiny}${id}.gif`
        : `${spritePaths.pokemon}${id}.png`;
      const owned = user.pokemon[id];
      const ownedText = owned
        ? `✅ Owned ×${owned.normal + owned.shiny} (${owned.shiny} shiny)`
        : "❌ Not owned";

      return new EmbedBuilder()
        .setColor(shiny ? 0xffd700 : 0x0099ff)
        .setTitle(`${data.name} — ${data.rarity}`)
        .setDescription(
          `${data.entry}\n\nRegion: ${data.region}\nEvolves from: ${data.evolves_from ?? "—"}`
        )
        .setImage(sprite)
        .setFooter({ text: ownedText });
    };

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("toggle_shiny").setLabel("✨ Toggle Shiny").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId("close").setLabel("❌ Close").setStyle(ButtonStyle.Secondary)
    );

    await interaction.reply({ embeds: [makeEmbed()], components: [row], flags: 64 });

    const msg = await interaction.fetchReply();
    const collector = msg.createMessageComponentCollector({ time: 120000 });
    collector.on("collect", async i => {
      if (i.user.id !== interaction.user.id)
        return i.reply({ content: "Not your session.", flags: 64 });
      if (i.customId === "toggle_shiny") {
        shiny = !shiny;
        await i.update({ embeds: [makeEmbed()], components: [row] });
      } else if (i.customId === "close") {
        await i.update({ content: "Closed.", embeds: [], components: [] });
        collector.stop();
      }
    });
    collector.on("end", async () => { try { await msg.edit({ components: [] }); } catch {} });
  }
};
