// ==========================================================
// tests/encounterFlow.test.js
// The Discord side of Trainer encounters (docs/superpowers/specs/
// 2026-11-10-trainer-encounters-design.md, Discord UX), with stub Discord
// objects: the replay on the card and its result embed, and
// (utils/encounter/service.js) spotting, the card, Battle! with its private
// EXP card and the card shrinking to the result, Run, timeouts, other players'
// clicks, and clicks on cards from before a restart. Synthetic data only.
// ==========================================================

import { assertEqual, assertTrue, section, finish } from "./harness.js";
import { encounterNames, encounterSummary, buildEncounterEmbed, playEncounter, createQueue } from "../utils/battle/playback.js";
import { fightEncounter } from "../utils/encounter/runEncounter.js";
import { rollTrainer } from "../utils/encounter/generate.js";
import { createNewUser } from "../utils/userSchema.js";
import { buildTeam } from "../utils/battle/runBattle.js";
import { PLAYBACK } from "../utils/battle/tuning.js";
import { createEncounterService, isEncounterButton } from "../utils/encounter/service.js";
import { RAN, LOST_INTEREST, STALE_LINE, fill } from "../utils/encounter/lines.js";
import { lockUser } from "../utils/userLocks.js";

PLAYBACK.delayMs = 0;
const quiet = console.log;
console.log = (...a) => { if (!String(a[0]).includes("loaded from memory")) quiet(...a); };

function player(speciesIds, level, cc = 12345) {
  const u = createNewUser("A", "A");
  for (const sid of speciesIds) {
    u.pokemon[sid] = { normal: 1, shiny: 0 };
    (u.training ??= {})[`${sid}:normal`] = { exp: level ** 3 };
  }
  u.displayedPokemon = speciesIds.map((sid) => ({ id: sid, variant: "normal" }));
  u.cc = cc;
  return u;
}
const STRONG = () => player([150, 249, 250, 384, 483, 484], 100);
const card = (user) => buildTeam(user).map(({ speciesId, variant }) => ({ speciesId, variant }));
const youngster = { ...rollTrainer({ team: [{ level: 10 }], seed: 1 }), classKey: "youngster", title: "Youngster", name: "Joey", spriteFile: "youngster-gen3.png" };
const ace = {
  ...youngster, classKey: "acetrainer", title: "Ace Trainer", name: "Kent", spriteFile: "acetrainer-gen3.png", tier: "over",
  party: [{ speciesId: 10, level: 5 }, { speciesId: 149, level: 100 }, { speciesId: 149, level: 100 }], prize: 3000,
};
const settle = (user, trainer) =>
  fightEncounter({ trainerData: { A: user }, userId: "A", encounter: { team: card(user), trainer }, seed: 1, now: new Date("2026-11-10T12:00:00Z") });

function recorder() {
  const sent = [];
  const edits = [];
  const channel = { send: async (o) => { sent.push(o); return { edit: async (e) => { edits.push(e); } }; } };
  return { sent, edits, channel };
}
// A posted encounter card, recording its edits.
function cardStub() {
  const m = { edits: [], edit: async (e) => { m.edits.push(e); } };
  return m;
}
const description = (o) => o.embeds?.[0]?.toJSON().description ?? "";

