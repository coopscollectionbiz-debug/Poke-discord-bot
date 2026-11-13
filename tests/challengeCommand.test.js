// ==========================================================
// tests/challengeCommand.test.js
// Drives the real /challenge execute() and its preview buttons with stub
// Discord objects. The fight must land on the live record (other commands
// and the dashboard replace it with a copy), re-check everything at the
// click, and never post the exact CC loss in public. Elite Four runs are
// driven through their private Revive menus.
// ==========================================================

import { assertEqual, assertTrue, section, finish } from "./harness.js";
import { execute, data, refusal, boardEmbed, boardMessage, boardMenu, reviveMenu, previewMessage, cardView, challengeExpMessage } from "../commands/challenge.js";
import { ComponentType } from "discord.js";
import { boardView, boardAltText, BOARD_SIZE } from "../utils/render/challengeBoard.js";
import { challengeCardView, cardAltText, cardSlots, CHALLENGE_CARD_SIZE } from "../utils/render/challengeCard.js";
import { previewChallenge } from "../utils/challenge/runChallenge.js";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { GifReader } from "omggif";
import { portraitBox, FRAME_WIDTH } from "../utils/battle/render.js";
import { lockUser } from "../utils/userLocks.js";
import { createNewUser } from "../utils/userSchema.js";
import { PLAYBACK, CHALLENGE } from "../utils/battle/tuning.js";
import { simulateChallenge, startRun, attachRunMessage } from "../utils/challenge/runChallenge.js";
import { CHALLENGES } from "../utils/challenge/roster.js";
import { badgeUrl } from "../utils/challenge/badgeImages.js";
import { buildTeam } from "../utils/battle/runBattle.js";
import { registerHooks } from "module";

PLAYBACK.delayMs = 0;
const quiet = console.log;
console.log = (...a) => { if (!String(a[0]).includes("loaded from memory")) quiet(...a); };
const GYMS = ["brock", "misty", "surge", "erika", "koga", "sabrina", "blaine", "giovanni"];

function player(speciesIds, level) {
  const u = createNewUser("A", "A");
  for (const sid of speciesIds) {
    u.pokemon[sid] = { normal: 1, shiny: 0 };
    (u.training ??= {})[`${sid}:normal`] = { exp: level ** 3 };
  }
  u.displayedPokemon = speciesIds.map((sid) => ({ id: sid, variant: "normal" }));
  u.cc = 12345;
  return u;
}
const WEAK = () => player([10], 5);
// Fight! picks a random seed, so tests that need a loss fight Giovanni, whom a
// lone Lv 5 Caterpie can't beat.
const LOSES = "giovanni";
const STRONG = () => player([150, 249, 250, 384, 483, 484], 100);
const allGyms = () => Object.fromEntries(GYMS.map((k) => [k, "d"]));
// The command picks its own seed, so Elite Four tests use a Team that behaves
// the same for any seed (pinned in "Elite Four fixture"): a Lv 5 Magikarp
// leads and faints, and a Lv 100 Mewtwo and Lugia clear every fight.
function runner() {
  const u = player([129, 150, 249], 100);
  u.training["129:normal"] = { exp: 5 ** 3 };
  u.challenge = { won: allGyms(), day: null, attempts: 0 };
  return u;
}
const tick = () => new Promise((r) => setTimeout(r, 5));
async function until(cond, ms = 30000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("timed out waiting");
    await tick();
  }
}

const embedJson = (e) => (e?.toJSON ? e.toJSON() : e);
// Everything a message says, including its images' alt text.
const textOf = (o) => (typeof o === "string" ? o
  : [o?.content ?? "", ...(o?.embeds ?? []).map((e) => JSON.stringify(embedJson(e))), ...(o?.files ?? []).map((f) => f.description ?? "")].join("\n"));
// The card is a GIF when it animates (idle trainers), else a PNG.
const card = (o) => o?.files?.find((f) => /^challenge\.(png|gif)$/.test(f.name));
const dims = (img) => (img.subarray(0, 3).toString() === "GIF" ? [img.readUInt16LE(6), img.readUInt16LE(8)] : [img.readUInt32BE(16), img.readUInt32BE(20)]);
const brightnessAt = async (png, x, y) => {
  const img = await loadImage(png);
  const ctx = createCanvas(img.width, img.height).getContext("2d");
  ctx.drawImage(img, 0, 0);
  return [...ctx.getImageData(x, y, 1, 1).data].slice(0, 3).reduce((a, b) => a + b, 0);
};

