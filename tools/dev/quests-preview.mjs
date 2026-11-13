// ==========================================================
// tools/dev/quests-preview.mjs: the Quests page over one synthetic player.
//
//   node tools/dev/quests-preview.mjs [port=5244]
//   then open http://localhost:5244/public/quests/?id=123456789012345678
//
// Real page, real handlers (services/questsApi.js, services/expeditionsApi.js)
// with QUESTS_ENABLED and QUESTS_EXPEDITIONS_ENABLED on for this process
// only, an in-memory player (a small Collection with Casual and Ranked
// teams), and no Discord, saves or player data.
// Dev routes: POST /dev/finish (finish the Daily board), POST /dev/skip?h=12
// (move this server's clock forward, to bring Expeditions back).
// ==========================================================

import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

process.env.QUESTS_ENABLED = "1";
process.env.QUESTS_EXPEDITIONS_ENABLED = "1";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { createQuestHandlers } = await import("../../services/questsApi.js");
const { createExpeditionHandlers } = await import("../../services/expeditionsApi.js");
const { ensureQuests, questProgress, TASKS } = await import("../../services/quests.js");
const { lockUser } = await import("../../utils/userLocks.js");
const { getAcquirablePokemon } = await import("../../utils/dataLoader.js");
const { createNewUser } = await import("../../utils/userSchema.js");
const { grantCatch } = await import("../../utils/training.js");
const { normalizeBox, copiesOf } = await import("../../services/box.js");

let offset = 0;
const now = () => Date.now() + offset;
const ID = "123456789012345678";
const u = createNewUser(ID, "Preview");
u.cc = 12_345; u.tp = 5000;
for (const sp of [9, 6, 3, 25, 26, 65, 68, 76, 94, 130, 131, 143, 149, 7, 7, 4, 1, 16, 19, 74, 92, 133]) grantCatch(u, sp, "normal", () => 0.5);
grantCatch(u, 25, "shiny", () => 0.5);
normalizeBox(u);
const slot = (sp) => ({ id: sp, variant: "normal", uid: copiesOf(u, sp, "normal")[0].uid });
u.displayedPokemon = [slot(25), slot(6), slot(9)];
u.battleTeam = [9, 6, 3, 65, 94, 149].map(slot);
const td = { [ID]: u };
const q = ensureQuests(u, ID);
const kind = (t) => TASKS.find((d) => d.id === t.id);
questProgress(u, ID, kind(q.tasks[0]).kind, kind(q.tasks[0]).target);
u.quests.week.done = 11;

const save = async () => ({ saved: true, note: "" });
const h = createQuestHandlers({ getTrainerData: () => td, lockUser, save, loadPool: getAcquirablePokemon, now });
const x = createExpeditionHandlers({ getTrainerData: () => td, lockUser, save, loadPool: getAcquirablePokemon, now });
const auth = { isAuthorized: () => true };
const send = (res, r) => res.status(r.status).json(r.body);

const app = express();
app.use("/public", express.static(path.join(root, "public")));
app.get("/public/quests", (_q, res) => res.sendFile(path.join(root, "public", "quests", "index.html")));
app.get("/api/quests/status", (_q, res) => res.json({ enabled: true }));
app.get("/api/quests", async (req, res) => send(res, await h.view({ query: req.query, ...auth })));
app.post("/api/quests/claim", express.json(), async (req, res) => send(res, await h.claim({ body: req.body, ...auth })));
app.get("/api/expeditions", async (req, res) => send(res, await x.view({ query: req.query, ...auth })));
app.post("/api/expeditions/send", express.json(), async (req, res) => send(res, await x.send({ body: req.body, ...auth })));
app.post("/api/expeditions/claim", express.json(), async (req, res) => send(res, await x.claim({ body: req.body, ...auth })));
// The Collection page (public/picker-pokemon), enough of /api/user-pokemon to show
// copies out on an Expedition next to the ones at home.
const { allCopies, slotsHolding } = await import("../../services/box.js");
const { awayCopyRows } = await import("../../services/expeditions.js");
const { liveGenerations } = await import("../../utils/speciesCatalog.js");
const TEAM_BIT = { displayedPokemon: 1, battleTeam: 2, showcaseTeam: 4 };
app.get("/public/picker-pokemon", (_q, res) => res.sendFile(path.join(root, "public", "picker-pokemon", "index.html")));
app.get("/api/pokedex-status", (_q, res) => res.json({ liveGenerations: liveGenerations(), maxDex: 1025 }));
app.get("/api/live-events", (_q, res) => res.json({ ok: true, running: [], upcoming: [], discounts: {}, paidChoice: null }));
app.get("/api/mega", (_q, res) => res.json({ enabled: false }));
app.get("/api/user-pokemon", (_q, res) => res.json({
  id: ID, cc: u.cc, tp: u.tp, rank: "Advanced Trainer", items: u.items, pokemon: u.pokemon,
  currentTeam: u.displayedPokemon, battleTeam: u.battleTeam, showcaseTeam: u.showcaseTeam ?? [],
  levels: {}, powers: {}, trained: {}, pokedex: u.pokedex ?? {}, notices: [],
  copies: allCopies(u).map((c) => [c.uid, c.id, c.variant === "shiny" ? 1 : 0, c.level, c.at ?? 0, c.trained ? 1 : 0, slotsHolding(u, c.uid).reduce((m, s) => m | (TEAM_BIT[s.field] ?? 0), 0), c.exp]),
  awayCopies: awayCopyRows(u),
  serverNow: now(),
}));
app.post("/dev/finish", (_q, res) => {
  for (const t of u.quests.tasks) questProgress(u, ID, kind(t).kind, kind(t).target);
  u.quests.week.done = Math.max(u.quests.week.done, 14);
  res.json({ ok: true });
});
app.post("/dev/skip", (req, res) => { offset += Number(req.query.h || 12) * 3_600_000; res.json({ ok: true, now: new Date(now()).toISOString() }); });
const port = Number(process.argv[2] || 5244);
app.listen(port, () => console.log(`Quests preview: http://localhost:${port}/public/quests/?id=${ID}`));
