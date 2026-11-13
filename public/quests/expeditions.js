// ==========================================================
// public/quests/expeditions.js: the Expeditions tab (Quests, Phase 2).
// Data: GET /api/expeditions. Send: POST /api/expeditions/send. Claim:
// POST /api/expeditions/claim. Both writes carry a requestId.
// The success chance shown while picking uses the server's formula and the
// counters it sends; the server's own figure (at send) is the one that counts.
// All text is inserted with textContent, never as HTML.
// ==========================================================

import { showExpired, toast, confirmDialog, showMessage } from "/public/shared/shell.js";

const userId = new URLSearchParams(window.location.search).get("id");
const $ = (id) => document.getElementById(id);
let data = null;
let picking = null; // { mission, party: [uid] }
let skew = 0; // server clock minus this device's clock
const serverNow = () => Date.now() + skew;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
const typeChip = (t) => { const s = el("span", "cc-type", t); s.dataset.type = t.toLowerCase(); return s; };
const newRequestId = () => (globalThis.crypto?.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);
const pct = (p) => `${Math.round(p * 100)}%`;

// "Returns in: 1:02:03" (live; ticks every second below).
function returnsIn(at) {
  const secs = Math.max(0, Math.ceil((at - serverNow()) / 1000));
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), sec = secs % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return `Returns in: ${h ? `${h}:${pad(m)}` : m}:${pad(sec)}`;
}

// Same formula as services/expeditions.js successChance.
function chanceFor(mission, party) {
  if (!party.length) return 0;
  const countered = mission.threats.filter((th) => party.some((c) => c.types.some((t) => th.counters.includes(t)))).length;
  const avg = party.reduce((t, c) => t + c.level, 0) / party.length;
  const diff = avg - mission.level;
  const p = 0.35 + 0.6 * (countered / mission.threats.length) + (diff >= 0 ? diff * 0.01 : diff * 0.03);
  return Math.min(0.95, Math.max(0.05, p));
}

// ---------- tabs ----------
function selectTab(which) {
  const exp = which === "exp";
  $("tabDaily").setAttribute("aria-selected", String(!exp));
  $("tabExp").setAttribute("aria-selected", String(exp));
  $("dailyPanel").hidden = exp;
  $("expPanel").hidden = !exp;
  try { localStorage.setItem("questsTab", which); } catch {}
}

// ---------- render ----------
function render() {
  $("expSlots").textContent = `${data.slots.used} of ${data.slots.max} running`;
  const c = data.caps;
  $("expCaps").textContent = `This week from Expeditions: ${c.stones[0]}/${c.stones[1]} Evolution Stones · ${c.dust[0]}/${c.dust[1]} Shiny Dust · ${c.pokemon[0]}/${c.pokemon[1]} Pokémon · ${c.tms[0]}/${c.tms[1]} TM`;
  $("expStatus").textContent = data.enabled ? "" : "New Expeditions aren't open. You can still bring back the ones running.";

  const running = $("expRunning");
  running.replaceChildren();
  for (const r of data.running) {
    r.done = r.done || serverNow() >= r.endsAt; // the clock may pass endsAt between loads
    const card = el("article", `quest-reward exp-run${r.done ? " done" : ""}`);
    card.append(el("h3", null, `${r.done ? "🏁" : "🧭"} ${r.mission.name} · ${r.mission.hours} h`));
    card.append(el("p", "desc", `${r.party.map((p) => `${p.shiny ? "✨" : ""}${p.name}`).join(", ")} · ${pct(r.chance)} chance`));
    if (r.done) {
      const b = el("button", "buy-btn quest-claim", "Bring them back");
      b.onclick = () => claim(r.id, b);
      card.append(b);
    } else {
      const timer = el("p", "usage exp-timer", returnsIn(r.endsAt));
      timer.dataset.ends = String(r.endsAt);
      card.append(timer);
    }
    running.append(card);
  }

  const grid = $("expMissions");
  grid.replaceChildren();
  for (const m of data.missions) {
    const card = el("article", `shop-item quest-card exp-mission${m.taken ? " claimed" : ""}`);
    card.append(el("h3", null, `${m.name}`));
    card.append(el("p", "tier", `${m.hours} h · Lv ${m.level}`));
    const threats = el("p", "exp-threats");
    threats.append(el("span", "exp-label", "Threats "), ...m.threats.map((t) => typeChip(t.type)));
    card.append(threats);
    const L = m.hours, loot = data.loot;
    const bits = [`${loot.ccPerHour * L} CC`, `${Math.round(loot.stoneChance[L] * 100)}% Evolution Stone`];
    if (loot.dust[L]) bits.push(`${loot.dust[L]} Shiny Dust`);
    if (loot.pokemonChance[L]) bits.push(`${Math.round(loot.pokemonChance[L] * 100)}% Pokémon`);
    if (loot.tmChance[L]) bits.push(`${Math.round(loot.tmChance[L] * 100)}% TM`);
    card.append(el("p", "desc", `On success: ${bits.join(" · ")}, plus EXP`));
    if (m.taken) card.append(el("p", "usage", "Taken today"));
    else if (data.enabled) {
      const b = el("button", "buy-btn", "Send a party");
      b.disabled = data.slots.used >= data.slots.max;
      if (b.disabled) b.title = "Both Expedition slots are in use";
      b.onclick = () => openPicker(m);
      card.append(b);
    }
    grid.append(card);
  }
}

