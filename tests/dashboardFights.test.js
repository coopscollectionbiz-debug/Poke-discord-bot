// ==========================================================
// tests/dashboardFights.test.js
// The Battle page's server side (services/dashboardFights.js) with stub
// Discord objects: the flag and the session gate, which channel each fight
// posts to, a fight with no usable channel, the shared caps and the
// rematch hand-off to /battle, the one-fight-at-a-time guard, a Challenge
// held to the loss its preview showed, and an Elite Four run whose Revive
// is picked from the page.
// ==========================================================

import { assertEqual, assertTrue, section, finish } from "./harness.js";
import { createDashboardFights, plainText } from "../services/dashboardFights.js";
import { lockUser } from "../utils/userLocks.js";
import { createNewUser } from "../utils/userSchema.js";
import { grantCatch, getTraining } from "../utils/training.js";
import { PLAYBACK, CHALLENGE } from "../utils/battle/tuning.js";
import { replayEstimateMs, VS_HOLD_MS } from "../utils/battle/playback.js";
import { isDashboardFightsEnabled } from "../config/features.js";

PLAYBACK.delayMs = 0;
CHALLENGE.pickMs = 400; // the Revive window, short for the test
const quiet = console.log;
console.log = (...a) => { if (!String(a[0]).includes("loaded from memory")) quiet(...a); };

const A = "100000000000000001";
const B = "100000000000000002";
const FULL = [25, 1, 4, 7, 16, 19];
const GYMS = ["brock", "misty", "surge", "erika", "koga", "sabrina", "blaine", "giovanni"];

function trainer(id) {
  const u = createNewUser(id, id);
  u.cc = 10_000;
  for (const sid of FULL) grantCatch(u, sid, "normal", () => 0.5);
  u.displayedPokemon = [{ id: 25, variant: "normal" }];
  u.battleTeam = FULL.map((sid) => ({ id: sid, variant: "normal" }));
  return u;
}
// An Elite Four team that behaves the same for any seed (tests/challengeCommand.test.js):
// a Lv 5 Magikarp leads and faints, a Lv 100 Mewtwo and Lugia clear every fight.
function runner(id) {
  const u = createNewUser(id, id);
  for (const sid of [129, 150, 249]) {
    u.pokemon[sid] = { normal: 1, shiny: 0 };
    (u.training ??= {})[`${sid}:normal`] = { exp: 100 ** 3 };
  }
  u.training["129:normal"] = { exp: 5 ** 3 };
  u.displayedPokemon = [129, 150, 249].map((sid) => ({ id: sid, variant: "normal" }));
  u.challenge = { won: Object.fromEntries(GYMS.map((k) => [k, "d"])), day: null, attempts: 0 };
  u.cc = 5000;
  return u;
}

const tick = () => new Promise((r) => setTimeout(r, 5));

