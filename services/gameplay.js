// ==========================================================
// services/gameplay.js — dashboard gameplay handlers
// (capture, evolve, shiny conversion, weekly pack)
//
// Moved out of bot_final.js (Release B qualification) so the REAL handler
// code runs in tests. Prices, odds, costs and rewards are unchanged; the
// routes in bot_final.js now only call these functions.
//
// Each handler returns { status, body } and follows the A1/A2 pattern:
// awaits (catalog loads) BEFORE the lock → validate + mutate in one
// synchronous, all-or-nothing block inside lockUser → saveAndAck →
// "saved" / "saved with a delay". Capture, evolve and convert accept an
// optional client requestId: a repeat returns the first result and never
// applies the change again (see runInventoryTransaction).
//
// Injected: anything with I/O or global state (player map, lock, save,
// the bot's record normalizer, event log, Discord broadcast).
// ==========================================================

import { getAllPokemon } from "../utils/dataLoader.js";
import { getPokemonCached } from "../utils/pokemonCache.js";
import { getPokemonDataCached } from "../utils/pokemonDataCache.js";
import { selectRandomPokemonForUser } from "../utils/weightedRandom.js";
import { rollForShiny } from "../shinyOdds.js";
import { grantCatch, carryLevel, resetLevelIfGone } from "../utils/training.js";
import { spritePaths } from "../spriteconfig.js";
import { normVariant, isDisplayedVariant, tierKey, shinyEvolveDustCost, SHINY_CRAFT_COST_BY_TIER, ensureWeeklyReset } from "../utils/economyRules.js";
import { getQuantity, grantItem, consumeItems, runInventoryTransaction, REQUEST_ID_PATTERN } from "./inventory.js";
import { saveAckFields } from "../utils/saveManager.js";

/** Poké Ball prices (CC). Unchanged. */
export const BALL_COST = Object.freeze({ pokeball: 1000, greatball: 2000, ultraball: 4000 });

/** Evolution Stone cost by "<fromTier>-<toTier>". Unchanged. */
export const EVOLVE_STONE_COST = Object.freeze({
  "common-common": 1,
  "uncommon-uncommon": 2,
  "rare-rare": 3,
  "epic-epic": 4,
  "legendary-legendary": 6,
  "mythic-mythic": 8,
  "common-uncommon": 1,
  "uncommon-rare": 2,
  "rare-epic": 5,
  "epic-legendary": 8,
  "legendary-mythic": 12,
  "common-rare": 4,
  "common-epic": 8,
  "common-legendary": 12,
  "uncommon-epic": 8,
  "uncommon-legendary": 12,
  "uncommon-mythic": 14,
  "rare-legendary": 8,
  "rare-mythic": 14,
  "epic-mythic": 12,
});

/** Weekly pack contents by tier. Unchanged. */
export const WEEKLY_PACK_TIERS = Object.freeze(["common", "common", "common", "uncommon", "uncommon", "rare"]);

const reply = (status, body) => ({ status, body });
const badRequestId = (rid) => rid != null && !REQUEST_ID_PATTERN.test(String(rid));
/** A transaction's own refusal → HTTP reply (status defaults to 400). */
const refusal = (tx) => {
  const { ok, status = 400, ...rest } = tx;
  return reply(status, rest);
};

/**
 * @param {object} deps
 * @param {() => object} deps.getTrainerData
 * @param {Function} deps.lockUser
 * @param {(data:object) => Promise<{saved:boolean, note:string}>} deps.save
 * @param {(id:string, user:object) => object} deps.normalizeUserSchema - in place
 * @param {Function} [deps.logEvent]
 * @param {(info:object) => void} [deps.onRareCatch] - Discord broadcast (fire-and-forget)
 */
