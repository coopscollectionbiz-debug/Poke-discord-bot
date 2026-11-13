// ==========================================================
// tools/dev/tm-teach-preview.mjs — serves this checkout's Collection and
// Teams pages over one synthetic player with TMs switched ON, using the real
// services (Pokémon detail, team rules, movesets, TM options and teaching,
// trained-copy slot carry). In memory only; nothing is saved. Never deploy.
//
//   node tools/dev/tm-teach-preview.mjs <checkoutRoot> <port>
//
// The player: 3 Charizards at Lv 50 (one trained with Thunder Punch, on the
// Display team), 2 Charmeleons (one trained with Dragon Claw), a Lv 20
// Pikachu, 2 Eevees, and Thunder Punch ×2, Flamethrower, Surf and
// Thunderbolt TMs. Donate, evolve, shiny craft and bulk donate (T5) run the
// real handlers too.
// ==========================================================

import express from "express";
import path from "path";
import { pathToFileURL } from "url";

const [rootArg, portArg = "5192"] = process.argv.slice(2);
const ROOT = path.resolve(rootArg);
process.env.TM_ENABLED = "1";
const imp = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);
const { pokemonDetail } = await imp("services/pokemonDetail.js");
const { teachOptions, teachTm } = await imp("services/tmTeaching.js");
const { runInventoryTransaction } = await imp("services/inventory.js");
const { validateMoveset, setMoveset, chosenMoves } = await imp("services/movesets.js");
const { prepareTeamSelection } = await imp("services/megaTeam.js");
const { prepareBattleTeamSelection } = await imp("services/battleTeam.js");
const { carryCopyUids, slotCopyUid, normalizeCustomPokemon, trainedSummary } = await imp("services/ownership.js");
const { createGameplayHandlers } = await imp("services/gameplay.js");
const { donateOne, bulkDonate } = await imp("utils/bulkDonate.js");
const { isDisplayedVariant, DONATION_CC_BY_TIER, DUST_REWARD_BY_TIER, NON_SHINY_DUST_WEEKLY_CAP } = await imp("utils/economyRules.js");
const pokemonDataFile = (await import("fs")).readFileSync(path.join(ROOT, "pokemonData.json"), "utf8");
const POKEMON_DATA = JSON.parse(pokemonDataFile);
const { levelsForUser } = await imp("utils/training.js");
const { tmShopView } = await imp("services/tmShop.js");
const { powersFromLevels } = await imp("utils/battle/power.js");

const ID = "100000000000000009";
const trainerData = {
  [ID]: {
    id: ID, cc: 26000, tp: 4100, rank: "Advanced Trainer",
    pokemon: { 5: { normal: 2, shiny: 0 }, 6: { normal: 3, shiny: 0 }, 25: { normal: 1, shiny: 0 }, 133: { normal: 2, shiny: 0 } },
    training: { "5:normal": { exp: 36 ** 3 }, "6:normal": { exp: 50 ** 3 }, "25:normal": { exp: 20 ** 3 }, "133:normal": { exp: 15 ** 3 } },
    customPokemon: {
      c_Bt5Charzrd: { uid: "c_Bt5Charzrd", speciesId: 6, variant: "normal", tmMoves: ["thunderpunch"], rev: 1, history: [], createdAt: 1 },
      c_Mt5Charmel: { uid: "c_Mt5Charmel", speciesId: 5, variant: "normal", tmMoves: ["dragonclaw"], rev: 1, history: [], createdAt: 2 },
    },
    displayedPokemon: [{ id: 6, variant: "normal", uid: "c_Bt5Charzrd" }, { id: 25, variant: "normal" }],
    battleTeam: [{ id: 25, variant: "normal" }],
    items: { evolution_stone: 20, shiny_dust: 200, tm_thunderpunch: 2, tm_flamethrower: 1, tm_surf: 1, tm_thunderbolt: 1 },
  },
};
const user = () => trainerData[ID];
const tx = (requestId, payloadKey, mutate) => runInventoryTransaction({ trainerData, userId: ID, lock: (_id, fn) => fn(), save: async () => ({ saved: true, note: "" }), requestId, payloadKey, mutate });
const reply = (res, t) => {
  if (!t.ok) { const { ok, status = 400, ...rest } = t; return res.status(status).json({ success: false, ...rest }); }
  const { ok, ...result } = t.result;
  return res.json({ saved: true, success: true, replayed: !!t.replayed, ...result });
};

