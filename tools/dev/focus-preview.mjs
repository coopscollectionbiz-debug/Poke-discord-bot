// ==========================================================
// tools/dev/focus-preview.mjs: the Shop page with Focus type on, over one
// synthetic player.
//
//   node tools/dev/focus-preview.mjs [port=5246]
//   then open http://localhost:5246/public/dashboardshop/?id=123456789012345678
//
// Real page, real Poké Ball handler (services/gameplay.js) with
// FOCUS_TYPE_ENABLED on for this process only; an in-memory player with
// 200,000 CC; no Discord, saves or player data. Other Shop sections answer
// "off" (TMs, held items, Mega).
// ==========================================================

import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

process.env.FOCUS_TYPE_ENABLED = "1";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { createGameplayHandlers, focusTypeEnabled, focusSurcharge, BALL_COST } = await import("../../services/gameplay.js");
const { lockUser } = await import("../../utils/userLocks.js");
const { createNewUser } = await import("../../utils/userSchema.js");

const ID = "123456789012345678";
const u = createNewUser(ID, "Preview");
u.cc = 200_000; u.tp = 25_000;
const td = { [ID]: u };
const h = createGameplayHandlers({ getTrainerData: () => td, lockUser, save: async () => ({ saved: true, note: "" }), normalizeUserSchema: (_id, x) => x });

const app = express();
app.use("/public", express.static(path.join(root, "public")));
app.get("/public/dashboardshop", (_q, res) => res.sendFile(path.join(root, "public", "dashboardshop", "index.html")));
app.get("/api/user", (_q, res) => res.json({ ...u, weeklyPackClaimed: true }));
app.get("/api/live-events", (_q, res) => res.json({ ok: true, running: [], upcoming: [], discounts: {}, paidChoice: null, catchEvents: [] }));
app.get("/api/focus-type", (_q, res) => res.json({ enabled: focusTypeEnabled(), surcharge: Object.fromEntries(Object.keys(BALL_COST).map((b) => [b, focusSurcharge(b)])) }));
app.post("/api/rewardPokemon", express.json(), async (req, res) => { const r = await h.rewardPokemon({ body: req.body, isAuthorized: () => true }); res.status(r.status).json(r.body); });
for (const p of ["/api/tm-shop", "/api/held-items", "/api/mega"]) app.get(p, (_q, res) => res.json({ success: true, enabled: false }));
const port = Number(process.argv[2] || 5246);
app.listen(port, () => console.log(`Focus preview: http://localhost:${port}/public/dashboardshop/?id=${ID}`));
