// ==========================================================
// tools/dev/held-items-preview.mjs — a LOCAL preview of the Teams page and
// Shop with held items switched on, over ONE synthetic player held in
// memory. Uses the real held-item handlers (services/heldItemsApi.js) and
// the real team validation; saves go nowhere. No Discord, no player data.
// Never deploy this.
//
//   node tools/dev/held-items-preview.mjs [port=5191]
// ==========================================================

import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { createHeldItemHandlers, createRateLimiter } from "../../services/heldItemsApi.js";
import { prepareTeamSelection } from "../../services/megaTeam.js";
import { prepareBattleTeamSelection } from "../../services/battleTeam.js";
import { reconcileTeamEquipment, equipmentRev } from "../../services/heldItems.js";
import { createNewUser } from "../../utils/userSchema.js";
import { lockUser } from "../../utils/userLocks.js";
import { levelsForUser } from "../../utils/training.js";
import { powersFromLevels } from "../../utils/battle/power.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const port = Number(process.argv[2] ?? 5191);
const ID = "100000000000000042";
const env = { HELD_ITEMS_ENABLED: "1", HELD_ITEMS_BATTLES_ENABLED: "1" };
const u = createNewUser(ID, "Preview Trainer");
u.cc = 24000;
for (const s of [6, 25, 143, 94, 1, 105, 248, 131, 9]) u.pokemon[s] = { normal: 1, shiny: s === 25 ? 1 : 0 };
u.displayedPokemon = [6, 25, 143, 94, 1, 105].map((id) => ({ id, variant: "normal" }));
u.battleTeam = [248, 143, 94, 131, 9].map((id) => ({ id, variant: "normal" }));
const td = { [ID]: u };
const api = createHeldItemHandlers({ getTrainerData: () => td, lockUser, save: async () => ({ saved: true, note: "" }), getEnv: () => env, allowWrite: createRateLimiter({ max: 1000 }) });
const ok = () => true;

const app = express();
app.use("/public", express.static(path.join(ROOT, "public"), { etag: false, maxAge: 0 }));
for (const page of ["teams", "dashboardshop"]) app.get(`/public/${page}`, (_, res) => res.sendFile(path.join(ROOT, "public", page, "index.html")));
app.get("/api/mega", (_, res) => res.json({ success: true, enabled: false }));
app.get("/api/user", (_, res) => res.json({ id: ID, cc: u.cc, tp: 4100, items: u.items, pokemon: u.pokemon, purchases: [] }));
app.get("/api/user-pokemon", (_, res) => {
  const levels = levelsForUser(u);
  res.json({ id: ID, cc: u.cc, items: u.items, pokemon: u.pokemon, currentTeam: u.displayedPokemon, battleTeam: u.battleTeam ?? null, levels, powers: powersFromLevels(levels), ranked: { rating: 1000, wins: 0, losses: 0, position: null, players: 0, streak: 0 }, casual: { wins: 0, losses: 0, streak: 0, bestStreak: 0 } });
});
app.post("/api/set-pokemon-team", express.json(), async (req, res) => {
  const { team, teamType = "display" } = req.body ?? {};
  const prepared = teamType === "battle" ? prepareBattleTeamSelection(u, team, { env }) : prepareTeamSelection(u, team, { env });
  if (!prepared.ok) return res.status(prepared.status).json({ success: false, error: prepared.error });
  if (teamType === "battle") u.battleTeam = prepared.team; else u.displayedPokemon = prepared.team;
  const itemsCleared = reconcileTeamEquipment(u, teamType);
  res.json({ success: true, saved: true, teamType, currentTeam: u.displayedPokemon, battleTeam: u.battleTeam, ...(itemsCleared.length ? { itemsCleared, equipmentRev: equipmentRev(u) } : {}) });
});
app.get("/api/held-items", (req, res) => { const { status, body } = api.view({ query: req.query, isAuthorized: ok }); res.status(status).json(body); });
for (const [route, fn] of [["claim-starter", api.claimStarter], ["equip", api.equip], ["buy", api.buy]]) {
  app.post(`/api/held-items/${route}`, express.json({ limit: "4kb" }), async (req, res) => { const { status, body } = await fn({ body: req.body ?? {}, isAuthorized: ok }); res.status(status).json(body); });
}
app.listen(port, "127.0.0.1", () => console.log(`held-items preview: http://localhost:${port}/public/teams?id=${ID}`));