// Stub channels: "dash" is where /dashboard was run, "casual" and "chal" the
// fixed channels, "dm" a DM, "noperm" a channel the bot can't attach files in.
function harness({ users = { [A]: trainer(A), [B]: trainer(B) }, env = { DASHBOARD_FIGHTS_ENABLED: "1" }, session = "dash", authorized = true } = {}) {
  const trainerData = users;
  const log = { fetched: [], sent: [], battles: [], challenges: [], saves: 0, records: [] };
  const channel = (id, { dm = false, perms = true } = {}) => ({
    id, name: id, guildId: "G",
    isDMBased: () => dm,
    isTextBased: () => true,
    permissionsFor: () => ({ has: () => perms }),
    send: async (o) => { log.sent.push({ id, o }); return { id: `m${log.sent.length}`, edit: async () => {} }; },
  });
  const channels = { dash: channel("dash"), casual: channel("casual"), chal: channel("chal"), dm: channel("dm", { dm: true }), noperm: channel("noperm", { perms: false }) };
  const client = {
    user: { id: "bot" },
    channels: { fetch: async (id) => { log.fetched.push(id); return channels[id] ?? null; } },
    users: { fetch: async (id) => ({ id, bot: false }) },
    guilds: { cache: { get: () => guild, first: () => guild } },
  };
  const guild = {
    members: {
      fetch: async (id) => ({ id, displayName: `Name${id.slice(-1)}`, user: { username: "u" } }),
      search: async ({ query }) => new Map(Object.keys(trainerData).concat(["999999999999999999"]).map((id) => [id, { id, displayName: `${query}-${id.slice(-1)}`, user: { bot: false } }])),
    },
  };
  const fights = createDashboardFights({
    getTrainerData: () => trainerData,
    lockUser,
    enqueueSave: async () => { log.saves++; },
    client,
    env,
    isAuthorized: () => authorized,
    sessionChannel: () => session,
    deps: {
      playBattle: async (ch, outcome) => { log.battles.push({ ch: ch.id, outcome }); },
      playChallenge: async (ch, outcome) => { log.challenges.push({ ch: ch.id, outcome }); },
      previewMessage: async () => ({ content: "intro" }),
      recordFight: (build) => { const r = build(); log.records.push(r); return Promise.resolve(true); },
      wait: async () => {},
    },
  });
  // Express-like request/response.
  const call = async (handler, { query = {}, body = null } = {}) => {
    const res = { status: 200, body: null, headersSent: false };
    const r = {
      status(code) { res.status = code; return r; },
      json(b) { res.body = b; res.headersSent = true; return r; },
      send(b) { res.body = b; res.headersSent = true; return r; },
    };
    await fights[handler]({ query, body, cookies: {} }, r);
    return res;
  };
  return { trainerData, log, call, fights };
}

section("Flag and session");
{
  assertEqual(isDashboardFightsEnabled({}), false, "DASHBOARD_FIGHTS_ENABLED unset: off");
  assertEqual(isDashboardFightsEnabled({ DASHBOARD_FIGHTS_ENABLED: "on" }), true, "\"on\" turns it on");
  const off = harness({ env: {} });
  assertEqual((await off.call("enabledView")).body, { enabled: false }, "the nav learns the page is off");
  assertEqual((await off.call("state", { query: { id: A } })).status, 404, "off: page state is 404");
  assertEqual((await off.call("startBattle", { body: { id: A, defenderId: B, mode: "open" } })).status, 404, "off: starting a battle is 404");
  assertEqual(off.trainerData[A].battle, undefined, "off: nothing ran");
  const stranger = harness({ authorized: false });
  assertEqual((await stranger.call("startBattle", { body: { id: A, defenderId: B, mode: "open" } })).status, 403, "no session: 403");
  assertEqual((await stranger.call("state", { query: { id: A } })).status, 403, "no session: state is 403 too");
}

section("Casual battle posts like /battle");
{
  delete process.env.CASUAL_BATTLE_CHANNEL_ID;
  const h = harness();
  const res = await h.call("startBattle", { body: { id: A, defenderId: B, mode: "open" } });
  assertEqual(res.status, 200, "the battle ran");
  assertEqual(res.body.posted?.channelId, "dash", "no fixed channel: posted where /dashboard was run");
  assertEqual(res.body.posted?.url, "https://discord.com/channels/G/dash", "with a link to the channel");
  assertEqual(h.log.battles.map((b) => b.ch), ["dash"], "the replay went to that channel");
  assertEqual(h.trainerData[A].battle.vs[B], 1, "counted on the live record");
  assertTrue(h.log.saves >= 1, "saved before the replay");
  assertEqual(h.log.records.length, 1, "a Fight record was kept");
  assertEqual(res.body.fightId, h.log.records[0].id, "and its id is returned for Watch replay");
  assertEqual(res.body.result.kind, "battle", "result panel: a battle");
  assertEqual(res.body.result.opponent, "Name2", "against the Defender's display name");
  assertEqual(res.body.result.won, h.log.battles[0].outcome.winnerId === A, "won matches the outcome");
  assertTrue(Array.isArray(res.body.result.exp), "EXP rows for the Challenger");
}

