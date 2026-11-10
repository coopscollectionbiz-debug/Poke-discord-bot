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

finish();
