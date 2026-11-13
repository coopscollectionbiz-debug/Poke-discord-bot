// ==========================================================
// utils/battle/showdown/result.js — a finished Showdown battle as our
// fight result.
//
// It reads the battle's protocol log once and returns today's result
// shape (winner, turns, endedBy, snapshots, knockouts, log: what playback,
// EXP and the Fight record pages read) plus the v2 fields:
//   steps      per turn, everything that happened, in our own event kinds:
//              move · hp (an HP change, `from` naming its cause when it
//              wasn't the move's hit) · switch · status · faint · note
//   raw        the protocol log itself, without timestamps
//   endStatus  each slot's major status when the fight ended (the Elite
//              Four carries it into the next fight)
// Events before turn 1 (lead switch-ins, entry abilities) open turn 1.
//
// HP comes from the private copy of each `|split|` pair, which has exact
// HP for that side. A knockout counts for the opposing Pokémon on the field
// when the faint happens (spec, "KO credit").
//
// Each step that isn't a hit is also narrated (utils/battle/narrate.js)
// onto the hit around it, in the fields both replayers already show: steps
// before a turn's first hit go in its preNotes, the rest in the latest
// hit's notes. A faint the hit already tells ("X fainted!") isn't repeated.
// ==========================================================

import { stepText } from "../narrate.js";

const ident = (s) => {
  const m = /^p([12])[a-z]?: s(\d+)$/.exec(s ?? "");
  return m ? { side: Number(m[1]) - 1, slot: Number(m[2]) } : null;
};
const tag = (parts, name) => parts.find((p) => p.startsWith(`[${name}]`))?.slice(name.length + 3).trim();
// "123/245 psn" or "0 fnt" → { hp, max, status }
const condition = (s) => {
  const [hpPart, status = ""] = (s ?? "").split(" ");
  const [hp, max] = hpPart.split("/").map(Number);
  return { hp, max: max || null, status: status === "fnt" ? "" : status };
};

/** The log with each `|split|` pair reduced to its exact-HP (private) copy, without timestamps. */
export function exactLog(b) {
  const out = [];
  for (let i = 0; i < b.log.length; i++) {
    const line = b.log[i];
    if (line.startsWith("|split|")) { out.push(b.log[i + 1]); i += 2; continue; }
    if (!line.startsWith("|t:|")) out.push(line);
  }
  return out;
}

const NOTE_KINDS = new Set([
  "-weather", "-fieldstart", "-fieldend", "-sidestart", "-sideend", "-boost", "-unboost", "-setboost", "-clearallboost",
  "-clearboost", "-ability", "-item", "-enditem", "cant", "-activate", "-start", "-end", "-fail", "-message",
  "-singleturn", "-singlemove", "-transform", "-prepare", "-mega", "-formechange", "detailschange", "-hint", "-block",
]);

/**
 * @param b        the finished (or capped) Battle
 * @param initial  [side][slot] HP fraction each member started with (0 for one left out)
 * @param cappedAt the turn cap, if drive() stopped there
 * @param names    [side][slot] each member's name, for the narration
 * @param conditions what drive's onTurn recorded (showdown/conditions.js), kept as result.conditions
 */
