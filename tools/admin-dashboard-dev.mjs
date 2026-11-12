// ==========================================================
// tools/admin-dashboard-dev.mjs — run the admin dashboard locally with
// synthetic players (no Discord, no real player data).
//
//   node tools/admin-dashboard-dev.mjs [port]     (default 3999)
//   then open http://localhost:<port>/dev/login
//
// Changes are kept in memory and the admin audit file goes to a temp
// folder, both thrown away when the process stops.
// ==========================================================

import fs from "fs";
import os from "os";
import path from "path";
import express from "express";
import cookieParser from "cookie-parser";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.env.TRAINERDATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "admin-dev-"));

const { generateToken, activateAdminSession, adminSessionOf, requireAdminSession, ADMIN_MAX_MS } = await import("../utils/dashboardAuth.js");
const { mountAdminDashboard } = await import("../routes/admindashboard.js");
const { lockUser } = await import("../utils/userLocks.js");
const { createNewUser } = await import("../utils/userSchema.js");
const { trainingKey, expForLevel } = await import("../utils/training.js");

const now = Date.now();
const DAY = 86_400_000;
function make(id, name, o = {}) {
  return { ...createNewUser(id, name), onboardingComplete: true, ...o };
}
const trainerData = {
  "100000000000000001": make("100000000000000001", "Ash", {
    cc: 12_400, tp: 8_210, rank: "Ace Trainer", lastActiveAt: now - 2 * 3600_000,
    pokemon: { 16: { normal: 4, shiny: 2 }, 17: { normal: 1, shiny: 0 }, 25: { normal: 1, shiny: 0 }, 6: { normal: 1, shiny: 0 } },
    training: { [trainingKey(16, "normal")]: { exp: expForLevel(12) }, [trainingKey(16, "shiny")]: { exp: expForLevel(9) }, [trainingKey(17, "normal")]: { exp: expForLevel(31) }, [trainingKey(25, "normal")]: { exp: expForLevel(40) }, [trainingKey(6, "normal")]: { exp: expForLevel(55) } },
    items: { evolution_stone: 3, shiny_dust: 120 },
    trainers: ["aaron.png", "acerola.png"], displayedTrainer: "aaron.png",
    displayedPokemon: [{ id: 25, variant: "normal" }, { id: 16, variant: "shiny" }],
    battleTeam: [{ id: 6, variant: "normal" }],
    lastDaily: now - 3600_000, weeklyPackClaimed: true,
    battle: { rating: 1180, wins: 6, losses: 3, day: new Date(now).toISOString().slice(0, 10), started: 10, vs: {}, season: 1 },
  }),
  "100000000000000002": make("100000000000000002", "Misty", { cc: 600, tp: 2_300, rank: "Skilled Trainer", lastDaily: now - 3 * DAY, pokemon: { 120: { normal: 2, shiny: 0 } } }),
  "100000000000000003": make("100000000000000003", "Brock", { cc: 90, tp: 450, lastActiveAt: now - 20 * DAY, trainers: ["aaron.png"] }),
  "100000000000000004": make("100000000000000004", "Gary", { cc: 50_000, tp: 30_000, rank: "Elite Trainer", lastActiveAt: now - DAY / 2, pendingWager: { stake: 500, expiresAt: now + 10 * 60_000, defenderId: "1" } }),
  "100000000000000005": make("100000000000000005", "New player", { onboardingComplete: false, lastActiveAt: now - 600_000 }),
};
for (let i = 6; i <= 40; i++) {
  const id = `1000000000000000${String(i).padStart(2, "0")}`;
  trainerData[id] = make(id, `Trainer ${i}`, { cc: (i * 977) % 20_000, tp: (i * 1_337) % 25_000, lastActiveAt: now - (i % 12) * DAY, pokemon: { [i]: { normal: 1, shiny: 0 } } });
}

const app = express();
app.use(cookieParser());
app.get("/dev/login", (req, res) => {
  const code = generateToken("900000000000000001", "dev", "admin", { name: "dev-admin" });
  activateAdminSession(code);
  res.cookie("admin_session", code, { httpOnly: true, sameSite: "Lax", path: "/", maxAge: ADMIN_MAX_MS });
  res.redirect("/public/admindashboard/");
});
app.get(["/public/admindashboard", "/public/admindashboard/"], (_req, res) => res.sendFile(path.join(root, "public", "admindashboard", "index.html")));
app.use("/public", express.static(path.join(root, "public")));
mountAdminDashboard(app, {
  getTrainerData: () => trainerData,
  requireAdminSession,
  adminSessionOf,
  lockUser,
  save: async () => ({ saved: true, note: "" }),
  syncRole: async () => ({ ok: false, reason: "Dev server has no Discord connection." }),
});

const port = Number(process.argv[2]) || 3999;
app.listen(port, () => console.log(`Admin dashboard dev server: http://localhost:${port}/dev/login`));
