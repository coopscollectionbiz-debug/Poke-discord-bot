// ==========================================================
// utils/render/renderers.js
// Every image renderer, by name, for the render threads
// (utils/render/renderPool.js): RENDERERS is what a thread runs, and
// `threaded` holds the same functions wrapped to run on the pool, for the
// bot's commands to use. With RENDER_THREADS=0 the wrapped functions just
// call the renderer on the main thread.
// ==========================================================

import { renderShowteam } from "./showteam.js";
import { renderTrainerCard } from "./trainerCard.js";
import { renderBattleCard } from "./battleCard.js";
import { renderPokedexCard } from "./pokedexCard.js";
import { renderInspectCard } from "./inspectCard.js";
import { renderDailyCard } from "./dailyCard.js";
import { renderExpCard } from "./expCard.js";
import { renderLeaderboard } from "./leaderboardCard.js";
import { renderCatchCard } from "./catchCard.js";
import { renderBoard } from "./challengeBoard.js";
import { renderChallengeCard } from "./challengeCard.js";
import { renderEncounterCard } from "./encounterCard.js";
import { renderBattleVsCard } from "./battleVsCard.js";
import { renderTrainerShowcase } from "./trainerShowcase.js";
import { renderBattleFrame } from "../battle/render.js";
import { threaded as wrap } from "./renderPool.js";

// A battle's sprites are a Map of loaded images (not plain data), cached
// per fight on the main thread. A thread keeps its own cache instead,
// shared by every fight it renders and trimmed oldest-first.
const BATTLE_SPRITE_LIMIT = 400;
class TrimmedCache extends Map {
  set(key, value) {
    super.set(key, value);
    if (this.size > BATTLE_SPRITE_LIMIT) this.delete(this.keys().next().value);
    return this;
  }
}
const threadSprites = new TrimmedCache();

export const RENDERERS = {
  showteam: renderShowteam,
  trainerCard: renderTrainerCard,
  battleCard: renderBattleCard,
  pokedex: renderPokedexCard,
  inspect: renderInspectCard,
  daily: renderDailyCard,
  exp: renderExpCard,
  leaderboard: renderLeaderboard,
  catch: renderCatchCard,
  challengeBoard: renderBoard,
  challengeCard: renderChallengeCard,
  encounter: renderEncounterCard,
  battleVs: renderBattleVsCard,
  trainerShowcase: renderTrainerShowcase,
  battleFrame: (opts) => renderBattleFrame({ ...opts, sprites: threadSprites }),
};

const direct = { ...RENDERERS, battleFrame: renderBattleFrame };
const prepare = {
  // The caller's sprite Map stays behind; the thread uses its own cache.
  battleFrame: ([opts]) => [{ ...opts, sprites: undefined }],
};

/** The renderers, run on the render threads when they're on. */
export const threaded = Object.fromEntries(
  Object.keys(RENDERERS).map((name) => [name, wrap(name, direct[name], { prepare: prepare[name] })]),
);
