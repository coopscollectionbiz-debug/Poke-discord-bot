// ==========================================================
// utils/encounter/service.js
// The Discord side of Trainer encounters (docs/superpowers/specs/
// 2026-11-10-trainer-encounters-design.md, Discord UX). maybeSpot runs after
// a chat message that didn't catch anything: it may post an encounter card
// in that channel. handleButton answers the card's Battle! and Run buttons,
// reached through the bot's global button handler rather than a collector,
// so a click on a card from before a restart still gets an answer. Every
// answer leaves the card as text: Run and timeouts as one line, Battle! as
// its result after the replay plays on the card, with the EXP card sent to
// the player privately in a message of its own.
// Open encounters live only in memory and hold nothing: a restart loses
// them, and their cards shrink on the next click.
// ==========================================================

import { auraLook } from "../../services/auras.js";
import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder, EmbedBuilder, MessageFlags, PermissionFlagsBits,
} from "discord.js";
import { randomInt, randomUUID } from "crypto";
import { ENCOUNTER, PLAYBACK } from "../battle/tuning.js";
import { buildTeam } from "../battle/runBattle.js";
import { rollTrainer } from "./generate.js";
import { spotBlock, recordSpot, fightEncounter } from "./runEncounter.js";
import { RAN, LOST_INTEREST, STALE_LINE, fill } from "./lines.js";
import { encounterCardView, encounterAltText } from "../render/encounterCard.js";
import { encounterNames, encounterSummary, playEncounter, challengeExpText } from "../battle/playback.js";
import { expMembers } from "../render/expCard.js";
import { logEvent } from "../eventLog.js";
import { recordFight as storeFight, encounterRecord } from "../fightRecordBuild.js";
import { threaded } from "../render/renderers.js";
import { cardImage } from "../render/stage.js";

const PREFIX = "encounter:";
export const isEncounterButton = (customId) => typeof customId === "string" && customId.startsWith(PREFIX);

// The card is a new message with an image, and the replay's images and
// result embed go on it.
const PERMISSIONS = [
  PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks,
];

const REFUSALS = {
  no_team: "None of the Pokémon on this card are yours anymore.",
  run_open: "Finish your Elite Four run first.",
  pending_wager: "Finish your pending wager first.",
};

const n = (x) => x.toLocaleString("en-US");
const trainerName = (e) => `${e.trainer.title} ${e.trainer.name}`;
// A card reduced to text: no image, no embed, no buttons.
const shrunk = (content) => ({ content, embeds: [], attachments: [], components: [], allowedMentions: { parse: [] } });