section("Playback");
{
  const win = settle(STRONG(), youngster);
  const names = encounterNames(win, "Ash");
  assertEqual(names, { A: "Ash", trainer: "Youngster Joey" }, "the player and the Trainer by name");
  assertEqual(buildEncounterEmbed(win, names).toJSON().description.split("\n"),
    [`💬 Youngster Joey: "${youngster.lines.lost}"`, `💰 Ash got ${youngster.prize.toLocaleString("en-US")} CC for winning!`],
    "a win: the Trainer's sore-loser line and the Prize money");
  const loss = settle(player([6, 9], 50), ace);
  const lossLines = buildEncounterEmbed(loss, encounterNames(loss, "Ash")).toJSON().description.split("\n");
  assertEqual(lossLines, [`💬 Ace Trainer Kent: "${ace.lines.won}"`, "Ash whited out!"], "a loss: the Trainer gloats, and no amount");
  assertEqual(encounterSummary(win, names), buildEncounterEmbed(win, names).toJSON().description, "the card's result line says what the embed says");

  const rec = recorder();
  const onCard = cardStub();
  const finished = await playEncounter(rec.channel, onCard, win, names, { ...PLAYBACK, trainers: ["acerola-masters.png", "youngster-gen3.png"] });
  assertEqual(rec.sent.length, 0, "it plays on the encounter card, with no new message");
  assertTrue(finished === onCard, "and finishes there");
  assertEqual(onCard.edits[0].content, "⚔️ <@A> vs Youngster Joey!", "the heading names the player");
  assertEqual(description(onCard.edits.at(-1)), buildEncounterEmbed(win, names).toJSON().description, "the result embed lands on the final image");
  assertTrue(onCard.edits.at(-1).files?.length === 1, "with the final image");

  const queue = createQueue(1);
  const hold = await queue.acquire();
  const waiting = recorder();
  const waitingCard = cardStub();
  let done = false;
  const played = playEncounter(waiting.channel, waitingCard, win, names, { ...PLAYBACK, queue }).then(() => { done = true; });
  await new Promise((r) => setTimeout(r, 30));
  assertTrue(!done && waiting.sent.length === 0 && waitingCard.edits[0]?.content.includes("in line"), "a busy queue: it waits its turn and says so on the card");
  hold();
  await played;
  assertTrue(done && description(waitingCard.edits.at(-1)).includes("for winning"), "and plays once a slot frees up");
}

// ==========================================================
// The service, with stub Discord objects and fake timers
// ==========================================================

function world({ perms = true, sendFails = false, roll = 0, renderFails = false, user = STRONG(), play = null } = {}) {
  const trainerData = { A: user };
  const log = { sent: [], events: [], saves: 0, rolls: 0 };
  const timers = new Map();
  let timerIds = 0;
  let clock = new Date("2026-11-10T12:00:00Z");
  const channel = {
    id: "C1",
    permissionsFor: () => ({ has: () => perms }),
    send: async (o) => {
      if (sendFails) throw new Error("Missing Permissions");
      const m = { id: `M${log.sent.length + 1}`, opts: o, edits: [], channel, edit: async (e) => { m.edits.push(e); } };
      log.sent.push(m);
      return m;
    },
  };
  const message = (authorId = "A") => ({
    author: { id: authorId, username: authorId },
    member: { displayName: "Ash" },
    guild: { members: { me: { id: "BOT" } } },
    channel,
  });
  const service = createEncounterService({
    getTrainerData: () => trainerData,
    lockUser,
    enqueueSave: () => { log.saves++; },
    random: () => { log.rolls++; return roll; },
    now: () => clock,
    seed: () => 1,
    setTimer: (fn, ms) => { const id = ++timerIds; timers.set(id, { fn, ms }); return id; },
    clearTimer: (id) => { timers.delete(id); },
    ...(renderFails && { render: async () => { throw new Error("canvas down"); } }),
    ...(play && { play }),
    log: async (type, userId, data) => { log.events.push({ type, userId, ...data }); },
  });
  const click = (customId, userId = "A") => {
    const i = {
      customId, user: { id: userId }, channel,
      updates: [], replies: [], followUps: [], edits: [], deferred: 0,
      update: async (o) => { i.updates.push(o); },
      editReply: async (o) => { i.edits.push(o); },
      reply: async (o) => { i.replies.push(o); },
      followUp: async (o) => { i.followUps.push(o); },
      deferUpdate: async () => { i.deferred++; },
    };
    return i;
  };
  const ids = (m) => m.opts.components[0].toJSON().components.map((c) => c.custom_id);
  const fireTimers = async () => { for (const [id, t] of [...timers]) { timers.delete(id); await t.fn(); } };
  return {
    trainerData, user, log, timers, channel, message, service, click, ids, fireTimers,
    advance: (ms) => { clock = new Date(clock.getTime() + ms); },
  };
}
const shrunk = (o) => o.components?.length === 0 && o.attachments?.length === 0 && o.embeds?.length === 0;
const matchesAny = (text, templates, trainer) => templates.some((t) => fill(t, { player: "Ash", trainer }) === text);

