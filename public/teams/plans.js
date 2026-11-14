// ==========================================================
// public/teams/plans.js — the Teams page's Battle plan row (full sim).
// The Casual and Ranked tabs show the Team's plan, what it does, and who
// on the Team helps it, or how to get it going; the Moves editor marks the
// recommended moves and can fill them in. The row is absent while the full
// sim is off, and on the Showcase team, which never fights. GET /api/battle-plans and POST
// /api/battle-plan (services/battlePlansApi.js); the server checks every rule.
// The render helpers are pure, so tests/teamsPlans.test.js runs them in Node.
// ==========================================================

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const list = (word) => (names) => (names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} ${word} ${names.at(-1)}`);
const or = list("or");
const and = list("and");

/** The readiness line under the plan, or "" for All-out attack. */
export function readinessLine(view) {
  if (!view || view.plan === "allout") return "";
  const r = view.readiness;
  if (r.ready) {
    const who = r.helpers.map((h) => `${h.name} (${[...h.moveNames, ...(h.ability ? [h.ability] : [])].join(", ")})`);
    return `${and(who)} ${who.length === 1 ? "helps" : "help"} this plan.`;
  }
  if (r.noWeather) return "No weather helps this Team's types or abilities, so it plays as All-out attack.";
  const how = r.howTo
    ? (r.howTo.known ? `${r.howTo.name} already knows ${r.howTo.moveName}, so add it to its Moveset.` : `${r.howTo.name} learns ${r.howTo.moveName} at Lv ${r.howTo.level}.`)
    : "Nobody on this Team learns one by leveling up.";
  return `Plays as All-out attack until a Pokémon brings ${or(r.missingNames ?? r.missing ?? [])}. ${how}`;
}

/** The plan row for Team `team`, or "" when it has none. */
export function planRowHtml(team, plans) {
  const view = plans?.enabled ? plans.teams?.[team] : null;
  if (!view) return "";
  const plan = plans.plans.find((p) => p.id === view.plan) ?? plans.plans[0];
  const line = readinessLine(view);
  const options = plans.plans.map((p) => `<option value="${esc(p.id)}"${p.id === view.plan ? " selected" : ""}>${esc(p.name)}</option>`).join("");
  return `<div class="tm-plan" data-team="${esc(team)}">
    <label class="tm-plan-label" for="plan-${esc(team)}">Battle plan</label>
    <select id="plan-${esc(team)}" class="tm-plan-select" data-act="plan" data-team="${esc(team)}">${options}</select>
    <p class="tm-sub tm-plan-blurb">${esc(plan?.blurb)}</p>
    ${line ? `<p class="tm-plan-ready${view.readiness.ready ? " is-ready" : ""}" role="status">${esc(line)}</p>` : ""}
  </div>`;
}

// This slot's row in the Team's plan view: its copy's, else its line's.
function slotRow(plans, team, s) {
  const slots = plans?.teams?.[team]?.slots ?? [];
  return slots.find((x) => x.speciesId === Number(s.id) && x.variant === s.variant && (x.uid ?? null) === (s.uid ?? null))
    ?? slots.find((x) => x.speciesId === Number(s.id) && x.variant === s.variant);
}

/** The moves the Moves editor marks Recommended and "Use recommended moves" fills in: { moves, planName }, or null. */
export function recommendedFor(plans, team, s) {
  const rec = slotRow(plans, team, s)?.recommended;
  if (!rec?.moves?.length) return null;
  const plan = plans.plans.find((p) => p.id === plans.teams[team].plan);
  return { moves: rec.moves, planName: plan?.name ?? "" };
}

export async function loadPlans(userId) {
  const res = await fetch(`/api/battle-plans?${new URLSearchParams({ id: userId })}`, { credentials: "same-origin" });
  if (!res.ok) return { enabled: false, plans: [], teams: {} };
  const body = await res.json();
  return { enabled: !!body.enabled, plans: body.plans ?? [], teams: body.teams ?? {} };
}

/** → the Team's new view, or throws with the server's message. */
export async function savePlan(userId, team, plan) {
  const res = await fetch("/api/battle-plan", {
    method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: userId, team, plan }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.success) throw Object.assign(new Error(body.error || "Couldn’t save the Battle plan."), { status: res.status });
  return body.view;
}