// One fake guild channel; the private reply and each Revive menu get a
// controllable collector. log.seq records public and private writes in order.
function harness(user = WEAK(), { perms = true, save = async () => {}, menusFail = false } = {}) {
  const trainerData = { A: user };
  const log = { replies: [], replyIds: [], replyEdits: [], channel: [], menus: [], seq: [], results: [] };
  const collectors = [];
  let ids = 0;
  const collectorStub = (opts) => ({ opts, h: {}, stopped: null, on(e, f) { this.h[e] = f; }, stop(reason) { this.stopped ??= reason; } });
  const message = (opts) => {
    const m = { id: `M${++ids}`, opts, edits: [], edit: async (o) => { m.edits.push(o); log.seq.push(["public", o]); } };
    log.channel.push(m);
    log.seq.push(["public", opts]);
    return m;
  };
  const channel = {
    id: "C1",
    send: async (opts) => message(opts),
    messages: { fetch: async (id) => log.channel.find((m) => m.id === id) ?? Promise.reject(new Error("Unknown Message")) },
  };
  const client = { channels: { fetch: async (id) => (id === "C1" ? channel : Promise.reject(new Error("Unknown Channel"))) } };
  // Each reply is a message with an ID, and each collector hears clicks on one
  // message, as in discord.js: a collector on the reply message itself
  // (withResponse), or on an InteractionResponse, which for a slash command
  // means its reply but for a component interaction (a dropdown pick) means
  // the message the component sits on (InteractionCollector, discord.js 14.28).
  const interaction = (opponent, { onMessage = null } = {}) => ({
    user: { id: "A", username: "A" },
    member: { displayName: "Ash" },
    channel,
    channelId: "C1",
    appPermissions: { has: () => perms },
    options: { getString: () => opponent ?? null },
    reply: async (o) => {
      const id = `R${++ids}`;
      log.replies.push(o);
      log.replyIds.push(id);
      const collectOn = (target) => (opts) => {
        const c = { opts, target, h: {}, ended: null, on(e, f) { this.h[e] = f; }, stop(reason) { this.ended ??= this.h.end?.([], reason); } };
        collectors.push(c);
        return c;
      };
      if (o.withResponse) return { resource: { message: { id, createMessageComponentCollector: collectOn(id) } } };
      return { createMessageComponentCollector: collectOn(onMessage ?? id) };
    },
    editReply: async (o) => { log.replyEdits.push(o); },
  });
  const button = (customId) => {
    const b = {
      user: { id: "A" },
      customId,
      updates: [],
      edits: [],
      followUps: [],
      replies: [],
      deferred: 0,
      update: async (o) => { b.updates.push(o); },
      deferUpdate: async () => { b.deferred++; },
      editReply: async (o) => { b.edits.push(o); log.seq.push(["private", o]); },
      followUp: async (o) => {
        b.followUps.push(o);
        if (!o.components) { // the private result after the replay
          log.results.push(o);
          log.seq.push(["private", o]);
          return { id: `P${++ids}` };
        }
        if (menusFail === "silent") return undefined; // bot_final's wrapper swallows "Unknown interaction"
        if (menusFail) throw new Error("Unknown Webhook");
        const menu = { id: `P${++ids}`, opts: o, from: b, collector: null };
        menu.createMessageComponentCollector = (opts) => (menu.collector = collectorStub(opts));
        log.menus.push(menu);
        return menu;
      },
      reply: async (o) => { b.replies.push(o); },
    };
    return b;
  };
  const run = (opponent) => execute(interaction(opponent), trainerData, null, null, lockUser, save, client);
  const nonceOf = (reply) => embedJson(reply.components[0]).components[0].custom_id.split(":")[1];
  const nonce = () => nonceOf(log.replies.at(-1));
  // Clicks a button on the newest reply. Only a collector on that message
  // hears it; with none, the click gets no answer ("didn't respond in time").
  const click = async (kind, c = collectors.findLast((x) => x.target === log.replyIds.at(-1))) => {
    const b = button(`challenge_${kind}:${nonce()}`);
    if (c) await c.h.collect(b);
    return b;
  };
  const publicText = () => log.channel.map((m) => [textOf(m.opts), ...m.edits.map(textOf)].join("\n")).join("\n");
  const menuButtons = (menu) => menu.opts.components.flatMap((r) => embedJson(r).components);
  // Clicks a Revive menu's button (the first by default) and returns the click.
  // Like Discord: once a collector has stopped, a click reaches nothing and gets no answer.
  const pick = async (menu, customId = menuButtons(menu)[0].custom_id) => {
    const b = button(customId);
    if (!menu.collector.stopped) await menu.collector.h.collect(b);
    return b;
  };
  // Clicks Fight! on the newest preview and answers each Revive menu with
  // answer(menu, index) until the run ends. Resolves to the Fight! click.
  const fightRun = async (answer) => {
    const fight = button(`challenge_fight_casual:${nonce()}`);
    let done = false;
    const playing = collectors.at(-1).h.collect(fight).then(() => { done = true; });
    for (let seen = 0; !done;) {
      await until(() => done || log.menus.length > seen);
      if (log.menus.length > seen) await answer(log.menus[seen], seen++);
    }
    await playing;
    return fight;
  };
  // Picks `value` from the newest board's dropdown, like Discord: a new
  // interaction from the same player in the same channel.
  const choose = async (value) => {
    const board = collectors.findLast((c) => c.opts.componentType === ComponentType.StringSelect);
    const at = log.replies.findLastIndex((r) => r.files?.[0]?.name === "board.png");
    const customId = embedJson(log.replies[at].components[0]).components[0].custom_id;
    await board.h.collect({ ...interaction(null, { onMessage: log.replyIds[at] }), customId, values: [value] });
    return board;
  };
  return { trainerData, log, collectors, run, click, publicText, button, nonce, nonceOf, channel, menuButtons, pick, fightRun, choose };
}

section("Command shape");
{
  const json = data.toJSON();
  assertEqual(json.name, "challenge", "named /challenge");
  assertEqual(json.options[0].choices.map((c) => c.value), [...GYMS, "elite4", "blue", "red"], "11 opponent choices");
  assertEqual(json.options[0].choices.map((c) => c.name).slice(-4), ["Giovanni", "Elite Four", "Blue", "Red"], "choices use the labels");
  assertEqual(json.options[0].required, false, "the opponent is optional");
}

