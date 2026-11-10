// ==========================================================
// tools/dev/mega-dashboard-preview.mjs — LOCAL preview of the Pokémon
// dashboard with Mega Evolution switched on, for visual checks only.
//
// Serves the real public/ files and the REAL Mega handlers
// (services/megaApi.js, services/megaTeam.js) over ONE synthetic player held
// in memory. No Discord login, no player data, nothing written to disk
// (saves are no-ops). Never deploy or import this from the bot.
//
// Run: node tools/dev/mega-dashboard-preview.mjs [port]
// Open: http://localhost:<port>/public/picker-pokemon?id=100000000000000001
// ==========================================================

import express from "express";
import path from "path";
import { fileURLToPath } from "url";

// Flags for THIS process only (the preview never runs in production).
process.env.MEGA_EVOLUTION_ENABLED = "1";
process.env.TRAINERDATA_DIR ??= path.join(process.env.TEMP || "/tmp", "mega-preview-no-writes");

const { createMegaHandlers } = await import("../../services/megaApi.js");
const { prepareTeamSelection, normalizeDisplayedTeam } = await import("../../services/megaTeam.js");
const { normalizeMegaUnlocks } = await import("../../services/megaUnlocks.js");
const { levelsForUser } = await import("../../utils/training.js");
const { liveGenerations } = await import("../../utils/speciesCatalog.js");
const { MAX_DEX } = await import("../../config/generations.js");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ID = "100000000000000001";
const user = {
  id: ID, name: "Preview Trainer", cc: 25000, tp: 30000,
  pokemon: { 3: { normal: 1, shiny: 0 }, 6: { normal: 2, shiny: 1 }, 25: { normal: 3, shiny: 0 }, 94: { normal: 1, shiny: 0 }, 150: { normal: 1, shiny: 0 }, 248: { normal: 1, shiny: 0 }, 384: { normal: 1, shiny: 0 }, 445: { normal: 1, shiny: 0 } },
  training: { "6:normal": { exp: 125000 }, "6:shiny": { exp: 64000 }, "150:normal": { exp: 343000 } },
  items: { evolution_stone: 3, shiny_dust: 40, megastone_charizarditey: 1, megastone_mewtwonitex: 1, megastone_mewtwonitey: 1, megastone_gengarite: 2 },
  displayedPokemon: [{ id: 6, variant: "normal" }, { id: 25, variant: "normal" }, { id: 150, variant: "normal" }],
  megaUnlocks: {
    "6:normal": { forms: { "mega-charizard-x": { at: Date.now(), stone: "megastone_charizarditex" } }, preferred: "mega-charizard-x" },
    "248:shiny": { forms: { "mega-tyranitar": { at: Date.now(), stone: "megastone_tyranitarite" } }, preferred: null }, // dormant: no shiny Tyranitar owned
  },
};
const trainerData = { [ID]: user };
normalizeMegaUnlocks(user);
normalizeDisplayedTeam(user);

const lockQueue = new Map();
const lockUser = (id, fn) => {
  const prev = lockQueue.get(id) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  lockQueue.set(id, next.catch(() => {}));
  return next;
};
const save = async () => ({ saved: true, note: "" });
const mega = createMegaHandlers({ getTrainerData: () => trainerData, lockUser, save });
const ok = () => true;

const app = express();
app.use("/public", express.static(path.join(ROOT, "public")));
app.get("/public/picker-pokemon", (_, res) => res.sendFile(path.join(ROOT, "public", "picker-pokemon", "index.html")));
app.get("/api/pokedex-status", (_, res) => res.json({ liveGenerations: liveGenerations(), maxDex: MAX_DEX }));
app.get("/api/user-pokemon", (_, res) => {
  normalizeDisplayedTeam(user);
  res.json({ id: ID, cc: user.cc, tp: user.tp, rank: "Elite Trainer", items: user.items, pokemon: user.pokemon, currentTeam: user.displayedPokemon, levels: levelsForUser(user), nonShinyDustEarnedThisWeek: 0 });
});
app.post("/api/set-pokemon-team", express.json(), (req, res) => {
  normalizeDisplayedTeam(user);
  const r = prepareTeamSelection(user, req.body?.team);
  if (!r.ok) return res.status(r.status).json({ success: false, error: r.error });
  user.displayedPokemon = r.team;
  res.json({ success: true, saved: true, currentTeam: user.displayedPokemon });
});
app.get("/api/mega", (req, res) => { const r = mega.view({ query: req.query, isAuthorized: ok }); res.status(r.status).json(r.body); });
app.post("/api/mega/unlock", express.json(), async (req, res) => { const r = await mega.unlock({ body: req.body, isAuthorized: ok }); res.status(r.status).json(r.body); });
app.post("/api/mega/preferred", express.json(), async (req, res) => { const r = await mega.preferred({ body: req.body, isAuthorized: ok }); res.status(r.status).json(r.body); });
app.get("/__state", (_, res) => res.json({ megaUnlocks: user.megaUnlocks, items: user.items, team: user.displayedPokemon }));

const port = Number(process.argv[2] || 5179);
app.listen(port, "127.0.0.1", () => console.log(`Mega dashboard preview: http://localhost:${port}/public/picker-pokemon?id=${ID}`));
