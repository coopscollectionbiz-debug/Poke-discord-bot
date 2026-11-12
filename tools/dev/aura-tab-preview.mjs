// ==========================================================
// tools/dev/aura-tab-preview.mjs — serves a checkout's Trainers page with
// the Auras tab over one in-memory player, using the REAL services/auras.js
// (equip and buy change memory only; nothing is saved). Art comes from
// tests/fixtures/auras unless AURA_ART_DIR is set. Never deploy this.
//
//   node tools/dev/aura-tab-preview.mjs <checkoutRoot> <port>
// ==========================================================

import express from "express";
import path from "path";
import { pathToFileURL } from "url";

const [rootArg, portArg = "5197"] = process.argv.slice(2);
const ROOT = path.resolve(rootArg);
process.env.AURA_ART_DIR ??= path.join(ROOT, "tests", "fixtures", "auras");
const A = await import(pathToFileURL(path.join(ROOT, "services", "auras.js")).href);
const { trainerTier } = await import(pathToFileURL(path.join(ROOT, "utils", "render", "trainerTier.js")).href);

const ID = "100000000000000009";
const user = {
  cc: 60_000, trainers: ["alain.png", "acerola.png", "cynthia-masters.png"], displayedTrainer: "alain.png",
  challenge: { won: { brock: 1, blaine: 1 } }, ach: { col_region_kanto_full: 1 },
};
A.syncTierAuras(user);

const app = express();
app.use(express.json());
app.use("/public", express.static(path.join(ROOT, "public"), { etag: false, maxAge: 0 }));
app.use("/auras-art", express.static(A.auraArtDir(), { index: false }));
app.get("/public/picker", (_, res) => res.sendFile(path.join(ROOT, "public", "picker", "index.html")));
app.get("/api/user-trainers", (_, res) => res.json({ owned: user.trainers, cc: user.cc, equipped: user.displayedTrainer }));
app.get("/api/auras", (_, res) => res.json({ ...A.auraView(user), trainer: user.displayedTrainer, autoTier: trainerTier(user.displayedTrainer) }));
app.post("/api/auras/equip", (req, res) => {
  const r = A.equipAura(user, req.body.aura);
  return r.ok ? res.json({ success: true, equipped: r.equipped }) : res.status(r.status).json({ success: false, error: r.error });
});
app.post("/api/shop/buy-aura", (req, res) => {
  const r = A.buyAura(user, req.body.aura);
  if (!r.ok) return res.status(r.status).json({ success: false, error: r.error });
  const { ok, ...rest } = r;
  return res.json({ success: true, ...rest });
});
app.listen(Number(portArg), "127.0.0.1", () => console.log(`Auras tab: http://localhost:${portArg}/public/picker?id=${ID}&tab=auras`));
