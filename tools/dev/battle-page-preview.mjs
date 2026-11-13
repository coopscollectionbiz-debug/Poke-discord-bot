// Local Battle page preview over in-memory players (no Discord, no real data).
// node tools/dev/battle-page-preview.mjs <port> [dash|dm]
//   → http://127.0.0.1:<port>/public/battle/?id=100000000000000001
// Player 1 has full Casual and Ranked teams and all 8 Badges (Elite Four open);
// players 2 and 3 are Defenders ("Misty" and "Brock" in the search). The
// stub channel logs what would be posted. Pass "dm" to see the no-channel line.
import os from "os";
import path from "path";
import fs from "fs/promises";
import http from "http";
import express from "express";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

process.env.TRAINERDATA_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "battle-preview-"));
process.env.DASHBOARD_FIGHTS_ENABLED = "1";
// Optional: AURA_PROTOTYPES=<folder of prototype Auras> copies two of them in
// as Blaine's and Lorelei's Auras, to see the preview once their art is added.
process.env.AURA_ART_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "battle-preview-auras-"));
if (process.env.AURA_PROTOTYPES) {
  for (const [from, to] of [["blaineKiln", "gymBlaine"], ["loreleiAurora", "e4Lorelei"]]) {
    await fs.cp(path.join(process.env.AURA_PROTOTYPES, from), path.join(process.env.AURA_ART_DIR, to), { recursive: true }).catch(() => {});
  }
}
const { createDashboardFights } = await import("../../services/dashboardFights.js");
const { createFightRecordHandlers } = await import("../../services/fightRecordsApi.js");
const { fightRecords } = await import("../../utils/fightRecords.js");
const { lockUser } = await import("../../utils/userLocks.js");
const { createNewUser } = await import("../../utils/userSchema.js");
const { grantCatch } = await import("../../utils/training.js");

const ME = "100000000000000001";
const NAMES = { [ME]: "Preview Trainer", "100000000000000002": "Misty", "100000000000000003": "Brock" };
const GYMS = ["brock", "misty", "surge", "erika", "koga", "sabrina", "blaine", "giovanni"];
function player(id, species) {
  const u = createNewUser(id, NAMES[id]);
  u.cc = 25_000;
  for (const sid of species) grantCatch(u, sid, "normal", () => 0.5);
  for (const sid of species) (u.training ??= {})[`${sid}:normal`] = { exp: 40 ** 3 };
  u.displayedPokemon = species.map((sid) => ({ id: sid, variant: "normal" }));
  u.battleTeam = species.map((sid) => ({ id: sid, variant: "normal" }));
  return u;
}
const td = {
  [ME]: player(ME, [6, 9, 3, 25, 143, 131]),
  "100000000000000002": player("100000000000000002", [121, 120, 54, 55, 118, 119]),
  "100000000000000003": player("100000000000000003", [95, 74, 75, 111, 142, 76]),
};
td[ME].challenge = { won: Object.fromEntries(GYMS.slice(0, 7).map((k) => [k, "d"])), day: null, attempts: 0 };
td[ME].challenge.won.giovanni = "d"; // all 8: the Elite Four is open
// Casual team for the Elite Four: a Lv 5 Magikarp leads and faints (so a
// Revive is offered), then Lv 100 Mewtwo and Lugia clear every fight.
for (const sid of [129, 150, 249]) {
  td[ME].pokemon[sid] = { normal: 1, shiny: 0 };
  td[ME].training[`${sid}:normal`] = { exp: (sid === 129 ? 5 : 100) ** 3 };
}
td[ME].displayedTrainer = "blue-gen3champion.png";
td[ME].displayedPokemon = [129, 150, 249].map((sid) => ({ id: sid, variant: "normal" }));

const session = process.argv[3] === "dm" ? "dm" : "dash";
const channel = (id, dm = false) => ({
  id, name: id === "dash" ? "battles" : id, guildId: "G",
  isDMBased: () => dm, isTextBased: () => true,
  permissionsFor: () => ({ has: () => true }),
  send: async (o) => { console.log(`[#${id}] ${o?.content ?? "(card)"}`); return { id: "m", edit: async () => {} }; },
});
const channels = { dash: channel("dash"), dm: channel("dm", true) };
const member = (id) => ({ id, displayName: NAMES[id] ?? "Trainer", user: { username: NAMES[id], bot: false } });
const guild = {
  members: {
    fetch: async (id) => member(id),
    search: async ({ query }) => new Map(Object.keys(NAMES)
      .filter((id) => NAMES[id].toLowerCase().startsWith(query.toLowerCase()))
      .map((id) => [id, member(id)])),
  },
};
const client = {
  user: { id: "bot" },
  channels: { fetch: async (id) => channels[id] ?? null },
  users: { fetch: async (id) => ({ id, bot: false }) },
  guilds: { cache: { get: () => guild, first: () => guild } },
};

const fights = createDashboardFights({
  getTrainerData: () => td, lockUser, enqueueSave: async () => {}, client, fightRecords,
  isAuthorized: () => true, sessionChannel: () => session,
  deps: {
    playBattle: async (ch, o) => console.log(`[#${ch.id}] replay: ${NAMES[o.winnerId]} wins in ${o.result.turns} turns`),
    playChallenge: async (ch, o) => console.log(`[#${ch.id}] challenge replay: ${o.cleared ? "cleared" : "lost"}`),
    previewMessage: async () => ({ content: "(intro card)" }),
  },
});

const app = express();
app.use("/public", express.static(path.join(ROOT, "public")));
app.use("/auras-art", express.static(process.env.AURA_ART_DIR, { index: false }));
const route = (h) => (req, res) => fights[h](req, res);
app.get("/api/battle/enabled", route("enabledView"));
app.get("/api/battle", route("state"));
app.get("/api/battle/players", route("players"));
app.get("/api/battle/team", route("team"));
app.get("/api/battle/challenge", route("challengePreview"));
app.get("/api/battle/run", route("run"));
app.post("/api/battle/start", express.json(), route("startBattle"));
app.post("/api/battle/challenge", express.json(), route("startChallenge"));
app.post("/api/battle/revive", express.json(), route("revive"));
const records = createFightRecordHandlers({ store: fightRecords, isAuthorized: () => true });
app.get("/api/fight-records", (req, res) => records.list(req, res));
app.get("/api/fight-records/:fightId", (req, res) => records.get(req, res));

const port = Number(process.argv[2] || 5190);
http.createServer(app).listen(port, "127.0.0.1", () => console.log(`battle page preview on http://127.0.0.1:${port}/public/battle/?id=${ME}`));
