// ==========================================================
// tests/showteamRender.test.js
// /showteam redesign prototype: the team view model (which Pokémon, which
// facts, no mutation), sprite scaling and fallbacks, and every layout
// rendering every synthetic fixture within budget.
// ==========================================================

import { performance } from "perf_hooks";
import { GifReader } from "omggif";
import { assertEqual, assertTrue, section, finish } from "./harness.js";
import { buildTeamView, expProgress } from "../utils/render/teamView.js";
import { renderShowteam, LAYOUTS, sizeFor } from "../utils/render/showteam.js";
import { catchView, renderCatchCard, regionCompletion, CATCH_SIZE } from "../utils/render/catchCard.js";
import { spriteScale, loadStaticSprite, loadTrainerSprite, opaqueBounds } from "../utils/render/sprites.js";
import { displaySpeciesName, DISPLAY_NAMES } from "../utils/render/names.js";
import { typeStyle, TYPE } from "../utils/render/tokens.js";
import { FIXTURES, CATCH_FIXTURES } from "./fixtures/showteamFixtures.js";

const clone = (o) => JSON.parse(JSON.stringify(o));

section("Team view: the battle Team, nothing invented");
{
  const view = buildTeamView(FIXTURES.full.user, { displayName: "Coop" });
  assertEqual(view.slots.map((s) => [s.id, s.variant]), [[6, "normal"], [94, "shiny"], [445, "normal"], [130, "normal"], [25, "shiny"], [637, "normal"]], "slots in Team order with variants");
  assertEqual(view.slots[0].types, ["Fire", "Flying"], "types from battle data");
  assertEqual(view.slots[0].level, 62, "Level from training");
  assertTrue(view.slots.every((s) => s.moves.length >= 1 && s.moves.length <= 4), "1–4 battle moves per slot");
  assertTrue(view.power > 0 && !view.fallback, "team power computed; not a fallback");
  const keys = Object.keys(view.slots[0]);
  assertTrue(!keys.some((k) => /^(nickname|abilit(y|ies)|nature|ivs?|evs?|hp|currentHp|status|heldItem|item)$/i.test(k)), "no unsupported fields (nickname, ability, nature, IV/EV, HP, status, item)");

  // A slot whose variant is no longer owned is skipped (as in battles); duplicates collapse.
  const user = clone(FIXTURES.full.user);
  user.pokemon[94].shiny = 0;
  user.displayedPokemon.push({ id: 6, variant: "normal" });
  assertEqual(buildTeamView(user).slots.map((s) => s.id), [6, 445, 130, 25, 637], "unowned slot dropped, duplicate ignored");
}

section("Team view: fallback and empty");
{
  const fb = buildTeamView(FIXTURES.fallback.user);
  assertTrue(fb.fallback && fb.slots.length === 5, "no Team set: first owned Pokémon, flagged as fallback");
  const shinyOnly = buildTeamView({ pokemon: { 1: { normal: 0, shiny: 1 } }, displayedPokemon: [] });
  assertEqual(shinyOnly.slots.length, 0, "fallback never shows a normal variant the player doesn't own");
  const empty = buildTeamView(FIXTURES.empty.user);
  assertTrue(!empty.fallback && empty.slots.length === 0 && empty.rank === "Unranked", "brand-new player: empty, Unranked");
}

section("Team view never mutates the player record");
for (const [name, fx] of Object.entries(FIXTURES)) {
  const before = clone(fx.user);
  buildTeamView(fx.user);
  assertEqual(fx.user, before, `${name}: record unchanged`);
}

section("Display names");
assertEqual(displaySpeciesName(122, "Mr-mime"), "Mr. Mime", "slug → game name");
assertEqual(displaySpeciesName(6, "Charizard"), "Charizard", "normal names pass through");
assertEqual(displaySpeciesName(9999, undefined), "#9999", "unknown species → dex number");
assertEqual(Object.keys(DISPLAY_NAMES).length, 24, "every hyphenated stored name is covered");

section("EXP progress");
assertEqual(expProgress(8, 2), 0, "start of Level 2");
assertEqual(expProgress(100 ** 3, 100), 1, "Level cap is full");
assertTrue(expProgress(50 ** 3 + 3000, 50) > 0 && expProgress(50 ** 3 + 3000, 50) < 1, "mid-Level is between 0 and 1");

section("Sprites: uniform scale, fallbacks, safety");
assertEqual(spriteScale(40, 40, 200, 200, 2), 2, "small sprite uses the shared 2×");
assertEqual(spriteScale(90, 90, 200, 200, 2), 2, "large sprite uses the same 2×");
assertEqual(spriteScale(150, 100, 200, 200, 2), 200 / 150, "oversized sprite shrinks just enough to fit");
assertEqual(opaqueBounds(new Uint8Array([0, 0, 0, 0, 0, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 0]), 2, 2), { x: 1, y: 0, w: 1, h: 1 }, "opaque bounds");
assertTrue((await loadStaticSprite(25, "shiny"))?.width > 0, "loads a real sprite from disk");
assertEqual(await loadStaticSprite(9999, "normal"), null, "unknown species → null (placeholder drawn)");
assertEqual(await loadTrainerSprite("../../bot_final.js"), null, "trainer file names can't escape the sprite folder");
assertEqual(await loadTrainerSprite("not-a-real-trainer.png"), null, "missing trainer sprite → null");