section("Fixed channels win; Ranked uses the /dashboard channel");
{
  process.env.CASUAL_BATTLE_CHANNEL_ID = "casual";
  process.env.CHALLENGE_CHANNEL_ID = "chal";
  const h = harness();
  const casual = await h.call("startBattle", { body: { id: A, defenderId: B, mode: "open" } });
  assertEqual(casual.body.posted?.channelId, "casual", "Casual → CASUAL_BATTLE_CHANNEL_ID");
  const ranked = await h.call("startBattle", { body: { id: A, defenderId: B, mode: "ranked" } });
  assertEqual(ranked.status, 200, "the ranked battle ran");
  assertEqual(ranked.body.posted?.channelId, "dash", "Ranked → the /dashboard channel");
  assertTrue(!!ranked.body.result.rating, "Ranked shows the rating change");
  const state = await h.call("state", { query: { id: A } });
  assertEqual(state.body.channels.challenge?.channelId, "chal", "Challenges → CHALLENGE_CHANNEL_ID");
  assertEqual(state.body.recent.map((p) => p.id), [], "no Fight record store: no recent list (and no crash)");
  delete process.env.CASUAL_BATTLE_CHANNEL_ID;
  delete process.env.CHALLENGE_CHANNEL_ID;
}

section("No usable channel: the fight runs, nothing is posted");
for (const session of ["dm", "noperm", null]) {
  const h = harness({ session });
  const res = await h.call("startBattle", { body: { id: A, defenderId: B, mode: "open" } });
  assertEqual([res.status, res.body.posted], [200, null], `${session ?? "no channel"}: ran, posted nowhere`);
  assertEqual(h.log.battles.length, 0, `${session ?? "no channel"}: no replay sent`);
  assertEqual(h.log.records.length, 1, `${session ?? "no channel"}: the Fight record keeps the replay`);
  const state = await h.call("state", { query: { id: A } });
  assertEqual(state.body.channels.casual, null, `${session ?? "no channel"}: the page is told before the fight`);
}

section("Caps, rematch hand-off and refusals");
{
  const h = harness();
  for (let i = 0; i < 3; i++) await h.call("startBattle", { body: { id: A, defenderId: B, mode: "open" } });
  const fourth = await h.call("startBattle", { body: { id: A, defenderId: B, mode: "open" } });
  assertEqual([fourth.status, fourth.body.reason], [409, "rematch_needed"], "4th casual battle vs the same Defender is refused");
  assertTrue(fourth.body.error.includes("/battle"), "and points to /battle for a rematch");
  assertEqual(h.trainerData[A].battle.vs[B], 3, "the refusal didn't count");
  const self = await h.call("startBattle", { body: { id: A, defenderId: A, mode: "open" } });
  assertEqual(self.body.reason, "self", "can't battle yourself");
  const ghost = await h.call("startBattle", { body: { id: A, defenderId: "123456789012345678", mode: "open" } });
  assertEqual(ghost.body.reason, "no_defender", "a Defender with no Trainer is refused");
  const wager = await h.call("startBattle", { body: { id: A, defenderId: B, mode: "wager" } });
  assertEqual(wager.status, 400, "Wager can't be started from the dashboard");
  h.trainerData[B].battleTeam = h.trainerData[B].battleTeam.slice(0, 5);
  const short = await h.call("startBattle", { body: { id: A, defenderId: B, mode: "ranked" } });
  assertEqual(short.body.reason, "short_battle_team_defender", "Ranked needs both Ranked teams full");
  assertTrue(!short.body.error.includes("<@"), "refusals carry names, not Discord mentions");
  assertEqual(plainText("<@1> and <@!2>", { 1: "Ash" }), "Ash and that player", "mentions become names");
}

section("One fight at a time per player");
{
  const h = harness();
  const [x, y] = await Promise.all([
    h.call("startBattle", { body: { id: A, defenderId: B, mode: "open" } }),
    h.call("startBattle", { body: { id: A, defenderId: B, mode: "open" } }),
  ]);
  assertEqual([x.status, y.status].sort(), [200, 409], "a double click runs one battle");
  assertEqual([x, y].find((r) => r.status === 409).body.error, "You're already in a fight.", "the other is told why");
  assertEqual(h.trainerData[A].battle.vs[B], 1, "only one counted");
  const again = await h.call("startBattle", { body: { id: A, defenderId: B, mode: "open" } });
  assertEqual(again.status, 200, "once saved, the next battle can start");
}

