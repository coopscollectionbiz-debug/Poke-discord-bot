// ==========================================================
// services/dashboardFights.js — start Battles and Challenges from the
// dashboard's Battle page (docs/superpowers/specs/2026-11-13-dashboard-battles-design.md).
//
// Each fight runs through the same engine, checks, caps and locks as
// /battle and /challenge, and is posted to Discord the way the command
// posts it:
//   Casual battle  → CASUAL_BATTLE_CHANNEL_ID, else the /dashboard channel
//   Ranked battle  → the /dashboard channel
//   Challenge      → CHALLENGE_CHANNEL_ID, else the /dashboard channel
// With no usable channel (a DM, or missing permissions) the fight still runs
// and only the dashboard shows it (its Fight record's replay).
// Wager battles and Rematch requests stay /battle-only.
//
//   GET  /api/battle?id=                      → page state
//   GET  /api/battle/players?id=&q=           → Defender search
//   POST /api/battle/start      {id, defenderId, mode: "open"|"ranked"}
//   GET  /api/battle/team?id=&defenderId=&mode= → a Defender's team as it would fight
//   GET  /api/battle/challenge?id=&key=       → Challenge preview (holds the loss shown)
//   POST /api/battle/challenge  {id, key, pick: "casual"|"ranked"}
//   GET  /api/battle/run?id=                  → the Elite Four run in progress
//   POST /api/battle/revive     {id, nonce, step, slot}
//
// Everything is behind DASHBOARD_FIGHTS_ENABLED (config/features.js).
// ==========================================================

import { randomInt } from "crypto";
import { logEvent } from "../utils/eventLog.js";
import { recordFight as defaultRecordFight, battleRecord, challengeRecord } from "../utils/fightRecordBuild.js";
import { battleBlock, runBattle, withBothLocks, teamFor, availablePicks } from "../utils/battle/runBattle.js";
import { rankedRecord, utcDay, dailyCap } from "../utils/battle/rewards.js";
import { CAPS, CHALLENGE, PLAYBACK } from "../utils/battle/tuning.js";
import { playBattle as defaultPlayBattle, playChallenge as defaultPlayChallenge, challengeNames, prizeText, replayEstimateMs } from "../utils/battle/playback.js";
import { CHALLENGES, CHALLENGE_KEYS, opponentName, displaySprite } from "../utils/challenge/roster.js";
import { AURAS } from "../catalog/auras.js";
import { speciesName } from "../utils/training.js";
import { auraLook, auraReady } from "./auras.js";
import {
  challengeBlock, previewChallenge, runChallenge, isUnlocked, startRun, isRunStale, challengeLogEntry,
} from "../utils/challenge/runChallenge.js";
import {
  refusal as battleRefusal, vsRecords, vsOf, trainersOf, aurasOf, casualChannelId, CHANNEL_PERMISSIONS,
} from "../commands/battle.js";
import {
  refusal as challengeRefusal, cardView, previewMessage as defaultPreviewMessage, challengeChannelId,
  playRun as defaultPlayRun, playing, finishStaleRun,
} from "../commands/challenge.js";
import { isDashboardFightsEnabled } from "../config/features.js";

const MODES = new Set(["open", "ranked"]);
const RECENT = 5; // recent Defenders shown above the search box
const SEARCH_LIMIT = 10;
const DONE_KEEP_MS = 30 * 60 * 1000; // a finished run's result stays readable this long

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const n = (x) => x.toLocaleString("en-US");

