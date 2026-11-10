// ==========================================================
// tests/catchMessage.test.js
// The random-catch announcement: which catches animate, the one-at-a-time
// GIF gate, captions, the embed fallback, and broadcastReward posting the
// same card (no pings) or, without one, its old embed. Fake channels only.
// ==========================================================

import { assertEqual, assertTrue, section, finish } from "./harness.js";
import { shouldAnimate, renderCatchImage, catchCaption, broadcastCaption, catchAnnouncement } from "../utils/render/catchMessage.js";
import { catchView } from "../utils/render/catchCard.js";
import { createRenderGate } from "../utils/render/renderGate.js";
import { broadcastReward } from "../utils/broadcastReward.js";
import { CATCH_FIXTURES } from "./fixtures/showteamFixtures.js";

const fx = CATCH_FIXTURES;
const common = catchView(fx.newCommon.user, fx.newCommon);
const shinyDup = catchView(fx.shinyDuplicate.user, fx.shinyDuplicate);
const legendary = catchView(fx.newLegendary.user, fx.newLegendary);

section("Which catches animate");
assertEqual([shouldAnimate(common), shouldAnimate(shinyDup), shouldAnimate(legendary)], [false, true, true], "Common: still; shiny and Rare-or-better: animated");

section("Image: gate and fallbacks");
{
  const fake = async (_v, o) => Buffer.from(o?.animate ? "GIF" : "PNG");
  const gate = createRenderGate(1);
  assertEqual((await renderCatchImage(common, { gate, env: {}, render: fake })).name, "catch.png", "Common → PNG");
  assertEqual((await renderCatchImage(legendary, { gate, env: {}, render: fake })).name, "catch.gif", "Legendary → GIF");
  const held = gate.tryAcquire();
  assertEqual((await renderCatchImage(legendary, { gate, env: {}, render: fake })).name, "catch.png", "a GIF already rendering → PNG");
  held();
  assertEqual((await renderCatchImage(legendary, { gate, env: { CATCH_ANIMATED: "0" }, render: fake })).name, "catch.png", "CATCH_ANIMATED=0 → PNG");
  const failing = async (_v, o) => { if (o?.animate) throw new Error("boom"); return Buffer.from("PNG"); };
  const r = await renderCatchImage(shinyDup, { gate, env: {}, render: failing });
  assertTrue(r.name === "catch.png" && gate.active === 0, "GIF failure → PNG, slot freed");
  const real = await renderCatchImage(legendary, { gate: createRenderGate(1), env: {} });
  assertEqual(real.buffer.subarray(0, 3).toString(), "GIF", "real render: an animated GIF");
}

section("Captions");
assertEqual(catchCaption(common, "42"), "🎉 <@42> caught a wild **Cubchoo**!", "channel line pings the catcher");
assertEqual(catchCaption(shinyDup, "42"), "🎉 <@42> caught a ✨ shiny **Dragonite**!", "shiny wording");
assertEqual(broadcastCaption(legendary, "a_b*c"), "**a\\_b\\*c** caught a wild **Giratina**!", "broadcast line: no ping, name markdown escaped");

section("catchAnnouncement");
{
  const catcher = { id: "42", username: "coop", globalName: "Coop" };
  const before = JSON.parse(JSON.stringify(fx.newCommon.user));
  const a = await catchAnnouncement({ user: fx.newCommon.user, catcher, pokemonId: 613, shiny: false, catchResult: fx.newCommon.catchResult, fallback: () => ({ embeds: ["old"] }) });
  assertEqual([a.message.content, a.message.files.length, a.message.embeds], ["🎉 <@42> caught a wild **Cubchoo**!", 1, undefined], "caption + card, no embed");
  assertEqual(a.broadcast.caption, "**Coop** caught a wild **Cubchoo**!", "broadcast uses the display name");
  assertEqual(fx.newCommon.user, before, "never mutates the record");
  const f = await catchAnnouncement({ user: fx.newCommon.user, catcher, pokemonId: 613, shiny: false, catchResult: fx.newCommon.catchResult, fallback: () => ({ embeds: ["old"] }), renderImage: async () => { throw new Error("boom"); } });
  assertEqual([f.message, f.broadcast], [{ embeds: ["old"] }, null], "render failure → today's embed, broadcast keeps its embed");
}

section("broadcastReward");
{
  const sent = [];
  const channel = (id) => ({ id, send: async (p) => { sent.push({ id, p }); } });
  const client = { channels: { cache: new Map([["G", channel("G")], ["R", channel("R")]]), fetch: async () => null } };
  process.env.REWARD_CHANNEL_ID = "G";
  process.env.RARE_SIGHTINGS_CHANNEL_ID = "R";
  const item = { id: 487, name: "Giratina", rarity: "legendary" };
  await broadcastReward(client, { user: { id: "1", username: "coop" }, type: "pokemon", item, source: "random encounter",
    image: { buffer: Buffer.from("GIF"), name: "catch.gif" }, caption: "**Coop** caught a wild **Giratina**!" });
  assertEqual(sent.map((s) => s.id), ["G", "R"], "global + rare channels (Legendary)");
  assertTrue(sent.every((s) => s.p.files?.[0]?.name === "catch.gif" && !s.p.embeds && s.p.content === "**Coop** caught a wild **Giratina**!"), "each gets the card and caption, no embed");
  assertTrue(sent[0].p.files[0] !== sent[1].p.files[0], "a fresh attachment per channel");
  assertEqual(sent[0].p.allowedMentions, { parse: [] }, "broadcasts never ping");
  sent.length = 0;
  await broadcastReward(client, { user: { id: "2", username: "misty" }, type: "pokemon", item: { id: 25, name: "Pikachu", rarity: "uncommon" }, source: "daily" });
  assertTrue(sent.length === 1 && sent[0].p.embeds?.length === 1 && !sent[0].p.files, "without a card: the old embed, global only");
}

finish();