section("Board");
{
  const t = harness();
  await t.run(null);
  const r = t.log.replies[0];
  assertEqual(r.flags, 64, "private");
  const board = r.files?.find((f) => f.name === "board.png");
  assertEqual(board && dims(board.attachment), [BOARD_SIZE.w, BOARD_SIZE.h], "the board card");
  assertEqual(board.description, boardAltText(boardView(t.trainerData.A, { displayName: "Ash", now: new Date() })), "described for screen readers");
  assertEqual(t.log.channel.length, 0, "nothing public");

  // The embed, sent when the card can't render.
  const quietWarn = console.warn;
  console.warn = () => {};
  const fallback = await boardMessage(t.trainerData.A, "Ash", new Date(), { render: async () => { throw new Error("boom"); } });
  console.warn = quietWarn;
  assertTrue(!fallback.files?.length, "no image when it can't render");
  const e = embedJson(fallback.embeds[0]);
  assertEqual(e.title, "Kanto challenges", "titled");
  const lines = e.description.split("\n");
  assertEqual(lines.length, 11, "8 Gyms, Elite Four, Blue, Red");
  assertTrue(lines[0].includes("**Brock** · Rock") && !lines[0].includes("✅"), "a Gym line with its type, not earned");
  assertTrue(lines.some((l) => l === "🔒 **Elite Four** · 8 more Badges"), "Elite Four locked with Badges missing");
  assertTrue(lines.some((l) => l === "🔒 **Blue** · Clear the Elite Four"), "Blue locked");
  assertTrue(lines.at(-1) === "**Red**", "Red open");
  assertTrue(!JSON.stringify(e).includes("Lv"), "no Levels");
  assertEqual(e.footer.text, "Challenges left today: 5/5", "attempts left");

  const u = WEAK();
  u.challenge = { won: Object.fromEntries(GYMS.slice(0, 7).map((k) => [k, "d"])), day: new Date().toISOString().slice(0, 10), attempts: 2 };
  const b = embedJson(boardEmbed(u, new Date()));
  assertTrue(b.description.split("\n")[0].endsWith(" ✅"), "an earned Badge is checked");
  assertTrue(b.description.includes("🔒 **Elite Four** · 1 more Badge\n"), "one Badge left, singular");
  assertEqual(b.footer.text, "Challenges left today: 3/5", "attempts used today count down");
  u.challenge.won.giovanni = "d";
  u.challenge.won.elite4 = "d";
  const open = embedJson(boardEmbed(u, new Date())).description;
  assertTrue(open.includes("\n**Elite Four** ✅\n") && open.includes("\n**Blue**\n"), "cleared run checked; Blue open");

  const nobody = harness();
  delete nobody.trainerData.A;
  await nobody.run(null);
  assertTrue(nobody.log.replies[0].files[0].description.endsWith("5 of 5 challenges left today."), "a player with no record still sees the board");
}

section("Refusals");
{
  const user = WEAK();
  assertEqual(
    ["no_team", "locked_elite4", "locked_blue", "cap", "pending_wager", "no_perms", "settled"].map((r) => refusal(r, user)),
    ["Challenges use your Casual or Ranked team. Set one on the Teams page: run /dashboard.", "Earn all 8 Badges first. You have 0.", "Clear the Elite Four to challenge Blue.",
      "You've used all 5 challenges today. They reset at midnight UTC.", "Finish your pending wager first.",
      "I can't post challenges in this channel. Try another one.", "This challenge already happened."],
    "exact copy");
  const cases = [
    ["no_team", (u) => { u.displayedPokemon = []; }, "brock"],
    ["locked_elite4", () => {}, "elite4"],
    ["locked_blue", () => {}, "blue"],
    ["cap", (u) => { u.challenge = { won: {}, day: new Date().toISOString().slice(0, 10), attempts: 5 }; }, "red"],
    ["pending_wager", (u) => { u.pendingWager = { nonce: "x" }; }, "brock"],
  ];
  for (const [reason, setup, key] of cases) {
    const t = harness();
    setup(t.trainerData.A);
    await t.run(key);
    const r = t.log.replies[0];
    assertTrue(r.content === refusal(reason, t.trainerData.A) && r.flags === 64 && !r.components, `${reason} is refused privately`);
    assertEqual(t.log.channel.length, 0, `${reason}: nothing public`);
  }
  const noPerms = harness(WEAK(), { perms: false });
  await noPerms.run("brock");
  assertEqual(noPerms.log.replies[0].content, refusal("no_perms"), "missing channel permissions are refused");
}

section("The challenge channel");
{
  // CHALLENGE_CHANNEL_ID keeps /challenge in one channel; unset, it works anywhere (every other section).
  process.env.CHALLENGE_CHANNEL_ID = "C2";
  const elsewhere = harness();
  await elsewhere.run("brock");
  const r = elsewhere.log.replies[0];
  assertTrue(r.content === "Challenges happen in <#C2>." && r.flags === 64 && !r.components, "a challenge elsewhere is refused privately");
  assertEqual([elsewhere.log.channel.length, elsewhere.trainerData.A.challenge], [0, undefined], "nothing public, nothing counted");
  const board = harness();
  await board.run(null);
  assertEqual(board.log.replies[0].content, "Challenges happen in <#C2>.", "the board too");
  process.env.CHALLENGE_CHANNEL_ID = "C1";
  const home = harness();
  await home.run("brock");
  assertEqual(embedJson(home.log.replies[0].components[0]).components.map((b) => b.label), ["Fight with Casual", "Not now"], "in the challenge channel, the preview opens");
  delete process.env.CHALLENGE_CHANNEL_ID;
}

