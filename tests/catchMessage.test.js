// ==========================================================
// tests/catchMessage.test.js
// The catch announcement: every catch animates when a GIF slot is free, the
// shared card gate, kill switches, captions, the embed fallback, and
// broadcastReward posting a card for every Pokémon broadcast (the caller's,
// or a sighting card it renders itself). Fake channels only.
// ==========================================================

import { assertEqual, assertTrue, section, finish } from "./harness.js";
import { renderCatchImage, catchCaption, broadcastCaption, catchAnnouncement } from "../utils/render/catchMessage.js";
import { catchView, sightingView, renderCatchCard, CATCH_SIZE } from "../utils/render/catchCard.js";
import { createRenderGate } from "../utils/render/renderGate.js";
import { broadcastReward } from "../utils/broadcastReward.js";
import { CATCH_FIXTURES } from "./fixtures/showteamFixtures.js";

const fx = CATCH_FIXTURES;
const common = catchView(fx.newCommon.user, fx.newCommon);
const shinyDup = catchView(fx.shinyDuplicate.user, fx.shinyDuplicate);
const legendary = catchView(fx.newLegendary.user, fx.newLegendary);
const gifDims = (b) => [b.readUInt16LE(6), b.readUInt16LE(8)];

section("Compact card, animated for every catch");
{
  assertEqual([CATCH_SIZE.w, CATCH_SIZE.h], [320, 96], "320 × 96, the old embed's width, drawn at the size Discord shows it");
  for (const v of [common, shinyDup, legendary]) {
    const gif = await renderCatchCard(v, { animate: true });
    assertTrue(gif.subarray(0, 3).toString() === "GIF" && gifDims(gif).join("×") === "320×96", `${v.name}: animated`);
  }
  const png = await renderCatchCard(common);
  assertEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [320, 96], "still version is a 320 × 96 PNG");
}

section("Image: shared gate and switches");
{
  const fake = async (_v, o) => Buffer.from(o?.animate ? "GIF89a" : "PNG");
  const gate = createRenderGate(1);
  assertEqual((await renderCatchImage(common, { gate, env: {}, render: fake })).name, "catch.gif", "a Common catch animates too");
  const held = gate.tryAcquire();
  assertEqual((await renderCatchImage(legendary, { gate, env: {}, render: fake })).name, "catch.png", "gate busy → PNG");
  held();
  assertEqual((await renderCatchImage(legendary, { gate, env: { CATCH_ANIMATED: "0" }, render: fake })).name, "catch.png", "CATCH_ANIMATED=0 → PNG");
  assertEqual((await renderCatchImage(legendary, { gate, env: { CARDS_ANIMATED: "0" }, render: fake })).name, "catch.png", "CARDS_ANIMATED=0 → PNG");
  const failing = async (_v, o) => { if (o?.animate) throw new Error("boom"); return Buffer.from("PNG"); };
  const r = await renderCatchImage(shinyDup, { gate, env: {}, render: failing });
  assertTrue(r.name === "catch.png" && gate.active === 0, "GIF failure → PNG, slot freed");
}

section("Captions");
assertEqual(catchCaption(common, "42"), "🎉 <@42> caught a wild **Cubchoo**!", "channel line pings the catcher");
assertEqual(catchCaption(shinyDup, "42"), "🎉 <@42> caught a ✨ shiny **Dragonite**!", "shiny wording");
assertEqual(broadcastCaption(legendary, "a_b*c"), "**a\\_b\\*c** caught a wild **Giratina**!", "broadcast line: no ping, name markdown escaped");
assertEqual(broadcastCaption(sightingView({ id: 25 }), "Misty"), "**Misty** caught **Pikachu**!", "sightings don't claim it was wild");

section("Sighting card (broadcasts without a catch result)");
{
  const s = sightingView({ id: 630, shiny: false });
  assertEqual([s.name, s.tier, s.level, s.isNew, s.dex, s.sighting], ["Mandibuzz", "rare", null, null, null, true], "species facts only");
  assertTrue(sightingView({ id: 25, shiny: true }).shiny, "shiny sightings");
  const gif = await renderCatchCard(s, { animate: true });
  assertEqual(gifDims(gif), [320, 96], "renders the same compact card");
}

section("catchAnnouncement");
{
  const catcher = { id: "42", username: "coop", globalName: "Coop" };
  const before = JSON.parse(JSON.stringify(fx.newCommon.user));
  const a = await catchAnnouncement({ user: fx.newCommon.user, catcher, pokemonId: 613, shiny: false, catchResult: fx.newCommon.catchResult, fallback: () => ({ embeds: ["old"] }) });
  assertEqual([a.message.content, a.message.files.length, a.message.embeds], ["🎉 <@42> caught a wild **Cubchoo**!", 1, undefined], "caption + card, no embed");
  assertEqual(a.broadcast.caption, "**Coop** caught a wild **Cubchoo**!", "broadcast uses the display name");
  assertEqual(fx.newCommon.user, before, "never mutates the record");
  const f = await catchAnnouncement({ user: fx.newCommon.user, catcher, pokemonId: 613, shiny: false, catchResult: fx.newCommon.catchResult, fallback: () => ({ embeds: ["old"] }), renderImage: async () => { throw new Error("boom"); } });
  assertEqual([f.message, f.broadcast], [{ embeds: ["old"] }, null], "render failure → today's embed");
}

section("broadcastReward: every Pokémon broadcast is a card");
{
  const sent = [];
  const channel = (id) => ({ id, send: async (p) => { sent.push({ id, p }); } });
  const client = { channels: { cache: new Map([["G", channel("G")], ["R", channel("R")]]), fetch: async () => null } };
  process.env.REWARD_CHANNEL_ID = "G";
  process.env.RARE_SIGHTINGS_CHANNEL_ID = "R";
  await broadcastReward(client, { user: { id: "1", username: "coop" }, type: "pokemon", item: { id: 487, name: "Giratina", rarity: "legendary" }, source: "random encounter",
    image: { buffer: Buffer.from("GIF"), name: "catch.gif" }, caption: "**Coop** caught a wild **Giratina**!" });
  assertEqual(sent.map((s) => s.id), ["G", "R"], "global + rare channels (Legendary)");
  assertTrue(sent.every((s) => s.p.files?.[0]?.name === "catch.gif" && !s.p.embeds && s.p.content === "**Coop** caught a wild **Giratina**!"), "the caller's card and caption, no embed");
  assertTrue(sent[0].p.files[0] !== sent[1].p.files[0], "a fresh attachment per channel");
  assertEqual(sent[0].p.allowedMentions, { parse: [] }, "broadcasts never ping");

  // Daily, starter pack and dashboard rewards pass no card: a sighting card is rendered here.
  sent.length = 0;
  await broadcastReward(client, { user: { id: "2", username: "misty" }, type: "pokemon", item: { id: 630, name: "Mandibuzz", rarity: "rare" }, source: "daily" });
  assertEqual(sent.map((s) => s.id), ["G", "R"], "a Rare daily Pokémon reaches rare sightings");
  assertTrue(sent.every((s) => /^catch\.(gif|png)$/.test(s.p.files?.[0]?.name ?? "") && !s.p.embeds && s.p.content === "**misty** caught **Mandibuzz**!"), "as the sighting card, not the old embed");
  sent.length = 0;
  await broadcastReward(client, { user: { id: "3", username: "brock" }, type: "trainer", item: { id: "brock", name: "Brock", rarity: "rare", spriteFile: "brock.png" }, source: "daily" });
  assertTrue(sent.length >= 1 && sent.every((s) => s.p.embeds?.length === 1), "trainer broadcasts keep their embed");
}

finish();
