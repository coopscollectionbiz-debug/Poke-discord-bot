// ==========================================================
// tests/battleTimeline.test.js
// Battle FX's timeline (utils/battle/timeline.js): one replay image's hits,
// beats and lines from a full-sim turn. Every beat kind from real fights,
// the spotlight following switches, notes rebuilt without the beats' lines,
// hitless turns, the per-image cap, pacing and the GIF length, BATTLE_FX=0,
// and invariants over seeded fights: the timeline ends where the engine's
// snapshot and recorded conditions do.
// ==========================================================

import { assertEqual, assertTrue, section, finish } from "./harness.js";
import { simulateFull } from "../utils/battle/showdown/simulate.js";
import { stepText, statChangesText } from "../utils/battle/narrate.js";
import { turnTimeline, hitsTimeline, marksAt, battleFx, FX, activeAt } from "../utils/battle/timeline.js";
import { createRng } from "../utils/battle/rng.js";

const mon = (speciesId, name, level, moves, extra = {}) => ({ speciesId, variant: "normal", name, level, moves, ...extra });
// Scripted choices: the turn's move from a list (the last one repeats).
const seq = (moves) => (req, b) => (req.forceSwitch ? null : moves[Math.min(b.turn, moves.length) - 1]);
const run = (a, b, seed, ai) => {
  const r = simulateFull({ sides: [{ members: a }, { members: b }], seed, ai });
  return { r, names: [a.map((m) => m.name), b.map((m) => m.name)] };
};
// The first seed (1–80) whose fight has a step passing `ok`: { r, names, turn, step }.
function find(make, ok) {
  for (let seed = 1; seed <= 80; seed++) {
    const f = make(seed);
    for (let t = 0; t < f.r.turns; t++) {
      const step = f.r.steps[t].find((s, i) => ok(s, f.r.steps[t], i));
      if (step) return { ...f, turn: t + 1, step };
    }
  }
  throw new Error("no seed in 1–80 gives that step");
}
const beats = (tl) => tl.segments.filter((s) => s.kind === "beat");
const hits = (tl) => tl.segments.filter((s) => s.kind === "hit");
const hitText = (tl) => hits(tl).flatMap((h) => [...(h.event.preNotes ?? []), ...(h.event.notes ?? []), ...(h.event.endNotes ?? [])]);
const wall = (moves = ["splash"]) => mon(143, "Snorlax", 70, moves);

section("Landings");
for (const [move, status] of [["willowisp", "brn"], ["toxic", "tox"], ["poisonpowder", "psn"], ["thunderwave", "par"], ["spore", "slp"]]) {
  const f = find((seed) => run([mon(94, "Gengar", 50, [move])], [wall()], seed), (s) => s.kind === "status" && s.status === status);
  const tl = turnTimeline(f.r, f.turn, f.names);
  const beat = beats(tl).find((b) => b.fx === status);
  assertTrue(beat && beat.text === stepText(f.step, f.names) && beat.side === 1 && beat.slot === 0, `${move}: a ${status} beat with the status's own line`);
  assertEqual(beat?.marksAfter.status[1][0], status, `${move}: the tag shows from the beat on`);
  assertTrue(!hitText(tl).includes(beat?.text), `${move}: the attack's box no longer repeats it`);
}
{
  const f = find((seed) => run([mon(131, "Lapras", 50, ["icebeam"])], [mon(143, "Snorlax", 100, ["splash"])], seed), (s) => s.kind === "status" && s.status === "frz");
  assertTrue(beats(turnTimeline(f.r, f.turn, f.names)).some((b) => b.fx === "frz"), "a freeze from Ice Beam is a frz beat");
}

section("Can't move");
for (const [move, why] of [["thunderwave", "par"], ["spore", "slp"]]) {
  const f = find((seed) => run([mon(94, "Gengar", 50, [move, "splash"])], [wall(["tackle"])], seed, [seq(["move 1", "move 2"]), seq(["move 1"])]),
    (s) => s.kind === "note" && s.type === "cant" && s.args[1] === why);
  const beat = beats(turnTimeline(f.r, f.turn, f.names)).find((b) => b.fx === why && b.text === stepText(f.step, f.names));
  assertTrue(beat, `${why}: can't move is a ${why} beat with its line`);
}
{
  const f = find((seed) => run([mon(131, "Lapras", 50, ["icebeam"])], [mon(143, "Snorlax", 100, ["tackle"])], seed), (s) => s.kind === "note" && s.type === "cant" && s.args[1] === "frz");
  assertTrue(beats(turnTimeline(f.r, f.turn, f.names)).some((b) => b.fx === "frz"), "frozen solid is a frz beat");
}