section("Spotting");
{
  const w = world({ perms: false });
  await w.service.maybeSpot(w.message());
  assertEqual([w.log.rolls, w.log.sent.length, w.user.encounter], [0, 0, undefined], "no permission to post: no roll, nothing used up");
}
{
  const w = world({ roll: 0.5 });
  await w.service.maybeSpot(w.message());
  assertEqual([w.log.rolls, w.log.sent.length, w.user.encounter], [1, 0, undefined], "a miss posts nothing");
}
{
  const w = world();
  await w.service.maybeSpot(w.message());
  const card = w.log.sent[0];
  assertEqual(w.log.sent.length, 1, "a hit posts the card");
  assertEqual(card.opts.content, "<@A>", "and @mentions the player");
  assertEqual(card.opts.allowedMentions, { users: ["A"] }, "pinging only them");
  const file = card.opts.files[0];
  assertTrue(/^encounter\.(png|gif)$/.test(file.name) && file.description.includes("challenged Ash!") && file.description.includes("Win or lose:"), "the card image, with alt text");
  const [battle, run] = w.ids(card);
  assertTrue(/^encounter:[\w-]+:battle$/.test(battle) && run === battle.replace(":battle", ":run"), "Battle! and Run");
  assertTrue(isEncounterButton(battle) && !isEncounterButton("confirm_x"), "encounter buttons are recognizable");
  assertEqual([w.user.encounter.count, w.user.encounter.lastAt, w.log.saves], [1, Date.parse("2026-11-10T12:00:00Z"), 1], "counted and saved once posted");
  assertEqual([...w.timers.values()].map((t) => t.ms), [120000], "2 minutes to answer");
  assertEqual(w.log.events.map((e) => e.phase), ["spotted"], "logged");
  assertTrue(["tier", "classKey", "partySize", "prize", "surprise"].every((k) => k in w.log.events[0]), "with what was rolled");
  await w.service.maybeSpot(w.message());
  assertEqual(w.log.sent.length, 1, "one open encounter at a time");
}
{
  const w = world({ sendFails: true });
  await w.service.maybeSpot(w.message());
  assertEqual([w.user.encounter?.count ?? 0, w.service.openCount(), w.timers.size], [0, 0, 0], "a failed post uses nothing up");
}
{
  const w = world();
  await Promise.all([w.service.maybeSpot(w.message()), w.service.maybeSpot(w.message()), w.service.maybeSpot(w.message())]);
  assertEqual([w.log.sent.length, w.user.encounter.count], [1, 1], "one card for simultaneous hits");
}
{
  const w = world({ user: player([], 5) });
  await w.service.maybeSpot(w.message());
  assertEqual(w.log.sent.length, 0, "no Team, never spotted");
}
{
  const w = world({ renderFails: true });
  await w.service.maybeSpot(w.message());
  const card = w.log.sent[0];
  const embed = card.opts.embeds[0].toJSON();
  assertTrue(embed.title.endsWith("challenged Ash!") && embed.description.includes("Win or lose:"), "embed fallback says the same");
  assertEqual(w.ids(card).length, 2, "embed fallback keeps the buttons");
}

