// ==========================================================
// tests/encounterFlow.test.js
// The Discord side of Trainer encounters (docs/superpowers/specs/
// 2026-11-10-trainer-encounters-design.md, Discord UX), with stub Discord
// objects: the replay and its result embed, and (utils/encounter/service.js)
// spotting, the card, Battle!, Run, timeouts, other players' clicks, and
// clicks on cards from before a restart. Synthetic data only.
// ==========================================================

import { assertEqual, assertTrue, section, finish } from "./harness.js";
import { encounterNames, buildEncounterEmbed, playEncounter, createQueue } from "../utils/battle/playback.js";
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

  const rec = recorder();
  const message = await playEncounter(rec.channel, win, names, { ...PLAYBACK, trainers: ["acerola-masters.png", "youngster-gen3.png"] });
  assertTrue(message !== null, "the replay finishes");
  assertEqual(rec.sent.length, 1, "one new message");
  assertEqual(rec.sent[0].content, "⚔️ <@A> vs Youngster Joey!", "the heading @mentions the player");
  assertEqual(description(rec.edits.at(-1)), buildEncounterEmbed(win, names).toJSON().description, "the result embed lands on the final image");
  assertTrue(rec.edits.at(-1).files?.length === 1, "with the final image");

  const queue = createQueue(1);
  const hold = await queue.acquire();
  const waiting = recorder();
  let done = false;
  const played = playEncounter(waiting.channel, win, names, { ...PLAYBACK, queue }).then(() => { done = true; });
  await new Promise((r) => setTimeout(r, 30));
  assertTrue(!done && waiting.sent.length === 1 && waiting.sent[0].content.includes("in line"), "a busy queue: it waits its turn and says so");
  hold();
  await played;
  assertTrue(done && description(waiting.edits.at(-1)).includes("for winning"), "and plays once a slot frees up");
}

// ==========================================================
// The service, with stub Discord objects and fake timers
// ==========================================================

function world({ perms = true, sendFails = false, roll = 0, renderFails = false, user = STRONG() } = {}) {
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
  assertTrue(file.name === "encounter.png" && file.description.includes("challenged Ash!") && file.description.includes("Win or lose:"), "the card image, with alt text");
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
  const [battle] = w.ids(w.log.sent[0]);
  const i = w.click(battle);
  await w.service.handleButton(i);
  assertEqual([i.deferred, i.updates.length], [1, 0], "Battle! is acknowledged at once");
  assertEqual(i.edits, [{ components: [] }], "then the buttons go and the card stays as the intro");
  const replay = w.log.sent[1];
  assertTrue(replay && replay.opts.content.startsWith("⚔️ <@A> vs "), "the replay posts below the card");
  const result = description(replay.edits.at(-1));
  const won = result.includes("for winning");
  const { prize, paid } = w.log.events.find((e) => e.phase === "result");
  assertEqual(w.user.cc, won ? ccBefore + prize : ccBefore - paid, "CC moved by the Prize money");
  assertTrue(w.log.saves >= 2, "saved");
  const priv = i.followUps[0];
  assertTrue(priv.flags === 64 && priv.files?.[0]?.name === "exp.png", "the EXP card arrives privately");
  assertEqual(priv.content ?? "", won ? "" : `You paid ${w.log.events[0].trainer} ${paid.toLocaleString("en-US")} CC.`, "with the exact CC only when it was paid");
  assertEqual(w.log.events.map((e) => e.phase), ["spotted", "answered", "result"], "logged");
  assertEqual([w.service.openCount(), w.timers.size], [0, 0], "closed");
}
{
  const w = world();
  await w.service.maybeSpot(w.message());
  const [battle] = w.ids(w.log.sent[0]);
  const [a, b] = [w.click(battle), w.click(battle)];
  await Promise.all([w.service.handleButton(a), w.service.handleButton(b), w.fireTimers()]);
  assertEqual(w.log.sent.length, 2, "one outcome per encounter: a double click and the timer race, one replay");
  assertEqual(w.log.sent[0].edits.length, 0, "and the card never shrank");
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
  assertEqual(w.log.sent.length, 2, "then it can still be fought");
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
  assertTrue(w.log.sent.length === 2 && i.followUps.some((f) => f.files?.[0]?.name === "exp.png"), "with the replay and the private result");
}
{
  const w = world();
  const fresh = w.click("encounter:gone-after-restart:battle");
  await w.service.handleButton(fresh);
  assertTrue(shrunk(fresh.updates[0]) && fresh.updates[0].content === STALE_LINE, "a stale click after a restart shrinks the card");
}

finish();
