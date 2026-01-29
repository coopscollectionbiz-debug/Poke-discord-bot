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

// ---- local helpers (keep showteam self-contained) ----
function normVariant(v) {
  return String(v || "normal").toLowerCase() === "shiny" ? "shiny" : "normal";
}
function toTeamObj(entry) {
  if (typeof entry === "number") return { id: entry, variant: "normal" };
  if (typeof entry === "string") {
    const n = Number(entry);
    return Number.isInteger(n) ? { id: n, variant: "normal" } : null;
  }
  if (entry && typeof entry === "object") {
    const pid = Number(entry.id);
    if (!Number.isInteger(pid)) return null;
    return { id: pid, variant: normVariant(entry.variant) };
  }
  return null;
}
function ensureTrailingSlash(s) {
  return String(s || "").endsWith("/") ? String(s || "") : `${String(s || "")}/`;
}
function ensureSpriteBase(base, folderName) {
  // If base already includes "/normal/" or "/shiny/", keep it.
  // Otherwise append folderName + "/"
  const b = ensureTrailingSlash(base);
  if (b.toLowerCase().includes(`/${folderName.toLowerCase()}/`)) return b;
  return `${b}${folderName}/`;
}

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
    await interaction.deferReply(); // public

    const user = await ensureUserInitialized(
      interaction.user.id,
      interaction.user.username,
      trainerData,
      client
    );

    const allPokemon = await getAllPokemon();

    // ✅ Variant-safe: displayedPokemon is canonical
    const displayedRaw = Array.isArray(user.displayedPokemon) ? user.displayedPokemon : [];
    const displayed = displayedRaw.map(toTeamObj).filter(Boolean).slice(0, 6);

    // fallback: first 6 owned NORMAL (variant-safe + deterministic)
    const fallback = Object.keys(user.pokemon || {})
      .map((k) => Number(k))
      .filter(Number.isInteger)
      .slice(0, 6)
      .map((id) => ({ id, variant: "normal" }));

    const teamSlots = displayed.length ? displayed : fallback;

    // sprite bases (handles either ".../pokemon/" or ".../pokemon/normal/")
    const normalBase = ensureSpriteBase(spritePaths.pokemon, "normal");
    const shinyBase = ensureSpriteBase(spritePaths.shiny, "shiny");

    const team = teamSlots
      .map((slot) => {
        const p = allPokemon.find((x) => x.id === Number(slot.id));
        if (!p) return null;

        return {
          id: p.id,
          name: p.name,
          tier: (p.tier || p.rarity || "common"),
          isShiny: slot.variant === "shiny",
          spriteUrl:
            slot.variant === "shiny"
              ? `${shinyBase}${p.id}.gif`
              : `${normalBase}${p.id}.gif`,
        };
      })
      .filter(Boolean);

    const trainerFile = user.displayedTrainer || "";
    const trainerSpriteUrl = trainerFile ? `${spritePaths.trainers}${trainerFile}` : "";

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
