// ==========================================================
// tests/gen69Display.test.js — every Gen 6–9 species works in battles,
// /inspectpokemon text, the battle renderer's sprite decoder and the
// /pokedex embed (stub Discord objects, synthetic player).
// ==========================================================

import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import { assertTrue, assertEqual, section, finish } from "./harness.js";

const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "gen69-display-"));
process.env.TRAINERDATA_DIR = dir;
delete process.env.POKEMON_GENERATIONS;

const DEX = JSON.parse(fs.readFileSync(new URL("../pokemonData.json", import.meta.url), "utf8"));
const NEW = Object.keys(DEX).map(Number).filter((n) => n >= 650);
const { simulateBattle } = await import("../utils/battle/sim.js");
const { loadSprite, spritePlayer, renderBattleFrame } = await import("../utils/battle/render.js");
const { battleInfo, infoLines } = await import("../commands/inspectpokemon.js");
const { default: pokedex } = await import("../commands/pokedex.js");
const G = await import("../config/generations.js");
const C = await import("../utils/speciesCatalog.js");
const enable = (list) => { G.setGenerationsForTesting(list); C.resetCatalogCachesForTesting(); };

section("Battles with every new species");
const side = (ids, level) => ({ members: ids.map((speciesId) => ({ speciesId, variant: "normal", level })) });
let battles = 0, failures = [];
for (let i = 0; i < NEW.length; i += 6) {
  const a = NEW.slice(i, i + 6), b = NEW.slice(Math.max(0, NEW.length - i - 6), NEW.length - i);
  try {
    const out = simulateBattle({ sides: [side(a, 50), side(b.length ? b : [25], 50)], seed: i + 1, surge: null });
    if (![0, 1].includes(out?.winner) || !(out.turns > 0) || !["knockout", "turnCap"].includes(out.endedBy)) failures.push(`${a.join(",")}: bad outcome`);
    battles++;
  } catch (e) { failures.push(`${a.join(",")}: ${e.message}`); }
}
assertEqual(failures, [], `${battles} full 6v6 simulations covering all 376 species complete`);
let mixed = true;
try { simulateBattle({ sides: [side([35, 282, 700, 468], 60), side([149, 445, 635, 887], 60)], seed: 7, surge: null }); } catch { mixed = false; }
assertTrue(mixed, "Fairy team vs Dragon team (old and new species) simulates");

section("/inspectpokemon for every new species");
let infoOk = true;
for (const n of NEW) {
  const header = infoLines({ ...DEX[n], id: n });
  const stats = battleInfo({ pokemon: { [n]: { normal: 1, shiny: 1 } }, training: {} }, n);
  if (!header.includes(DEX[n].tier.toUpperCase()) || !/HP \d+ · Atk \d+/.test(stats)) { infoOk = false; break; }
}
assertTrue(infoOk, "rarity, types and battle stats render for all 376");
assertTrue(infoLines({ ...DEX[700], id: 700 }).includes("Fairy"), "Sylveon shows the Fairy type");

section("Battle renderer decodes every new sprite");
let decoded = 0;
for (const n of NEW) {
  for (const folder of ["normal", "shiny"]) {
    const s = await loadSprite(folder, n);
    if (s && s.width > 0 && spritePlayer(s)(0)) decoded++;
  }
}
assertEqual(decoded, 752, "752 sprites (376 × normal/shiny) decode and play");
const frame = await renderBattleFrame({
  sides: [{ name: "A", members: [{ speciesId: 906, variant: "normal", level: 5, hp: 20, maxHp: 20, name: "Sprigatito" }] }, { name: "B", members: [{ speciesId: 700, variant: "shiny", level: 5, hp: 20, maxHp: 20, name: "Sylveon" }] }],
  hpBefore: [[20], [20]],
  sprites: new Map([["normal:906", await loadSprite("normal", 906)], ["shiny:700", await loadSprite("shiny", 700)]]),
}).catch((e) => e);
assertTrue(!(frame instanceof Error), `a battle frame with a static Gen 9 and an animated Gen 6 sprite renders${frame instanceof Error ? `: ${frame.message}` : ""}`);

section("/pokedex embed");
async function lookup(name, owner = {}) {
  let sent = null;
  const interaction = {
    user: { id: "P1", username: "player" },
    options: { getString: () => name },
    async deferReply() {}, async editReply(o) { sent = o; return { createMessageComponentCollector: () => ({ on() {} }) }; },
    async reply(o) { sent = o; }, async followUp(o) { sent = o; }, async fetchReply() { return { createMessageComponentCollector: () => ({ on() {} }) }; },
    deferred: true, replied: false,
  };
  const td = { P1: { id: "P1", pokemon: owner, tp: 0, cc: 0, trainers: [], items: {} } };
  await pokedex.execute(interaction, td, async () => {}, async () => {}, async (_id, fn) => fn(), async () => {}, null);
  return sent;
}
const hidden = await lookup("Sylveon");
assertTrue(/isn't in the Pokédex yet/.test(hidden?.content ?? ""), "unreleased species: not shown to players who don't own it");
enable([6]);
const shown = await lookup("sylveon");
// /pokedex now sends a rendered entry card (utils/render/pokedexCard.js) with
// the sprite drawn in from local files and the credit printed on the card.
const { pokedexView } = await import("../utils/render/pokedexCard.js");
assertTrue(/^pokedex-[a-z0-9]+\.(gif|png)$/.test(shown?.files?.[0]?.name ?? "") && !(shown?.embeds?.length), "released: the Sylveon entry card is sent");
const card = shown.files[0].attachment;
assertTrue((card.subarray(0, 3).toString() === "GIF" ? card.readUInt16LE(6) : card.readUInt32BE(16)) === 1000, "the sprite is drawn into the card, not hot-linked");
const credit = pokedexView(700, {}).credit ?? "";
assertTrue(/Smogon X\/Y Sprite Project/.test(credit) && /\/credits/.test(credit), "the card credits the sprite project");
enable(null);
const owned = await lookup("Flabébé", { 669: { normal: 1, shiny: 0 } });
assertTrue((owned?.files?.length ?? owned?.embeds?.length ?? 0) > 0, "an owner can still look up a species from a disabled generation");

await fsp.rm(dir, { recursive: true, force: true });
finish();