section("Defender search");
{
  const h = harness();
  const res = await h.call("players", { query: { id: A, q: "Na" } });
  assertEqual(res.body.players.map((p) => p.id), [B], "players with a Trainer, minus yourself and strangers");
  assertEqual(res.body.players[0].leftVs, 3, "with battles left against them today");
  assertEqual((await h.call("players", { query: { id: A, q: "N" } })).body.players, [], "one letter: no search");
}

section("Challenge: preview first, loss held to the preview");
{
  const h = harness();
  const noPreview = await h.call("startChallenge", { body: { id: A, key: "giovanni", pick: "casual" } });
  assertEqual(noPreview.body.reason, "no_preview", "Fight without a preview is refused");
  const preview = await h.call("challengePreview", { query: { id: A, key: "giovanni" } });
  assertEqual(preview.body.loss, 1000, "the preview shows 10% of 10,000 CC");
  h.trainerData[A].cc = 50_000; // the balance grows before Fight
  const res = await h.call("startChallenge", { body: { id: A, key: "giovanni", pick: "casual" } });
  assertEqual(res.status, 200, "the Challenge ran");
  assertEqual(res.body.result.won, false, "a lone Lv 25 Pikachu loses to Giovanni");
  assertEqual(res.body.result.ccLost, 1000, "the loss is what the preview showed, not 10% of the new balance");
  assertEqual(h.trainerData[A].cc, 49_000, "taken from the live record");
  assertEqual(h.log.sent.map((s) => s.id), ["dash"], "the intro card was posted");
  assertEqual(h.log.challenges.map((c) => c.ch), ["dash"], "then the replay");
  const reuse = await h.call("startChallenge", { body: { id: A, key: "giovanni", pick: "casual" } });
  assertEqual(reuse.body.reason, "no_preview", "a preview is good for one Fight");
  const elite = await h.call("challengePreview", { query: { id: A, key: "elite4" } });
  assertEqual(elite.body.reason, "locked_elite4", "Elite Four locked without 8 Badges");
}

section("Elite Four run: Revive picked on the page");
{
  const h = harness({ users: { [A]: runner(A) }, session: "dm" });
  await h.call("challengePreview", { query: { id: A, key: "elite4" } });
  const start = await h.call("startChallenge", { body: { id: A, key: "elite4", pick: "casual" } });
  assertEqual(start.status, 200, "the run started");
  assertEqual(start.body.posted, null, "no channel: played on the dashboard only");
  let run;
  const view = async () => (await h.call("run", { query: { id: A } })).body.run;
  // Wait for the first Revive window.
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    run = await view();
    if (run?.stage === "revive" || run?.stage === "done") break;
    await tick();
  }
  assertEqual(run?.stage, "revive", "after Lorelei the page is asked for a Revive");
  assertEqual(run.pick.fainted.map((f) => f.name), ["Magikarp"], "Magikarp fainted");
  const busy = await h.call("challengePreview", { query: { id: A, key: "brock" } });
  assertEqual(busy.body.reason, "run_open", "no other Challenge opens mid-run");
  const wrong = await h.call("revive", { body: { id: A, nonce: run.pick.nonce, step: run.pick.step, slot: 2 } });
  assertEqual(wrong.status, 400, "only a fainted Pokémon can be revived");
  const picked = await h.call("revive", { body: { id: A, nonce: run.pick.nonce, step: run.pick.step, slot: run.pick.fainted[0].slot } });
  assertEqual(picked.status, 200, "the pick was taken");
  const late = await h.call("revive", { body: { id: A, nonce: run.pick.nonce, step: run.pick.step, slot: run.pick.fainted[0].slot } });
  assertEqual(late.status, 409, "a second click is too late");
  // The later windows pass with no pick: no Revive, the run goes on.
  while (Date.now() < deadline + 30_000) {
    run = await view();
    if (run?.stage === "done") break;
    await tick();
  }
  assertEqual(run?.stage, "done", "the run finished");
  assertEqual(run.result.won, true, "and was cleared");
  assertEqual(run.result.unlocked, "blue", "Blue opens");
  assertEqual(h.trainerData[A].challenge.run, undefined, "the run is closed on the record");
  assertEqual(h.trainerData[A].challenge.won.elite4 !== undefined, true, "the Elite Four counts as won");
  assertTrue(!!run.fightId && h.log.records.at(-1).id === run.fightId, "the run's Fight record id is returned");
}

