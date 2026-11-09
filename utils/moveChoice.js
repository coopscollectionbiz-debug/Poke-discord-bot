// ==========================================================
// utils/moveChoice.js
// The private move prompt. When a Level-up teaches a move to a Pokémon
// whose Moveset is full, the default has already happened: it learned the
// move and forgot its oldest one. This prompt, sent after /battle and after
// catches from /daily, /quest, /recruit and the /shop Starter Pack, lets the
// player forget a different move or not learn it at all. One message asks
// one question at a time; anything left unanswered keeps the default, so a
// missed prompt (expired token, restart, dismissed) changes nothing.
// ==========================================================

import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, MessageFlags } from "discord.js";
import { randomUUID } from "crypto";
import { getMove } from "./battle/data.js";
import { learnMove, MOVESET_SIZE } from "./battle/moveset.js";
import { MOVE_CHOICE } from "./battle/tuning.js";
import { getTraining, getMoveset, chooseMoves, speciesName, trainingKey } from "./training.js";
import { lockUser as defaultLockUser } from "./userLocks.js";
import { saveAndAck, withSaveNote } from "./saveManager.js";

const moveName = (id) => `**${getMove(id).name}**`;
const learnAll = (moves, taught) => taught.reduce(learnMove, moves);
const sameMoves = (a, b) => a.length === b.length && a.every((m, i) => m === b[i]);

// One entry per species + Variant, in the order the lessons came (Team slot
// order for a battle). A Pokémon that leveled twice in one command (two
// /daily picks of the same species) is one Level-up.
export function mergeLessons(lessons) {
  const byKey = new Map();
  for (const lesson of lessons.filter(Boolean)) {
    const key = trainingKey(lesson.speciesId, lesson.variant);
    const seen = byKey.get(key);
    if (seen) {
      seen.toLevel = lesson.toLevel;
      seen.taught.push(...lesson.taught);
    } else {
      const name = speciesName(lesson.speciesId);
      byKey.set(key, {
        speciesId: lesson.speciesId,
        variant: lesson.variant,
        name: lesson.variant === "shiny" ? `Shiny ${name}` : name,
        toLevel: lesson.toLevel,
        moves: [...lesson.before], // the Moveset before the move being asked about
        taught: [...lesson.taught], // moves still to learn, the one being asked about first
      });
    }
  }
  return [...byKey.values()];
}

// Learns every move that needs no question (the Moveset has room, or already
// knows it) and returns the next entry with a question, or null.
export function nextQuestion(entries) {
  for (const entry of entries) {
    while (entry.taught.length) {
      const [move] = entry.taught;
      if (entry.moves.length === MOVESET_SIZE && !entry.moves.includes(move)) return entry;
      entry.moves = learnMove(entry.moves, move);
      entry.taught.shift();
    }
  }
  return null;
}

// Answers the entry's question: forget `forget`, or not learn it when null.
// Returns the line for the summary.
export function answer(entry, forget) {
  const move = entry.taught.shift();
  if (!forget) return `${entry.name} didn't learn ${moveName(move)}.`;
  entry.moves = [...entry.moves.filter((m) => m !== forget), move];
  return `${entry.name} forgot ${moveName(forget)} and learned ${moveName(move)}.`;
}

const defaultLine = (entry) =>
  `${entry.name} learned ${moveName(entry.taught[0])} and forgot ${moveName(entry.moves[0])}.`;

// Questions still to come if every one keeps the default. Answers can change
// this only in rare cases (a later move the player chose to keep).
function questionsLeft(entries) {
  const copy = entries.map((e) => ({ ...e, moves: [...e.moves], taught: [...e.taught] }));
  let count = 0;
  for (let q = nextQuestion(copy); q; q = nextQuestion(copy)) {
    answer(q, q.moves[0]);
    count++;
  }
  return count;
}

