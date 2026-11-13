// ==========================================================
// tools/dev/mega-shop-preview.mjs — the dashboard Shop page with the REAL
// Mega shop handlers (services/megaApi.js) over one in-memory synthetic
// player. Mega rewards are ON for this process only (or OFF with "off").
// Nothing is saved anywhere. Never deploy this.
//
//   node tools/dev/mega-shop-preview.mjs [port] [on|off]
// ==========================================================

import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { createMegaHandlers } from "../../services/megaApi.js";
import { lockUser } from "../../utils/userLocks.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const [portArg = "5191", mode = "on"] = process.argv.slice(2);
const env = mode === "off" ? {} : { MEGA_EVOLUTION_ENABLED: "1", MEGA_REWARDS_ENABLED: "1", MEGA_BATTLES_ENABLED: "1" };
const ID = "100000000000000009";
const td = { [ID]: { id: ID, cc: 40000, tp: 4100, items: { evolution_stone: 2, mega_shard: 30, megastone_lucarionite: 1 }, pokemon: { 6: { normal: 1, shiny: 0 } }, weeklyPackClaimed: false } };
const mega = createMegaHandlers({ getTrainerData: () => td, lockUser, save: async () => ({ saved: true, note: "" }), getEnv: () => env });
const auth = () => true;

const app = express();
app.use("/public", express.static(path.join(ROOT, "public"), { etag: false, maxAge: 0 }));
app.get("/public/dashboardshop/", (_, res) => res.sendFile(path.join(ROOT, "public", "dashboardshop", "index.html")));
app.get("/api/user", (_, res) => res.json(td[ID]));
app.get("/api/mega/shop", (req, res) => { const r = mega.shop({ query: req.query, isAuthorized: auth }); res.status(r.status).json(r.body); });
app.post("/api/mega/shop/buy-shards", express.json(), async (req, res) => { const r = await mega.buyShards({ body: req.body, isAuthorized: auth }); res.status(r.status).json(r.body); });
app.post("/api/mega/shop/buy-stone", express.json(), async (req, res) => { const r = await mega.buyStone({ body: req.body, isAuthorized: auth }); res.status(r.status).json(r.body); });
app.listen(Number(portArg), "127.0.0.1", () => console.log(`shop preview (Mega rewards ${mode}): http://localhost:${portArg}/public/dashboardshop/?id=${ID}`));
