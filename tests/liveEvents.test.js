// ==========================================================
// tests/liveEvents.test.js — Live events (docs/design/live-events.md):
// validation (no caps), combining overlapping events, Catch boost math,
// Catch limits, the paid-roll choice, discounts, EXP, the admin store
// (create/edit/end/delete + audit), and the start/end posts.
// ==========================================================

import fs from "fs/promises";
import os from "os";
import path from "path";
import { readFileSync } from "fs";
import { assertTrue, assertEqual, assertBetween, section, finish } from "./harness.js";

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "live-events-"));
process.env.TRAINERDATA_DIR = dir;

const R = await import("../utils/liveEventRules.js");
const S = await import("../services/liveEvents.js");
const P = await import("../services/liveEventsPlayer.js");
const { selectRandomPokemonForUser, rollRows, emptyBalls } = await import("../utils/weightedRandom.js");
const { acquirablePokemon } = await import("../utils/speciesCatalog.js");
const { createGameplayHandlers, BALL_COST } = await import("../services/gameplay.js");
const { lockUser } = await import("../utils/userLocks.js");
const { saveAndAck } = await import("../utils/saveManager.js");
const { readAudit } = await import("../utils/adminAudit.js");
const { effectText } = await import("../utils/liveEventText.js");

const pokemonData = JSON.parse(readFileSync(new URL("../pokemonData.json", import.meta.url), "utf8"));
const POOL = acquirablePokemon(Object.values(pokemonData));
const HOUR = 3600_000;
const NOW = Date.now();
const ev = (o) => ({ name: "E", startAt: NOW - HOUR, endAt: NOW + HOUR, effects: [], ...o });
const share = (rows, pred) => rows.filter((r) => pred(r.item)).reduce((s, r) => s + r.w, 0) / rows.reduce((s, r) => s + r.w, 0);
const isWater = (p) => R.typeNamesOf(p).includes("Water");
const tierShare = (rows, t) => share(rows, (p) => String(p.tier).toLowerCase() === t);
const sample = (n, fn) => Array.from({ length: n }, fn);