section("Confusion");
{
  const f = find((seed) => run([mon(94, "Gengar", 50, ["confuseray", "splash"])], [wall(["tackle"])], seed, [seq(["move 1", "move 2"]), seq(["move 1"])]),
    (s) => s.kind === "hp" && s.from === "confusion");
  const beat = beats(turnTimeline(f.r, f.turn, f.names)).find((b) => b.fx === "confusion" && b.hpChanges.length === 1);
  assertTrue(beat && beat.text === stepText(f.step, f.names) && beat.hpChanges[0][3] === f.step.hpAfter, "hurting itself is one confusion beat that drains HP");
  const landing = find((seed) => run([mon(94, "Gengar", 50, ["confuseray"])], [wall()], seed), (s) => s.kind === "note" && s.type === "start" && s.args[1] === "confusion");
  assertTrue(beats(turnTimeline(landing.r, landing.turn, landing.names)).some((b) => b.fx === "confusion" && b.hpChanges.length === 0), "becoming confused is a confusion beat");
}

section("End of turn");
for (const [move, from, fx] of [["willowisp", "brn", "brn"], ["poisonpowder", "psn", "psn"], ["toxic", "psn", "tox"]]) {
  const f = find((seed) => run([mon(94, "Gengar", 50, [move, "splash"])], [wall()], seed, [seq(["move 1", "move 2"]), seq(["move 1"])]), (s) => s.kind === "hp" && s.from === from);
  const beat = beats(turnTimeline(f.r, f.turn, f.names)).find((b) => b.fx === fx && b.hpChanges.length);
  assertTrue(beat && beat.hpChanges[0][2] === beat.hp[1][0] && beat.hpChanges[0][3] === f.step.hpAfter, `${fx}: the tick drains HP from where it was to the step's HP`);
}
{
  const f = find((seed) => run([mon(3, "Venusaur", 50, ["leechseed", "splash"])], [mon(143, "Snorlax", 60, ["bodyslam"])], seed, [seq(["move 1", "move 2"]), seq(["move 1"])]),
    (s, list, i) => s.kind === "hp" && s.from === "Leech Seed" && list[i + 1]?.kind === "hp" && list[i + 1].heal && list[i + 1].side === 0);
  const tl = turnTimeline(f.r, f.turn, f.names);
  const beat = beats(tl).find((b) => b.fx === "leechseed" && b.hpChanges.length === 2);
  assertTrue(beat && beat.hpChanges[0][0] === 1 && beat.hpChanges[1][0] === 0, "Leech Seed's drain is one beat: the target down, the seeder up");
  const all = [...tl.segments.map((s) => s.text), ...hitText(tl)];
  assertTrue(!all.includes("Venusaur had its HP restored."), "the seeder's heal has no line of its own");
}

{
  // buildResult credits a later HP change of the attacker to its own move (userHpAfter):
  // a burn tick after the burned Pokémon's Splash belongs to the beat, not the Splash.
  const { r, names } = run([mon(94, "Gengar", 50, ["willowisp", "splash"])], [mon(143, "Snorlax", 50, ["swordsdance", "splash"], { hpFraction: 0.2 })], 5, [seq(["move 1", "move 2"]), seq(["move 1", "move 2"])]);
  const tl = turnTimeline(r, 2, names);
  const splash = hits(tl).find((h) => h.event.side === 1);
  const tick = beats(tl).find((b) => b.fx === "brn");
  assertTrue(!("userHpAfter" in splash.event) && !splash.event.userFainted, "the Splash carries no HP change of its own");
  assertEqual([tick.hpChanges[0][2], tick.hpChanges[0][3]], [r.snapshots[1][1][0], r.snapshots[2][1][0]], "the burn tick drains from where the turn started");
}

section("Cures");
{
  const wake = find((seed) => run([mon(94, "Gengar", 50, ["spore", "splash"])], [wall(["tackle"])], seed, [seq(["move 1", "move 2"]), seq(["move 1"])]), (s) => s.kind === "status" && s.cured === "slp");
  const beat = beats(turnTimeline(wake.r, wake.turn, wake.names)).find((b) => b.fx === "cure");
  assertTrue(beat && beat.text === stepText(wake.step, wake.names) && beat.marksAfter.status[1][0] === "", "waking up is a cure beat that removes the tag");
  const thaw = find((seed) => run([mon(131, "Lapras", 50, ["icebeam"])], [mon(143, "Snorlax", 100, ["tackle"])], seed), (s) => s.kind === "status" && s.cured === "frz");
  assertTrue(beats(turnTimeline(thaw.r, thaw.turn, thaw.names)).some((b) => b.fx === "cure"), "thawing out is a cure beat");
}

