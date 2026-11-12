// ==========================================================
// tools/generate-tm-data.mjs — TM compatibility data (TM system, phase T2).
//
// Writes data/battle/tm-data.json. battleData.json is NOT touched, so no
// existing battle can change. The bot reads the file through
// utils/battle/tmData.js and never imports @pkmn at runtime.
//
// Catalog (owner decisions D-T4/D-T5/D-T5b, 2026-11-10: the broad catalog
// "R-B"; docs/tm-system in the TM audit):
//   • LAUNCH (156): damaging moves the battle engine already models.
//   • HOLD (16): sellable once a small engine fix lands (D-T13). Their
//     compatibility is generated now so a fix needs no data change.
//     (Gyro Ball and Grass Knot are also held but are not in battleData.json
//     — power from Speed/weight — so they get no data until they are added.)
//   • Everything else (status moves, two-turn/recharge moves, Hidden Power,
//     Return…) is not in the catalog at all.
//
// Compatibility rule (R-B), from Showdown learnset sources ("<gen>M" = taught
// by TM/TR/HM in that generation):
//   • Gen 5 TM/HM moves: #1–649 by Gen 5 machine (5M) — the bot's Gen 5
//     baseline — and #650–1025 by machine in their latest game.
//   • Every other catalog move: by machine in the species' latest game that
//     has it, Gen 9 → 8 → 7 → 6, for every species.
// The latest game for a species is the newest of Gens 9…5 whose dex has it.
//
// Item ids are tm_<moveId>; Gen 5 TM/HM numbers are kept for display only.
// Gen 5 numbering was verified against PokeAPI machine records for
// black-white and black-2-white-2 (identical; TM audit 2026-11-10).
//
// Run: npm run generate:tm-data     (needs the @pkmn/dex dev dependency)
// ==========================================================

import fs from "fs";
import { Dex } from "@pkmn/dex";
import { Generations } from "@pkmn/data";

const ROOT = new URL("..", import.meta.url);
const OUT = new URL("data/battle/tm-data.json", ROOT);
const battle = JSON.parse(fs.readFileSync(new URL("battleData.json", ROOT), "utf8"));
const pokemonData = JSON.parse(fs.readFileSync(new URL("pokemonData.json", ROOT), "utf8"));

// Gen 5 (Black/White = Black 2/White 2) TM and HM numbers.
const GEN5_MACHINES = `TM01:honeclaws TM02:dragonclaw TM03:psyshock TM04:calmmind TM05:roar TM06:toxic TM07:hail TM08:bulkup TM09:venoshock TM10:hiddenpower TM11:sunnyday TM12:taunt TM13:icebeam TM14:blizzard TM15:hyperbeam TM16:lightscreen TM17:protect TM18:raindance TM19:telekinesis TM20:safeguard TM21:frustration TM22:solarbeam TM23:smackdown TM24:thunderbolt TM25:thunder TM26:earthquake TM27:return TM28:dig TM29:psychic TM30:shadowball TM31:brickbreak TM32:doubleteam TM33:reflect TM34:sludgewave TM35:flamethrower TM36:sludgebomb TM37:sandstorm TM38:fireblast TM39:rocktomb TM40:aerialace TM41:torment TM42:facade TM43:flamecharge TM44:rest TM45:attract TM46:thief TM47:lowsweep TM48:round TM49:echoedvoice TM50:overheat TM51:allyswitch TM52:focusblast TM53:energyball TM54:falseswipe TM55:scald TM56:fling TM57:chargebeam TM58:skydrop TM59:incinerate TM60:quash TM61:willowisp TM62:acrobatics TM63:embargo TM64:explosion TM65:shadowclaw TM66:payback TM67:retaliate TM68:gigaimpact TM69:rockpolish TM70:flash TM71:stoneedge TM72:voltswitch TM73:thunderwave TM74:gyroball TM75:swordsdance TM76:strugglebug TM77:psychup TM78:bulldoze TM79:frostbreath TM80:rockslide TM81:xscissor TM82:dragontail TM83:workup TM84:poisonjab TM85:dreameater TM86:grassknot TM87:swagger TM88:pluck TM89:uturn TM90:substitute TM91:flashcannon TM92:trickroom TM93:wildcharge TM94:rocksmash TM95:snarl HM01:cut HM02:fly HM03:surf HM04:strength HM05:waterfall HM06:dive`
  .split(" ").map((s) => s.split(":"));
const GEN5_NUMBER = Object.fromEntries(GEN5_MACHINES.map(([n, m]) => [m, n]));

