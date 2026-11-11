// ==========================================================
// tools/dev/dashboard-static-preview.mjs — serves ANY checkout's Pokémon
// dashboard page over one synthetic player, with Mega Evolution reported
// OFF (GET /api/mega → { enabled: false }, the production answer). Used by
// the M3 no-Mega gate to compare master's page with this branch's in a
// browser. Read-only stubs; nothing is saved. Never deploy this.
//
//   node tools/dev/dashboard-static-preview.mjs <checkoutRoot> <port>
// ==========================================================

import express from "express";
import path from "path";

const [rootArg, portArg = "5190"] = process.argv.slice(2);
const ROOT = path.resolve(rootArg);
const ID = "100000000000000009";
const team = [{ id: 6, variant: "normal" }, { id: 25, variant: "shiny" }, { id: 150, variant: "normal" }];
const user = {
  id: ID, cc: 1200, tp: 4100, rank: "Advanced Trainer",
  items: { evolution_stone: 2, shiny_dust: 10 },
  pokemon: { 1: { normal: 1, shiny: 0 }, 6: { normal: 2, shiny: 0 }, 25: { normal: 1, shiny: 1 }, 133: { normal: 3, shiny: 0 }, 150: { normal: 1, shiny: 0 } },
  currentTeam: team,
  levels: { "6:normal": 55, "25:shiny": 40, "150:normal": 70, "1:normal": 5, "133:normal": 12, "25:normal": 9 },
  nonShinyDustEarnedThisWeek: 0,
};

const app = express();
app.use("/public", express.static(path.join(ROOT, "public"), { etag: false, maxAge: 0 }));
app.get("/public/picker-pokemon", (_, res) => res.sendFile(path.join(ROOT, "public", "picker-pokemon", "index.html")));
app.get("/api/pokedex-status", (_, res) => res.json({ liveGenerations: [1, 2, 3, 4, 5], maxDex: 649 }));
app.get("/api/user-pokemon", (_, res) => res.json(user));
app.get("/api/mega", (_, res) => res.json({ success: true, enabled: false }));
app.listen(Number(portArg), "127.0.0.1", () => console.log(`dashboard (${path.basename(ROOT)}): http://localhost:${portArg}/public/picker-pokemon?id=${ID}`));