section("Stat changes");
{
  const { r, names } = run([mon(91, "Cloyster", 50, ["shellsmash"])], [wall()], 1);
  const stats = beats(turnTimeline(r, 1, names)).filter((b) => b.fx === "stats" && b.side === 0);
  assertEqual(stats.length, 1, "Shell Smash is one beat");
  assertEqual([stats[0].up, stats[0].down, stats[0].pop], [true, true, "ATK ▲▲"], "with chevrons both ways and the Attack pop");
  assertEqual(stats[0].text, "Cloyster's Defense and Sp. Def fell! Cloyster's Attack, Sp. Atk, and Speed rose sharply!", "and the grouped line");
  assertEqual(stats[0].marksAfter.chips[0], { def: -1, spd: -1, atk: 2, spa: 2, spe: 2 }, "the chips after it");
  assertEqual(stats[0].text, statChangesText("Cloyster", [{ stat: "def", n: 1, dir: "unboost" }, { stat: "spd", n: 1, dir: "unboost" }, { stat: "atk", n: 2, dir: "boost" }, { stat: "spa", n: 2, dir: "boost" }, { stat: "spe", n: 2, dir: "boost" }]), "the line is statChangesText's");
}

section("Switches move the spotlight");
{
  const { r, names } = run([mon(212, "Scizor", 50, ["uturn"]), mon(130, "Gyarados", 50, ["waterfall"])], [mon(143, "Snorlax", 70, ["tackle"])], 2);
  const tl = turnTimeline(r, 1, names);
  const uturn = tl.segments.findIndex((s) => s.kind === "hit" && s.event.move === "U-turn");
  assertEqual(tl.segments[uturn].active[0], 0, "U-turn plays with Scizor in front");
  assertEqual(tl.segments[uturn + 1].active[0], 1, "the next segment has Gyarados in front");
  const intim = beats(tl).find((b) => b.fx === "stats" && b.side === 1);
  assertTrue(intim && intim.active[0] === 1, "Intimidate lands with the incoming Gyarados already in front");
}
{
  // Review Focus 1: a status on a switch-in plays on the Pokémon that just came in.
  const f = find((seed) => run([mon(212, "Scizor", 50, ["splash", "uturn"]), mon(143, "Snorlax", 50, ["splash"])], [mon(407, "Roserade", 80, ["toxicspikes", "splash"])], seed, [seq(["move 1", "move 2", "move 1"]), seq(["move 1", "move 2"])]),
    (s) => s.kind === "status" && s.side === 0 && s.slot === 1 && s.status === "psn");
  const beat = beats(turnTimeline(f.r, f.turn, f.names)).find((b) => b.fx === "psn" && b.side === 0);
  assertTrue(beat && beat.slot === 1 && beat.active[0] === 1, "Toxic Spikes poisons the switch-in, with the spotlight on it");
}

section("Faints");
{
  // Review Focus 2: a burn knocks out the last Pokémon and ends the fight mid-turn.
  const { r, names } = run([mon(143, "Snorlax", 50, ["splash"], { hpFraction: 0.03, status: "brn" })], [mon(94, "Gengar", 50, ["splash"])], 1);
  const tl = turnTimeline(r, r.turns, names);
  const ko = beats(tl).find((b) => b.fx === "brn");
  assertEqual([ko?.ko, ko?.hpChanges[0][3]], [true, 0], "the burn's last tick is a knockout beat");
  assertEqual([tl.end.marks.status[0][0], tl.end.hp[0][0]], ["", 0], "after it, no tag and no HP");
  assertEqual(r.endedBy, "knockout", "and the fight is over");
  // Final review I3: the knockout's line goes with its beat, not before it in the hit's box.
  assertTrue(ko?.text.endsWith("Snorlax fainted!") && !hitText(tl).includes("Snorlax fainted!"), "the beat says it fainted, after the burn's line");
}
{
  // Final review I3: an ability's line before the turn's first hit goes with the beat it causes.
  const { r, names } = run([mon(130, "Gyarados", 50, ["splash"])], [mon(143, "Snorlax", 50, ["splash"])], 1);
  const tl = turnTimeline(r, 1, names);
  const intim = beats(tl).find((b) => b.fx === "stats" && b.side === 1);
  assertTrue(intim?.text.startsWith("Gyarados's Intimidate!") && !hitText(tl).includes("Gyarados's Intimidate!"), "Intimidate's line opens its beat instead of following it");
}