/** A command refusal without Discord mentions: <@id> becomes the player's name. */
export const plainText = (text, names = {}) => String(text).replace(/<@!?(\d+)>/g, (_, id) => names[id] ?? "that player");
/** <#id> becomes #name (or "the battle channel"). */
const plainChannels = (text, channelName) => String(text).replace(/<#\d+>/g, channelName ? `#${channelName}` : "the battle channel");

export function battleRefusalText(reason, opponentId, name) {
  if (reason === "rematch_needed") return "3 battles with them today. Ask for a rematch with /battle.";
  if (reason === "busy") return "You're already in a fight.";
  if (reason === "no_defender") return "That player hasn't started playing yet.";
  return plainText(battleRefusal(reason, opponentId), { [opponentId]: name });
}

export function challengeRefusalText(reason, user) {
  if (reason === "busy") return "You're already in a fight.";
  if (reason === "no_preview") return "That preview expired. Open the Challenge again.";
  return challengeRefusal(reason, user);
}

/** The result panel for a Battle, from the Challenger's side. */
export function battleResultView(outcome, userId, names) {
  const opponentId = outcome.sides.find((s) => s.userId !== userId)?.userId;
  return {
    kind: "battle",
    mode: outcome.mode,
    won: outcome.winnerId === userId,
    opponent: names[opponentId] ?? "Trainer",
    rating: outcome.rating?.[userId] ?? null,
    exp: expRows(outcome.exp?.[userId]),
    overCap: outcome.overCap ?? null,
    megaShards: outcome.megaShards?.[userId] ?? 0,
    surge: !!outcome.surge,
  };
}

/** The result panel for a Challenge or a finished Elite Four run. */
export function challengeResultView(outcome) {
  const challenge = CHALLENGES[outcome.key];
  return {
    kind: "challenge",
    key: outcome.key,
    opponent: challenge.kind === "elite4" ? "the Elite Four" : opponentName(challenge.opponents[0]),
    won: !!outcome.cleared,
    ccLost: outcome.ccLost ?? 0,
    prize: outcome.prize ? prizeText(outcome.key, outcome.prize) : null,
    badge: outcome.badge ? challenge.badge?.badge ?? outcome.badge : null,
    unlocked: outcome.unlocked ?? null,
    auras: Array.isArray(outcome.auras) ? outcome.auras.length : 0,
    exp: expRows(outcome.exp?.[outcome.userId]),
  };
}

const expRows = (rows) => (rows ?? []).map((e) => ({
  name: e.name, fromLevel: e.fromLevel, toLevel: e.toLevel, gained: e.gained, learned: e.learned ?? [],
}));

/**
 * The Aura a Challenge opponent gives when beaten (catalog/auras.js), as a
 * look to draw behind them: shown only once its art exists (auraReady), so
 * each opponent gets theirs the day the art is added.
 */
export function opponentAura(key, opponent, env = process.env) {
  const a = AURAS.find((x) => x.challenge === key && (!x.opponent || x.opponent === opponent.key));
  if (!a) return null;
  return { id: a.id, name: a.name, look: auraReady(a.id, env) ? a.look : null };
}

/**
 * A team for the page's team view: what the posted VS card shows (species,
 * shiny, Level, Mega form) plus held items. Moves and stats stay private.
 */
export const teamView = (members) => members.map((m) => ({
  speciesId: m.speciesId, variant: m.variant ?? "normal", name: m.name, level: m.level,
  ...(m.megaForm && { megaForm: m.megaForm }),
  ...(m.item && { item: typeof m.item === "string" ? m.item : m.item.id ?? null }),
}));

/** The trainers on a Challenge preview: the player (with their equipped Aura) and every opponent. */
export function previewTrainers(key, user, playerName, env = process.env) {
  return {
    player: { name: playerName, trainer: user?.displayedTrainer ?? null, look: auraLook(user, { env }) ?? null },
    trainers: CHALLENGES[key].opponents.map((o) => ({
      name: o.name, title: o.title ?? null, type: o.type ?? null, trainer: displaySprite(o) ?? null, aura: opponentAura(key, o, env),
      // Their party at its real Levels (the hidden Challenge stat boost isn't shown).
      team: o.team.map((m) => ({ speciesId: m.speciesId, variant: "normal", name: speciesName(m.speciesId), level: m.level })),
    })),
  };
}

export function createDashboardFights({
  getTrainerData, lockUser, enqueueSave, client, isAuthorized, sessionChannel,
  env = process.env,
  fightRecords = null,
  deps = {},
}) {
  const {
    playBattle = defaultPlayBattle,
    playChallenge = defaultPlayChallenge,
    playRun = defaultPlayRun,
    previewMessage = defaultPreviewMessage,
    recordFight = defaultRecordFight,
    wait = sleep,
    now = () => new Date(),
  } = deps;

  const inFlight = new Set(); // players with a fight being started (until its result is saved)
  const previews = new Map(); // userId → { key, loss, at }: the loss a Challenge preview showed
  const runs = new Map(); // userId → the dashboard's view of an Elite Four run it is playing
  const save = () => enqueueSave(getTrainerData(), { force: true });

  const enabled = () => isDashboardFightsEnabled(env);

  const guild = () => client?.guilds?.cache?.get(env.GUILD_ID) ?? client?.guilds?.cache?.first?.() ?? null;

  async function memberName(userId) {
    const member = await guild()?.members?.fetch?.(userId).catch(() => null);
    return member?.displayName ?? member?.user?.username ?? getTrainerData()[userId]?.name ?? "Trainer";
  }

  // Where a fight of this kind goes: { channel, id, name } or { channel: null }.
  async function target(kind, req) {
    const fixed = kind === "casual" ? casualChannelId() : kind === "challenge" ? challengeChannelId() : null;
    const id = fixed || sessionChannel(req);
    if (!id || !client?.channels?.fetch) return { channel: null };
    const channel = await client.channels.fetch(id).catch(() => null);
    if (!channel || channel.isDMBased?.() || !channel.isTextBased?.() || !channel.send) return { channel: null };
    const perms = channel.permissionsFor?.(client.user);
    if (!perms?.has?.(CHANNEL_PERMISSIONS)) return { channel: null };
    return { channel, id: channel.id, name: channel.name ?? null, guildId: channel.guildId ?? null };
  }

  const where = (t) => (t.channel ? { channelId: t.id, name: t.name, url: t.guildId ? `https://discord.com/channels/${t.guildId}/${t.id}` : null } : null);

  // Checks the session and the flag. Returns the player's id or sends the error.
  function gate(req, res, id) {
    if (!enabled()) { res.status(404).json({ error: "Not found" }); return null; }
    if (!id) { res.status(400).json({ error: "Missing id" }); return null; }
    if (!isAuthorized(req, String(id))) { res.status(403).json({ error: "Invalid or expired session" }); return null; }
    return String(id);
  }

  const vsToday = (user, opponentId, day) => (user?.battle?.day === day ? user.battle.vs?.[opponentId] ?? 0 : 0);
  const battlesUsed = (user, day) => (user?.battle?.day === day ? user.battle.started ?? 0 : 0);

  // One row in the Defender list.
  function playerRow(trainerData, userId, otherId, name, day) {
    const other = trainerData[otherId];
    return {
      id: otherId,
      name,
      rating: rankedRecord(other).rating,
      leftVs: Math.max(0, CAPS.perOpponent - vsToday(trainerData[userId], otherId, day)),
      casual: teamFor(other, "open").length > 0,
      ranked: teamFor(other, "ranked").length >= 6,
    };
  }

  function runView(userId) {
    const st = runs.get(userId);
    if (!st) {
      const open = getTrainerData()[userId]?.challenge?.run;
      return open ? { stage: "elsewhere" } : null;
    }
    if (st.stage === "done" && now().getTime() - st.doneAt > DONE_KEEP_MS) {
      runs.delete(userId);
      return null;
    }
    return {
      stage: st.stage, // "playing" | "revive" | "done"
      fight: st.fight, // index of the fight being shown, 0–3
      opponents: CHALLENGES.elite4.opponents.map((o) => o.name),
      posted: st.posted,
      postedTo: st.posted ? st.where : null,
      ...(st.pick && {
        pick: {
          nonce: st.pick.nonce, step: st.pick.step, next: st.pick.next?.name ?? null,
          fainted: st.pick.fainted, msLeft: Math.max(0, st.pick.deadline - now().getTime()),
        },
      }),
      ...(st.stage === "done" && { result: st.result, fightId: st.fightId }),
    };
  }

  const handlers = {
    /** GET /api/battle/enabled: whether the Battle nav item shows. No session needed. */
    enabledView(_req, res) {
      return res.json({ enabled: enabled() });
    },

    async state(req, res) {
      const id = gate(req, res, req.query.id);
      if (!id) return;
      const trainerData = getTrainerData();
      const user = trainerData[id];
      const day = utcDay(now());
      const [casual, ranked, challenge] = await Promise.all(["casual", "ranked", "challenge"].map((k) => target(k, req)));
      let recent = [];
      try {
        const records = fightRecords ? await fightRecords.list(id, { group: "battles" }) : [];
        const seen = new Set();
        for (const r of records) {
          const side = r.sides?.find((s) => s.id && s.id !== id);
          if (!side || seen.has(side.id) || !trainerData[side.id]) continue;
          seen.add(side.id);
          recent.push(playerRow(trainerData, id, side.id, side.name, day));
          if (recent.length >= RECENT) break;
        }
      } catch (err) {
        console.warn("⚠️ battle page recent opponents failed:", err?.message || err);
        recent = [];
      }
      const attempts = user?.challenge?.day === day ? user.challenge.attempts ?? 0 : 0;
      return res.json({
        enabled: true,
        battlesLeft: Math.max(0, dailyCap() - battlesUsed(user, day)),
        battlesPerDay: dailyCap(),
        perOpponent: CAPS.perOpponent,
        challengesLeft: Math.max(0, CHALLENGE.perDay - attempts),
        challengesPerDay: CHALLENGE.perDay,
        teams: { casual: teamFor(user, "open").length, ranked: teamFor(user, "ranked").length },
        channels: { casual: where(casual), ranked: where(ranked), challenge: where(challenge) },
        board: CHALLENGE_KEYS.map((key) => ({
          key,
          label: CHALLENGES[key].label,
          kind: CHALLENGES[key].kind,
          type: CHALLENGES[key].badge?.type ?? null,
          unlocked: isUnlocked(user ?? {}, key),
          won: !!user?.challenge?.won && key in user.challenge.won,
        })),
        recent,
        run: runView(id),
      });
    },

    async players(req, res) {
      const id = gate(req, res, req.query.id);
      if (!id) return;
      const q = String(req.query.q ?? "").trim().slice(0, 32);
      if (q.length < 2) return res.json({ players: [] });
      const trainerData = getTrainerData();
      const day = utcDay(now());
      let members = [];
      try {
        const found = await guild()?.members?.search?.({ query: q, limit: SEARCH_LIMIT * 2 });
        members = found ? [...found.values()] : [];
      } catch (err) {
        console.warn("⚠️ battle page member search failed:", err?.message || err);
        return res.status(502).json({ error: "Couldn't search players right now." });
      }
      const players = members
        .filter((m) => !m.user?.bot && m.id !== id && trainerData[m.id])
        .slice(0, SEARCH_LIMIT)
        .map((m) => playerRow(trainerData, id, m.id, m.displayName ?? m.user?.username ?? "Trainer", day));
      return res.json({ players });
    },

    /** A Defender's team as it would fight in this mode: Casual at real Levels, Ranked at Lv 50. */
    async team(req, res) {
      const id = gate(req, res, req.query.id);
      if (!id) return;
      const defenderId = String(req.query.defenderId ?? "");
      const mode = String(req.query.mode ?? "open");
      if (!MODES.has(mode) || !/^\d{5,25}$/.test(defenderId)) return res.status(400).json({ error: "Bad request" });
      const user = getTrainerData()[defenderId];
      if (!user) return res.status(404).json({ error: "That player hasn't started playing yet." });
      return res.json({
        name: await memberName(defenderId),
        trainer: user.displayedTrainer ?? null,
        look: auraLook(user, { env }) ?? null,
        mode,
        members: teamView(teamFor(user, mode, { env })),
      });
    },

    async startBattle(req, res) {
      const body = req.body ?? {};
      const id = gate(req, res, body.id);
      if (!id) return;
      const defenderId = String(body.defenderId ?? "");
      const mode = String(body.mode ?? "");
      if (!MODES.has(mode) || !/^\d{5,25}$/.test(defenderId)) return res.status(400).json({ error: "Bad request" });
      // Claimed before any await, so a double click or a second tab is refused.
      if (inFlight.has(id)) return res.status(409).json({ ok: false, reason: "busy", error: battleRefusalText("busy") });
      inFlight.add(id);
      try {
        const trainerData = getTrainerData();
        const defenderName = await memberName(defenderId);
        const refuse = (reason, status = 409) => res.status(status).json({ ok: false, reason, error: battleRefusalText(reason, defenderId, defenderName) });
        if (!trainerData[defenderId]) return refuse("no_defender");
        const defenderUser = await client?.users?.fetch?.(defenderId).catch(() => null);
        if (defenderUser?.bot) return refuse("bot");
        const early = battleBlock({ trainerData, challengerId: id, defenderId, mode, now: now() });
        if (early) return refuse(early);
        const t = await target(mode === "open" ? "casual" : "ranked", req);
        const seed = randomInt(0, 2 ** 31 - 1);
        const outcome = await withBothLocks(lockUser, id, defenderId, async () => {
          const live = getTrainerData();
          const before = vsRecords(live, [id, defenderId], mode);
          const out = runBattle({ trainerData: live, challengerId: id, defenderId, mode, seed, now: now() });
          if (out.ok) {
            out.vsRecords = before;
            await save(); // saved before the replay, as /battle does
          }
          return out;
        });
        if (!outcome.ok) return refuse(outcome.reason);

        logEvent("battle", id, {
          defenderId, mode, seed, winnerId: outcome.winnerId, turns: outcome.result.turns, surge: !!outcome.surge, via: "dashboard",
        });
        const names = { [id]: await memberName(id), [defenderId]: defenderName };
        const live = getTrainerData();
        let fightId = null;
        recordFight(() => {
          const r = battleRecord(outcome, names, live);
          fightId = r.id;
          return r;
        });
        if (t.channel) {
          // Fire and forget, as /battle's replay: a long replay never holds the request.
          playBattle(t.channel, outcome, names, {
            ...PLAYBACK, trainers: trainersOf(live, outcome), auras: aurasOf(live, outcome), vs: vsOf(outcome, names, live),
          }).catch((err) => console.warn("⚠️ dashboard battle post failed:", err?.message || err));
        }
        return res.json({ ok: true, result: battleResultView(outcome, id, names), fightId, posted: where(t) });
      } finally {
        inFlight.delete(id);
      }
    },

    async challengePreview(req, res) {
      const id = gate(req, res, req.query.id);
      if (!id) return;
      const key = String(req.query.key ?? "");
      if (!CHALLENGE_KEYS.includes(key)) return res.status(400).json({ error: "Unknown challenge" });
      const trainerData = getTrainerData();
      const user = trainerData[id];
      if (isRunStale(user, now())) await finishStaleRun({ trainerData, userId: id, lockUser, enqueueSave, client, playerName: await memberName(id) });
      const block = challengeBlock({ trainerData, userId: id, key, now: now() });
      if (block) return res.json({ ok: false, reason: block, error: challengeRefusalText(block, trainerData[id]) });
      const shown = previewChallenge(trainerData[id], key);
      previews.set(id, { key, loss: shown.loss, at: now().getTime() });
      const { player, trainers } = previewTrainers(key, trainerData[id], await memberName(id), env);
      const challenge = CHALLENGES[key];
      return res.json({
        ok: true,
        key,
        label: challenge.label,
        opponents: challenge.opponents.map((o) => opponentName(o)),
        player,
        trainers,
        badge: challenge.badge?.badge ?? null,
        type: challenge.badge?.type ?? null,
        prize: shown.prize ? prizeText(key, shown.prize) : null,
        loss: shown.loss,
        lossText: `${n(shown.loss)} CC`,
        picks: availablePicks(trainerData[id]),
        expiresInMs: CHALLENGE.previewMs,
      });
    },

    async startChallenge(req, res) {
      const body = req.body ?? {};
      const id = gate(req, res, body.id);
      if (!id) return;
      const key = String(body.key ?? "");
      const pick = body.pick === "ranked" ? "ranked" : "casual";
      if (!CHALLENGE_KEYS.includes(key)) return res.status(400).json({ error: "Unknown challenge" });
      const refuse = (reason, status = 409) => res.status(status).json({ ok: false, reason, error: challengeRefusalText(reason, getTrainerData()[id]) });
      // The loss shown in the preview is the most a loss can cost, as in /challenge.
      const shown = previews.get(id);
      if (!shown || shown.key !== key || now().getTime() - shown.at > CHALLENGE.previewMs) return refuse("no_preview");
      const running = runs.get(id);
      if (inFlight.has(id) || (running && running.stage !== "done")) return refuse("busy");
      inFlight.add(id);
      try {
        previews.delete(id);
        const playerName = await memberName(id);
        const t = await target("challenge", req);
        const isRun = key === "elite4";
        const first = await lockUser(id, async () => {
          const live = getTrainerData()[id];
          const atStake = live && previewChallenge(live, key);
          const card = live && cardView(key, atStake, live, playerName, pick);
          const seed = randomInt(0, 2 ** 31 - 1);
          const out = isRun
            ? startRun({ trainerData: getTrainerData(), userId: id, seed, maxLoss: shown.loss, channelId: t.id ?? null, pick, now: now() })
            : runChallenge({ trainerData: getTrainerData(), userId: id, key, seed, maxLoss: shown.loss, pick, now: now() });
          if (out.ok) await save();
          return { ...out, atStake, card };
        });
        if (!first.ok) return refuse(first.reason);

        const trainer = first.card?.player.trainerFile ?? null;
        const aura = first.card?.player.tier;
        let posted = !!t.channel;
        if (t.channel) {
          try {
            await t.channel.send(await previewMessage(key, first.atStake, first.card));
          } catch (err) {
            console.warn("⚠️ dashboard challenge post failed:", err?.message || err);
            posted = false;
          }
        }

        if (!isRun) {
          const fightId = record(id, first, playerName);
          if (posted) {
            playChallenge(t.channel, first, challengeNames(first, playerName), { ...PLAYBACK, trainer, aura })
              .catch((err) => console.warn("⚠️ dashboard challenge replay failed:", err?.message || err));
          }
          return res.json({ ok: true, result: challengeResultView(first), fightId, posted: posted ? where(t) : null });
        }

        startRunPlayback({ userId: id, first, channel: posted ? t.channel : null, where: posted ? where(t) : null, playerName, trainer, aura });
        return res.json({ ok: true, run: runView(id), posted: posted ? where(t) : null });
      } finally {
        inFlight.delete(id);
      }
    },

    run(req, res) {
      const id = gate(req, res, req.query.id);
      if (!id) return;
      return res.json({ run: runView(id) });
    },

    revive(req, res) {
      const body = req.body ?? {};
      const id = gate(req, res, body.id);
      if (!id) return;
      const st = runs.get(id);
      const pick = st?.pick;
      const slot = Number(body.slot);
      if (!pick || pick.nonce !== body.nonce || pick.step !== Number(body.step)) {
        return res.status(409).json({ ok: false, error: "Too late. No Pokémon was revived." });
      }
      if (!pick.fainted.some((f) => f.slot === slot)) return res.status(400).json({ ok: false, error: "Pick a fainted Pokémon." });
      pick.answer(slot);
      return res.json({ ok: true, run: runView(id) });
    },
  };

  // Event log line and Fight record for a finished Challenge; returns the record id.
  function record(userId, outcome, playerName, extra = {}) {
    logEvent("challenge", userId, { ...challengeLogEntry(outcome), ...extra, via: "dashboard" });
    let fightId = null;
    recordFight(() => {
      const r = challengeRecord(outcome, playerName, getTrainerData());
      fightId = r.id;
      return r;
    });
    return fightId;
  }

  // Plays an Elite Four run in the background. The Revive pick comes from
  // the page (POST /api/battle/revive) within CHALLENGE.pickMs; no pick, a
  // closed tab or an expired session means no Revive, as in Discord.
  function startRunPlayback({ userId, first, channel, where: postedTo, playerName, trainer, aura }) {
    const st = { userId, nonce: first.nonce, stage: "playing", fight: 0, posted: !!channel, where: postedTo, pick: null, result: null, fightId: null, doneAt: 0 };
    runs.set(userId, st);
    const revive = (latest, step) => new Promise((resolve) => {
      let settled = false;
      const finish = (slot) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        st.pick = null;
        st.stage = "playing";
        resolve({ slot, click: latest });
      };
      const timer = setTimeout(() => finish(null), CHALLENGE.pickMs);
      st.stage = "revive";
      st.pick = {
        nonce: step.nonce, step: step.step + 1, next: step.next, fainted: step.fainted,
        deadline: now().getTime() + CHALLENGE.pickMs, answer: finish,
      };
    });
    const pace = channel ? null : (shown, i) => wait(replayEstimateMs(shown.fights?.[i]));
    playing.add(first.nonce);
    (async () => {
      try {
        const played = await playRun({
          channel, fightClick: null, step: first, trainerData: getTrainerData(), userId, lockUser, enqueueSave, playerName, trainer, aura,
          revive, pace, onStep: (step) => { st.fight = step.step; },
        });
        if (!played) {
          st.result = null; // finished elsewhere (a stale finish shows the result in the channel)
        } else {
          st.result = challengeResultView(played.outcome);
          st.fightId = record(userId, played.outcome, playerName);
          st.posted = st.posted && played.posted;
        }
      } catch (err) {
        console.warn("⚠️ dashboard Elite Four run failed:", err?.message || err);
      } finally {
        playing.delete(first.nonce);
        st.stage = "done";
        st.pick = null;
        st.doneAt = now().getTime();
      }
    })();
  }

  return handlers;
}