function questionPayload(entry, customId, position) {
  const counter = position.total > 1 ? ` (${position.n} of ${position.total})` : "";
  return {
    content: `${defaultLine(entry)}${counter}\nForget a different move instead?`,
    components: [new ActionRowBuilder().addComponents(
      ...entry.moves.map((m, i) =>
        new ButtonBuilder().setCustomId(customId(i)).setLabel(getMove(m).name).setStyle(ButtonStyle.Secondary)),
      new ButtonBuilder().setCustomId(customId("skip")).setLabel("✖ Don't learn").setStyle(ButtonStyle.Secondary),
    )],
  };
}

// Sends the prompt as a private follow-up to `interaction` (which must already
// be replied to or deferred) when any lesson needs a question, then handles
// the clicks. Returns once it's sent; never throws.
export async function offerMoveChoices(interaction, { trainerData, userId, lessons, lockUser = defaultLockUser, save }) {
  const entries = mergeLessons(lessons);
  let current = nextQuestion(entries);
  if (!current) return;

  const nonce = randomUUID();
  let step = 0;
  const lines = [];
  let saveNote = "";
  const ask = () => questionPayload(current, (choice) => `movechoice:${nonce}:${step}:${choice}`, {
    n: lines.length + 1,
    total: lines.length + questionsLeft(entries),
  });
  const summary = () => ({ content: withSaveNote(lines.join("\n"), { note: saveNote }), components: [] });

  let message;
  try {
    message = await interaction.followUp({ ...ask(), flags: MessageFlags.Ephemeral });
  } catch (err) {
    // Usually a Wager Challenger whose /battle is over 15 minutes old.
    console.warn("⚠️ move prompt failed:", err?.message || err);
    return;
  }

  // The newest click's token outlives the command's, so edits go through it.
  let latest = null;
  const edit = (payload) => (latest ? latest.editReply(payload) : interaction.editReply({ ...payload, message }));

  async function handle(i) {
    const [, , clickedStep, choice] = i.customId.split(":");
    if (Number(clickedStep) !== step || !current) return; // a second click on an answered question
    latest = i;
    const entry = current;
    const forget = choice === "skip" ? null : entry.moves[Number(choice)];
    const result = await lockUser(userId, async () => {
      const user = trainerData[userId];
      // Another battle, catch, evolution or donation since the prompt was sent
      // means its moves aren't what this question is about anymore.
      const unchanged = user
        && getTraining(user, entry.speciesId, entry.variant).level === entry.toLevel
        && sameMoves(getMoveset(user, entry.speciesId, entry.variant), learnAll(entry.moves, entry.taught));
      if (!unchanged) return null;
      const line = answer(entry, forget);
      chooseMoves(user, entry.speciesId, entry.variant, learnAll(entry.moves, entry.taught));
      return { line, ack: await saveAndAck(trainerData, save ? { save } : undefined) };
    });
    if (result) {
      lines.push(result.line);
      saveNote ||= result.ack.note;
    } else {
      lines.push(`${entry.name} has changed since this prompt, so its moves were left as they are.`);
      entry.taught = [];
    }
    step++;
    current = nextQuestion(entries);
    if (current) return edit(ask());
    collector.stop("done");
    return edit(summary());
  }

  const collector = message.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: MOVE_CHOICE.windowMs,
    filter: (i) => i.user.id === userId && i.customId.startsWith(`movechoice:${nonce}:`),
  });
  // Clicks are acknowledged at once (Discord allows 3 seconds) and handled
  // one at a time, since each answer changes the next question.
  let queue = Promise.resolve();
  collector.on("collect", (i) => {
    const acked = i.deferUpdate().catch(() => {});
    queue = queue.then(() => acked).then(() => handle(i))
      .catch((err) => console.warn("⚠️ move choice failed:", err?.message || err));
    return queue;
  });
  // Time's up: unanswered questions keep the default, already applied.
  collector.on("end", (_, reason) => {
    if (reason === "done") return;
    queue = queue.then(() => {
      for (let q = current; q; q = nextQuestion(entries)) {
        lines.push(defaultLine(q));
        answer(q, q.moves[0]);
      }
      current = null;
      return edit(summary());
    }).catch((err) => console.warn("⚠️ move prompt cleanup failed:", err?.message || err));
    return queue;
  });
}
