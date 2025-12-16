// commands/showfullteamcard.js
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

// Load trainer sprite JSON once
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const trainerSpritesPath = path.join(__dirname, "../trainerSprites.json");
const trainerSprites = JSON.parse(fs.readFileSync(trainerSpritesPath, "utf-8"));
const spriteToTrainerMap = buildSpriteToTrainerMap(trainerSprites);

export default {
  data: new SlashCommandBuilder()
    .setName("teamcard")
    .setDescription("Show your trainer + full team as a canvas card.")
    .addUserOption(opt =>
      opt.setName("user").setDescription("Show another user's card (optional)").setRequired(false)
    ),

  async execute(interaction, trainerData, _saveTrainerDataLocal, _saveDataToDiscord, client) {
    await interaction.deferReply({ ephemeral: true });

    const target = interaction.options.getUser("user") || interaction.user;

    const user = await ensureUserInitialized(
      target.id,
      target.username,
      trainerData,
      client
    );

    const allPokemon = await getAllPokemon();

    // Team ids: prefer displayedPokemon, else first 6 owned
    const displayed = Array.isArray(user.displayedPokemon) ? user.displayedPokemon.slice(0, 6) : [];
    const teamIds = displayed.length
      ? displayed
      : Object.keys(user.pokemon || {}).map(Number).slice(0, 6);

    // IMPORTANT: match your actual sprite path convention.
    // Your starter embed uses `${spritePaths.pokemon}normal/${id}.gif`
    const team = teamIds
      .map(id => {
        const p = allPokemon.find(x => x.id === Number(id));
        if (!p) return null;

        return {
          id: p.id,
          name: p.name,
          tier: (p.tier || p.rarity || "common"),
          spriteUrl: `${spritePaths.pokemon}normal/${p.id}.gif`,
        };
      })
      .filter(Boolean);

    // Trainer sprite
    const trainerFile = user.displayedTrainer || null;
    const trainerSpriteUrl = trainerFile ? `${spritePaths.trainers}${trainerFile}` : "";

    const displayName =
      interaction.guild?.members?.cache?.get(target.id)?.displayName ||
      target.username;

    const avatarUrl = target.displayAvatarURL({ extension: "png", size: 256 });

    const png = await renderTrainerCardCanvas({
      displayName,
      avatarUrl,
      trainerSpriteUrl,
      trainerSpriteFileName: trainerFile || "",
      spriteToTrainerMap,
      team,
    });

    const attachment = new AttachmentBuilder(png, { name: "teamcard.png" });
    return interaction.editReply({ files: [attachment] });
  },
};