section("Answering");
{
  const w = world();
  await w.service.maybeSpot(w.message());
  const [battle] = w.ids(w.log.sent[0]);
  const other = w.click(battle, "B");
  await w.service.handleButton(other);
  assertEqual(other.replies, [{ content: "This Trainer has their eye on Ash.", flags: 64 }], "someone else's click, privately");
  assertEqual([w.service.openCount(), w.log.sent.length], [1, 1], "changes nothing");
}
{
  const w = world();
  await w.service.maybeSpot(w.message());
  const [, run] = w.ids(w.log.sent[0]);
  const i = w.click(run);
  await w.service.handleButton(i);
  const trainer = w.log.events[0].trainer;
  assertTrue(shrunk(i.updates[0]) && matchesAny(i.updates[0].content, RAN, trainer), "Run shrinks the card to one line");
  assertEqual([w.service.openCount(), w.timers.size], [0, 0], "and closes the encounter");
  assertEqual(w.log.events.at(-1).answer, "run", "logged");
  const late = w.click(run);
  await w.service.handleButton(late);
  assertEqual([late.updates.length, late.deferred], [0, 1], "a late click on it is acknowledged and ignored");
}
{
  const w = world();
  await w.service.maybeSpot(w.message());
  await w.fireTimers();
  const card = w.log.sent[0];
  assertTrue(shrunk(card.edits[0]) && matchesAny(card.edits[0].content, LOST_INTEREST, w.log.events[0].trainer), "no answer in 2 minutes: it loses interest");
  assertEqual([w.service.openCount(), w.log.events.at(-1).answer], [0, "timeout"], "closed and logged");
}
{
  const w = world();
  const ccBefore = w.user.cc;
  await w.service.maybeSpot(w.message());
  const card = w.log.sent[0];
  const [battle] = w.ids(card);
  const i = w.click(battle);
  await w.service.handleButton(i);
  assertEqual([i.deferred, i.updates.length], [1, 0], "Battle! is acknowledged at once");
  assertEqual(i.edits, [{ components: [] }], "then the buttons go");
  assertEqual(w.log.sent.length, 1, "the replay plays on the card, with no new message");
  assertTrue(card.edits[0].content.startsWith("⚔️ <@A> vs "), "starting with the heading");
  const final = card.edits.at(-1);
  const won = description(final).includes("for winning");
  const { prize, paid } = w.log.events.find((e) => e.phase === "result");
  assertEqual(w.user.cc, won ? ccBefore + prize : ccBefore - paid, "CC moved by the Prize money");
  assertTrue(w.log.saves >= 2, "saved");
  const priv = i.followUps[0];
  assertEqual(i.followUps.length, 1, "one private message");
  assertEqual(priv.flags, 64, "sent privately");
  // Two images in one message show side by side, cropped. The battle's
  // images go with the card; the player keeps only the EXP card.
  assertEqual(priv.files?.map((f) => f.name), ["exp.png"], "with the EXP card alone, so it shows uncropped");
  assertEqual(priv.content ?? "", won ? "" : `You paid ${w.log.events[0].trainer} ${paid.toLocaleString("en-US")} CC.`, "with the exact CC only when it was paid");
  assertEqual(w.log.events.map((e) => e.phase), ["spotted", "answered", "result"], "logged");
  assertEqual(w.service.openCount(), 0, "closed");
  assertEqual([...w.timers.values()].map((t) => t.ms), [10000], "the final image stays up 10 seconds");
  const shown = card.edits.length;
  await w.fireTimers();
  const line = card.edits.at(-1);
  assertTrue(card.edits.length === shown + 1 && shrunk(line), "then the card loses its images");
  assertEqual(line.content, description(final), "leaving the Trainer's line and the CC result");
  assertEqual(line.allowedMentions, { parse: [] }, "pinging no one");
  assertEqual([i.followUps.length, i.edits.length], [1, 1], "and the private EXP message is left alone");
  assertEqual(w.timers.size, 0, "and nothing is left running");
}
{
  const w = world({ play: async () => { throw new Error("Missing Permissions"); } });
  await w.service.maybeSpot(w.message());
  const card = w.log.sent[0];
  const i = w.click(w.ids(card)[0]);
  await w.service.handleButton(i);
  const priv = i.followUps[0];
  assertTrue(priv.content?.startsWith("The battle counted, but I couldn't post it here."), "a replay that can't play: the private message says the battle still counted");
  assertEqual(priv.files?.map((f) => f.name), ["exp.png"], "with the EXP card alone");
  await w.fireTimers();
  const line = card.edits.at(-1);
  assertTrue(shrunk(line) && line.content.startsWith(`💬 ${w.log.events[0].trainer}: "`), "and the card still shrinks to the result");
}
{
  const w = world();
  await w.service.maybeSpot(w.message());
  const [battle] = w.ids(w.log.sent[0]);
  const [a, b] = [w.click(battle), w.click(battle)];
  await Promise.all([w.service.handleButton(a), w.service.handleButton(b), w.fireTimers()]);
  const card = w.log.sent[0];
  assertEqual(card.edits.filter((e) => e.content?.startsWith("⚔️")).length, 1, "one outcome per encounter: a double click and the timer race, one replay");
  assertTrue(!card.edits.some((e) => matchesAny(e.content, LOST_INTEREST, w.log.events[0].trainer)), "and the Trainer never lost interest");
  assertEqual(w.log.events.filter((e) => e.phase === "result").length, 1, "one result");
}
{
  const w = world();
  await w.service.maybeSpot(w.message());
  const [battle] = w.ids(w.log.sent[0]);
  w.user.pendingWager = { stake: 5 };
  const refused = w.click(battle);
  await w.service.handleButton(refused);
  assertEqual([refused.deferred, refused.edits.length], [1, 0], "a refused Battle! leaves the card as it was");
  assertEqual(refused.followUps, [{ content: "Finish your pending wager first.", flags: 64 }], "and answers privately");
  assertEqual([w.service.openCount(), w.timers.size, w.log.sent.length], [1, 1, 1], "and keeps the encounter open");
  delete w.user.pendingWager;
  await w.service.handleButton(w.click(battle));
  assertEqual(w.log.events.filter((e) => e.phase === "result").length, 1, "then it can still be fought");
}
{
  // Another command can hold the player's lock for seconds while it waits on
  // a save; Discord fails a click that isn't acknowledged within 3.
  const w = world();
  await w.service.maybeSpot(w.message());
  const [battle] = w.ids(w.log.sent[0]);
  let release;
  const held = lockUser("A", () => new Promise((r) => { release = r; }));
  const i = w.click(battle);
  const pressed = w.service.handleButton(i);
  await new Promise((r) => setTimeout(r, 20));
  assertEqual([i.deferred, w.log.sent.length], [1, 1], "Battle! is acknowledged while another command holds the player's record");
  release();
  await held;
  await pressed;
  assertEqual(i.edits, [{ components: [] }], "then it plays out once the record is free");
  assertTrue(w.log.sent[0].edits.some((e) => e.content?.startsWith("⚔️")) && i.followUps.some((f) => f.files?.some((x) => x.name === "exp.png")),
    "with the replay on the card and the private EXP card");
}
{
  const w = world();
  const fresh = w.click("encounter:gone-after-restart:battle");
  await w.service.handleButton(fresh);
  assertTrue(shrunk(fresh.updates[0]) && fresh.updates[0].content === STALE_LINE, "a stale click after a restart shrinks the card");
}

section("The card's Mega");
{
  // The card keeps the Display team's Mega slot, so Battle! fights it as a
  // Mega, as a casual battle would.
  const ON = { MEGA_EVOLUTION_ENABLED: "1", MEGA_BATTLES_ENABLED: "1" };
  Object.assign(process.env, ON);
  const u = player([6, 94, 445], 60);
  u.displayedPokemon[0].mega = "mega-charizard-x";
  u.megaUnlocks = { "6:normal": { forms: { "mega-charizard-x": { at: 1, stone: null } }, preferred: null } };
  let played = null;
  const w = world({ user: u, play: async (channel, message, outcome) => { played = outcome; } });
  await w.service.maybeSpot(w.message());
  const [battle] = w.ids(w.log.sent[0]);
  await w.service.handleButton(w.click(battle));
  for (const k of Object.keys(ON)) delete process.env[k];
  assertEqual(played?.sides[0].members[0].megaForm, "mega-charizard-x", "Battle! fights the Display team's Mega as a Mega");
}

finish();
