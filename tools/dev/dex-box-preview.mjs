// ==========================================================
// tools/dev/dex-box-preview.mjs: serves this checkout's Collection (box),
// Pokédex and Overview pages over one synthetic player built with the real
// services (services/box.js), so copies, the Pokédex and Feed behave as in
// the bot. In memory only; nothing is saved. Never deploy this.
//
//   node tools/dev/dex-box-preview.mjs <port>
// ==========================================================

import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { normalizeBox, allCopies, slotsHolding, mergeDex, feedCopy, canFeed } from "../../services/box.js";
import { levelsForUser, expForLevel } from "../../utils/training.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PORT = Number(process.argv[2] ?? 5200);
const ID = "100000000000000009";

// Legacy-shaped player, migrated on start exactly like a live one at boot.
const user = {
  id: ID, cc: 5200, tp: 4100,
  items: { evolution_stone: 4, shiny_dust: 40 },
  pokemon: { 1: { normal: 1, shiny: 0 }, 4: { normal: 3, shiny: 0 }, 16: { normal: 5, shiny: 1 }, 25: { normal: 2, shiny: 1 }, 133: { normal: 3, shiny: 0 }, 150: { normal: 1, shiny: 0 } },
  training: { "4:normal": { exp: expForLevel(34) }, "16:normal": { exp: expForLevel(28) }, "16:shiny": { exp: expForLevel(9) }, "25:normal": { exp: expForLevel(22) }, "25:shiny": { exp: expForLevel(40) }, "133:normal": { exp: expForLevel(15) }, "150:normal": { exp: expForLevel(70) } },
  displayedPokemon: [{ id: 4, variant: "normal" }, { id: 25, variant: "shiny" }, { id: 150, variant: "normal" }],
  battleTeam: [{ id: 16, variant: "normal" }, { id: 4, variant: "normal" }],
  nonShinyDustEarnedThisWeek: 0,
};
let seed = 3;
normalizeBox(user, { rand: () => ((seed = (seed * 9301 + 49297) % 233280) / 233280) });
// Backfill stand-in: species caught before and since donated/evolved away.
mergeDex(user, { 2: 1, 7: 1, 10: 3, 19: 1, 35: 1, 129: 1, 147: 1 });

const TEAM_BIT = { displayedPokemon: 1, battleTeam: 2, showcaseTeam: 4 };
const payload = () => {
  const levels = levelsForUser(user);
  return {
    id: ID, cc: user.cc, tp: user.tp, rank: "Advanced Trainer", items: user.items,
    pokemon: user.pokemon, currentTeam: user.displayedPokemon, battleTeam: user.battleTeam,
    levels, powers: {}, trained: {}, pokedex: user.pokedex ?? {},
    copies: allCopies(user).map((c) => [c.uid, c.id, c.variant === "shiny" ? 1 : 0, c.level, c.at ?? 0, c.trained ? 1 : 0, slotsHolding(user, c.uid).reduce((m, s) => m | (TEAM_BIT[s.field] ?? 0), 0)]),
    ranked: { wins: 0, losses: 0, rating: 1000, position: null, players: 1, streak: 0 },
    casual: { wins: 0, losses: 0, streak: 0, bestStreak: 0 }, challenge: { badges: [] },
    nonShinyDustEarnedThisWeek: 0, notices: [],
  };
};

const app = express();
app.use(express.json());
app.use("/public", express.static(path.join(ROOT, "public"), { etag: false, maxAge: 0 }));
for (const page of ["picker-pokemon", "pokedex", "overview"]) {
  app.get(`/public/${page}`, (_, res) => res.sendFile(path.join(ROOT, "public", page, "index.html")));
}
app.get("/api/pokedex-status", (_, res) => res.json({ liveGenerations: [1, 2, 3, 4, 5], maxDex: 649 }));
app.get("/api/user-pokemon", (_, res) => res.json(payload()));
app.get("/api/user", (_, res) => res.json({ id: ID, name: "Preview", tp: user.tp, rank: "Advanced Trainer", cc: user.cc }));
app.get("/api/achievements", (_, res) => res.json({ claimable: 0, achievements: [] }));
app.get("/api/mega", (_, res) => res.json({ success: true, enabled: false }));
app.post("/api/pokemon/feed", (req, res) => {
  const { from, to, rev } = req.body ?? {};
  const can = canFeed(user, { from, to, confirmRev: rev });
  if (!can.ok) return res.status(400).json({ success: false, error: can.error, code: can.code });
  const species = user.box[to].id;
  const r = feedCopy(user, { from, to, confirmRev: rev });
  res.json({ success: true, fed: { speciesId: species, to, gained: r.gained, fromLevel: r.fromLevel, toLevel: r.toLevel } });
});
app.listen(PORT, "127.0.0.1", () => console.log(`dex/box preview: http://localhost:${PORT}/public/picker-pokemon?id=${ID}`));
