// Local admin dashboard preview over an in-memory player (no Discord, no disk).
// node tools/dev/admin-preview.mjs <port>   → http://127.0.0.1:<port>/public/admindashboard/
import os from "os";
import path from "path";
import fs from "fs/promises";
import http from "http";
import express from "express";

process.env.TRAINERDATA_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "admin-preview-"));
process.env.ADMIN_DASH_TOKEN = "preview";
const { mountAdminDashboard } = await import("../../routes/admindashboard.js");
const { lockUser } = await import("../../utils/userLocks.js");

const td = {
  1: { id: "1", name: "Preview Trainer", cc: 5000, tp: 100, rank: "Novice Trainer", onboardingComplete: true,
    pokemon: {}, training: {}, items: { evolution_stone: 2 }, trainers: [], displayedPokemon: [], displayedTrainer: null },
};
const app = express();
app.use("/public", express.static(path.resolve("public")));
mountAdminDashboard(app, {
  getTrainerData: () => td,
  requireAdminSession: () => null,
  adminSessionOf: () => ({ id: "900", name: "Preview admin", expires: Date.now() + 3_600_000 }),
  lockUser,
  save: async () => ({ saved: true, note: "" }),
  writeBlocked: () => null,
  appendAudit: async () => ({ ok: true }),
  readAudit: async () => ({ total: 0, entries: [] }),
});
const port = Number(process.argv[2] || 5180);
http.createServer(app).listen(port, "127.0.0.1", () => console.log(`admin preview on http://127.0.0.1:${port}/public/admindashboard/`));