section("Hitless turns");
{
  const { r, names } = run([mon(143, "Snorlax", 50, ["tackle"], { status: "slp" })], [mon(143, "Snorlax", 50, ["tackle"], { status: "slp" })], 3);
  const first = turnTimeline(r, 1, names);
  assertTrue(r.log[0].length === 0 && first.segments.length > 0 && first.segments.every((s) => s.kind !== "hit"), "both asleep: the turn has beats and no hits");
  const told = first.segments.map((s) => s.text);
  for (let t = 2; t <= r.turns; t++) {
    const own = r.steps[t - 1].map((s) => stepText(s, names)).filter(Boolean);
    const shown = hitText(turnTimeline(r, t, names));
    assertTrue(shown.every((line) => own.includes(line) || !told.includes(line)), `turn ${t} doesn't repeat an earlier hitless turn's lines`);
  }
}

{
  // Final review M1: a hitless turn of lines only (both recharging) waits for its lines.
  let found = null;
  for (let seed = 1; seed <= 40 && !found; seed++) {
    const f = run([mon(143, "Snorlax", 50, ["hyperbeam"])], [mon(143, "Snorlax", 50, ["hyperbeam"])], seed);
    const t = f.r.log.findIndex((events, i) => i > 0 && events.length === 0 && turnTimeline(f.r, i + 1, f.names).segments.filter((s) => s.kind === "line").length >= 2);
    if (t >= 0) found = { ...f, turn: t + 1 };
  }
  const tl = turnTimeline(found.r, found.turn, found.names);
  assertTrue(tl.segments.every((s) => s.kind === "line") && tl.waitMs === Math.max(2000, tl.frames * 100 + 600), "both recharging: the next update waits for every line");
}

section("The cap");
{
  const { r, names } = run([mon(94, "Gengar", 50, ["willowisp", "splash"])], [mon(143, "Snorlax", 50, ["swordsdance", "splash"])], 5, [seq(["move 1", "move 2"]), seq(["move 1", "move 2"])]);
  const n = beats(turnTimeline(r, 1, names)).length;
  assertTrue(n >= 3, `turn 1 has a burn, a Swords Dance and a burn tick (${n} beats)`);
  assertTrue(beats(turnTimeline(r, 1, names, { capFrames: 12 })).every((b) => b.frames === Math.max(FX.minBeatFrames, Math.floor(12 / n))), "over the cap, beats share it evenly down to the floor");
  assertTrue(beats(turnTimeline(r, 1, names, { capFrames: 8 * n })).every((b) => b.frames === FX.beatFrames), "at the cap, every beat keeps its 8 frames");
}

section("BATTLE_FX=0 and marks");
{
  const { r, names } = run([mon(94, "Gengar", 50, ["willowisp", "confuseray", "leechseed"])], [mon(143, "Snorlax", 50, ["bodyslam", "swordsdance"])], 5, [seq(["move 1", "move 2", "move 3"]), seq(["move 2", "move 1"])]);
  assertEqual([battleFx({}), battleFx({ BATTLE_FX: "0" })], [true, false], "on unless BATTLE_FX=0");
  for (let t = 1; t <= Math.min(4, r.turns); t++) {
    const off = turnTimeline(r, t, names, { env: { BATTLE_FX: "0" } });
    assertEqual(off, hitsTimeline(r.log[t - 1], r.snapshots[t - 1], activeAt(r, t)), `turn ${t}, BATTLE_FX=0: today's hits only`);
    assertTrue(off.segments.every((s, i) => s.event === r.log[t - 1][i]) && off.waitMs === 2000, `turn ${t}, BATTLE_FX=0: the log's own events, and today's wait`);
  }
  assertEqual(marksAt(r, 0), { status: r.conditions[0].status, chips: [null, null] }, "marks before the leads: statuses, no chips");
  assertEqual(marksAt(r, 1).chips[1], { atk: 2 }, "marks after turn 1: the Swords Dance chip");
  assertEqual(marksAt({ ...r, conditions: undefined }, 0), null, "a result without conditions has no marks");
}

