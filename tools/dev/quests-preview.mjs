// ==========================================================
// tools/dev/quests-preview.mjs: the Quests page over one synthetic player.
//
//   node tools/dev/quests-preview.mjs [port=5244]
//   then open http://localhost:5244/public/quests/?id=123456789012345678
//
// Real page, real handlers (services/questsApi.js) with QUESTS_ENABLED on
// for this process only, an in-memory player whose board has one task
// finished and one half done, and no Discord, saves or player data.
// ==========================================================

import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

process.env.QUESTS_ENABLED = "1";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { createQuestHandlers } = await import("../../services/questsApi.js");
const { ensureQuests, questProgress, TASKS } = await import("../../services/quests.js");
const { lockUser } = await import("../../utils/userLocks.js");
const { getAcquirablePokemon } = await import("../../utils/dataLoader.js");

const ID = "123456789012345678";
const td = { [ID]: { id: ID, cc: 12_345, tp: 5000, pokemon: {}, box: {}, pokedex: {} } };
const q = ensureQuests(td[ID], ID);
const kind = (t) => TASKS.find((d) => d.id === t.id);
questProgress(td[ID], ID, kind(q.tasks[0]).kind, kind(q.tasks[0]).target);
questProgress(td[ID], ID, kind(q.tasks[1]).kind, Math.max(1, Math.floor(kind(q.tasks[1]).target / 2)));
td[ID].quests.week.done = 11;

const h = createQuestHandlers({ getTrainerData: () => td, lockUser, save: async () => ({ saved: true, note: "" }), loadPool: getAcquirablePokemon });
const app = express();
app.use("/public", express.static(path.join(root, "public")));
app.get("/public/quests", (_q, res) => res.sendFile(path.join(root, "public", "quests", "index.html")));
app.get("/api/quests/status", (_q, res) => res.json({ enabled: true }));
app.get("/api/quests", async (req, res) => { const r = await h.view({ query: req.query, isAuthorized: () => true }); res.status(r.status).json(r.body); });
app.post("/api/quests/claim", express.json(), async (req, res) => { const r = await h.claim({ body: req.body, isAuthorized: () => true }); res.status(r.status).json(r.body); });
// Finish everything on the board (preview only), to try the chest and the weekly bonus.
app.post("/dev/finish", (_q, res) => {
  for (const t of td[ID].quests.tasks) questProgress(td[ID], ID, kind(t).kind, kind(t).target);
  td[ID].quests.week.done = Math.max(td[ID].quests.week.done, 14);
  res.json({ ok: true });
});
const port = Number(process.argv[2] || 5244);
app.listen(port, () => console.log(`Quests preview: http://localhost:${port}/public/quests/?id=${ID}`));