export function createEncounterService({
  getTrainerData, lockUser, enqueueSave,
  random = Math.random,
  now = () => new Date(),
  seed = () => randomInt(2 ** 31),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  render = threaded.encounter,
  renderExp = threaded.exp,
  play = playEncounter,
  log = logEvent,
  recordFight = storeFight,
}) {
  const open = new Map(); // nonce -> { nonce, userId, displayName, team, trainer, seed, channel, message, timer, deadline, busy }
  // Encounters answered or expired, so a late click is ignored instead of
  // being taken for a card from before a restart. The newest 500 are enough:
  // their buttons are gone once the answer lands.
  const closed = new Set();
  const close = (e) => {
    open.delete(e.nonce);
    clearTimer(e.timer);
    closed.add(e.nonce);
    if (closed.size > 500) closed.delete(closed.values().next().value);
  };
  const pick = (list) => list[Math.floor(random() * list.length)];
  const record = (userId, data) => { void log("encounter", userId, data); };

  async function cardMessage(e) {
    const user = getTrainerData()[e.userId];
    const view = encounterCardView({ trainer: e.trainer, team: e.team, user, displayName: e.displayName });
    const buttons = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`${PREFIX}${e.nonce}:battle`).setLabel("Battle!").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(`${PREFIX}${e.nonce}:run`).setLabel("Run").setStyle(ButtonStyle.Secondary),
    );
    const base = { content: `<@${e.userId}>`, allowedMentions: { users: [e.userId] }, components: [buttons] };
    try {
      // Animated when the render threads have room, else the still PNG.
      const card = await cardImage((animate) => render(view, { animate }), "encounter");
      return { ...base, files: [new AttachmentBuilder(card.buffer, { name: card.name, description: encounterAltText(view) })] };
    } catch (err) {
      console.warn("⚠️ encounter card render failed; sending an embed:", err?.message || err);
      const embed = new EmbedBuilder().setColor(0xff5a6a).setTitle(view.heading)
        .setDescription(`"${view.line}"\nWin or lose: **${n(view.prize)} CC**`);
      return { ...base, embeds: [embed] };
    }
  }

  async function expire(nonce) {
    const e = open.get(nonce);
    if (!e || e.busy) return; // a Battle! being settled decides; it re-checks the deadline if refused
    close(e);
    await e.message.edit(shrunk(fill(pick(LOST_INTEREST), { player: e.displayName, trainer: trainerName(e) }))).catch(() => {});
    record(e.userId, { phase: "answered", answer: "timeout" });
  }

  /** After a chat message that didn't catch anything: maybe a Trainer spots its author. Never throws. */
  async function maybeSpot(message) {
    try {
      const me = message.guild?.members?.me;
      // Checked before the roll, so a channel the card can't post in never uses an encounter up.
      if (!me || !message.channel?.permissionsFor?.(me)?.has(PERMISSIONS)) return;
      if (random() >= ENCOUNTER.chance) return;
      const userId = message.author.id;
      const displayName = message.member?.displayName ?? message.author.globalName ?? message.author.username;
      // Reserved in `open` under the lock, so a second hit before the card posts finds it open.
      const e = await lockUser(userId, () => {
        const user = getTrainerData()[userId];
        if (spotBlock({ user, open: [...open.values()].some((x) => x.userId === userId), now: now() })) return null;
        const team = buildTeam(user);
        const s = seed();
        const entry = {
          nonce: randomUUID(), userId, displayName, seed: s, channel: message.channel,
          team: team.map(({ speciesId, variant, megaForm }) => ({ speciesId, variant, ...(megaForm && { megaForm }) })),
          trainer: rollTrainer({ team, seed: s }),
        };
        open.set(entry.nonce, entry);
        return entry;
      });
      if (!e) return;
      try {
        e.message = await message.channel.send(await cardMessage(e));
      } catch (err) {
        console.warn("⚠️ encounter card couldn't post:", err?.message || err);
        open.delete(e.nonce);
        return;
      }
      await lockUser(userId, () => {
        const user = getTrainerData()[userId];
        if (user) recordSpot(user, now());
      });
      enqueueSave(getTrainerData());
      const t = e.trainer;
      record(userId, { phase: "spotted", trainer: trainerName(e), classKey: t.classKey, tier: t.tier, partySize: t.party.length, prize: t.prize, surprise: t.surprise });
      e.deadline = now().getTime() + ENCOUNTER.answerMs;
      if (open.get(e.nonce) === e) e.timer = setTimer(() => expire(e.nonce), ENCOUNTER.answerMs);
    } catch (err) {
      console.warn("⚠️ encounter spotting failed:", err?.message || err);
    }
  }

  // The player's private EXP card, alone in its message: a second image
  // beside it would show both cropped. The bot never edits or removes it.
  async function expMessage(outcome, names, note) {
    const user = getTrainerData()[outcome.userId];
    const caption = [note, outcome.won ? null : `You paid ${names.trainer} ${n(outcome.paid)} CC.`].filter(Boolean).join("\n");
    try {
      const png = await renderExp({
        opponent: names.trainer, won: outcome.won, rating: null, surge: false, pot: 0,
        members: expMembers(outcome.exp[outcome.userId], user),
      });
      return { ...(caption && { content: caption }), files: [new AttachmentBuilder(png, { name: "exp.png" })], flags: MessageFlags.Ephemeral };
    } catch (err) {
      console.warn("⚠️ encounter EXP card render failed; sending text:", err?.message || err);
      return { content: [caption, challengeExpText(outcome)].filter(Boolean).join("\n"), flags: MessageFlags.Ephemeral };
    }
  }

  async function battle(i, e) {
    // Set before any await: a second click or the timer now leaves this to us.
    e.busy = true;
    // Acknowledged before the lock, which can wait seconds on another
    // command's save; Discord fails a click left unanswered for 3 s. After
    // this, the buttons go with editReply and private replies are followUps.
    await i.deferUpdate().catch(() => {});
    const outcome = await lockUser(e.userId, () => {
      const trainerData = getTrainerData();
      const result = fightEncounter({ trainerData, userId: e.userId, encounter: { team: e.team, trainer: e.trainer }, seed: e.seed + 1, now: now() });
      if (result.ok) enqueueSave(trainerData);
      return result;
    });
    if (!outcome.ok) {
      e.busy = false;
      await i.followUp({ content: REFUSALS[outcome.reason] ?? "This battle can't happen right now.", flags: MessageFlags.Ephemeral }).catch(() => {});
      if (now().getTime() >= e.deadline) await expire(e.nonce);
      return;
    }
    close(e);
    await i.editReply({ components: [] }).catch(() => {});
    record(e.userId, { phase: "answered", answer: "battle" });
    record(e.userId, { phase: "result", won: outcome.won, prize: outcome.prize, paid: outcome.paid });
    recordFight(() => encounterRecord(outcome, e.displayName, getTrainerData())); // Battle Records; never throws
    const names = encounterNames(outcome, e.displayName);
    const user = getTrainerData()[e.userId];
    let note = null;
    try {
      await play(e.channel, e.message, outcome, names, { ...PLAYBACK, trainers: [user?.displayedTrainer ?? null, e.trainer.spriteFile], aura: auraLook(user) });
    } catch (err) {
      console.warn("⚠️ encounter replay couldn't post:", err?.message || err);
      note = "The battle counted, but I couldn't post it here.";
    }
    // The channel keeps only the result: once the final image has been up a
    // moment, the card drops its images. A restart in that window leaves them.
    setTimer(() => e.message.edit(shrunk(encounterSummary(outcome, names))).catch(() => {}), ENCOUNTER.resultMs);
    await i.followUp(await expMessage(outcome, names, note)).catch(() => {});
  }

  /** A click on an encounter card's button. Never throws. */
  async function handleButton(i) {
    try {
      const [, nonce, action] = i.customId.split(":");
      const e = open.get(nonce);
      if (!e) {
        if (closed.has(nonce)) return void (await i.deferUpdate().catch(() => {}));
        return void (await i.update(shrunk(STALE_LINE)).catch(() => {}));
      }
      if (i.user.id !== e.userId) {
        return void (await i.reply({ content: `This Trainer has their eye on ${e.displayName}.`, flags: MessageFlags.Ephemeral }).catch(() => {}));
      }
      if (e.busy) return void (await i.deferUpdate().catch(() => {}));
      if (action === "battle") return void (await battle(i, e));
      close(e);
      await i.update(shrunk(fill(pick(RAN), { player: e.displayName, trainer: trainerName(e) }))).catch(() => {});
      record(e.userId, { phase: "answered", answer: "run" });
    } catch (err) {
      console.warn("⚠️ encounter button failed:", err?.message || err);
    }
  }

  return { maybeSpot, handleButton, openCount: () => open.size };
}
