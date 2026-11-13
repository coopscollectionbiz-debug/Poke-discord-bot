// ==========================================================
// utils/battle/timeline.js — one replay image's timeline (Battle FX spec,
// docs/superpowers/specs/2026-11-13-battle-fx-design.md).
//
// turnTimeline() reads one full-sim turn's steps and returns its segments
// in order, each with its frames at ANIMATION.delayMs:
//   hit   a log event, played as today (its notes rebuilt without the
//         lines that became beats)
//   beat  a status condition landing or cured, a can't-move, an end-of-turn
//         tick, confusion, Leech Seed, or a run of stat changes, with its
//         own text line
//   line  text with no animation, only on a turn with no hit
// Each segment carries the HP, marks (status tags and stat chips) and
// spotlight at its start, so a switch shows from the next segment on.
// Playback paces the next update by the timeline's waitMs, and passes it
// to the render thread, so it is plain data. No canvas here: render.js
// imports this, not the other way round.
// ==========================================================

import { stepText, statChangesText } from "./narrate.js";
import { PLAYBACK } from "./tuning.js";

// GIF timing: 100 ms frames; an attack takes 7 of them, then the scene holds
// with sprites still moving. Discord ignores a long last-frame delay and loops
// a GIF once its regular frames run out, replaying the turn (HP jumps back
// up), so each turn runs turnMs on regular frames: longer than the ~2.5-2.8 s
// a screen recording measured between playback updates. The final frame
// still asks for the GIF maximum (~11 min) for viewers that honor it.
// Start and result images loop: with POKEMON_LOOP_FIT on, over one fitted
// loop of their sprites at 50 ms steps (idleTiming); else idleFrames per
// text screen. (render.js re-exports this.)
export const ANIMATION = { delayMs: 100, eventFrames: 7, holdFrames: 10, idleFrames: 20, turnMs: 4000, freezeMs: 655_350 };

// A beat's frames, the floor a capped beat keeps, the read margin after an
// image's last beat (today's margin after a two-hit turn: 2,000 − 2 × 700 ms),
// and the beat frames one image may use before its beats share them: the
// p95 of beat frames per image in tools/bench-battle-fx.mjs (2026-11-13, 24),
// so 95% of images play every beat at full length.
export const FX = Object.freeze({ beatFrames: 8, minBeatFrames: 4, readMs: 600, capFrames: 24 });

/** Battle FX is on unless BATTLE_FX=0. */
export const battleFx = (env = process.env) => env.BATTLE_FX !== "0";

/** A stat's short label on chips and pops. */
export const STAT_LABELS = Object.freeze({ atk: "ATK", def: "DEF", spa: "SPA", spd: "SPD", spe: "SPE", accuracy: "ACC", evasion: "EVA" });

const MAJOR = new Set(["brn", "psn", "tox", "par", "slp", "frz"]);
const CANT = new Set(["slp", "frz", "par"]);
const copy = (rows) => rows.map((r) => [...r]);
const copyMarks = (m) => ({ status: copy(m.status), chips: m.chips.map((c) => (c ? { ...c } : null)) });
const identOf = (s) => {
  const m = /^p([12])[a-z]?: s(\d+)$/.exec(s ?? "");
  return m ? { side: Number(m[1]) - 1, slot: Number(m[2]) } : null;
};
const fromTag = (args) => args.find((a) => a.startsWith("[from]")) ?? null;
const firstUp = (row) => row.findIndex((h) => h > 0);

/**
 * The slot in front on each side as turn `turn` starts. A full-sim result
 * says so in its switch steps (U-turn, drags, replacements); in today's
 * results the first Pokémon with HP left is always in front.
 */
export function activeAt(result, turn) {
  if (!result.steps) return result.snapshots[turn - 1].map(firstUp);
  const active = result.snapshots[0].map(firstUp);
  const before = [...result.steps.slice(0, turn - 1).flat()];
  for (const s of result.steps[turn - 1] ?? []) { if (s.kind === "move") break; before.push(s); }
  for (const s of before) if (s.kind === "switch") active[s.side] = s.slot;
  return active;
}

/** Status tags and stat chips from result.conditions[index], or null without it. */
export function marksAt(result, index) {
  const c = result.conditions?.[index];
  if (!c) return null;
  return { status: copy(c.status), chips: c.active.map((a) => (a && Object.keys(a.boosts).length ? { ...a.boosts } : null)) };
}