section("The board's dropdown");
{
  const options = (user) => embedJson(boardMenu(user, "n")).components[0].options.map((o) => o.value);
  const fresh = WEAK();
  assertEqual(options(fresh), [...GYMS, "red"], "every Gym and Red; the Elite Four and Blue stay out until they open");
  const eight = WEAK();
  eight.challenge = { won: allGyms(), day: null, attempts: 0 };
  assertEqual(options(eight), [...GYMS, "elite4", "red"], "8 Badges add the Elite Four");
  eight.challenge.won.elite4 = "d";
  assertEqual(options(eight), [...GYMS, "elite4", "blue", "red"], "a cleared run adds Blue");
  assertEqual(embedJson(boardMenu(fresh, "n")).components[0].options.slice(0, 2).map((o) => o.label), ["Brock", "Misty"], "labeled by name");

  const t = harness();
  await t.run(null);
  const menu = embedJson(t.log.replies[0].components[0]).components[0];
  assertEqual([menu.type, menu.custom_id.startsWith("challenge_pick:"), menu.placeholder], [ComponentType.StringSelect, true, "Choose who to challenge"],
    "the board carries the dropdown");

  await t.choose("brock");
  const preview = t.log.replies.at(-1);
  assertEqual([preview.flags, preview.content], [64, "A loss costs you **1,234 CC**."], "picking Brock opens the private preview");
  assertTrue(preview.files[0].description.startsWith("Ash vs Gym Leader Brock"), "with Brock's VS card");
  const fight = await t.click("fight");
  assertEqual([t.trainerData.A.challenge?.attempts, t.log.channel.length], [1, 2], "and Fight! from it plays the challenge");
  assertTrue(!!fight.updates.length, "answering the click");

  const capped = harness();
  capped.trainerData.A.challenge = { won: {}, day: new Date().toISOString().slice(0, 10), attempts: CHALLENGE.perDay };
  await capped.run(null);
  await capped.choose("misty");
  assertEqual(capped.log.replies.at(-1), { content: refusal("cap"), flags: 64 }, "a pick is checked like the command: out of challenges is refused privately");

  const idle = harness();
  await idle.run(null);
  const board = idle.collectors.find((c) => c.opts.componentType === ComponentType.StringSelect);
  assertEqual(board.opts.time, 10 * 60 * 1000, "the dropdown works for 10 minutes");
  board.stop("time");
  assertEqual(idle.log.replyEdits.at(-1), { components: [] }, "then it leaves the board, which stays");
}

section("Preview");
{
  const t = harness();
  await t.run("brock");
  const r = t.log.replies[0];
  assertEqual(r.flags, 64, "private");
  const png = card(r);
  assertTrue(!!png && dims(png.attachment).join("x") === `${CHALLENGE_CARD_SIZE.w}x${CHALLENGE_CARD_SIZE.h}`, "the VS card");
  assertEqual(png.description, cardAltText(challengeCardView("brock", previewChallenge(t.trainerData.A, "brock"), t.trainerData.A, { displayName: "Ash" })),
    "described for screen readers, with the challenger's display name");
  assertTrue(png.description.includes("Win: Brock sprite, 2,500 CC, 1 stone, and 5 Dust"), "the prize");
  assertEqual(r.content, "A loss costs you **1,234 CC**.", "the exact loss, in text only");
  assertTrue(!r.embeds?.length, "no embed");
  assertTrue(!textOf(r).includes("Lv"), "no Levels");
  const buttons = embedJson(r.components[0]).components;
  assertEqual(buttons.map((b) => b.label), ["Fight with Casual", "Not now"], "Fight! and Not now");
  assertEqual(t.collectors[0].opts.time, 120000, "buttons work for 2 minutes");
  assertEqual(t.trainerData.A.challenge, undefined, "a preview holds nothing");

  const run = harness(STRONG());
  run.trainerData.A.challenge = { won: Object.fromEntries(GYMS.map((k) => [k, "d"])), day: null, attempts: 0 };
  await run.run("elite4");
  assertTrue(card(run.log.replies[0]).description.startsWith("Ash vs the Elite Four: Lorelei, Bruno, Agatha, and Lance."), "the run lists who's in it");

  const rematch = harness();
  rematch.trainerData.A.challenge = { won: { brock: "d" }, day: null, attempts: 0 };
  await rematch.run("brock");
  assertTrue(card(rematch.log.replies[0]).description.includes("Rematch. Win: EXP only."), "a rematch says so");
}

section("The private EXP message");
{
  const t = harness(STRONG());
  await t.run("brock");
  await t.click("fight");
  const quietWarn = console.warn;
  console.warn = () => {};
  const text = await challengeExpMessage(
    // The same Outcome shape the command gets; a fresh win over Brock.
    (await import("../utils/challenge/runChallenge.js")).runChallenge({ trainerData: { A: STRONG() }, userId: "A", key: "brock", seed: 1 }),
    { A: "Ash", brock: "Gym Leader Brock" }, null, { render: async () => { throw new Error("boom"); } });
  console.warn = quietWarn;
  assertEqual(text.files, undefined, "a card that can't render sends text instead");
  assertTrue(text.content.startsWith("You won! 🎁 Brock sprite") && text.content.split("\n").length === 7, "the result, then one line per Team member");
  assertTrue(/^Mewtwo Lv 100 · \+\d+ EXP$/.test(text.content.split("\n")[1]), "each with its Level and EXP gained");

  const fails = harness(STRONG());
  await fails.run("brock");
  const b = fails.button(`challenge_fight_casual:${fails.nonce()}`);
  b.followUp = async () => { throw new Error("Invalid Webhook Token"); };
  let threw = false;
  await fails.collectors.at(-1).h.collect(b).catch(() => { threw = true; });
  assertTrue(!threw && fails.trainerData.A.challenge.won.brock, "a refused follow-up (an expired reply window) doesn't throw; the win still counts");
}