section("Challenge preview: trainers, Auras and parties");
{
  const h = harness();
  h.trainerData[A].displayedTrainer = "brock.png";
  const brock = (await h.call("challengePreview", { query: { id: A, key: "brock" } })).body;
  assertEqual(brock.player.trainer, "brock.png", "the player's displayed trainer");
  assertTrue(brock.player.look !== undefined, "with their equipped Aura look (Auto: the trainer's tier)");
  assertEqual(brock.trainers.map((t) => [t.name, !!t.trainer]), [["Brock", true]], "Brock's sprite");
  assertEqual(brock.trainers[0].aura.id, "gymBrock", "Brock's Aura is the one he gives");
  assertEqual(brock.trainers[0].aura.look, null, "drawn only once its art exists (none in tests)");
  assertEqual(brock.trainers[0].team.length, 6, "his party of 6");
  assertTrue(brock.trainers[0].team.every((m) => m.name && m.level && !("statMult" in m)), "names and Levels, no hidden stat boost");
}
{
  const { CHALLENGE_KEYS } = await import("../utils/challenge/roster.js");
  const fs = await import("fs");
  const { previewTrainers } = await import("../services/dashboardFights.js");
  const missing = CHALLENGE_KEYS.flatMap((key) => previewTrainers(key, {}, "x").trainers
    .filter((t) => !t.trainer || !fs.existsSync(`public/sprites/trainers_2/${t.trainer}`)).map((t) => `${key}:${t.name}`));
  assertEqual(missing, [], "every Challenge opponent has a trainer sprite on disk");
  assertEqual(previewTrainers("elite4", {}, "x").trainers.map((t) => t.aura?.id), ["e4Lorelei", "e4Bruno", "e4Agatha", "e4Lance"], "each Elite Four member shows their own Aura");
}

section("A Defender's team");
{
  const h = harness();
  const casual = (await h.call("team", { query: { id: A, defenderId: B, mode: "open" } })).body;
  assertEqual(casual.members.map((m) => m.speciesId), [25], "Casual: their Casual team");
  assertEqual(casual.members[0].level, getTraining(h.trainerData[B], 25, "normal").level, "at its real Level");
  const ranked = (await h.call("team", { query: { id: A, defenderId: B, mode: "ranked" } })).body;
  assertEqual(ranked.members.length, 6, "Ranked: their Ranked team");
  assertTrue(ranked.members.every((m) => m.level === 50), "at Lv 50, as it fights");
  assertTrue(ranked.members.every((m) => !("moves" in m) && !("battleProfile" in m)), "moves and stats stay private");
  assertEqual((await h.call("team", { query: { id: A, defenderId: "123456789012345678", mode: "open" } })).status, 404, "no Trainer: 404");
  assertEqual((await h.call("team", { query: { id: A, defenderId: B, mode: "wager" } })).status, 400, "only Casual or Ranked");
}

section("Replay estimate");
{
  assertEqual(replayEstimateMs({ result: { turns: 3 } }, { maxUpdates: 12, delayMs: 2000 }), VS_HOLD_MS + 4 * 2000, "hold + 3 turns + the result image");
  assertEqual(replayEstimateMs({ result: { turns: 40 } }, { maxUpdates: 12, delayMs: 2000 }), VS_HOLD_MS + 13 * 2000, "at most maxUpdates turn images");
  assertEqual(replayEstimateMs(null, { maxUpdates: 12, delayMs: 2000 }), VS_HOLD_MS + 2000, "no fight: hold + result");
}

finish();
