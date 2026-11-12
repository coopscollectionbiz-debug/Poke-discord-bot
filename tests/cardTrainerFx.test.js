// Trainer effects on cards and battle images: tier lookup, the kill switch,
// region backdrops staying clear of content, the /battle VS card, its
// records (read before the battle), and the VS card opening playback.
import { assertEqual, assertTrue, section, finish } from "./harness.js";
import { trainerTier, cardTrainerFx } from "../utils/render/trainerTier.js";
import { regionBackdrop, backdropTint, createBackdrop } from "../utils/render/trainerBackdrop.js";
import { renderBattleVsCard, vsSide, battleVsAltText, BATTLE_VS_SIZE } from "../utils/render/battleVsCard.js";
import { renderChallengeCard } from "../utils/render/challengeCard.js";
import { renderTrainerShowcase } from "../utils/render/trainerShowcase.js";
import { renderBattleFrame } from "../utils/battle/render.js";
import { vsRecord, vsRecords, vsView } from "../commands/battle.js";
import { playBattle, vsHoldMs } from "../utils/battle/playback.js";
import { runBattle } from "../utils/battle/runBattle.js";
import { createNewUser } from "../utils/userSchema.js";
import { grantCatch } from "../utils/training.js";
import { createCanvas } from "@napi-rs/canvas";

const isGif = (b) => b.subarray(0, 3).toString() === "GIF";
const gifDims = (b) => [b.readUInt16LE(6), b.readUInt16LE(8)];
const pngDims = (b) => [b.readUInt32BE(16), b.readUInt32BE(20)];

section("Tier lookup and the kill switch");
{
  assertEqual(trainerTier("cynthia-anime.png"), "mythic", "a Mythic sprite");
  assertEqual(trainerTier("alder.png"), "legendary", "a Legendary sprite");
  assertEqual(trainerTier("ALDER"), "legendary", "case and extension don't matter");
  assertEqual(trainerTier("no-such-trainer.png"), null, "an unknown file has no tier");
  assertEqual(trainerTier(null), null, "nor does no trainer");
  assertEqual([backdropTint("mythic"), backdropTint("Epic"), backdropTint("rare"), backdropTint(null)], ["#ef4444", "#a855f7", null, null],
    "only Epic, Legendary and Mythic have a backdrop colour");
  assertTrue(cardTrainerFx({}) && cardTrainerFx({ CARD_TRAINER_FX: "1" }), "on by default");
  assertTrue(!cardTrainerFx({ CARD_TRAINER_FX: "0" }), "CARD_TRAINER_FX=0 turns it off");
}

section("Region backdrop: wide, diagonal, clear of content");
{
  const rect = { x: 10, y: 20, w: 400, h: 160 };
  const busy = (x, y) => x >= 100 && x < 180 && y >= 60 && y < 140; // a sprite's box
  assertEqual(regionBackdrop({ tier: "rare", rect, occupied: () => false, from: [10, 180], to: [400, 0], floor: 170, frames: 24 }), null, "below Epic: none");
  const bd = regionBackdrop({ tier: "mythic", rect, u: 2, occupied: busy, from: [10, 180], to: [400, 0], floor: 170, frames: 24, dil: 0 });
  assertTrue(!!bd && bd.tint === "#ef4444", "Mythic: a backdrop in its colour");
  // Effects (anything brighter than the glow) never land on the busy box, in any frame.
  let onBusy = 0, effects = 0;
  for (let f = 0; f < 24; f++) {
    const c = createCanvas(420, 200), ctx = c.getContext("2d");
    bd.draw(ctx, f);
    const d = ctx.getImageData(0, 0, 420, 200).data;
    for (let y = 0; y < 200; y++) for (let x = 0; x < 420; x++) {
      const a = d[(y * 420 + x) * 4 + 3];
      if (a > 120) { effects++; if (busy(x, y)) onBusy++; }
    }
  }
  assertTrue(effects > 0, `effects show (${effects} bright pixels over the loop)`);
  assertEqual(onBusy, 0, "and none on content");
  const spread = createBackdrop({ tier: "mythic", gridW: 438, gridH: 89, mask: new Uint8Array(438 * 89), halo: { from: [0, 89], to: [370, -50] }, floorRow: 85, frames: 24, spread: true });
  const xs = spread.meteors.map((m) => m.x0).sort((a, b) => a - b);
  assertEqual(spread.meteors.length, 8, "a wide Mythic region gets 8 meteors a loop");
  assertTrue(xs[0] < 438 * 0.2 && xs.at(-1) > 438 * 0.75, `spread across the width (${xs.join(", ")})`);
  assertEqual(createBackdrop({ tier: "mythic", gridW: 80, gridH: 90, mask: new Uint8Array(7200), halo: { cx: 40, cy: 40, rx: 30, ry: 30 }, floorRow: 85, frames: 24 }).meteors.length, 3,
    "a trainer's own panel keeps the approved 3");
}

section("VS records: read before the battle, never created");
{
  const u = createNewUser("A", "Ash");
  assertEqual(vsRecord(u, "open"), { wins: 0, losses: 0, streak: 0 }, "a new player's casual record");
  assertTrue(u.casual === undefined, "reading it doesn't create one");
  u.casual = { wins: 7, losses: 3, streak: 4, bestStreak: 5 };
  assertEqual(vsRecord(u, "open"), { wins: 7, losses: 3, streak: 4 }, "casual: W–L and streak");
  const r = vsRecord(u, "ranked");
  assertTrue(typeof r.rating === "number" && r.wins === 0 && r.streak === 0, "ranked with no games this season: the starting rating, no streak");
  const recs = vsRecords({ A: u, B: null }, ["A", "B"], "open");
  assertEqual(recs.B, { wins: 0, losses: 0, streak: 0 }, "a missing record reads as empty");
  const v = vsView("wager", [{ userId: "A", members: [{ speciesId: 6, variant: "shiny" }] }, { userId: "B", members: [] }], { A: "Ash", B: "Gary" }, { A: { displayedTrainer: "alder.png" }, B: {} }, { A: { rating: 1500, wins: 1, losses: 0, streak: 0 } }, 400);
  assertEqual([v.mode, v.pot, v.sides[0].tier, v.sides[0].team[0].shiny, v.sides[1].trainerFile], ["wager", 400, "legendary", true, null], "the view: mode, pot, tiers, Teams");
  assertTrue(battleVsAltText(v).includes("Ash (rating 1500") && battleVsAltText(v).includes("400 CC pot"), "alt text names the players, ratings and pot");
}