section("Preview: the embed when the card can't render");
{
  const user = WEAK();
  const preview = previewChallenge(user, "brock");
  const view = challengeCardView("brock", preview, user, { displayName: "Ash" });
  const quietWarn = console.warn;
  console.warn = () => {};
  const fallback = await previewMessage("brock", preview, view, { exactLoss: true, render: async () => { throw new Error("boom"); } });
  const pub = await previewMessage("brock", preview, view, { render: async () => { throw new Error("boom"); } });
  console.warn = quietWarn;
  const e = embedJson(fallback.embeds[0]);
  assertTrue(!fallback.files?.length && !fallback.content, "no image, and no loss line above the embed (the embed has it)");
  assertEqual(e.title, "Gym Leader Brock", "titled with the opponent");
  assertTrue(e.thumbnail.url.endsWith("/trainers_2/brock.png"), "Brock's sprite");
  assertEqual([e.author?.name, e.author?.icon_url, e.description], ["Boulder Badge", badgeUrl("brock"), "Rock"], "the Badge with its image, and the type");
  const field = (name) => e.fields.find((f) => f.name === name)?.value;
  assertEqual(field("Win"), "Brock sprite, 2,500 CC, 1 stone, and 5 Dust", "the prize");
  assertEqual(field("Lose"), "1,234 CC (10% of your CC)", "the exact loss, privately");
  assertEqual(embedJson(pub.embeds[0]).fields.find((f) => f.name === "Lose").value, "10% of their CC", "and 10% in public");

  // Building the card's facts can fail too (before the fight is saved, under the lock): the embed still goes.
  console.warn = () => {};
  const broken = cardView("no-such-challenge", preview, user, "Ash");
  const noView = await previewMessage("brock", preview, broken, { exactLoss: true });
  console.warn = quietWarn;
  assertEqual(broken, null, "facts that can't be built give no view, without throwing");
  assertEqual(embedJson(noView.embeds[0]).fields.find((f) => f.name === "Lose").value, "1,234 CC (10% of your CC)", "and the preview sends the embed");
}

section("Not now and expiry");
{
  const t = harness();
  await t.run("brock");
  const b = await t.click("cancel");
  assertEqual(b.updates[0], { content: "Not now.", embeds: [], components: [], attachments: [] }, "Not now closes the preview and its card");
  assertEqual(t.log.channel.length, 0, "nothing public");
  assertEqual([t.trainerData.A.challenge, t.trainerData.A.cc], [undefined, 12345], "no attempt used, no CC lost");

  const x = harness();
  await x.run("brock");
  x.collectors[0].stop("time");
  await x.collectors[0].ended;
  assertEqual(x.log.replyEdits[0], { content: "Preview expired.", embeds: [], components: [], attachments: [] }, "expiry closes the preview and its card");
  assertEqual(x.trainerData.A.challenge, undefined, "and costs nothing");
}

section("Fight! and a loss");
{
  const t = harness();
  await t.run(LOSES);
  const b = await t.click("fight");
  const res = t.log.results.at(-1);
  assertEqual(res.content, "You lost 1,234 CC.", "the private result shows the exact loss");
  assertEqual([res.flags, res.files?.map((f) => f.name)], [64, ["exp.png"]], "with the EXP card, privately, as /battle sends it");
  assertEqual(b.edits, [], "the \"starting below\" message stays as it is");
  assertEqual([t.trainerData.A.cc, t.trainerData.A.challenge.attempts], [11111, 1], "CC and the attempt are recorded");
  assertEqual(t.log.channel.length, 2, "the intro card and the replay post");
  const intro = t.log.channel[0].opts;
  assertTrue(card(intro).description.endsWith("Win: Giovanni sprite, 12,000 CC, 3 stones, and 25 Dust. Lose: 10% of CC."),
    "the intro is the VS card, with the prize at stake and 10%");
  assertTrue(!(intro.content ?? "").includes("<@") && !(intro.content ?? "").includes("CC"), "and no mention or amount above it");
  const pub = t.publicText();
  assertTrue(!pub.includes("1,234") && !pub.includes("1234") && !pub.includes("11,111") && !pub.includes("11111"), "no amount or balance in public");
  assertTrue(pub.includes("💸 Lost 10% of their CC."), "the replay ends with the loss line");
  assertEqual(t.collectors[0].ended !== null, true, "the preview stops listening");

  const again = await t.click("fight");
  assertEqual([again.replies[0], again.updates, again.followUps], [{ content: "This challenge already happened.", flags: 64 }, [], []],
    "a second click finds it settled, answered privately");
  assertEqual(t.trainerData.A.challenge.attempts, 1, "and uses no attempt");
}

section("Clicks while a Fight! is saving");
{
  // A forced save can wait behind a running flush; the preview must not take more clicks meanwhile.
  let finishSave;
  const t = harness(WEAK(), { save: () => new Promise((r) => { finishSave = r; }) });
  await t.run(LOSES);
  const nonce = t.log.replies[0].components[0].toJSON().components[0].custom_id.split(":")[1];
  const fight = { user: { id: "A" }, customId: `challenge_fight_casual:${nonce}`, updates: [], edits: [], replies: [], followUps: [],
    update: async (o) => { fight.updates.push(o); }, deferUpdate: async () => {}, editReply: async (o) => { fight.edits.push(o); },
    reply: async (o) => { fight.replies.push(o); }, followUp: async (o) => { fight.followUps.push(o); } };
  const fighting = t.collectors[0].h.collect(fight);
  await new Promise((r) => setTimeout(r, 0));
  assertEqual(fight.updates[0], { content: "⚔️ Your challenge is starting below.", embeds: [], components: [], attachments: [] }, "Fight! drops the buttons at once");
  const notNow = await t.click("cancel");
  assertEqual([notNow.replies[0], notNow.updates, notNow.followUps], [{ content: "This challenge already happened.", flags: 64 }, [], []],
    "Not now during the save is answered privately and changes nothing");
  t.collectors[0].stop("time");
  await t.collectors[0].ended;
  finishSave();
  await fighting;
  assertTrue(!t.log.replyEdits.some((e) => e.content === "Preview expired."), "expiry during the save doesn't cover the fight");
  assertTrue(textOf(fight.followUps.at(-1)).includes("You lost 1,234 CC."), "the fight finishes and shows its result");
  assertEqual(t.trainerData.A.challenge.attempts, 1, "one attempt used");
}

