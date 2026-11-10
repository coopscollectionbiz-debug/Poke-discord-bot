// ==========================================================
// tools/dev/mega-m3-previews.mjs — Mega Evolution M3 preview images.
//
//   node tools/dev/mega-m3-previews.mjs [outDir]
//
// Renders the real Discord images (the same renderers and attachment rules
// the commands use) for fixture players — no Discord connection, no player
// data, no network. Mega flags are set for this process only. Writes PNG/GIF
// files plus manifest.json (size, dimensions, bytes) to outDir (default
// docs/mega-evolution/m3-previews).
// ==========================================================

import fs from "fs";
import path from "path";

const OUT = path.resolve(process.argv[2] ?? "docs/mega-evolution/m3-previews");
const ENV = { MEGA_EVOLUTION_ENABLED: "1", MEGA_BATTLES_ENABLED: "1" };
Object.assign(process.env, ENV);

const { createNewUser } = await import("../../utils/userSchema.js");
const { buildTeamView } = await import("../../utils/render/teamView.js");
const { renderShowteam } = await import("../../utils/render/showteam.js");
const { renderInspectCard } = await import("../../utils/render/inspectCard.js");
const { trainerCardView, renderTrainerCard } = await import("../../utils/render/trainerCard.js");
const { expView, renderExpCard } = await import("../../utils/render/expCard.js");
const { renderBattleFrame } = await import("../../utils/battle/render.js");
const { runBattle } = await import("../../utils/battle/runBattle.js");
const { isGif } = await import("../../utils/render/stage.js");

/** A fixture player: `team` = [[species, variant, level, megaFormId?], ...]. */
export function fixtureUser(id, name, team, { extraUnlocks = [] } = {}) {
  const u = createNewUser(id, name);
  u.tp = 5200;
  u.cc = 1800;
  u.training = {};
  u.megaUnlocks = {};
  u.battle = { rating: 1215, wins: 14, losses: 6 };
  const unlock = (species, variant, formId) => {
    const line = `${species}:${variant}`;
    u.megaUnlocks[line] ??= { forms: {}, preferred: null };
    u.megaUnlocks[line].forms[formId] = { at: 1, stone: null };
  };
  for (const [species, variant, level, mega] of team) {
    u.pokemon[species] ??= { normal: 0, shiny: 0 };
    u.pokemon[species][variant] += 1;
    u.training[`${species}:${variant}`] = { exp: level ** 3 + 7 * level * level };
    if (mega) unlock(species, variant, mega);
  }
  for (const [species, variant, formId] of extraUnlocks) unlock(species, variant, formId);
  u.displayedPokemon = team.map(([species, variant, , mega]) => (mega ? { id: species, variant, mega } : { id: species, variant }));
  return u;
}

const SCENES = {
  // Mega Charizard X leads; Mega Mewtwo can't share the Team (one Mega).
  charizardX: fixtureUser("100000000000000001", "Ash", [[6, "normal", 62, "mega-charizard-x"], [25, "normal", 48], [150, "normal", 70], [9, "normal", 55], [3, "normal", 51], [149, "normal", 60]]),
  charizardY: fixtureUser("100000000000000002", "Misty", [[121, "normal", 50], [6, "normal", 58, "mega-charizard-y"], [130, "normal", 52], [131, "normal", 49]]),
  mewtwoX: fixtureUser("100000000000000003", "Brock", [[150, "normal", 80, "mega-mewtwo-x"], [95, "normal", 40], [74, "normal", 38]]),
  shinyMega: fixtureUser("100000000000000004", "Erika", [[282, "shiny", 66, "mega-gardevoir"], [45, "normal", 44], [71, "normal", 47]]),
  // Unlocked Legends: Z-A Mega (Mega Raichu X) on the Team: shown as Raichu, with the reason.
  zaUnavailable: fixtureUser("100000000000000005", "Surge", [[26, "normal", 50, "mega-raichu-x"], [101, "normal", 45], [82, "normal", 44]]),
};

async function save(name, buffer) {
  const file = path.join(OUT, `${name}.${isGif(buffer) ? "gif" : "png"}`);
  fs.writeFileSync(file, buffer);
  const w = buffer.readUInt16LE?.(6), h = buffer.readUInt16LE?.(8);
  const dims = isGif(buffer) ? { w, h } : { w: buffer.readUInt32BE(16), h: buffer.readUInt32BE(20) };
  return { file: path.basename(file), bytes: buffer.length, ...dims };
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, "/").replace(/^([A-Z]):/i, "/$1:")}` || process.argv[1]?.endsWith("mega-m3-previews.mjs")) {
  fs.mkdirSync(OUT, { recursive: true });
  const manifest = {};
  for (const [key, user] of Object.entries(SCENES)) {
    const view = buildTeamView(user, { displayName: user.username ?? key, env: ENV });
    manifest[`showteam-${key}`] = { ...(await save(`showteam-${key}`, await renderShowteam(view, { layout: "refined" }))), megaNotice: view.megaNotice };
    const tc = trainerCardView(user, { displayName: key, trainer: null });
    manifest[`trainercard-${key}`] = await save(`trainercard-${key}`, await renderTrainerCard(tc));
    const megaSlot = view.slots.find((s) => s.mega) ?? view.slots[0];
    manifest[`inspect-${key}`] = await save(`inspect-${key}`, await renderInspectCard(megaSlot, { owner: key }));
  }
  manifest["showteam-charizardX-animated"] = await save("showteam-charizardX-animated", await renderShowteam(buildTeamView(SCENES.charizardX, { displayName: "Ash", env: ENV }), { layout: "refined", animate: true }));

  // A real battle between two Mega Teams, then its frames and EXP card.
  const td = { A: SCENES.charizardX, B: SCENES.charizardY };
  const out = runBattle({ trainerData: td, challengerId: "A", defenderId: "B", mode: "open", seed: 4242, now: new Date(Date.UTC(2026, 10, 10, 12)), env: ENV });
  if (!out.ok) throw new Error(`battle refused: ${out.reason}`);
  const sides = out.sides.map((s) => ({ name: s.userId === "A" ? "Ash" : "Misty", members: s.members }));
  const snaps = out.result.hpSnapshots ?? out.result.snapshots;
  const startHp = sides.map((s) => s.members.map(() => 1));
  manifest["battle-start"] = await save("battle-start", await renderBattleFrame({ sides, hpBefore: snaps?.[0] ?? startHp, screens: [["The battle begins!", `${sides[0].members[0].name} and ${sides[1].members[0].name} lead off.`]] }));
  // Fainted Mega: Charizard X at 0 HP (grayscale Mega sprite) beside a standing team.
  const fainted = sides.map((s, i) => s.members.map((_, j) => (i === 0 && j === 0 ? 0 : 1)));
  manifest["battle-fainted-mega"] = await save("battle-fainted-mega", await renderBattleFrame({ sides, hpBefore: fainted, badge: "TURN 9", screens: [["Mega Charizard X fainted!", ""]] }));
  manifest["exp-charizardX"] = await save("exp-charizardX", await renderExpCard(expView(out, "A", { A: "Ash", B: "Misty" }, td.A)));
  manifest.battle = { winner: out.winnerId, turns: out.result.turns, members: out.sides.map((s) => s.members.map((m) => m.name)) };
  fs.writeFileSync(path.join(OUT, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify(manifest, null, 1));
}