export function createGameplayHandlers(deps) {
  const {
    getTrainerData,
    lockUser,
    save,
    normalizeUserSchema,
    logEvent = () => {},
    onRareCatch = () => {},
    // Real catalog loaders by default; tests may inject an empty pool.
    loaders = {},
  } = deps;
  const loadAllPokemon = loaders.getAllPokemon ?? getAllPokemon;
  const loadPokemonCached = loaders.getPokemonCached ?? getPokemonCached;
  const loadPokemonData = loaders.getPokemonDataCached ?? getPokemonDataCached;

  const guard = (body, isAuthorized, extra = () => null) => {
    const id = body?.id;
    if (!id) return reply(400, { success: false, error: "Missing id" });
    const more = extra(body);
    if (more) return more;
    if (!isAuthorized(id)) return reply(403, { success: false, error: "Invalid or expired session" });
    if (!getTrainerData()[id]) return reply(404, { success: false, error: "User not found" });
    if (badRequestId(body.requestId)) return reply(400, { success: false, error: "Invalid request id" });
    return null;
  };

  // ======================================================
  // 🎯 Capture: buy a Poké Ball and throw it (instant use)
  // ======================================================
  async function rewardPokemon({ body, isAuthorized }) {
    const stop = guard(body, isAuthorized);
    if (stop) return stop;
    const { id, source, requestId = null } = body;

    const cost = Object.prototype.hasOwnProperty.call(BALL_COST, source) ? BALL_COST[source] : 0;
    if (!cost) return reply(200, { success: false, error: `Invalid Poké Ball type: ${source}` });

    const allPokemon = await loadAllPokemon();
    if (!Array.isArray(allPokemon) || allPokemon.length === 0) {
      return reply(200, { success: false, error: "Pokémon pool unavailable." });
    }

    const tx = await runInventoryTransaction({
      trainerData: getTrainerData(),
      userId: id,
      lock: lockUser,
      save,
      requestId,
      payloadKey: `capture:${source}`,
      mutate: (user) => {
        if ((user.cc ?? 0) < cost) return { ok: false, status: 200, success: false, error: `Not enough CC — requires ${cost} CC.` };
        const reward = selectRandomPokemonForUser(allPokemon, user, source);
        if (!reward) return { ok: false, status: 200, success: false, error: "No Pokémon could be selected." };
        const shiny = rollForShiny(user.tp || 0);
        user.cc -= cost;
        grantCatch(user, reward.id, shiny ? "shiny" : "normal");
        const rarity = reward.tier || reward.rarity || "common";
        return { ok: true, pokemon: { id: reward.id, name: reward.name, rarity, shiny }, cc: user.cc };
      },
    });
    if (!tx.ok) return refusal(tx);

    const { pokemon, cc } = tx.result;
    if (!tx.replayed) {
      logEvent("roll", id, { ball: source, cost, pokemonId: pokemon.id, pokemonName: pokemon.name, tier: pokemon.rarity, shiny: pokemon.shiny });
      if (pokemon.shiny || ["rare", "epic", "legendary", "mythic"].includes(String(pokemon.rarity).toLowerCase())) {
        try { onRareCatch({ userId: id, pokemon, source }); } catch {}
      }
    }
    return reply(200, {
      ...saveAckFields(tx),
      success: true,
      replayed: !!tx.replayed,
      pokemon: {
        ...pokemon,
        sprite: pokemon.shiny ? `${spritePaths.shiny}${pokemon.id}.gif` : `${spritePaths.pokemon}${pokemon.id}.gif`,
      },
      cc,
    });
  }

  // ======================================================
  // 💎 Evolve (Evolution Stones, + Shiny Dust for shiny)
  // ======================================================
  async function evolve({ body, isAuthorized }) {
    const stop = guard(body, isAuthorized, (b) => (b.baseId == null || b.targetId == null ? reply(400, { error: "Missing baseId/targetId" }) : null));
    if (stop) return stop;
    const { id, baseId, targetId, shiny, variant, requestId = null } = body;

    const pokemonData = await loadPokemonData();
    const bId = Number(baseId);
    const tId = Number(targetId);
    const base = pokemonData[bId];
    const target = pokemonData[tId];
    if (!base || !target) return reply(400, { error: "Invalid Pokémon IDs" });

    // The target must be one of the base's direct evolutions (the same list
    // the dashboard offers). Before this check any species of a supported
    // rarity step was accepted, e.g. a common "evolving" into any legendary.
    const evolvesTo = (base.evolvesTo || base.evolves_to || []).map(Number);
    if (!evolvesTo.includes(tId)) {
      return reply(400, { error: `${target.name} isn't an evolution of ${base.name}.` });
    }

    const currentTier = String(base.tier || "common").toLowerCase();
    const nextTier = String(target.tier || "common").toLowerCase();
    const cost = EVOLVE_STONE_COST[`${currentTier}-${nextTier}`] ?? 0;
    if (cost <= 0) return reply(400, { error: `Evolution path ${currentTier} ➝ ${nextTier} is not supported` });

    // Determine variant (prefer explicit "variant", fall back to boolean "shiny")
    const chosenVariant = typeof variant === "string" ? normVariant(variant) : shiny ? "shiny" : "normal";
    const dustCost = chosenVariant === "shiny" ? shinyEvolveDustCost(tierKey(base.tier || "common"), tierKey(target.tier || "common")) : 0;

    const tx = await runInventoryTransaction({
      trainerData: getTrainerData(),
      userId: id,
      lock: lockUser,
      save,
      requestId,
      payloadKey: `evolve:${bId}>${tId}:${chosenVariant}`,
      mutate: (user) => {
        normalizeUserSchema(id, user);
        if (getQuantity(user, "evolution_stone") < cost) return { ok: false, error: "Not enough Evolution Stones." };
        if (isDisplayedVariant(user, bId, chosenVariant)) {
          return { ok: false, error: `You can’t evolve your ${chosenVariant} ${base.name} because it’s currently displayed on your team. Remove it from your team first.` };
        }
        if ((user.pokemon?.[bId]?.[chosenVariant] || 0) <= 0) {
          return { ok: false, error: `You do not own a ${chosenVariant === "shiny" ? "shiny " : ""}${base.name}.` };
        }
        if (dustCost > 0 && getQuantity(user, "shiny_dust") < dustCost) {
          return { ok: false, error: `Not enough Shiny Dust. Requires ${dustCost}.`, dustRequired: dustCost, dustAvailable: getQuantity(user, "shiny_dust") };
        }
        // All checks passed: everything below is applied together.
        const spent = consumeItems(user, { evolution_stone: cost, shiny_dust: dustCost });
        if (!spent.ok) return { ok: false, error: spent.error };

        user.pokemon[bId][chosenVariant] -= 1;
        if ((user.pokemon[bId].normal ?? 0) <= 0 && (user.pokemon[bId].shiny ?? 0) <= 0) delete user.pokemon[bId];
        user.pokemon[tId] ??= { normal: 0, shiny: 0 };
        user.pokemon[tId][chosenVariant] = (user.pokemon[tId][chosenVariant] ?? 0) + 1;
        carryLevel(user, { id: bId, variant: chosenVariant }, { id: tId, variant: chosenVariant });
        resetLevelIfGone(user, bId, chosenVariant);

        return {
          ok: true,
          evolved: { from: base.name, to: target.name, variant: chosenVariant, shiny: chosenVariant === "shiny", cost, dustCost },
          stonesRemaining: getQuantity(user, "evolution_stone"),
          shinyDustRemaining: getQuantity(user, "shiny_dust"),
        };
      },
    });
    if (!tx.ok) return refusal(tx);

    if (!tx.replayed) {
      logEvent("evolve", id, {
        fromId: bId, fromName: base.name, fromTier: currentTier,
        toId: tId, toName: target.name, toTier: nextTier,
        variant: chosenVariant, stoneCost: cost, dustCost,
      });
    }
    const { evolved, stonesRemaining, shinyDustRemaining } = tx.result;
    return reply(200, { ...saveAckFields(tx), success: true, replayed: !!tx.replayed, evolved, stonesRemaining, shinyDustRemaining });
  }

  // ======================================================
  // ✨ Convert a normal Pokémon to shiny (Shiny Dust)
  // ======================================================
  async function convertToShiny({ body, isAuthorized }) {
    const stop = guard(body, isAuthorized, (b) => (b.pokeId == null ? reply(400, { error: "Missing pokeId" }) : null));
    if (stop) return stop;
    const { id, pokeId, requestId = null } = body;

    const pokemonData = await loadPokemonData();
    const pid = Number(pokeId);
    const p = pokemonData[pid];
    if (!p) return reply(400, { error: "Invalid Pokémon ID" });
    const tier = tierKey(p.tier || "common");
    const dustCost = SHINY_CRAFT_COST_BY_TIER[tier] ?? 0;

    const tx = await runInventoryTransaction({
      trainerData: getTrainerData(),
      userId: id,
      lock: lockUser,
      save,
      requestId,
      payloadKey: `convert:${pid}`,
      mutate: (user) => {
        normalizeUserSchema(id, user);
        if (isDisplayedVariant(user, pid, "normal")) {
          return { ok: false, error: `You can’t convert ${p.name} to shiny because its normal variant is currently displayed on your team. Remove it from your team first.` };
        }
        // Check ownership BEFORE touching user.pokemon (a refused conversion
        // used to leave an empty {normal:0, shiny:0} entry behind).
        if ((user.pokemon?.[pid]?.normal ?? 0) <= 0) return { ok: false, error: `You do not own a normal ${p.name} to convert.` };
        if (getQuantity(user, "shiny_dust") < dustCost) {
          return { ok: false, error: `Not enough Shiny Dust. Requires ${dustCost}.`, dustRequired: dustCost, dustAvailable: getQuantity(user, "shiny_dust") };
        }
        const spent = consumeItems(user, { shiny_dust: dustCost });
        if (!spent.ok) return { ok: false, error: "Not enough Shiny Dust." };

        user.pokemon[pid].normal -= 1;
        user.pokemon[pid].shiny = (user.pokemon[pid].shiny ?? 0) + 1;
        carryLevel(user, { id: pid, variant: "normal" }, { id: pid, variant: "shiny" });
        resetLevelIfGone(user, pid, "normal");
        if ((user.pokemon[pid].normal ?? 0) <= 0 && (user.pokemon[pid].shiny ?? 0) <= 0) delete user.pokemon[pid];

        return {
          ok: true,
          converted: { id: pid, name: p.name },
          tier,
          dustCost,
          shinyDustRemaining: getQuantity(user, "shiny_dust"),
          counts: { normal: user.pokemon?.[pid]?.normal ?? 0, shiny: user.pokemon?.[pid]?.shiny ?? 0 },
        };
      },
    });
    if (!tx.ok) return refusal(tx);

    if (!tx.replayed) logEvent("convert", id, { pokemonId: pid, pokemonName: p.name, tier, dustCost });
    return reply(200, { ...saveAckFields(tx), success: true, replayed: !!tx.replayed, ...tx.result, ok: undefined });
  }

  // ======================================================
  // 🎁 Weekly pack (3 common, 2 uncommon, 1 rare; once per ISO week)
  // ======================================================
  async function weeklyPack({ body, isAuthorized }) {
    const id = body?.id;
    if (!id) return reply(400, { error: "Missing id" });
    if (!isAuthorized(id)) return reply(403, { error: "Invalid or expired session" });
    if (!getTrainerData()[id]) return reply(404, { error: "User not found" });

    // D6: every await happens BEFORE the claim flag is set.
    let allPokemon;
    try {
      allPokemon = await loadPokemonCached();
    } catch (err) {
      return reply(503, { error: "Rewards are unavailable right now. Please try again." });
    }
    if (!Array.isArray(allPokemon) || allPokemon.length === 0) {
      return reply(503, { error: "Rewards are unavailable right now. Please try again." });
    }

    const tx = await runInventoryTransaction({
      trainerData: getTrainerData(),
      userId: id,
      lock: lockUser,
      save,
      mutate: (user) => {
        ensureWeeklyReset(user);
        if (user.weeklyPackClaimed) return { ok: false, error: "Weekly pack already claimed." };

        const pick = (tier) => {
          const pool = allPokemon.filter((p) => p.tier === tier);
          return pool[Math.floor(Math.random() * pool.length)];
        };
        const rewards = [];
        for (const tier of WEEKLY_PACK_TIERS) {
          const reward = pick(tier);
          if (!reward) continue;
          const shiny = rollForShiny(user.tp || 0);
          rewards.push({ reward, shiny });
        }
        // Never "claim" an empty pack.
        if (!rewards.length) return { ok: false, status: 503, error: "Rewards are unavailable right now. Please try again." };
        const results = rewards.map(({ reward, shiny }) => {
          grantCatch(user, reward.id, shiny ? "shiny" : "normal");
          return {
            type: "pokemon",
            id: reward.id,
            name: reward.name,
            rarity: reward.tier,
            shiny,
            sprite: shiny ? `/public/sprites/pokemon/shiny/${reward.id}.gif` : `/public/sprites/pokemon/normal/${reward.id}.gif`,
          };
        });
        user.weeklyPackClaimed = true;
        return { ok: true, rewards: results };
      },
    });
    if (!tx.ok) return refusal(tx);

    logEvent("weekly_claim", id, {
      rewards: tx.result.rewards.map((r) => ({ pokemonId: r.id, pokemonName: r.name, tier: r.rarity, shiny: r.shiny })),
    });
    return reply(200, { ...saveAckFields(tx), success: true, rewards: tx.result.rewards });
  }

  return { rewardPokemon, evolve, convertToShiny, weeklyPack };
}

// Re-exported for the Bag/shop code paths that grant items directly.
export { grantItem };