section("Fight! and a first win");
{
  const t = harness(STRONG());
  await t.run("brock");
  const b = await t.click("fight");
  assertEqual(t.log.results.at(-1).content, "You won! 🎁 Brock sprite, 2,500 CC, 1 stone, and 5 Dust", "the private result shows the prize");
  const intro = card(t.log.channel[0].opts);
  assertTrue(intro.description.includes("The Boulder Badge is on the line. Win: Brock sprite, 2,500 CC, 1 stone, and 5 Dust."),
    "the intro card shows the Badge and prize before they were won");
  // The intro posts after the win is saved; it must still show the Badge as not yet earned.
  const boulder = cardSlots({ kind: "gym", badge: {} }).badges[0];
  assertTrue(await brightnessAt(intro.attachment, boulder.x + boulder.size / 2, boulder.y + boulder.size / 2) < 400,
    "the challenger's Boulder Badge is still dim on it");
  assertTrue(t.publicText().includes("Earned the Boulder Badge"), "the result shows the Badge");
}

section("The replay shows the challenger's trainer");
{
  const startFrame = async (trainer) => {
    const t = harness(STRONG());
    t.trainerData.A.displayedTrainer = trainer;
    await t.run("brock");
    await t.click("fight");
    const r = new GifReader(t.log.channel[1].opts.files[0].attachment);
    const px = new Uint8Array(r.width * r.height * 4);
    r.decodeAndBlitFrameRGBA(0, px);
    return px;
  };
  const [withTrainer, without] = [await startFrame("acerola-masters.png"), await startFrame(null)];
  const box = portraitBox(0);
  let differ = 0;
  for (let y = box.y; y < box.y + box.h; y++) for (let x = box.x; x < box.x + box.w; x++) {
    const i = (y * FRAME_WIDTH + x) * 4;
    if (Math.abs(withTrainer[i] - without[i]) + Math.abs(withTrainer[i + 1] - without[i + 1]) + Math.abs(withTrainer[i + 2] - without[i + 2]) > 60) differ++;
  }
  assertTrue(differ > 600, "their displayed trainer stands in the replay's portrait");
}

section("Review Focus: changes between preview and Fight!");
{
  const t = harness();
  await t.run(LOSES);
  t.trainerData.A = structuredClone(t.trainerData.A); // e.g. a dashboard save
  await t.click("fight");
  assertEqual([t.trainerData.A.cc, t.trainerData.A.challenge?.attempts], [11111, 1], "the fight lands on the live record");

  const empty = harness();
  await empty.run("brock");
  empty.trainerData.A.displayedPokemon = [];
  const b = await empty.click("fight");
  assertEqual(textOf(b.edits[0]), "Challenges use your Casual or Ranked team. Set one on the Teams page: run /dashboard.", "an emptied Team is refused at the click");
  assertEqual([empty.log.channel.length, empty.trainerData.A.challenge], [0, undefined], "nothing posts or counts");

  const wager = harness();
  await wager.run("brock");
  wager.trainerData.A.pendingWager = { nonce: "x" };
  const w = await wager.click("fight");
  assertEqual(textOf(w.edits[0]), "Finish your pending wager first.", "a wager offered after the preview is refused");
  assertEqual(wager.trainerData.A.cc, 12345, "and nothing is lost");

  const richer = harness();
  await richer.run(LOSES);
  richer.trainerData.A.cc = 50000;
  const rb = await richer.click("fight");
  assertEqual(richer.log.results.at(-1).content, "You lost 1,234 CC.", "the loss never exceeds what the preview showed");
  assertEqual(richer.trainerData.A.cc, 50000 - 1234, "balance after the capped loss");
}

section("Single fight: the private result comes after the replay");
{
  const t = harness();
  await t.run(LOSES);
  const b = await t.click("fight");
  assertEqual(b.updates[0], { content: "⚔️ Your challenge is starting below.", embeds: [], components: [], attachments: [] }, "Fight! points to the channel first");
  const privateAt = t.log.seq.findIndex(([k, o]) => k === "private" && textOf(o).includes("You lost 1,234 CC."));
  const lastPublic = t.log.seq.findLastIndex(([k]) => k === "public");
  assertTrue(privateAt > lastPublic && lastPublic > 0, "the exact loss arrives after the replay's last frame");
}

section("Elite Four fixture");
{
  const team = buildTeam(runner());
  assertEqual(team.map((m) => [m.speciesId, m.level]), [[129, 5], [150, 100], [249, 100]], "Lv 5 Magikarp leads Lv 100 Mewtwo and Lugia");
  const onlyMagikarp = (f) => {
    const hp = f.result.snapshots.at(-1)[0];
    return hp[0] === 0 && hp[1] > 0 && hp[2] > 0;
  };
  const holds = Array.from({ length: 200 }, (_, seed) => {
    const run = (pick) => simulateChallenge({ team, opponents: CHALLENGES.elite4.opponents, seed, pick });
    const revived = run(({ hp }) => hp.indexOf(0));
    const never = run(() => null);
    return revived.cleared && revived.fights.slice(0, -1).every(onlyMagikarp) && never.cleared && onlyMagikarp(never.fights[0]);
  });
  assertTrue(holds.every(Boolean),
    "for 200 seeds, only Magikarp faints, after every fight even when revived, and the run clears with or without Revives");
}