section("Invariants over seeded fights");
{
  const POOL = [
    [94, "Gengar", ["shadowball", "willowisp", "hypnosis", "confuseray"]], [3, "Venusaur", ["energyball", "leechseed", "toxic", "sleeppowder"]],
    [25, "Pikachu", ["thunderbolt", "thunderwave", "quickattack", "irontail"]], [91, "Cloyster", ["shellsmash", "iciclespear", "rockblast", "icebeam"]],
    [212, "Scizor", ["swordsdance", "uturn", "bulletpunch", "batonpass"]], [110, "Weezing", ["haze", "sludgebomb", "willowisp", "toxicspikes"]],
    [130, "Gyarados", ["dragondance", "waterfall", "earthquake", "thunderwave"]], [143, "Snorlax", ["bodyslam", "rest", "curse", "earthquake"]],
    [407, "Roserade", ["toxicspikes", "sludgebomb", "gigadrain", "sleeppowder"]], [227, "Skarmory", ["spikes", "whirlwind", "roost", "bravebird"]],
    [282, "Gardevoir", ["psychic", "moonblast", "calmmind", "thunderwave"]], [248, "Tyranitar", ["stealthrock", "crunch", "stoneedge", "dragondance"]],
  ];
  const bad = { hp: [], status: [], hits: [], clone: [], pace: [], sample: [] };
  let turns = 0, beatCount = 0;
  for (const plan of ["status", "setup"]) {
    for (let n = 0; n < 20; n++) {
      const rng = createRng(1000 * (plan === "status" ? 1 : 2) + n);
      // Hazards, sandstorm (Tyranitar), Whirlwind drags and Leftovers: HP changes that are neither a hit nor a beat.
      const team = () => Array.from({ length: 6 }, () => POOL[rng.int(POOL.length)]).map(([id, name, moves], i) => mon(id, name, 50, moves, i % 3 === 0 ? { item: "leftovers" } : {}));
      const a = team(), b = team();
      const r = simulateFull({ sides: [{ members: a, plan }, { members: b, plan }], seed: 500 + n });
      const names = [a.map((m) => m.name), b.map((m) => m.name)];
      for (let t = 1; t <= r.turns; t++) {
        const tl = turnTimeline(r, t, names);
        const where = `${plan} #${n} turn ${t}`;
        turns++;
        beatCount += beats(tl).length;
        if (JSON.stringify(tl.end.hp) !== JSON.stringify(r.snapshots[t])) bad.hp.push(where);
        if (JSON.stringify(tl.end.marks.status) !== JSON.stringify(r.conditions[t].status)) bad.status.push(where);
        if (hits(tl).length !== r.log[t - 1].length) bad.hits.push(where); // Review Focus 3
        if (JSON.stringify(structuredClone(tl)) !== JSON.stringify(tl)) bad.clone.push(where); // Review Focus 5
        const paced = tl.hasBeats || (r.log[t - 1].length === 0 && tl.segments.length > 0); // beats, or a hitless turn's lines
        const wait = paced ? Math.max(2000, tl.frames * 100 + 600) : 2000;
        if (tl.waitMs !== wait || tl.minFrames !== Math.max(tl.frames + 10, Math.ceil((wait + 2000) / 100))) bad.pace.push(where);
        const kinds = [...new Set(beats(tl).map((s) => s.fx))];
        const firsts = kinds.map((k) => { const s = beats(tl).find((x) => x.fx === k); return s.start + Math.floor(s.frames / 2); });
        if (JSON.stringify([...tl.sample].sort()) !== JSON.stringify(firsts.sort())) bad.sample.push(where);
      }
    }
  }
  assertTrue(beatCount > 100, `the fights have beats to check (${beatCount} over ${turns} turns)`);
  assertEqual(bad.hp.slice(0, 5), [], "every turn's timeline ends at the engine's HP snapshot");
  assertEqual(bad.status.slice(0, 5), [], "and at its recorded status conditions");
  assertEqual(bad.hits.slice(0, 5), [], "one hit segment per log event (called and multi-hit moves included)");
  assertEqual(bad.clone.slice(0, 5), [], "a timeline is plain data (it clones to a render thread)");
  assertEqual(bad.pace.slice(0, 5), [], "the wait and the GIF length follow the pacing rule");
  assertEqual(bad.sample.slice(0, 5), [], "the palette samples each effect kind's first beat at its middle");
}

finish();