section("Type tokens");
assertEqual(Object.keys(TYPE).length, 18, "all 18 types styled");
assertTrue(typeStyle("???").fill.startsWith("#"), "unknown type has a fallback style");

section("Every layout renders every fixture");
const PNG = [0x89, 0x50, 0x4e, 0x47];
for (const layout of Object.keys(LAYOUTS)) {
  for (const [name, fx] of Object.entries(FIXTURES)) {
    const t0 = performance.now();
    const view = buildTeamView(fx.user, { displayName: fx.displayName });
    const png = await renderShowteam(view, { layout });
    const want = sizeFor(layout, view);
    const ms = performance.now() - t0;
    const w = png.readUInt32BE(16), h = png.readUInt32BE(20);
    assertTrue(PNG.every((b, i) => png[i] === b) && w === want.w && h === want.h, `${layout}/${name}: ${w}×${h} PNG`);
    assertTrue(ms < 2000 && png.length < 1_000_000, `${layout}/${name}: ${Math.round(ms)} ms, ${Math.round(png.length / 1024)} KB`);
  }
}

section("Animated output");
{
  const gif = await renderShowteam(buildTeamView(FIXTURES.full.user), { layout: "roster", animate: true, frames: 6 });
  const r = new GifReader(gif);
  assertTrue(r.numFrames() === 6 && r.loopCount() === 0, "looping GIF with the requested frames");
  assertTrue(gif.length < 8 * 1024 * 1024, "well under Discord's attachment limit");
}

section("/showcase loops on whole sprite cycles");
{
  // The default (no `frames`): the fitted loop the other cards use, in 50 ms
  // steps, so sprites don't jump back to their first frame every 2.4 s.
  const view = buildTeamView(FIXTURES.full.user);
  const fitted = new GifReader(await renderShowteam(view, { layout: "refined", animate: true }));
  const delays = Array.from({ length: fitted.numFrames() }, (_, i) => fitted.frameInfo(i).delay * 10);
  const loopMs = delays.reduce((a, b) => a + b, 0);
  assertTrue(delays.every((d) => d === 50) && loopMs > 2400 && loopMs % 2400 === 0, `fitted: 50 ms frames, a whole number of 2.4 s clocks with a shiny backdrop (${loopMs} ms)`);
  const old = new GifReader(await renderShowteam(view, { layout: "refined", animate: true, env: { ...process.env, POKEMON_LOOP_FIT: "0" } }));
  assertTrue(old.numFrames() === 24 && old.frameInfo(0).delay === 10, "POKEMON_LOOP_FIT=0: the old 24 × 100 ms loop");
}

section("Refined layout");
{
  const full = buildTeamView(FIXTURES.full.user);
  assertEqual(sizeFor("refined", full), { w: 1200, h: 920 }, "refined: 1200×920 with a Team");
  assertEqual(sizeFor("refined", buildTeamView(FIXTURES.fallback.user)).h, 964, "refined grows 44 px for the no-Team note");
  const gif = new GifReader(await renderShowteam(full, { layout: "refined", animate: true, frames: 6 }));
  assertTrue(gif.numFrames() === 6 && gif.width === 1200 && gif.height === 920, "refined animates through the layered path");
}

section("Catch card");
{
  const fx = CATCH_FIXTURES.newCommon;
  const before = JSON.parse(JSON.stringify(fx.user));
  const v = catchView(fx.user, fx);
  assertEqual(fx.user, before, "catchView never mutates the record");
  assertEqual([v.name, v.types, v.tier, v.level, v.isNew], ["Cubchoo", ["Ice"], "common", 4, true], "real catch facts from data and grantCatch's result");
  assertEqual(v.dex, { region: "Unova", owned: 47, total: 156 }, "regional Pokédex completion: owned species now / region size");
  const dup = catchView(CATCH_FIXTURES.shinyDuplicate.user, CATCH_FIXTURES.shinyDuplicate);
  assertEqual([dup.shiny, dup.isNew, dup.expGained, dup.copies], [true, false, 3291, 3], "duplicate shiny: EXP gained and copies owned");
  assertEqual(catchView(CATCH_FIXTURES.newLegendary.user, CATCH_FIXTURES.newLegendary).name, "Giratina", "display name, not the stored slug");
  assertEqual(regionCompletion({ pokemon: { 1: { normal: 0, shiny: 0 }, 4: { normal: 1 } } }, "Kanto").owned, 1, "zero-copy entries don't count");
  assertEqual(regionCompletion({}, "Atlantis"), null, "unknown region: no Pokédex line");
  for (const [name, f] of Object.entries(CATCH_FIXTURES)) {
    const t0 = performance.now();
    const png = await renderCatchCard(catchView(f.user, f));
    const ms = performance.now() - t0;
    assertTrue(png.readUInt32BE(16) === CATCH_SIZE.w && png.readUInt32BE(20) === CATCH_SIZE.h && ms < 1000, `catch/${name}: ${CATCH_SIZE.w}×${CATCH_SIZE.h} in ${Math.round(ms)} ms`);
  }
  const gif = new GifReader(await renderCatchCard(v, { animate: true }));
  assertTrue(gif.numFrames() > 1 && gif.width === CATCH_SIZE.w, `catch card animates (${CATCH_SIZE.w} px wide)`);
}

finish();