section("Elite Four run: picking a Revive");
{
  const t = harness(runner());
  await t.run("elite4");
  const clicks = [];
  let earlier = null;
  let atFirstBreak = null;
  const fight = await t.fightRun(async (menu, k) => {
    if (k === 0) atFirstBreak = t.log.channel[1].edits.at(-1)?.content;
    const b = await t.pick(menu);
    clicks.push(b);
    if (k === 0) clicks.push(await t.pick(menu)); // a double click
    if (k === 1) earlier = await t.pick(t.log.menus[0]); // an earlier break's button
  });
  const [menu0, menu1] = t.log.menus;
  assertEqual(fight.updates[0], { content: "⚔️ Your challenge is starting below.", embeds: [], components: [], attachments: [] }, "Fight! points to the channel");
  assertTrue(atFirstBreak.startsWith("⚔️ <@A> · Elite Four · Lorelei (1 of 4)") && atFirstBreak.endsWith("\n⏳ <@A> is choosing a Pokémon to revive…"),
    "during the pick, the replay says the player is choosing");
  assertEqual([menu0.opts.content, menu0.opts.flags], ["Next: Bruno · Fighting\nPick a Pokémon to revive · 60 s", 64], "the menu is private and names who's next");
  assertEqual(t.menuButtons(menu0).map((b) => [b.label, b.style]), [["Magikarp Lv 5", 3]], "one button per fainted Pokémon");
  assertEqual(menu0.from, fight, "the first menu uses the Fight! click's reply window");
  assertEqual(clicks[0].updates, [{ content: "Magikarp revived.", components: [] }], "a click revives it");
  assertEqual([clicks[1].updates, clicks[1].replies, clicks[1].deferred], [[], [], 1], "a second click is acknowledged and changes nothing");
  assertTrue(t.publicText().includes("Bruno (2 of 4)\n💊 <@A> revived Magikarp!"), "the next header says who was revived");
  assertEqual(t.log.menus.length, 3, "a menu at every break");
  assertEqual(menu1.from, clicks[0], "the next menu uses the newest click's reply window");
  assertEqual([earlier.updates, earlier.replies, earlier.deferred], [[], [], 1], "an earlier break's button is answered and changes nothing");
  assertEqual([t.trainerData.A.challenge.run, t.trainerData.A.challenge.won.elite4 !== undefined, t.trainerData.A.challenge.attempts],
    [undefined, true, 1], "the run is cleared and closed, for one attempt");
  const privateAt = t.log.seq.findIndex(([k, o]) => k === "private" && textOf(o).startsWith("You won! 🎁 Lorelei sprite"));
  const finalFrame = t.log.seq.findLastIndex(([k, o]) => k === "public" && o.embeds?.length);
  assertTrue(privateAt > finalFrame && finalFrame > 0, "the private result arrives after the last replay");
  assertTrue(textOf(t.log.channel[1].edits.at(-1)).includes("Lorelei ✓ · Bruno ✓ · Agatha ✓ · Lance ✓"), "the run ends with its result embed");
}

section("A Revive menu for six fainted Pokémon");
{
  // A double knockout can win a fight with all six fainted.
  const names = ["Bulbasaur", "Ivysaur", "Venusaur", "Charmander", "Charmeleon", "Charizard"];
  const step = { nonce: "N", step: 1, next: CHALLENGES.elite4.opponents[2], fainted: names.map((name, slot) => ({ slot, name, level: 70 })) };
  const menu = reviveMenu(step);
  const rows = menu.components.map((r) => embedJson(r).components);
  assertEqual(rows.map((r) => r.length), [5, 1], "six buttons take two rows of up to 5");
  assertEqual(rows.flat().map((b) => b.custom_id), names.map((_, slot) => `challenge_revive:N:2:${slot}`), "each button names the run, the next fight, and the slot");
  assertEqual([rows[1][0].label, menu.content], ["Charizard Lv 70", "Next: Agatha · Ghost\nPick a Pokémon to revive · 60 s"], "labels and the next opponent");
}

section("Elite Four run: no pick in time");
{
  CHALLENGE.pickMs = 30;
  const t = harness(runner());
  await t.run("elite4");
  const fight = await t.fightRun(async () => {});
  CHALLENGE.pickMs = 60000;
  const menu0 = t.log.menus[0];
  const closing = fight.edits.find((e) => e.message === menu0);
  assertEqual([closing?.content, closing?.components, Object.keys(closing ?? {}).sort()], ["No Pokémon was revived.", [], ["components", "content", "message"]],
    "at the deadline the menu loses its buttons");
  assertTrue(t.log.menus.every((m) => m.from === fight), "with no pick, later menus use the Fight! click");
  assertTrue(t.publicText().includes("Bruno (2 of 4)\n💊 No Pokémon was revived."), "the next header says nothing was revived");
  const late = await t.pick(menu0);
  assertEqual([late.replies, late.updates], [[{ content: "Too late. No Pokémon was revived.", flags: 64 }], []], "a click after the deadline is too late");
  assertTrue(t.trainerData.A.challenge.won.elite4 !== undefined, "and the run still cleared");
}

section("Elite Four run: a Revive menu that can't be sent");
{
  const t = harness(runner(), { menusFail: true });
  await t.run("elite4");
  const fight = t.button(`challenge_fight_casual:${t.nonce()}`);
  await t.collectors.at(-1).h.collect(fight);
  assertTrue(fight.followUps.length >= 1 && t.publicText().includes("Bruno (2 of 4)\n💊 No Pokémon was revived."), "counts as no pick, and the run goes on");
  assertEqual(t.trainerData.A.challenge.run, undefined, "to its end");

  const expired = harness(runner(), { menusFail: "silent" });
  await expired.run("elite4");
  const late = expired.button(`challenge_fight_casual:${expired.nonce()}`);
  await expired.collectors.at(-1).h.collect(late);
  assertEqual(expired.trainerData.A.challenge.run, undefined, "a menu the bot's wrapper drops (an expired reply window) counts as no pick too");
}

section("Elite Four run: a loss at Lorelei");
{
  const u = WEAK();
  u.challenge = { won: allGyms(), day: null, attempts: 0 };
  const t = harness(u);
  await t.run("elite4");
  const fight = await t.fightRun(async () => {});
  assertEqual([t.log.menus.length, t.trainerData.A.cc, t.trainerData.A.challenge.run], [0, 11111, undefined], "no menu; 10% lost; the run is closed");
  assertEqual(t.log.results.at(-1).content, "You lost 1,234 CC.", "the private result shows the amount");
  assertTrue(!t.publicText().includes("1,234") && !t.publicText().includes("1234"), "the public replay never does");
}

