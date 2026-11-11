// ==========================================================
// tools/dev/tm-shop-preview.mjs — serves this checkout's Shop page over one
// synthetic player with the TM shop switched ON, using the real
// services/tmShop.js (listing, prices, purchase rules, request-id replay).
// In memory only; nothing is saved. Never deploy this.
//
//   node tools/dev/tm-shop-preview.mjs <checkoutRoot> <port>
// ==========================================================

import express from "express";
import path from "path";
import { pathToFileURL } from "url";

const [rootArg, portArg = "5191"] = process.argv.slice(2);
const ROOT = path.resolve(rootArg);
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);
const { tmShopView, buyTms } = await imp("services/tmShop.js");
const { runInventoryTransaction } = await imp("services/inventory.js");

const ID = "100000000000000009";
const env = { TM_ENABLED: "1" };
const trainerData = {
  [ID]: {
    id: ID, cc: 26000, tp: 4100, rank: "Advanced Trainer",
    items: { evolution_stone: 2, shiny_dust: 10, tm_thunderbolt: 1 },
    pokemon: { 6: { normal: 2, shiny: 0 }, 25: { normal: 1, shiny: 1 }, 133: { normal: 3, shiny: 0 }, 700: { normal: 1, shiny: 0 } },
    displayedPokemon: [{ id: 6, variant: "normal" }],
    weeklyPackClaimed: false,
  },
};

const app = express();
app.use("/public", express.static(path.join(ROOT, "public"), { etag: false, maxAge: 0 }));
app.get("/public/dashboardshop", (_, res) => res.sendFile(path.join(ROOT, "public", "dashboardshop", "index.html")));
app.get("/api/user", (_, res) => res.json(trainerData[ID]));
app.get("/api/tms", (_, res) => res.json(tmShopView(trainerData[ID], { env })));
app.post("/api/shop/buy-tm", express.json(), async (req, res) => {
  const { item, qty = 1, requestId = null } = req.body || {};
  const tx = await runInventoryTransaction({
    trainerData, userId: ID, lock: (_id, fn) => fn(), save: async () => ({ saved: true, note: "" }),
    requestId, payloadKey: `buy-tm:${item}:${Number(qty)}`,
    mutate: (u) => buyTms(u, { item, qty: Number(qty) }, { env }),
  });
  if (!tx.ok) { const { ok, status = 400, ...rest } = tx; return res.status(status).json({ success: false, ...rest }); }
  const { ok, ...result } = tx.result;
  return res.json({ saved: true, success: true, replayed: !!tx.replayed, ...result });
});
app.listen(Number(portArg), "127.0.0.1", () => console.log(`shop (${path.basename(ROOT)}): http://localhost:${portArg}/public/dashboardshop?id=${ID}`));
