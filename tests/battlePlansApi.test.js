// ==========================================================
// tests/battlePlansApi.test.js
// The dashboard's Battle plan endpoints (services/battlePlansApi.js):
// sessions are checked, a plan is validated and saved under the player's
// lock, and the page gets each fighting Team's plan, readiness (who helps,
// by name) and per-Pokémon recommended moves, but only while the full sim is on.
// ==========================================================

import { assertEqual, assertTrue, section, finish } from "./harness.js";
import { createBattlePlanHandlers } from "../services/battlePlansApi.js";
import { createNewUser } from "../utils/userSchema.js";
import { setPlan } from "../services/battlePlans.js";
import { setMoveset } from "../services/movesets.js";
import { autoMoveset } from "../utils/battle/moveset.js";

function player(id, speciesIds, level) {
  const u = createNewUser(id, `Trainer ${id}`);
  for (const sid of speciesIds) {
    u.pokemon[sid] = { normal: 1, shiny: 0 };
    u.training ??= {};
    u.training[`${sid}:normal`] = { exp: level ** 3 };
  }
  u.displayedPokemon = speciesIds.map((sid) => ({ id: sid, variant: "normal" }));
  return u;
}
const response = () => {
  const r = { code: 200, body: null };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
};
const setup = ({ on = true } = {}) => {
  const trainerData = { A: player("A", [25, 143], 50) };
  const calls = { locked: [], saved: 0 };
  const api = createBattlePlanHandlers({
    getTrainerData: () => trainerData,
    isAuthorized: (req, id) => req.session === id,
    lockUser: async (id, fn) => { calls.locked.push(id); return fn(); },
    saveAndAck: async () => { calls.saved++; return { saved: true }; },
    env: on ? { FULL_SIM_ENABLED: "1" } : {},
  });
  return { trainerData, calls, api };
};

section("Reading");
{
  const { api } = setup();
  const res = response();
  await api.get({ query: { id: "A" }, session: "A" }, res);
  assertEqual([res.code, res.body.enabled, res.body.plans.map((p) => p.id).length], [200, true, 6], "the page gets the six plans");
  assertEqual(Object.keys(res.body.teams), ["display", "battle"], "and both fighting Teams");
  assertEqual(res.body.teams.display.plan, "allout", "each with its plan");
  assertTrue(Array.isArray(res.body.teams.display.slots) && res.body.teams.display.slots.length === 2, "and one row per Team member");
  const pika = res.body.teams.display.slots[0];
  assertTrue(pika.recommended.moves.length >= 1 && pika.recommended.moves.length <= 4 && pika.recommended.helper === null,
    "each row carries its recommended moves (All-out attack: no plan move)");
  assertEqual("suggestions" in pika, false, "and nothing else to mark: the Moves editor marks the recommended moves");
}
{
  const { api, trainerData } = setup();
  const u = trainerData.A;
  setPlan(u, "display", "status");
  // Teams are built from the process's switch, as the bot runs them.
  const saved = process.env.FULL_SIM_ENABLED;
  process.env.FULL_SIM_ENABLED = "1";
  const res = response();
  try {
    setMoveset(u, "display", 25, "normal", ["thunderwave", ...autoMoveset(25, 50).slice(0, 3)]);
    await api.get({ query: { id: "A" }, session: "A" }, res);
  } finally { if (saved === undefined) delete process.env.FULL_SIM_ENABLED; else process.env.FULL_SIM_ENABLED = saved; }
  assertEqual(res.body.teams.display.readiness.helpers, [{ name: "Pikachu", moveNames: ["Thunder Wave"], ability: null }], "readiness names who helps, with each move's name");
  const denied = response();
  await api.get({ query: { id: "A" }, session: "B" }, denied);
  assertEqual(denied.code, 403, "another player's session is refused");
  const off = setup({ on: false });
  const offRes = response();
  await off.api.get({ query: { id: "A" }, session: "A" }, offRes);
  assertEqual([offRes.body.enabled, offRes.body.teams], [false, undefined], "with the full sim off, plans aren't offered");
}

section("Setting");
{
  const { api, trainerData, calls } = setup();
  const res = response();
  await api.set({ body: { id: "A", team: "display", plan: "status" }, session: "A" }, res);
  assertEqual([res.code, res.body.success, trainerData.A.battlePlans.display], [200, true, "status"], "a valid plan is saved");
  assertEqual([calls.locked, calls.saved], [["A"], 1], "under the player's lock, then saved");
  assertTrue(typeof res.body.view?.readiness?.ready === "boolean", "the reply carries the Team's new readiness");
  const bad = response();
  await api.set({ body: { id: "A", team: "display", plan: "nope" }, session: "A" }, bad);
  assertEqual([bad.code, trainerData.A.battlePlans.display], [400, "status"], "an unknown plan is refused and changes nothing");
  const showcase = response();
  await api.set({ body: { id: "A", team: "showcase", plan: "speed" }, session: "A" }, showcase);
  assertEqual(showcase.code, 400, "the Showcase team has no plan");
  const off = setup({ on: false });
  const offRes = response();
  await off.api.set({ body: { id: "A", team: "display", plan: "speed" }, session: "A" }, offRes);
  assertEqual([offRes.code, off.trainerData.A.battlePlans], [409, undefined], "with the full sim off, plans can't be set");
}

finish();
