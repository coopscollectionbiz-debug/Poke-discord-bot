// commands/showteam.js
import { SlashCommandBuilder, AttachmentBuilder } from "discord.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { ensureUserInitialized } from "../utils/userInitializer.js";
import { getAllPokemon } from "../utils/dataLoader.js";
import { spritePaths } from "../spriteconfig.js";
import {
  buildSpriteToTrainerMap,
  renderTrainerCardCanvas,
} from "../utils/trainerCardCanvas.js";
import { getRank } from "../utils/rankSystem.js";

// Load trainer sprite JSON once
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const trainerSpritesPath = path.join(__dirname, "../trainerSprites.json");
const trainerSprites = JSON.parse(fs.readFileSync(trainerSpritesPath, "utf-8"));
const spriteToTrainerMap = buildSpriteToTrainerMap(trainerSprites);

export default {
  data: new SlashCommandBuilder()
    .setName("showteam")
    .setDescription("Show your trainer + full team as a canvas card."),

  async execute(interaction, trainerData, _saveTrainerDataLocal, _saveDataToDiscord, client) {
    // ✅ Public reply
    await interaction.deferReply();

    const user = await ensureUserInitialized(
      interaction.user.id,
      interaction.user.username,
      trainerData,
      client
    );

    const allPokemon = await getAllPokemon();

    // Team ids: prefer displayedPokemon, else first 6 owned
    const displayed = Array.isArray(user.displayedPokemon)
      ? user.displayedPokemon.slice(0, 6)
      : [];

    const teamIds = displayed.length
      ? displayed
      : Object.keys(user.pokemon || {}).map(Number).slice(0, 6);

    // Normalize sprite bases
    const normalBase = spritePaths.pokemon.includes("/normal/")
      ? spritePaths.pokemon
      : `${spritePaths.pokemon}normal/`;

    const shinyBase = spritePaths.shiny.includes("/shiny/")
      ? spritePaths.shiny
      : `${spritePaths.shiny}shiny/`;

    const team = teamIds
      .map(id => {
        const p = allPokemon.find(x => x.id === Number(id));
        if (!p) return null;

        const owned = user.pokemon?.[p.id];
        const isShiny = (owned?.shiny || 0) > 0;

        return {
          id: p.id,
          name: p.name,
          tier: (p.tier || p.rarity || "common"),
          isShiny,
          spriteUrl: isShiny
            ? `${shinyBase}${p.id}.gif`
            : `${normalBase}${p.id}.gif`,
        };
      })
      .filter(Boolean);

    // Trainer sprite
    const trainerFile = user.displayedTrainer || "";
    const trainerSpriteUrl = trainerFile
      ? `${spritePaths.trainers}${trainerFile}`
      : "";

    // Display name = member displayName if possible
    const member = interaction.guild
      ? await interaction.guild.members.fetch(interaction.user.id).catch(() => null)
      : null;

    const displayName = member?.displayName || interaction.user.username;

    const avatarUrl = interaction.user.displayAvatarURL({
      extension: "png",
      size: 256,
    });

    const png = await renderTrainerCardCanvas({
      displayName,
      avatarUrl,
      rankLabel: getRank(user.tp),
      tp: user.tp,
      trainerSpriteUrl,
      trainerSpriteFileName: trainerFile,
      spriteToTrainerMap,
      team,
    });

    const attachment = new AttachmentBuilder(png, { name: "teamcard.png" });
    return interaction.editReply({ files: [attachment] });
  },
};