const LAUNCH = `dragonclaw venoshock icebeam blizzard smackdown thunderbolt thunder earthquake psychic shadowball brickbreak sludgewave flamethrower sludgebomb fireblast rocktomb aerialace facade flamecharge thief lowsweep round echoedvoice focusblast energyball scald chargebeam incinerate shadowclaw payback retaliate stoneedge voltswitch strugglebug bulldoze rockslide xscissor dragontail poisonjab pluck uturn flashcannon wildcharge rocksmash snarl cut surf strength waterfall
dazzlinggleam disarmingvoice drainingkiss infestation mysticalfire petalblizzard playrough poweruppunch brutalswing darkestlariat highhorsepower liquidation lunge pollenpuff psychicfangs smartstrike stompingtantrum throatchop breakingswipe burningjealousy dualwingbeat expandingforce flipturn grassyglide lashout scaleshot scorchingsands skittersmack alluringvoice chillingwater icespinner pounce psychicnoise supercellslam temperflare trailblaze
acidspray aircutter airslash assurance aurasphere avalanche blazekick bodyslam bravebird brine bugbite bugbuzz bulletseed crosspoison crunch darkpulse doubleedge dragonpulse drainpunch drillrun earthpower electroweb firefang firepunch firespin flareblitz gigadrain gunkshot headbutt heatwave hurricane hydropump hypervoice icefang icepunch iciclespear icywind ironhead irontail leafblade leechlife magicalleaf megakick megapunch megahorn metalclaw mudshot mudslap muddywater pinmissile poisontail powergem powerwhip psybeam psychocut razorshell revenge rockblast sandtomb seedbomb steelwing swift tailslap takedown thunderfang thunderpunch triattack vacuumwave waterpulse whirlpool zenheadbutt`.split(/\s+/);

// Held until an engine fix (D-T13); reason shown to admins/players later.
const HOLD = {
  psyshock: "should hit the target's Defense",
  overheat: "user's Sp. Atk −2 after use not applied",
  falseswipe: "must leave the target at 1 HP",
  acrobatics: "110 power when holding no item (data has 55)",
  frostbreath: "always lands a critical hit",
  bodypress: "should use the user's Defense",
  tripleaxel: "hits for 20, 40 then 60 power",
  terablast: "Terastal mechanic absent (always Normal)",
  closecombat: "user's Defense and Sp. Def −1 not applied",
  superpower: "user's Attack and Defense −1 not applied",
  dracometeor: "user's Sp. Atk −2 not applied",
  leafstorm: "user's Sp. Atk −2 not applied",
  outrage: "2–3 turn lock-in and confusion not modeled",
  uproar: "3-turn lock-in not modeled",
  foulplay: "should use the target's Attack",
  knockoff: "battle data keeps the Gen 5 power 20 (Gen 6+: 65)",
};

const G = new Generations(Dex);
const GEN = Object.fromEntries([5, 6, 7, 8, 9].map((n) => [n, G.get(n)]));
const baseName = (num) => Dex.species.all().find((x) => x.num === num && !x.forme)?.name;

const problems = [];
const moveIds = [...LAUNCH, ...Object.keys(HOLD)];
if (new Set(moveIds).size !== moveIds.length) problems.push("a move is listed twice");
for (const id of moveIds) if (!battle.moves[id]) problems.push(`not in battleData.json: ${id}`);

// Learnsets per species from its latest game.
const species = Object.keys(pokemonData).map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 1025).sort((a, b) => a - b);
const learn = {};
for (const num of species) {
  const name = baseName(num);
  const latest = [9, 8, 7, 6, 5].find((g) => GEN[g].species.get(name));
  if (!latest) { problems.push(`no learnset generation for #${num} ${name}`); continue; }
  learn[num] = { latest, ls: (await GEN[latest].learnsets.get(name))?.learnset ?? {} };
}
if (problems.length) { console.error(problems.join("\n")); process.exit(1); }

const byMachine = (num, id, gen) => (learn[num].ls[id] ?? []).includes(`${gen}M`);
function learns(num, id) {
  if (GEN5_NUMBER[id]) return num <= 649 ? byMachine(num, id, 5) : byMachine(num, id, learn[num].latest);
  return [9, 8, 7, 6].some((g) => byMachine(num, id, g));
}

const moves = {};
for (const id of moveIds) {
  const learners = species.filter((n) => learns(n, id));
  moves[id] = {
    status: HOLD[id] ? "hold" : "launch",
    ...(HOLD[id] && { holdReason: HOLD[id] }),
    tm: GEN5_NUMBER[id] ?? null,
    rule: GEN5_NUMBER[id] ? "gen5" : "modern",
    introduced: Dex.moves.get(id).gen,
    species: learners,
  };
}

const out = {
  note: "TM compatibility (generated by tools/generate-tm-data.mjs from @pkmn/dex 0.10.12; do not edit). battleData.json is unchanged.",
  rule: "Gen 5 TM moves: #1-649 by Gen 5 machine, #650+ by machine in their latest game. Other moves: by machine in the species' latest game that has it (Gen 9-6).",
  counts: { launch: LAUNCH.length, hold: Object.keys(HOLD).length, species: species.length },
  moves: Object.fromEntries(Object.entries(moves).sort(([a], [b]) => a.localeCompare(b))),
};
const json = JSON.stringify(out, null, 1).replace(/\[\n\s+([\d,\n\s]+?)\n\s+\]/g, (_, body) => `[${body.replace(/\s+/g, "")}]`);
fs.writeFileSync(OUT, json + "\n");
const pairs = Object.values(moves).reduce((t, m) => t + m.species.length, 0);
console.log(`tm-data: ${LAUNCH.length} launch + ${Object.keys(HOLD).length} hold moves, ${pairs} species-move pairs, ${json.length} bytes`);