// Start frames, and what pacing and the GIF need. Only an image with beats
// waits longer than PLAYBACK.delayMs; each GIF keeps today's margin of
// regular frames past the next update (ANIMATION.turnMs − PLAYBACK.delayMs).
function timed(segments, end, hasBeats) {
  let at = 0;
  for (const s of segments) { s.start = at; at += s.frames; }
  const waitMs = hasBeats ? Math.max(PLAYBACK.delayMs, at * ANIMATION.delayMs + FX.readMs) : PLAYBACK.delayMs;
  const minFrames = Math.max(at + ANIMATION.holdFrames, Math.ceil((waitMs + ANIMATION.turnMs - PLAYBACK.delayMs) / ANIMATION.delayMs));
  const sample = [];
  const seen = new Set();
  for (const s of segments) if (s.kind === "beat" && !seen.has(s.fx)) { seen.add(s.fx); sample.push(s.start + Math.floor(s.frames / 2)); }
  return { segments, end, frames: at, minFrames, waitMs, hasBeats, sample };
}

// A hit's own HP changes. A status move has no hpAfter: HP stays as it was.
function applyHit(hp, e) {
  if ("hpAfter" in e) hp[1 - e.side][e.targetSlot] = e.hpAfter;
  if ("userHpAfter" in e) hp[e.side][e.slot] = e.userHpAfter;
}

/** Today's image: the hits alone, no marks (BATTLE_FX=0, today's engine). */
export function hitsTimeline(events, hpBefore, active = null) {
  const hp = copy(hpBefore);
  const segments = events.map((event) => {
    const seg = { kind: "hit", start: 0, frames: ANIMATION.eventFrames, hp: copy(hp), marks: null, active, event };
    applyHit(hp, event);
    return seg;
  });
  return timed(segments, { hp, marks: null, active }, false);
}

/**
 * Turn `turn` of a full-sim result as one image's timeline. names[side][slot]
 * are the Pokémon's names. capFrames: the beat frames this image may use
 * before its beats share them evenly (each keeps FX.minBeatFrames).
 */