export function buildResult(b, { initial, cappedAt = null, names = initial.map((s) => s.map((_, i) => `#${i}`)), conditions = null }) {
  const lines = exactLog(b);
  const hp = initial.map((s) => [...s]);
  const hpPoints = initial.map((s) => s.map(() => null)); // exact HP once seen
  const active = [null, null];
  const snapshots = [initial.map((s) => [...s])];
  const knockouts = [];
  const log = [];
  const steps = [];
  let turn = 0, events = [], turnSteps = [], preface = [], cur = null, lastFaintSide = null;
  const lastFrom = new Map(); // "side:slot" → cause of the last HP change

  const setHp = (p, cond) => {
    const c = condition(cond);
    if (c.max) {
      const before = hpPoints[p.side][p.slot];
      hpPoints[p.side][p.slot] = c.hp;
      hp[p.side][p.slot] = c.hp / c.max;
      return { lost: before === null ? 0 : before - c.hp, status: c.status };
    }
    hp[p.side][p.slot] = c.hp === 0 ? 0 : hp[p.side][p.slot];
    return { lost: 0, status: c.status };
  };
  let waiting = []; // narration for the next hit
  const told = (step) => step.kind === "faint" && cur
    && ((cur.fainted && step.side !== cur.side && step.slot === cur.targetSlot) || (cur.userFainted && step.side === cur.side && step.slot === cur.slot));
  const push = (step) => {
    (turn === 0 ? preface : turnSteps).push(step);
    if (step.kind === "move" || told(step)) return;
    const text = stepText(step, names);
    if (!text) return;
    if (cur) (cur.notes ??= []).push(text); else waiting.push(text);
  };
  const closeTurn = () => {
    if (waiting.length && events.length) (events.at(-1).endNotes ??= []).push(...waiting.splice(0));
    log.push(events);
    steps.push(turn === 1 ? [...preface, ...turnSteps] : turnSteps);
    snapshots.push(hp.map((s) => [...s]));
    events = [];
    turnSteps = [];
    cur = null;
  };

  for (const line of lines) {
    const parts = line.split("|");
    const kind = parts[1];
    if (kind === "turn") {
      const n = Number(parts[2]);
      if (n > 1) closeTurn();
      turn = n;
      continue;
    }
    if (kind === "switch" || kind === "drag") {
      const p = ident(parts[2]);
      if (!p) continue;
      setHp(p, parts[4]);
      active[p.side] = p.slot;
      push({ kind: "switch", ...p, ...(kind === "drag" && { drag: true }) });
      continue;
    }
    if (kind === "move") {
      const p = ident(parts[2]);
      if (!p) continue;
      const target = ident(parts[4]);
      cur = {
        side: p.side, slot: p.slot, targetSlot: target?.side === 1 - p.side ? target.slot : active[1 - p.side],
        move: parts[3], damage: 0, crit: false, eff: 1, missed: parts.includes("[miss]"),
      };
      if (waiting.length) cur.preNotes = waiting.splice(0);
      events.push(cur);
      push({ kind: "move", side: p.side, slot: p.slot, target: cur.targetSlot, move: parts[3] });
      continue;
    }
    if (kind === "-damage" || kind === "-heal") {
      const p = ident(parts[2]);
      if (!p) continue;
      const from = tag(parts, "from");
      const { lost } = setHp(p, parts[3]);
      push({ kind: "hp", ...p, hpAfter: hp[p.side][p.slot], ...(from && { from }), ...(kind === "-heal" && { heal: true }) });
      lastFrom.set(`${p.side}:${p.slot}`, kind === "-damage" ? from ?? "move" : lastFrom.get(`${p.side}:${p.slot}`));
      if (!cur) continue;
      if (kind === "-damage" && !from && p.side !== cur.side) {
        cur.damage += lost;
        cur.hpAfter = hp[p.side][p.slot];
        cur.fainted = hp[p.side][p.slot] === 0;
      } else if (p.side === cur.side && p.slot === cur.slot) {
        if (kind === "-heal" && from === "drain") cur.drain = -lost;
        if (kind === "-damage" && from === "Recoil") cur.recoil = lost;
        cur.userHpAfter = hp[p.side][p.slot];
        cur.userFainted = hp[p.side][p.slot] === 0;
      }
      continue;
    }
    if (kind === "-status" || kind === "-curestatus") {
      const p = ident(parts[2]);
      if (p) push({ kind: "status", ...p, status: kind === "-status" ? parts[3] : "", ...(kind === "-curestatus" && { cured: parts[3] }) });
      continue;
    }
    if (kind === "faint") {
      const p = ident(parts[2]);
      if (!p) continue;
      hp[p.side][p.slot] = 0;
      const cause = lastFrom.get(`${p.side}:${p.slot}`) ?? "move";
      knockouts.push({ turn: Math.max(1, turn), side: p.side, slot: p.slot, bySide: 1 - p.side, bySlot: active[1 - p.side], cause });
      push({ kind: "faint", ...p, cause });
      lastFaintSide = p.side;
      continue;
    }
    if (kind === "-crit" && cur) { cur.crit = true; continue; }
    if (kind === "-supereffective" && cur) { cur.eff = 2; continue; }
    if (kind === "-resisted" && cur) { cur.eff = 0.5; continue; }
    if (kind === "-immune" && cur) { cur.eff = 0; continue; }
    if (kind === "-miss" && cur) { cur.missed = true; continue; }
    if (kind === "-hitcount" && cur) { cur.hits = Number(parts[3]); continue; }
    if (NOTE_KINDS.has(kind)) push({ kind: "note", type: kind.replace(/^-/, ""), args: parts.slice(2) });
  }

  const raw = b.log.filter((l) => !l.startsWith("|t:|"));
  const endStatus = initial.map((s) => s.map(() => ""));
  for (const [side, s] of b.sides.entries()) for (const p of s.pokemon) if (p.hp > 0) endStatus[side][Number(p.name.slice(1))] = p.status ?? "";

  if (cappedAt !== null) {
    // The last `|turn|` marker (cap + 1) already closed the final turn.
    const total = (i) => snapshots.at(-1)[i].reduce((a, v) => a + v, 0);
    return { winner: total(0) > total(1) ? 0 : 1, turns: cappedAt, endedBy: "turnCap", snapshots, knockouts, log, v: 2, steps, raw, endStatus, ...(conditions && { conditions }) };
  }
  closeTurn();
  const winner = b.winner === "p1" ? 0 : b.winner === "p2" ? 1 : lastFaintSide;
  return { winner, turns: Math.max(1, turn), endedBy: "knockout", snapshots, knockouts, log, v: 2, steps, raw, endStatus, ...(conditions && { conditions }) };
}