// ----------------------------------------------------------
section("Validation: no caps, only physical bounds");
{
  const ok = R.cleanEvent(ev({ effects: [{ kind: "exp", value: 1000 }] }));
  assertTrue(!ok.error, "×1000 EXP is allowed (no arbitrary cap)");
  assertTrue(/above 0/.test(R.cleanEvent(ev({ effects: [{ kind: "cc", value: 0 }] })).error), "×0 is refused");
  assertTrue(/between 1 and 100/.test(R.cleanEvent(ev({ effects: [{ kind: "discount", value: 120, categories: ["balls"] }] })).error), "a discount over 100 % is refused");
  assertTrue(/at least one category/.test(R.cleanEvent(ev({ effects: [{ kind: "discount", value: 50, categories: [] }] })).error), "a discount needs a category");
  assertTrue(/at least one/.test(R.cleanEvent(ev({ effects: [{ kind: "catchBoost", value: 3, match: {} }] })).error), "a Catch boost needs a target");
  assertTrue(/can't target tiers/.test(R.cleanEvent(ev({ effects: [{ kind: "catchLimit", match: { tiers: ["rare"] } }] })).error), "a Catch limit can't name a Tier");
  assertTrue(/Unknown types/.test(R.cleanEvent(ev({ effects: [{ kind: "catchBoost", value: 2, match: { types: ["Wet"] } }] })).error), "unknown types are refused");
  assertTrue(/after the start/.test(R.cleanEvent(ev({ endAt: NOW - 2 * HOUR, effects: [{ kind: "cc", value: 2 }] })).error), "end before start is refused");
  assertTrue(/at least one effect/.test(R.cleanEvent(ev({ effects: [] })).error), "an event needs an effect");
  assertTrue(!R.cleanEvent(ev({ effects: [{ kind: "catchBoost", value: 2, match: { tiers: ["legendary"] } }] })).error, "a Tier boost is allowed");
}

// ----------------------------------------------------------
section("Combining overlapping events");
{
  const events = [
    ev({ id: 1, name: "A", effects: [{ kind: "exp", value: 2 }, { kind: "cc", value: 2 }, { kind: "battleCap", value: 3 }] }),
    ev({ id: 2, name: "B", startAt: NOW - 10, effects: [{ kind: "cc", value: 1.5 }, { kind: "battleCap", value: 2 }, { kind: "catchLimit", match: { regions: ["Kanto"] } }] }),
    ev({ id: 3, name: "Later", startAt: NOW + HOUR, endAt: NOW + 2 * HOUR, effects: [{ kind: "cc", value: 10 }] }),
    ev({ id: 4, name: "Ended early", endedAt: NOW - 5, effects: [{ kind: "cc", value: 10 }] }),
  ];
  const fx = R.combine(events, NOW);
  assertEqual(fx.cc, 3, "same-kind multipliers multiply (2 × 1.5)");
  assertEqual(fx.battleCap, 5, "extra battles add up");
  assertEqual(fx.events.map((e) => e.name), ["A", "B"], "scheduled and ended-early events don't count");
  assertEqual(fx.catchStartedAt, NOW - 10, "catchStartedAt = the latest start among catch events");
  assertEqual(R.statusOf(events[2], NOW), "scheduled", "status: scheduled");
  assertEqual(R.statusOf(events[3], NOW), "ended", "status: ended early");
  assertEqual(R.scaleChance(0.6, 3), 1, "a chance is clamped at 100 %");
  assertEqual(R.scaleEarned(100, 1.5), 150, "earnings scale and round");
}

// ----------------------------------------------------------
section("Catch boost: Tier odds stay, species inside them shift");
{
  const weight = (p) => ({ common: 52, uncommon: 34, rare: 8, epic: 4, legendary: 1.5, mythic: 0.5 })[String(p.tier).toLowerCase()];
  const base = POOL.map((p) => ({ item: p, w: weight(p) }));
  const fx = R.combine([ev({ effects: [{ kind: "catchBoost", value: 3, match: { types: ["Water"] } }] })], NOW);
  const boosted = R.boostedWeights(POOL, fx, weight);
  for (const t of R.TIERS) assertBetween(Math.abs(tierShare(boosted, t) - tierShare(base, t)), 0, 1e-9, `${t} share unchanged by a type boost`);
  assertTrue(share(boosted, isWater) > share(base, isWater) * 1.8, `Water's share rises (${(share(base, isWater) * 100).toFixed(1)}% → ${(share(boosted, isWater) * 100).toFixed(1)}%)`);
  const fxTier = R.combine([ev({ effects: [{ kind: "catchBoost", value: 2, match: { tiers: ["legendary"] } }] })], NOW);
  const tierBoosted = R.boostedWeights(POOL, fxTier, weight);
  assertTrue(tierShare(tierBoosted, "legendary") > tierShare(base, "legendary") * 1.9, "a Tier boost does raise that Tier's share");
}

// ----------------------------------------------------------
section("Catch limits on real rolls");
{
  const player = { tp: 0 };
  S.setLiveEventsForTesting([ev({ name: "Kanto week", effects: [{ kind: "catchLimit", match: { regions: ["Kanto"] } }] })]);
  const free = sample(400, () => selectRandomPokemonForUser(POOL, player, "pokeball"));
  assertTrue(free.every((p) => p.id >= 1 && p.id <= 151), "free rolls: Kanto only (400 draws)");
  const paidOff = sample(400, () => selectRandomPokemonForUser(POOL, player, "pokeball", { paid: true }));
  assertTrue(paidOff.some((p) => p.id > 151), "paid roll without the choice: normal pool");
  const opted = { tp: 0 };
  S.setOptIn(opted, true);
  const paidOn = sample(400, () => selectRandomPokemonForUser(POOL, opted, "ultraball", { paid: true }));
  assertTrue(paidOn.every((p) => p.id <= 151 && !["common", "uncommon"].includes(p.tier)), "paid Ultra Ball with the choice on: Kanto rare+ only");

  // The choice lapses when a newer catch event starts.
  S.setLiveEventsForTesting([
    ev({ name: "Kanto week", effects: [{ kind: "catchLimit", match: { regions: ["Kanto"] } }] }),
    ev({ name: "Water day", startAt: Date.now() + 5, endAt: NOW + HOUR, effects: [{ kind: "catchBoost", value: 2, match: { types: ["Water"] } }] }),
  ]);
  const later = Date.now() + 10;
  assertTrue(!S.optedIn(opted, S.liveEffects(later)), "the choice resets to Off when a new Catch boost starts");

  // Nothing left for the ball: refused, never a fallback.
  S.setLiveEventsForTesting([ev({ name: "Pidgey day", effects: [{ kind: "catchLimit", match: { species: [16] } }] })]);
  const p2 = { tp: 0 };
  S.setOptIn(p2, true);
  assertEqual(selectRandomPokemonForUser(POOL, p2, "ultraball", { paid: true }), null, "opted-in Ultra Ball with only Pidgey allowed: nothing (null)");
  assertEqual(emptyBalls(POOL, S.liveEffects()), ["greatball", "ultraball"], "Great and Ultra Balls are reported empty");
  assertEqual(selectRandomPokemonForUser(POOL, p2, "pokeball").id, 16, "a free roll gives Pidgey");
}

// ----------------------------------------------------------
section("Overlapping limits that leave nothing are refused");
{
  const kanto = ev({ id: 1, name: "Kanto week", startAt: NOW, endAt: NOW + 7 * 24 * HOUR, effects: [{ kind: "catchLimit", match: { regions: ["Kanto"] } }] });
  const johto = { name: "Johto day", startAt: NOW + 24 * HOUR, endAt: NOW + 48 * HOUR, effects: [{ kind: "catchLimit", match: { regions: ["Johto"] } }] };
  assertTrue(/Together with Kanto week/.test(R.emptyLimitProblem(johto, [kanto], POOL) ?? ""), "Johto-only during Kanto week: refused");
  const after = { ...johto, startAt: NOW + 8 * 24 * HOUR, endAt: NOW + 9 * 24 * HOUR };
  assertEqual(R.emptyLimitProblem(after, [kanto], POOL), null, "Johto-only after Kanto week ends: fine");
  const kantoWater = { ...johto, effects: [{ kind: "catchLimit", match: { types: ["Water"] } }] };
  assertEqual(R.emptyLimitProblem(kantoWater, [kanto], POOL), null, "Water-only during Kanto week: fine (Kanto Water-types)");
  const kalos = { ...after, effects: [{ kind: "catchLimit", match: { regions: ["Kalos"] } }] };
  assertTrue(/generations that are live/.test(R.emptyLimitProblem(kalos, [], POOL) ?? ""), "Kalos-only with Gen 6 off: refused");
}

// ----------------------------------------------------------
section("Discounts, EXP and words");
{
  const fx = R.combine([
    ev({ effects: [{ kind: "discount", value: 50, categories: ["balls", "tms"] }] }),
    ev({ effects: [{ kind: "discount", value: 50, categories: ["balls"] }] }),
    ev({ effects: [{ kind: "exp", value: 2 }, { kind: "exp", value: 3, match: { types: ["Fire"] } }] }),
  ], NOW);
  assertEqual(R.discountedPrice(fx, "balls", 1000), 250, "two 50 % discounts: pay 25 %");
  assertEqual(R.discountedPrice(fx, "tms", 1000), 500, "a category only one covers: 50 %");
  assertEqual(R.discountedPrice(fx, "stones", 1000), 1000, "uncovered category: full price");
  assertEqual(R.expMultiplier(fx, pokemonData[4]), 6, "Charmander (Fire): ×2 × ×3");
  assertEqual(R.expMultiplier(fx, pokemonData[7]), 2, "Squirtle: ×2 only");
  assertEqual(effectText({ kind: "catchLimit", match: { regions: ["Kanto"] } }), "Only Kanto Pokémon can be caught", "limit in words");
  assertEqual(effectText({ kind: "catchBoost", value: 3, match: { types: ["Water"] } }), "Water-type Pokémon turn up ×3 as often", "boost in words");
}

// ----------------------------------------------------------
section("Odds preview rows");
{
  const fx = R.combine([ev({ effects: [{ kind: "catchLimit", match: { regions: ["Kanto"] } }] })], NOW);
  const rows = rollRows(POOL, { tp: 0 }, "pokeball", fx);
  assertEqual(rows.length, POOL.filter((p) => p.id <= 151).length, "preview pool = the Kanto species");
  const sum = R.oddsSummary(rows);
  assertBetween(Object.values(sum.tiers).reduce((a, b) => a + b, 0), 0.999999, 1.000001, "Tier shares add up to 100 %");
}

// ----------------------------------------------------------
section("Admin store: create, edit, end, delete, audit, reload");
{
  S.setLiveEventsForTesting([]);
  const admin = { id: "a1", name: "Admin" };
  const noReason = await S.createLiveEvent(ev({ startAt: NOW + HOUR, endAt: NOW + 2 * HOUR, effects: [{ kind: "cc", value: 2 }] }), { admin, reason: "" });
  assertTrue(!noReason.ok && /reason/.test(noReason.error), "a reason is required");
  const made = await S.createLiveEvent({ name: "Double CC", startAt: NOW + HOUR, endAt: NOW + 2 * HOUR, effects: [{ kind: "cc", value: 2 }] }, { admin, reason: "test" });
  assertTrue(made.ok && made.event.id === 1, "created");
  const edited = await S.updateLiveEvent(1, { name: "Triple CC", startAt: NOW + HOUR, endAt: NOW + 3 * HOUR, effects: [{ kind: "cc", value: 3 }] }, { admin, reason: "more" });
  assertTrue(edited.ok && edited.event.effects[0].value === 3, "edited while scheduled");
  const endEarly = await S.endLiveEvent(1, { admin, reason: "x" });
  assertTrue(!endEarly.ok && endEarly.status === 409, "can't end one that hasn't started");

  const running = await S.createLiveEvent({ name: "Now", startAt: NOW - HOUR, endAt: NOW + HOUR, effects: [{ kind: "tp", value: 2 }] }, { admin, reason: "test" });
  assertTrue(running.ok, "created a running one (start in the past, end in the future)");
  const moved = await S.updateLiveEvent(running.event.id, { name: "Now", startAt: NOW + 5 * HOUR, endAt: NOW + 6 * HOUR, effects: [{ kind: "tp", value: 2 }] }, { admin, reason: "move" });
  assertEqual(S.getLiveEvent(running.event.id).startAt, NOW - HOUR, "a running event keeps its start");
  assertTrue(moved.ok, "edit of a running event applies");
  const del = await S.deleteLiveEvent(running.event.id, { admin, reason: "x" });
  assertTrue(!del.ok && del.status === 409, "a running event can't be deleted");
  const ended = await S.endLiveEvent(running.event.id, { admin, reason: "done" });
  assertTrue(ended.ok && S.liveEffects().tp === 1, "End now stops it at once");
  const editEnded = await S.updateLiveEvent(running.event.id, { name: "Now", startAt: NOW, endAt: NOW + HOUR, effects: [{ kind: "tp", value: 9 }] }, { admin, reason: "x" });
  assertTrue(!editEnded.ok && editEnded.status === 409, "an ended event is read-only");
  const gone = await S.deleteLiveEvent(1, { admin, reason: "cancelled" });
  assertTrue(gone.ok && !S.getLiveEvent(1), "a scheduled event can be deleted");

  const audit = await readAudit({ limit: 50 });
  const actions = (audit.entries ?? audit.items ?? audit.rows ?? []).filter((e) => e.type === "live_event").map((e) => e.action);
  assertTrue(["create", "edit", "end", "delete"].every((a) => actions.includes(a)), `every action is audited (${actions.join(", ")})`);

  await S.loadLiveEvents();
  assertEqual(S.listLiveEvents().length, 1, "reloads from live-events.json (the deleted one hidden)");
}

// ----------------------------------------------------------
section("Start and end posts");
{
  const t0 = Date.now();
  S.setLiveEventsForTesting([
    { name: "On", startAt: t0 - HOUR, endAt: t0 + HOUR, effects: [{ kind: "cc", value: 2 }] },
    { name: "Missed", startAt: t0 - 3 * HOUR, endAt: t0 - 2 * HOUR, effects: [{ kind: "cc", value: 2 }] },
  ], { channelId: "123456789012" });
  const sent = [];
  const send = async (ch, embed) => { sent.push(embed.data.title); return true; };
  await P.postDueAnnouncements({ send, now: t0 });
  assertEqual(sent, ["🎪 On has started!"], "posts the running one's start; the missed one stays silent");
  await P.postDueAnnouncements({ send, now: t0 });
  assertEqual(sent.length, 1, "never posts twice");
  await P.postDueAnnouncements({ send, now: t0 + 2 * HOUR });
  assertEqual(sent.at(-1), "🎪 On has ended", "posts the end once it's over");
  const failing = async () => false;
  S.setLiveEventsForTesting([{ name: "Retry", startAt: t0 - 1, endAt: t0 + HOUR, effects: [{ kind: "cc", value: 2 }] }], { channelId: "123456789012" });
  await P.postDueAnnouncements({ send: failing, now: t0 });
  await P.postDueAnnouncements({ send, now: t0 });
  assertEqual(sent.at(-1), "🎪 Retry has started!", "a failed post is retried");
}

// ----------------------------------------------------------
section("Dashboard Poké Ball: discount and the paid choice");
{
  S.setLiveEventsForTesting([ev({ name: "Ball sale", effects: [{ kind: "discount", value: 40, categories: ["balls"] }, { kind: "catchLimit", match: { species: [16] } }] })]);
  const td = { u1: { cc: 10_000, tp: 0, pokemon: {}, items: { evolution_stone: 0 }, displayedPokemon: [], training: {} } };
  const h = createGameplayHandlers({
    getTrainerData: () => td, lockUser, save: (d) => saveAndAck(d, { save: async () => true }),
    normalizeUserSchema: (_id, u) => u, logEvent: () => {}, onRareCatch: () => {},
  });
  const buy = (source) => h.rewardPokemon({ body: { id: "u1", source }, isAuthorized: () => true });
  const r1 = await buy("ultraball");
  assertTrue(r1.body.success && td.u1.cc === 10_000 - BALL_COST.ultraball * 0.6, "charged 60 % of the Ultra Ball price");
  assertTrue(r1.body.eventNames.length === 0, "choice off: the roll ignored the event");
  S.setOptIn(td.u1, true);
  const before = td.u1.cc;
  const r2 = await buy("ultraball");
  assertTrue(!r2.body.success && /nothing it can catch/.test(r2.body.error) && td.u1.cc === before, "choice on, nothing allowed: refused and no CC spent");
  const r3 = await buy("pokeball");
  assertTrue(r3.body.success && r3.body.pokemon.id === 16 && r3.body.eventNames[0] === "Ball sale", "choice on, Poké Ball: Pidgey, tagged with the event");
  const view = P.playerView(td.u1);
  assertEqual(view.discounts.balls, 0.6, "player view: balls cost 60 %");
  assertTrue(view.paidChoice.on && view.paidChoice.emptyBalls.includes("ultraball"), "player view: choice on, Ultra Ball greyed out");
}

S.setLiveEventsForTesting([]);
await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
finish();
process.exit(0);