export function turnTimeline(result, turn, names, { env = process.env, capFrames = FX.capFrames } = {}) {
  const events = result.log[turn - 1] ?? [];
  if (!battleFx(env) || !result.steps) return hitsTimeline(events, result.snapshots[turn - 1], activeAt(result, turn));
  const steps = result.steps[turn - 1] ?? [];
  const known = marksAt(result, turn - 1);
  const marks = known ?? { status: result.snapshots[turn - 1].map((row) => row.map(() => "")), chips: [null, null] };
  const hp = copy(result.snapshots[turn - 1]);
  // Who is in front before this turn's own switches.
  const active = result.snapshots[0].map(firstUp);
  for (const s of result.steps.slice(0, turn - 1).flat()) if (s.kind === "switch") active[s.side] = s.slot;

  const hitless = events.length === 0;
  const segments = [];
  const pre = []; // lines before the turn's first hit: its preNotes
  let hit = null; // the latest hit segment: later lines go in its notes
  let next = 0; // the next log event (the n-th move step is the n-th event)
  const at = () => ({ start: 0, hp: copy(hp), marks: known && copyMarks(marks), active: [...active] });
  const beat = (fx, who, text, extra = {}) => {
    const seg = { kind: "beat", ...at(), frames: FX.beatFrames, fx, side: who.side, slot: who.slot, text, hpChanges: [], ko: false, ...extra };
    segments.push(seg);
    return seg;
  };
  const after = (seg) => { if (seg) seg.marksAfter = known && copyMarks(marks); };
  const told = (s) => s.kind === "faint" && hit
    && ((hit.event.fainted && s.side !== hit.event.side && s.slot === hit.event.targetSlot)
      || (hit.event.userFainted && s.side === hit.event.side && s.slot === hit.event.slot));
  const line = (s) => {
    const text = told(s) ? null : stepText(s, names);
    if (!text) return;
    if (hitless) segments.push({ kind: "line", ...at(), frames: FX.beatFrames, text });
    else if (hit) (hit.event.notes ??= []).push(text);
    else pre.push(text);
  };
  const drain = (seg, s) => {
    seg.hpChanges.push([s.side, s.slot, hp[s.side][s.slot], s.hpAfter]);
    hp[s.side][s.slot] = s.hpAfter;
    if (s.hpAfter === 0) seg.ko = true;
  };

  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (s.kind === "move") {
      const { preNotes, notes, endNotes, userHpAfter, userFainted, ...rest } = events[next++];
      // buildResult credits any later HP change of the attacker this turn to
      // its hit (a burn tick after its own Splash); only drain and recoil are the hit's.
      for (let j = i + 1; j < steps.length && steps[j].kind !== "move"; j++) {
        const h = steps[j];
        if (h.kind === "hp" && h.side === rest.side && h.slot === rest.slot && (h.from === "drain" || h.from === "Recoil")) rest.userHpAfter = h.hpAfter;
      }
      if (rest.userHpAfter === 0) rest.userFainted = true;
      hit = { kind: "hit", ...at(), frames: ANIMATION.eventFrames, event: { ...rest, ...(pre.length && !segments.some((x) => x.kind === "hit") && { preNotes: pre.splice(0) }) } };
      segments.push(hit);
      applyHit(hp, rest);
      continue;
    }
    if (s.kind === "status" && (MAJOR.has(s.status) || (!s.status && s.cured))) {
      const seg = beat(s.status || "cure", s, stepText(s, names));
      marks.status[s.side][s.slot] = s.status;
      after(seg);
      continue;
    }
    if (s.kind === "note") {
      const who = identOf(s.args[0]);
      const effect = (s.args[1] ?? "").replace(/^move: /, "");
      if (who && s.type === "start" && (effect === "confusion" || effect === "Leech Seed")) {
        after(beat(effect === "confusion" ? "confusion" : "leechseed", who, stepText(s, names)));
        continue;
      }
      if (who && s.type === "cant" && CANT.has(s.args[1])) {
        after(beat(s.args[1], who, stepText(s, names)));
        continue;
      }
      if (who && s.type === "activate" && s.args[1] === "confusion") {
        const hurt = steps[i + 1];
        if (hurt?.kind === "hp" && hurt.from === "confusion" && hurt.side === who.side && hurt.slot === who.slot) {
          const seg = beat("confusion", who, stepText(hurt, names));
          drain(seg, hurt);
          after(seg);
          i++;
        }
        continue;
      }
      if (who && (s.type === "boost" || s.type === "unboost")) {
        // A run of stat changes on one Pokémon from one cause is one beat (Shell Smash).
        const changes = [];
        const cause = fromTag(s.args);
        let j = i;
        for (; j < steps.length; j++) {
          const n = steps[j];
          if (n.kind !== "note" || (n.type !== "boost" && n.type !== "unboost") || n.args[0] !== s.args[0] || fromTag(n.args) !== cause) break;
          changes.push({ stat: n.args[1], n: Number(n.args[2]), dir: n.type });
        }
        i = j - 1;
        const moved = changes.filter((c) => c.n > 0);
        const top = [...moved].sort((a, b) => (b.dir === "boost") - (a.dir === "boost") || b.n - a.n)[0];
        const name = names[who.side]?.[who.slot] ?? "It";
        const seg = beat("stats", who, statChangesText(name, changes), {
          up: moved.some((c) => c.dir === "boost"),
          down: moved.some((c) => c.dir === "unboost"),
          pop: top ? `${STAT_LABELS[top.stat] ?? top.stat} ${(top.dir === "boost" ? "▲" : "▼").repeat(Math.min(top.n, 3))}` : null,
        });
        const chips = { ...(marks.chips[who.side] ?? {}) };
        for (const c of moved) {
          const v = Math.max(-6, Math.min(6, (chips[c.stat] ?? 0) + (c.dir === "boost" ? c.n : -c.n)));
          if (v) chips[c.stat] = v; else delete chips[c.stat];
        }
        marks.chips[who.side] = Object.keys(chips).length ? chips : null;
        after(seg);
        continue;
      }
      if (who && s.type === "setboost") {
        marks.chips[who.side] = { ...(marks.chips[who.side] ?? {}), [s.args[1]]: Number(s.args[2]) };
        line(s);
        continue;
      }
      if (s.type === "clearallboost") marks.chips = [null, null];
      if (who && s.type === "clearboost") marks.chips[who.side] = null;
      line(s);
      continue;
    }
    if (s.kind === "hp" && !s.heal && (s.from === "brn" || s.from === "psn" || s.from === "confusion" || s.from === "Leech Seed")) {
      const fx = s.from === "psn" ? (marks.status[s.side][s.slot] === "tox" ? "tox" : "psn") : s.from === "Leech Seed" ? "leechseed" : s.from;
      const seg = beat(fx, s, stepText(s, names));
      drain(seg, s);
      // Leech Seed: the seeder's heal (logged silently, with no cause) joins the beat.
      const heal = steps[i + 1];
      if (fx === "leechseed" && heal?.kind === "hp" && heal.heal && !heal.from && heal.side !== s.side) {
        drain(seg, heal);
        i++;
      }
      after(seg);
      continue;
    }
    if (s.kind === "hp") {
      hp[s.side][s.slot] = s.hpAfter;
      line(s);
      continue;
    }
    if (s.kind === "switch") {
      active[s.side] = s.slot;
      marks.chips[s.side] = null;
      continue;
    }
    if (s.kind === "faint") {
      hp[s.side][s.slot] = 0;
      marks.status[s.side][s.slot] = "";
      if (active[s.side] === s.slot) marks.chips[s.side] = null;
      line(s);
      continue;
    }
    line(s);
  }

  // Over the cap, the beats share it evenly, each keeping the floor.
  const beatSegs = segments.filter((x) => x.kind === "beat");
  if (beatSegs.length * FX.beatFrames > capFrames) {
    const each = Math.max(FX.minBeatFrames, Math.floor(capFrames / beatSegs.length));
    for (const x of beatSegs) x.frames = each;
  }
  return timed(segments, { hp, marks: known && copyMarks(marks), active: [...active] }, beatSegs.length > 0);
}