section("While a run is open");
{
  CHALLENGE.pickMs = 200;
  const t = harness(runner());
  await t.run("brock");
  const olderNonce = t.nonce();
  const olderCollector = t.collectors.at(-1);
  await t.run("elite4");
  const playing = t.fightRun(async () => {});
  await until(() => t.log.menus.length === 1);
  await t.run("brock");
  assertEqual(t.log.replies.at(-1), { content: "Finish your Elite Four run first.", flags: 64 }, "/challenge with an opponent refuses");
  await t.run(null);
  assertEqual(t.log.replies.at(-1).files?.[0]?.name, "board.png", "the board still works");
  const old = t.button(`challenge_fight_casual:${olderNonce}`);
  await olderCollector.h.collect(old);
  assertEqual(textOf(old.edits.at(-1)), "Finish your Elite Four run first.", "Fight! on an older preview refuses the same way");
  await playing;
  CHALLENGE.pickMs = 60000;
  assertEqual(t.trainerData.A.challenge.attempts, 1, "only the run used an attempt");
}

section("A live run is never stale");
{
  // A long replay queue can keep a run's step from moving for 15 minutes while
  // its command is still playing it; only a run whose command died is stale.
  CHALLENGE.pickMs = 300;
  const t = harness(runner());
  await t.run("elite4");
  const playing = t.fightRun(async () => {});
  await until(() => t.log.menus.length === 1);
  t.trainerData.A.challenge.run.updatedAt -= 16 * 60 * 1000;
  await t.run("brock");
  assertEqual(t.log.replies.at(-1).content, "Finish your Elite Four run first.", "/challenge leaves a run that's still playing alone");
  const fight = await playing;
  CHALLENGE.pickMs = 60000;
  assertTrue(t.log.results.at(-1).content.startsWith("You won!"), "and the run finishes with its private result");
  assertTrue(!t.publicText().includes("stopped unexpectedly"), "with no stopped note");
}

section("A run that stopped unexpectedly");
{
  let saves = 0;
  const t = harness(runner(), { save: async () => { saves++; } });
  const step = startRun({ trainerData: t.trainerData, userId: "A", seed: 1, maxLoss: 1234, channelId: "C1", now: new Date() });
  const replay = await t.channel.send({ content: "replay" });
  attachRunMessage(t.trainerData.A, step.nonce, { channelId: "C1", messageId: replay.id });
  t.trainerData.A.challenge.run.updatedAt -= 16 * 60 * 1000;
  await t.run(null);
  await until(() => replay.edits.length > 0);
  assertEqual([t.trainerData.A.challenge.run, t.trainerData.A.challenge.won.elite4 !== undefined, saves > 0], [undefined, true, true],
    "the next /challenge finishes it, applies the result, and saves");
  assertEqual(replay.edits.at(-1).content, "⚔️ <@A>'s Elite Four run stopped unexpectedly and finished without Revives.", "the run's message says so");
  assertEqual(embedJson(replay.edits.at(-1).embeds[0]).title, "🏆 Ash cleared the Elite Four!", "with the result");
  assertEqual(t.log.replies.at(-1).files?.[0]?.name, "board.png", "then the board shows");

  const preview = harness(runner());
  startRun({ trainerData: preview.trainerData, userId: "A", seed: 1, maxLoss: 1234, channelId: "C1", now: new Date() });
  preview.trainerData.A.challenge.run.updatedAt -= 16 * 60 * 1000;
  await preview.run("brock");
  assertTrue(card(preview.log.replies.at(-1)).description.startsWith("Ash vs Gym Leader Brock"), "or the preview, after finishing it");

  const fresh = harness(runner());
  startRun({ trainerData: fresh.trainerData, userId: "A", seed: 1, maxLoss: 1234, channelId: "C1", now: new Date() });
  fresh.trainerData.A.challenge.run.updatedAt -= 14 * 60 * 1000;
  await fresh.run("brock");
  assertEqual(fresh.log.replies.at(-1).content, "Finish your Elite Four run first.", "a run 14 minutes quiet is still open");
}

section("Elite Four fights that fail (review I4)");
{
  // The full sim, wrapped so a test can make a fight throw the way a crashed
  // sim worker would; inline (SIM_THREADS=0), so the wrapper is the full sim.
  registerHooks({
    load(url, context, next) {
      if (url.endsWith("/utils/battle/showdown/simulate.js")) {
        return { format: "module", shortCircuit: true, source: `import * as real from "./simulate.js?real";
export function simulateFull(input) { if (globalThis.failFight?.()) throw new Error("test: the sim failed"); return real.simulateFull(input); }` };
      }
      return next(url, context);
    },
  });
  process.env.FULL_SIM_ENABLED = "1";
  process.env.SIM_THREADS = "0";
  const warn = console.warn;
  console.warn = () => {};
  try {
    const t = harness(runner());
    await t.run("elite4");
    globalThis.failFight = () => true;
    const start = await t.click("fight_casual");
    assertEqual(start.edits.at(-1)?.content, "The fight couldn't run. Try again.", "a first fight that fails says so");
    assertEqual([t.trainerData.A.challenge.run, t.trainerData.A.challenge.attempts], [undefined, 0], "and leaves no run and spends no attempt");

    const later = harness(runner());
    await later.run("elite4");
    let fights = 0;
    globalThis.failFight = () => ++fights === 2;
    const fight = await later.fightRun((menu) => later.pick(menu));
    const run = later.trainerData.A.challenge.run;
    assertEqual([run?.next, run?.fights.length], [1, 1], "a later fight that fails leaves the run open after the fights already played");
    assertTrue(fight.followUps.some((o) => o.content === "The next fight couldn't run, so your run is paused. Use /challenge again in 15 minutes and it finishes without Revives."),
      "and tells the player how it finishes");
  } finally {
    console.warn = warn;
    globalThis.failFight = undefined;
    delete process.env.FULL_SIM_ENABLED;
    delete process.env.SIM_THREADS;
  }
}

finish();