// ---------- party picker ----------
function openPicker(mission) {
  picking = { mission, party: [] };
  const line = $("expPickerMission");
  line.replaceChildren(el("strong", null, `${mission.name} · ${mission.hours} h · Lv ${mission.level} `), ...mission.threats.map((t) => typeChip(t.type)));
  const sel = $("expType");
  if (sel.options.length === 1) {
    for (const t of [...new Set(data.copies.flatMap((c) => c.types))].sort()) { const o = el("option", null, t); o.value = t; sel.append(o); }
  }
  $("expSearch").value = "";
  $("expCounters").checked = false;
  renderPicker();
  $("expPicker").showModal();
}

const countersAny = (c) => picking.mission.threats.some((th) => c.types.some((t) => th.counters.includes(t)));

function renderPicker() {
  const { mission, party } = picking;
  const chosen = party.map((uid) => data.copies.find((c) => c.uid === uid)).filter(Boolean);
  $("expChance").textContent = chosen.length ? `Success chance: ${pct(chanceFor(mission, chosen))}` : `Pick up to ${data.partyMax} Pokémon.`;

  const partyList = $("expParty");
  partyList.replaceChildren();
  for (const c of chosen) {
    const li = el("li", "exp-pick picked");
    const b = el("button", null, `✕ ${c.shiny ? "✨" : ""}${c.name} Lv ${c.level}`);
    b.type = "button";
    b.setAttribute("aria-label", `Remove ${c.name} from the party`);
    b.onclick = () => { picking.party = party.filter((u) => u !== c.uid); renderPicker(); };
    li.append(b);
    partyList.append(li);
  }

  const q = $("expSearch").value.trim().toLowerCase();
  const type = $("expType").value;
  const onlyCounters = $("expCounters").checked;
  const list = data.copies
    .filter((c) => !party.includes(c.uid))
    .filter((c) => (!q || c.name.toLowerCase().includes(q)) && (!type || c.types.includes(type)) && (!onlyCounters || countersAny(c)))
    .sort((a, b) => Number(countersAny(b)) - Number(countersAny(a)) || b.level - a.level)
    .slice(0, 60);
  const ul = $("expList");
  ul.replaceChildren();
  for (const c of list) {
    const li = el("li", "exp-pick");
    const b = el("button");
    b.type = "button";
    b.disabled = party.length >= data.partyMax;
    b.append(el("span", "exp-name", `${c.shiny ? "✨" : ""}${c.name}`), el("span", "exp-lv", `Lv ${c.level}`), ...c.types.map(typeChip));
    if (countersAny(c)) b.append(el("span", "exp-tag good", "Counter"));
    for (const t of c.teams) b.append(el("span", "exp-tag", t));
    b.onclick = () => { picking.party = [...party, c.uid]; renderPicker(); };
    li.append(b);
    ul.append(li);
  }
  if (!list.length) ul.append(el("li", "exp-empty", "No Pokémon match."));

  const teams = [...new Set(chosen.flatMap((c) => c.teams))];
  const warn = $("expWarn");
  const lines = [];
  if (teams.length) lines.push(`Sending takes them off the ${teams.length > 1 ? `${teams.slice(0, -1).join(", ")} and ${teams.at(-1)} teams` : `${teams[0]} team`}.`);
  if (teams.includes("Ranked")) lines.push("Your Ranked team will be short of 6, so Ranked and Wager battles wait until you refill it.");
  warn.textContent = lines.join(" ");
  warn.hidden = !lines.length;
  $("expSend").disabled = !chosen.length;
}