const app = express();
app.use(express.json());
app.use("/public", express.static(path.join(ROOT, "public"), { etag: false, maxAge: 0 }));
for (const page of ["picker-pokemon", "teams", "dashboardshop", "bag"]) app.get(`/public/${page}`, (_, res) => res.sendFile(path.join(ROOT, "public", page, "index.html")));
app.get("/api/pokedex-status", (_, res) => res.json({ liveGenerations: [1, 2, 3, 4, 5], maxDex: 649 }));
app.get("/api/mega", (_, res) => res.json({ success: true, enabled: false }));
app.get("/api/user", (_, res) => res.json(user()));
app.get("/api/tm-shop", (_, res) => res.json(tmShopView(user())));
app.get("/api/user-pokemon", (_, res) => {
  const u = user();
  normalizeCustomPokemon(u);
  const levels = levelsForUser(u);
  res.json({ id: ID, cc: u.cc, tp: u.tp, rank: u.rank, items: u.items, pokemon: u.pokemon, currentTeam: u.displayedPokemon, battleTeam: u.battleTeam ?? null,
    ranked: { rating: 1000, wins: 0, losses: 0, position: null, players: 1, streak: 0 }, casual: { wins: 0, losses: 0, streak: 0, bestStreak: 0 },
    levels, powers: powersFromLevels(levels), nonShinyDustEarnedThisWeek: 0, trained: trainedSummary(u) });
});
app.get("/api/pokemon/detail", (req, res) => { const { status, body } = pokemonDetail(user(), req.query.species); res.status(status).json(body); });
app.get("/api/pokemon/tm-options", (req, res) => {
  const r = teachOptions(user(), { speciesId: req.query.species, variant: req.query.variant });
  if (!r.ok) { const { ok, status = 400, ...rest } = r; return res.status(status).json(rest); }
  const { ok, ...body } = r; res.json(body);
});
app.post("/api/pokemon/teach-tm", async (req, res) => {
  const { item, pokeId, variant, uid = null, rev = null, expect = null, equip = null, requestId = null } = req.body || {};
  reply(res, await tx(requestId, `teach-tm:${item}:${Number(pokeId)}:${variant}:${uid ?? "untrained"}`, (u) => teachTm(u, { item, pokeId, variant, uid, rev, expect, equip }, { requestId })));
});
app.post("/api/pokemon/moveset", (req, res) => {
  const { team, pokeId, variant, moves, uid = null } = req.body || {};
  const u = user();
  const v = variant === "shiny" ? "shiny" : "normal";
  const copy = uid == null ? null : slotCopyUid(u, { id: Number(pokeId), variant: v, uid });
  if (moves !== null) {
    const check = validateMoveset(u, pokeId, v, moves, { uid: copy });
    if (!check.ok) return res.status(400).json({ success: false, error: check.error });
    setMoveset(u, team, pokeId, v, check.moves, { uid: copy });
  } else setMoveset(u, team, pokeId, v, null, { uid: copy });
  res.json({ success: true, saved: true, team, moves: chosenMoves(u, team, pokeId, v, { uid: copy }) });
});
app.post("/api/set-pokemon-team", (req, res) => {
  const { team, teamType = "display" } = req.body || {};
  const u = user();
  const prepared = teamType === "battle" ? prepareBattleTeamSelection(u, team) : prepareTeamSelection(u, team);
  if (!prepared.ok) return res.status(prepared.status).json({ success: false, error: prepared.error });
  const normalized = carryCopyUids(u, teamType === "battle" ? u.battleTeam : u.displayedPokemon, prepared.team, team);
  if (teamType === "battle") u.battleTeam = normalized; else u.displayedPokemon = normalized;
  res.json({ success: true, saved: true, teamType, currentTeam: u.displayedPokemon, battleTeam: u.battleTeam ?? null });
});
// ---- T5: donate / evolve / shiny craft / bulk donate (real handlers) ----
const economy = { ccByTier: DONATION_CC_BY_TIER, shinyDustByTier: DUST_REWARD_BY_TIER, normalDustChanceByTier: {}, normalDustWeeklyCap: NON_SHINY_DUST_WEEKLY_CAP, rollDust: () => 0 };
const gameplay = createGameplayHandlers({ getTrainerData: () => trainerData, lockUser: (_id, fn) => fn(), save: async () => ({ saved: true, note: "" }), normalizeUserSchema: (_id, u) => u });
app.post("/api/pokemon/evolve", async (req, res) => { const r = await gameplay.evolve({ body: { ...req.body, id: ID }, isAuthorized: () => true }); res.status(r.status).json(r.body); });
app.post("/api/pokemon/convert-to-shiny", async (req, res) => { const r = await gameplay.convertToShiny({ body: { ...req.body, id: ID }, isAuthorized: () => true }); res.status(r.status).json(r.body); });
app.post("/api/pokemon/donate", async (req, res) => {
  const { pokeId, variant, requestId = null, uid = null, rev = null, confirmTrained = false } = req.body || {};
  const v = variant === "shiny" ? "shiny" : "normal";
  reply(res, await tx(requestId, `donate:${Number(pokeId)}:${v}:${uid ?? "untrained"}`, (u) => {
    const r = donateOne({ user: u, pokeId, variant: v, pokemonData: POKEMON_DATA, economy, isOnTeam: (pid, vv) => isDisplayedVariant(u, pid, vv), uid, rev, confirmTrained: confirmTrained === true });
    if (r.error) return { ok: false, status: 400, error: r.error, code: r.code };
    const ev = r.event;
    return { ok: true, donated: { id: ev.pokemonId, name: ev.pokemonName, variant: ev.variant }, gainedCC: ev.ccGained, totalCC: u.cc, shinyDustGained: ev.dustGained, shinyDustTotal: u.items.shiny_dust ?? 0, nonShinyDustWeeklyRemaining: 0 };
  }));
});
app.post("/api/pokemon/donate-bulk", async (req, res) => {
  const { mode, items, requestId = null } = req.body || {};
  reply(res, await tx(requestId, `donate-bulk:${mode}:${JSON.stringify(items).length}`, (u) => {
    const r = bulkDonate({ user: u, mode, items, pokemonData: POKEMON_DATA, economy, isOnTeam: (pid, v) => isDisplayedVariant(u, pid, v) });
    return r.error ? { ok: false, status: 400, error: r.error } : { ok: true, ...r };
  }));
});
app.post("/api/weekly-pack", (_, res) => res.status(400).json({ error: "Not in preview" }));

app.get("/__state", (_, res) => res.json(user())); // preview-only: inspect the in-memory record
app.listen(Number(portArg), "127.0.0.1", () => console.log(`TM teach preview (${path.basename(ROOT)}): http://localhost:${portArg}/public/picker-pokemon?id=${ID}`));