section("The /battle VS card");
{
  const mon = (ids) => ids.map((speciesId) => ({ speciesId, variant: "normal" }));
  const v = {
    mode: "ranked", pot: null,
    sides: [
      vsSide({ name: "Coop", trainerFile: "cynthia-anime.png", tier: "mythic", members: mon([25, 6]), record: { rating: 1512, wins: 9, losses: 4, streak: 3 } }),
      vsSide({ name: "Gary", trainerFile: "alain.png", tier: "rare", members: mon([9]), record: { rating: 1488, wins: 2, losses: 7, streak: 0 } }),
    ],
  };
  const still = await renderBattleVsCard(v);
  assertTrue(!isGif(still) && pngDims(still).join("x") === `${BATTLE_VS_SIZE.w}x${BATTLE_VS_SIZE.h}`, "a still PNG by default");
  const gif = await renderBattleVsCard(v, { animate: true });
  assertTrue(isGif(gif) && gifDims(gif).join("x") === "1200x640", "animated: a GIF");
  const off = await renderBattleVsCard(v, { animate: true, env: { CARD_TRAINER_FX: "0", TRAINERS_ANIMATED: "0" } });
  assertTrue(off.length < gif.length, "CARD_TRAINER_FX=0: no backdrop or idles (a smaller image)");
}

section("Cards with the effects off stay still");
{
  const v = {
    key: "brock", kind: "gym", eyebrow: "GYM LEADER", title: "Brock", type: "Rock", accent: "#b8a038",
    opponents: [{ name: "Brock", title: "Gym Leader", type: "Rock", trainerFile: "brock.png" }], partySize: 2,
    badge: null, win: "1,000 CC", rematch: false,
    player: { name: "Ash", trainerFile: "cynthia-anime.png", tier: "mythic", team: [], badges: [] },
  };
  const off = await renderChallengeCard(v, { animate: true, env: { CARD_TRAINER_FX: "0", TRAINERS_ANIMATED: "0" } });
  assertTrue(!isGif(off), "no backdrop, no idles, no Team: the /challenge card is a PNG");
  const on = await renderChallengeCard(v, { animate: true });
  assertTrue(isGif(on), "with them on, a Mythic player makes it a GIF");
}

section("Playback rows and the showcase");
{
  const pk = (speciesId) => ({ speciesId, name: `#${speciesId}`, level: 50, variant: "normal" });
  const sides = [{ name: "Coop", members: [pk(25)] }, { name: "Gary", members: [pk(9)] }];
  const frame = await renderBattleFrame({ sides, hpBefore: [[1], [1]], trainers: ["cynthia-anime.png", "alain.png"], tiers: ["mythic", null] });
  assertTrue(isGif(frame), "a playback frame with a Mythic row renders");
  assertTrue((await renderTrainerShowcase({ file: "cynthia-anime.png", tier: "mythic" }, { animate: true })).length > 0, "the /showtrainers showcase renders");
  assertEqual(await renderTrainerShowcase({ file: "no-such.png", tier: "mythic" }), null, "a missing sprite: none (the URL is used)");
}

section("The VS card opens playback");
{
  const trainer = (id, ids) => {
    const u = createNewUser(id, id);
    for (const s of ids) grantCatch(u, s, "normal", () => 0.5);
    u.displayedPokemon = ids.map((s) => ({ id: s, variant: "normal" }));
    u.displayedTrainer = id === "A" ? "cynthia-anime.png" : "alain.png";
    return u;
  };
  const td = { A: trainer("A", [6, 25]), B: trainer("B", [19]) };
  const names = { A: "Ash", B: "Gary" };
  const before = vsRecords(td, ["A", "B"], "open");
  const out = runBattle({ trainerData: td, challengerId: "A", defenderId: "B", mode: "open", seed: 3, now: new Date("2026-11-02T12:00:00Z") });
  const vs = vsView("open", out.sides, names, td, before);
  assertEqual(vs.sides[0].record, before.A, "the card shows the record from before the battle");
  const sent = [], edits = [];
  const channel = { send: async (o) => { sent.push(o); return { edit: async (e) => { edits.push(e); } }; } };
  const t0 = Date.now();
  await playBattle(channel, out, names, { maxUpdates: 2, delayMs: 0, trainers: [td.A.displayedTrainer, td.B.displayedTrainer], vs });
  assertTrue(/^battle-vs\.(gif|png)$/.test(sent[0].files[0].name), `the first image is the VS card (${sent[0].files[0].name})`);
  assertTrue(edits.length >= 1 && !edits.some((e) => e.files?.[0]?.name?.startsWith("battle-start")), "then the turns, with no start image");
  assertTrue(Date.now() - t0 >= vsHoldMs(isGif(sent[0].files[0].attachment)) - 50, "it stays up for the hold before turn 1");
  assertEqual([vsHoldMs(true), vsHoldMs(false)], [4800, 4000], "the hold: at least 4 s, whole 2.4 s loops for a GIF");
}

finish();
