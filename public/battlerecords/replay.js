// ==========================================================
// public/battlerecords/replay.js — the full-screen replay viewer.
// Draws replaySteps() (records.js) in the browser: the viewer's Pokémon
// bottom left, the opponent's top right, HP bars, party pips, a caption,
// and a VS intro per fight. Play/pause, previous/next turn, 1×/2× speed
// and a scrubber over every step. Esc or the browser's back closes it.
// No Tier backdrops or trainer card effects (docs/design/battle-records.md).
// ==========================================================

import { scanFx } from "/public/shared/spriteFx.js";
import { replaySteps, stepForTurn, pokemonSprite, trainerSprite } from "/public/battlerecords/records.js";

const dialog = document.getElementById("brViewer");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const FALLBACK = `onerror="this.onerror=null;this.src='/public/sprites/items/pokeball.png'"`;
const BASE_MS = { intro: 1800, note: 1400, move: 1300, faint: 1100, result: 2200 };
const reduceMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

let state = null; // { record, me, mine, steps, at, playing, speed, timer, onClose }

const hpClass = (f) => (f <= 0.2 ? "low" : f <= 0.5 ? "mid" : "");

function sideHtml(step, side, cls) {
  const slot = step.active[side];
  const m = step.members[side][slot];
  const hp = step.hp[side][slot] ?? 0;
  const pips = Array.from({ length: 6 }, (_, i) => {
    const has = i < step.members[side].length;
    return `<i class="${!has ? "empty" : step.hp[side][i] <= 0 ? "out" : ""}"></i>`;
  }).join("");
  const shiny = m.variant === "shiny";
  return `<div class="rv-side ${cls}">
    <div class="rv-card"><div class="nm"><span>${esc(m.name)}${shiny ? " ✨" : ""}</span><small>Lv ${m.level}</small></div>
      <div class="rv-hp" role="img" aria-label="${esc(m.name)} HP ${Math.round(hp * 100)}%"><i class="${hpClass(hp)}" style="width:${Math.max(0, hp) * 100}%"></i></div>
      <div class="rv-pips" aria-hidden="true">${pips}</div></div>
    <div class="rv-mon${hp <= 0 ? " faint" : ""}" data-side="${side}" ${shiny ? `data-fx="shiny" data-fx-seed="${m.speciesId}"` : ""}>
      <img src="${pokemonSprite(m)}" alt="" ${FALLBACK}></div>
  </div>`;
}

function introHtml(step) {
  const r = state.record;
  const me = r.sides[state.mine];
  return `<div class="rv-intro">
    <div><img src="${trainerSprite(me.trainer)}" alt="" ${FALLBACK}><p>${esc(me.name)}</p></div>
    <div><div class="vs">VS</div><p class="sub">${esc(step.heading)}</p></div>
    <div><img src="${trainerSprite(step.foe?.trainer)}" alt="" ${FALLBACK}><p>${esc(step.foe?.name ?? "")}</p></div>
  </div>`;
}

function draw() {
  const s = state.steps[state.at];
  const stage = dialog.querySelector(".rv-stage");
  const mine = state.mine;
  stage.innerHTML = s.kind === "intro" || !s.members ? introHtml(s) : `${sideHtml(s, 1 - mine, "foe")}${sideHtml(s, mine, "me")}`;
  if (s.kind === "move" && !reduceMotion()) {
    const atk = stage.querySelector(`.rv-mon[data-side="${s.attacker.side}"]`);
    const tgt = stage.querySelector(`.rv-mon[data-side="${s.target.side}"]`);
    atk?.classList.add("attack");
    if (s.damage > 0 && tgt) {
      tgt.classList.add("hit");
      const d = document.createElement("span");
      d.className = "rv-dmg";
      d.textContent = `−${s.damage}%`;
      const box = tgt.getBoundingClientRect(), host = stage.getBoundingClientRect();
      d.style.left = `${box.left - host.left + box.width / 2 - 20}px`;
      d.style.top = `${box.top - host.top + 10}px`;
      stage.append(d);
    }
  }
  dialog.querySelector(".rv-caption").textContent = s.caption;
  dialog.querySelector(".rv-turn").textContent = s.turns && s.turn ? `Turn ${s.turn} of ${s.turns}` : "";
  dialog.querySelector(".rv-top h2").textContent = s.heading ?? "";
  const range = dialog.querySelector("input[type=range]");
  range.value = String(state.at);
  range.setAttribute("aria-valuetext", `Step ${state.at + 1} of ${state.steps.length}${s.turn ? `, turn ${s.turn}` : ""}`);
  const play = dialog.querySelector("[data-act=play]");
  play.textContent = state.playing ? "❚❚" : "▶";
  play.setAttribute("aria-label", state.playing ? "Pause" : "Play");
  scanFx(stage);
}