async function send() {
  const { mission, party } = picking;
  const chosen = party.map((uid) => data.copies.find((c) => c.uid === uid));
  if (chosen.some((c) => c.trained) && !(await confirmDialog({ title: "Send a TM-trained Pokémon?", message: "It keeps its TM moves and comes back with them.", okText: "Send" }))) return;
  $("expSend").disabled = true;
  const body = await post("/api/expeditions/send", { mission: mission.index, uids: party });
  if (!body) { $("expSend").disabled = false; return; }
  $("expPicker").close();
  toast(`Party sent to ${mission.name}. Returns in ${mission.hours} h. Chance ${pct(body.expedition.chance)}.`, { tone: "success" });
  await load();
}

async function claim(expedition, button) {
  button.disabled = true;
  const r = await post("/api/expeditions/claim", { expedition });
  if (!r) { button.disabled = false; return; }
  const lines = [r.expedition.success ? `Success!${r.expedition.bonus === "exp" ? " Bonus: double EXP." : r.expedition.bonus === "loot" ? " Bonus: extra loot." : ""}` : "The party came back empty-handed."];
  lines.push(`+${r.cc} CC`);
  if (r.items.evolution_stone) lines.push(`+${r.items.evolution_stone} Evolution Stone${r.items.evolution_stone > 1 ? "s" : ""}`);
  if (r.items.shiny_dust) lines.push(`+${r.items.shiny_dust} Shiny Dust`);
  for (const p of r.pokemon) lines.push(`${p.shiny ? "✨ A shiny " : ""}${p.name} joined your Collection`);
  if (r.tms.length) lines.push(`+${r.tms.length} TM`);
  for (const e of r.exp ?? []) lines.push(`${e.name}: +${e.gained} EXP${e.toLevel > e.fromLevel ? ` (Lv ${e.fromLevel} → ${e.toLevel})` : ""}`);
  if (r.capped) lines.push("Some loot was over this week's limit and wasn't paid.");
  await load(); // refresh first: the page never waits on the dialog
  showMessage({ title: r.expedition.mission.name, message: lines.join("\n"), tone: "info" });
}

async function post(url, payload) {
  let res, body;
  try {
    res = await fetch(url, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: userId, requestId: newRequestId(), ...payload }) });
    body = await res.json().catch(() => ({}));
  } catch {
    toast("Network error. Please try again.", { tone: "error" });
    return null;
  }
  if (!res.ok || !body.success) {
    if (res.status === 403 && /session/i.test(body.error || "")) showExpired();
    else toast(body.error || "That didn't work.", { tone: "error" });
    return null;
  }
  return body;
}

async function load() {
  let res;
  try {
    res = await fetch(`/api/expeditions?id=${encodeURIComponent(userId)}`, { credentials: "same-origin" });
  } catch { return; }
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.success || body.enabled === false && !body.running) return;
  data = body;
  if (Number.isFinite(body.now)) skew = body.now - Date.now();
  $("questTabs").hidden = false;
  render();
}

if (userId) {
  $("tabDaily").onclick = () => selectTab("daily");
  $("tabExp").onclick = () => selectTab("exp");
  for (const id of ["expSearch", "expType", "expCounters"]) $(id).addEventListener("input", () => picking && renderPicker());
  $("expCancel").onclick = () => $("expPicker").close();
  $("expSend").onclick = send;
  load().then(() => {
    let saved = null;
    try { saved = localStorage.getItem("questsTab"); } catch {}
    if (data && saved === "exp") selectTab("exp");
  });
  // Live countdowns: tick every second; when one reaches zero, redraw so its card offers the claim.
  setInterval(() => {
    let finished = false;
    for (const t of document.querySelectorAll(".exp-timer[data-ends]")) {
      const ends = Number(t.dataset.ends);
      if (serverNow() >= ends) finished = true;
      else t.textContent = returnsIn(ends);
    }
    if (finished && data) render();
  }, 1000);
}
