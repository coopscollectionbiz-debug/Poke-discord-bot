// ==========================================================
// tests/challengeCommand.test.js
// Drives the real /challenge execute() and its preview buttons with stub
// Discord objects. The fight must land on the live record (other commands
// and the dashboard replace it with a copy), re-check everything at the
// click, and never post the exact CC loss in public.
// ==========================================================

import { assertEqual, assertTrue, section, finish } from "./harness.js";
import { execute, data, refusal, boardEmbed } from "../commands/challenge.js";
import { lockUser } from "../utils/userLocks.js";
import { createNewUser } from "../utils/userSchema.js";
import { PLAYBACK } from "../utils/battle/tuning.js";

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

const embedJson = (e) => (e?.toJSON ? e.toJSON() : e);
const textOf = (o) => (typeof o === "string" ? o
  : [o?.content ?? "", ...(o?.embeds ?? []).map((e) => JSON.stringify(embedJson(e)))].join("\n"));

// One fake guild channel; the private reply gets a controllable collector.
function harness(user = WEAK(), { perms = true, save = async () => {} } = {}) {
  const trainerData = { A: user };
  const log = { replies: [], replyEdits: [], channel: [] };
  const collectors = [];
  const message = (opts) => {
    const m = { opts, edits: [], edit: async (o) => { m.edits.push(o); } };
    log.channel.push(m);
    return m;
  };
  const channel = { send: async (opts) => message(opts) };
  const interaction = (opponent) => ({
    user: { id: "A", username: "A" },
    member: { displayName: "Ash" },
    channel,
    appPermissions: { has: () => perms },
    options: { getString: () => opponent ?? null },
    reply: async (o) => {
      log.replies.push(o);
      return {
        createMessageComponentCollector: (opts) => {
          const c = { opts, h: {}, ended: null, on(e, f) { this.h[e] = f; }, stop(reason) { this.ended ??= this.h.end?.([], reason); } };
          collectors.push(c);
          return c;
        },
      };
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
      update: async (o) => { b.updates.push(o); },
      deferUpdate: async () => {},
      editReply: async (o) => { b.edits.push(o); },
      followUp: async (o) => { b.followUps.push(o); },
      reply: async (o) => { b.replies.push(o); },
    };
    return b;
  };
  const run = (opponent) => execute(interaction(opponent), trainerData, null, null, lockUser, save, null);
  const nonce = () => {
    const row = embedJson(log.replies.at(-1).components[0]);
    return row.components[0].custom_id.split(":")[1];
  };
  const click = async (kind, c = collectors.at(-1)) => {
    const b = button(`challenge_${kind}:${nonce()}`);
    await c.h.collect(b);
    return b;
  };
  const publicText = () => log.channel.map((m) => [textOf(m.opts), ...m.edits.map(textOf)].join("\n")).join("\n");
  return { trainerData, log, collectors, run, click, publicText };
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
  const e = embedJson(r.embeds[0]);
  assertEqual(e.title, "Kanto challenges", "titled");
  const lines = e.description.split("\n");
  assertEqual(lines.length, 11, "8 Gyms, Elite Four, Blue, Red");
  assertTrue(lines[0].includes("**Brock** · Rock") && !lines[0].includes("✅"), "a Gym line with its type, not earned");
  assertTrue(lines.some((l) => l === "🔒 **Elite Four** · 8 more Badges"), "Elite Four locked with Badges missing");
  assertTrue(lines.some((l) => l === "🔒 **Blue** · Clear the Elite Four"), "Blue locked");
  assertTrue(lines.at(-1) === "**Red**", "Red open");
  assertTrue(!JSON.stringify(e).includes("Lv"), "no Levels");
  assertEqual(e.footer.text, "Challenges left today: 5/5", "attempts left");
  assertEqual(t.log.channel.length, 0, "nothing public");

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
  assertEqual(embedJson(nobody.log.replies[0].embeds[0]).footer.text, "Challenges left today: 5/5", "a player with no record still sees the board");
}

section("Refusals");
{
  const user = WEAK();
  assertEqual(
    ["no_team", "locked_elite4", "locked_blue", "cap", "pending_wager", "no_perms", "settled"].map((r) => refusal(r, user)),
    ["Set a Team on your dashboard first.", "Earn all 8 Badges first. You have 0.", "Clear the Elite Four to challenge Blue.",
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

section("Preview");
{
  const t = harness();
  await t.run("brock");
  const r = t.log.replies[0];
  assertEqual(r.flags, 64, "private");
  const e = embedJson(r.embeds[0]);
  assertEqual(e.title, "Gym Leader Brock", "titled with the opponent");
  assertTrue(e.thumbnail.url.endsWith("/trainers_2/brock-gen3.png"), "Brock's sprite");
  assertTrue(e.description.includes("Boulder Badge") && e.description.includes("Rock"), "Badge and type");
  const field = (name) => e.fields.find((f) => f.name === name)?.value;
  assertEqual(field("Win"), "Brock sprite, 2,500 CC, 1 stone, and 5 Dust", "the prize");
  assertEqual(field("Lose"), "1,234 CC (10% of your CC)", "the exact loss");
  assertTrue(!JSON.stringify(e).includes("Lv"), "no Levels");
  const buttons = embedJson(r.components[0]).components;
  assertEqual(buttons.map((b) => b.label), ["Fight!", "Not now"], "Fight! and Not now");
  assertEqual(t.collectors[0].opts.time, 120000, "buttons work for 2 minutes");
  assertEqual(t.trainerData.A.challenge, undefined, "a preview holds nothing");

  const run = harness(STRONG());
  run.trainerData.A.challenge = { won: Object.fromEntries(GYMS.map((k) => [k, "d"])), day: null, attempts: 0 };
  await run.run("elite4");
  const re = embedJson(run.log.replies[0].embeds[0]);
  assertEqual(re.title, "Elite Four", "the run is titled Elite Four");
  assertTrue(re.description.includes("Lorelei · Bruno · Agatha · Lance"), "the run lists who's in it");

  const rematch = harness();
  rematch.trainerData.A.challenge = { won: { brock: "d" }, day: null, attempts: 0 };
  await rematch.run("brock");
  assertEqual(embedJson(rematch.log.replies[0].embeds[0]).fields.find((f) => f.name === "Win").value, "Rematch: EXP only", "a rematch says so");
}

section("Not now and expiry");
{
  const t = harness();
  await t.run("brock");
  const b = await t.click("cancel");
  assertEqual(b.updates[0], { content: "Not now.", embeds: [], components: [] }, "Not now closes the preview");
  assertEqual(t.log.channel.length, 0, "nothing public");
  assertEqual([t.trainerData.A.challenge, t.trainerData.A.cc], [undefined, 12345], "no attempt used, no CC lost");

  const x = harness();
  await x.run("brock");
  x.collectors[0].stop("time");
  await x.collectors[0].ended;
  assertEqual(x.log.replyEdits[0], { content: "Preview expired.", embeds: [], components: [] }, "expiry closes the preview");
  assertEqual(x.trainerData.A.challenge, undefined, "and costs nothing");
}

section("Fight! and a loss");
{
  const t = harness();
  await t.run(LOSES);
  const b = await t.click("fight");
  assertTrue(textOf(b.edits[0]).includes("You lost 1,234 CC."), "the private reply shows the exact loss");
  assertEqual(b.edits[0].components, [], "and drops the buttons");
  assertEqual([t.trainerData.A.cc, t.trainerData.A.challenge.attempts], [11111, 1], "CC and the attempt are recorded");
  assertEqual(t.log.channel.length, 2, "the intro card and the replay post");
  const intro = embedJson(t.log.channel[0].opts.embeds[0]);
  assertEqual(intro.fields.find((f) => f.name === "Lose").value, "10% of their CC", "the intro card says 10%");
  assertEqual(intro.fields.find((f) => f.name === "Win").value, "Giovanni sprite, 12,000 CC, 3 stones, and 25 Dust", "and the prize at stake");
  assertTrue(!(t.log.channel[0].opts.content ?? "").includes("<@"), "the intro card mentions no one");
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
  const fight = { user: { id: "A" }, customId: `challenge_fight:${nonce}`, updates: [], edits: [], replies: [], followUps: [],
    update: async (o) => { fight.updates.push(o); }, deferUpdate: async () => {}, editReply: async (o) => { fight.edits.push(o); },
    reply: async (o) => { fight.replies.push(o); }, followUp: async (o) => { fight.followUps.push(o); } };
  const fighting = t.collectors[0].h.collect(fight);
  await new Promise((r) => setTimeout(r, 0));
  assertEqual(fight.updates[0], { content: "⚔️ Fighting…", embeds: [], components: [] }, "Fight! drops the buttons at once");
  const notNow = await t.click("cancel");
  assertEqual([notNow.replies[0], notNow.updates, notNow.followUps], [{ content: "This challenge already happened.", flags: 64 }, [], []],
    "Not now during the save is answered privately and changes nothing");
  t.collectors[0].stop("time");
  await t.collectors[0].ended;
  finishSave();
  await fighting;
  assertTrue(!t.log.replyEdits.some((e) => e.content === "Preview expired."), "expiry during the save doesn't cover the fight");
  assertTrue(textOf(fight.edits.at(-1)).includes("You lost 1,234 CC."), "the fight finishes and shows its result");
  assertEqual(t.trainerData.A.challenge.attempts, 1, "one attempt used");
}

section("Fight! and a first win");
{
  const t = harness(STRONG());
  await t.run("brock");
  const b = await t.click("fight");
  assertEqual(textOf(b.edits[0]), "You won! 🎁 Brock sprite, 2,500 CC, 1 stone, and 5 Dust", "the private reply shows the prize");
  const intro = embedJson(t.log.channel[0].opts.embeds[0]);
  assertEqual(intro.fields.find((f) => f.name === "Win").value, "Brock sprite, 2,500 CC, 1 stone, and 5 Dust", "the intro card shows the prize before it was won");
  assertTrue(t.publicText().includes("Earned the Boulder Badge"), "the result shows the Badge");
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
  assertEqual(textOf(b.edits[0]), "Set a Team on your dashboard first.", "an emptied Team is refused at the click");
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
  assertTrue(textOf(rb.edits[0]).includes("You lost 1,234 CC."), "the loss never exceeds what the preview showed");
  assertEqual(richer.trainerData.A.cc, 50000 - 1234, "balance after the capped loss");
}

finish();