function schedule() {
  clearTimeout(state.timer);
  if (!state.playing) return;
  const s = state.steps[state.at];
  state.timer = setTimeout(() => {
    if (state.at >= state.steps.length - 1) { state.playing = false; draw(); return; }
    state.at++;
    draw();
    schedule();
  }, BASE_MS[s.kind] / state.speed);
}

function go(at, { keepPlaying = true } = {}) {
  state.at = Math.max(0, Math.min(state.steps.length - 1, at));
  if (!keepPlaying) state.playing = false;
  draw();
  schedule();
}

function act(name) {
  if (!state) return;
  if (name === "play") {
    if (!state.playing && state.at >= state.steps.length - 1) state.at = 0;
    state.playing = !state.playing;
    draw();
    schedule();
  } else if (name === "next") go(stepForTurn(state.steps, state.at, 1));
  else if (name === "prev") go(stepForTurn(state.steps, state.at, -1));
  else if (name === "speed") {
    state.speed = state.speed === 1 ? 2 : 1;
    dialog.querySelector("[data-act=speed]").textContent = `${state.speed}×`;
    schedule();
  } else if (name === "close") dialog.close();
}

/** Opens the viewer on a full record. `onClose` runs when it closes. */
export function openReplay(record, me, { onClose = () => {} } = {}) {
  if (state?.record.id === record.id && dialog.open) return;
  if (state) clearTimeout(state.timer);
  const steps = replaySteps(record, me);
  const mine = Math.max(0, record.sides.findIndex((s) => s.id === String(me)));
  state = { record, me, mine, steps, at: 0, playing: !reduceMotion(), speed: 1, timer: null, onClose };
  dialog.innerHTML = `<div class="rv">
    <div class="rv-top"><h2></h2><span class="rv-turn" aria-live="off"></span>
      <button type="button" class="cc-btn" data-act="close" aria-label="Close replay">✕</button></div>
    <div class="rv-stage"></div>
    <p class="rv-caption" aria-live="polite"></p>
    <div class="rv-controls">
      <button type="button" class="cc-btn" data-act="prev" aria-label="Previous turn">⏮</button>
      <button type="button" class="cc-btn cc-btn--primary" data-act="play" aria-label="Pause">❚❚</button>
      <button type="button" class="cc-btn" data-act="next" aria-label="Next turn">⏭</button>
      <input type="range" min="0" max="${steps.length - 1}" value="0" step="1" aria-label="Replay position">
      <button type="button" class="cc-btn" data-act="speed" aria-label="Playback speed">1×</button>
    </div></div>`;
  dialog.querySelector(".rv-controls").addEventListener("click", (e) => { const b = e.target.closest("[data-act]"); if (b) act(b.dataset.act); });
  dialog.querySelector(".rv-top").addEventListener("click", (e) => { if (e.target.closest("[data-act=close]")) act("close"); });
  dialog.querySelector("input[type=range]").addEventListener("input", (e) => go(Number(e.target.value), { keepPlaying: false }));
  if (!dialog.open) dialog.showModal();
  draw();
  schedule();
  dialog.querySelector("[data-act=play]").focus();
}

/** Closes the viewer if open (the hash was cleared). */
export function closeReplay() {
  if (dialog.open) dialog.close();
}

dialog.addEventListener("close", () => {
  if (!state) return;
  clearTimeout(state.timer);
  const { onClose } = state;
  state = null;
  dialog.innerHTML = "";
  onClose();
});

dialog.addEventListener("keydown", (e) => {
  if (!state || e.target.matches("input[type=range]") && (e.key === "ArrowLeft" || e.key === "ArrowRight")) return;
  if (e.key === " " && !e.target.matches("button")) { e.preventDefault(); act("play"); }
  else if (e.key === "ArrowRight") { e.preventDefault(); act("next"); }
  else if (e.key === "ArrowLeft") { e.preventDefault(); act("prev"); }
});
