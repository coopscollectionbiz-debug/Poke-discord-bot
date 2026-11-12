// ==========================================================
// utils/encounter/roster.js
// The Trainer classes met in Trainer encounters (docs/superpowers/specs/
// 2026-11-10-trainer-encounters-design.md, The Trainer): generic route
// Trainers only, never a /challenge opponent or a named character. Each class
// has a title, a sprite, a gender for its names, a type theme its Pokémon
// come from (empty: any type), a Prize money base, and a set of lines in
// utils/encounter/lines.js. Ace Trainers appear only in Over-tier encounters.
// ==========================================================

import { enabledSprites } from "../challenge/roster.js";

const regular = (key, title, spriteKey, gender, types, { base = 10, lines = key } = {}) =>
  ({ key, title, spriteKey, gender, types, base, ace: false, lines });
const wealthy = (key, title, gender, types) => regular(key, title, key, gender, types, { base: 40 });
const ace = (key, gender) => ({ key, title: "Ace Trainer", spriteKey: key, gender, types: [], base: 30, ace: true, lines: "ace" });

export const TRAINER_CLASSES = Object.fromEntries([
  regular("youngster", "Youngster", "youngster", "m", ["Normal", "Flying", "Poison", "Bug"]),
  regular("lass", "Lass", "lass", "f", ["Normal", "Fairy", "Grass"]),
  regular("bugcatcher", "Bug Catcher", "bugcatcher", "m", ["Bug"]),
  regular("camper", "Camper", "camper", "m", ["Ground", "Normal", "Fire"]),
  regular("picnicker", "Picnicker", "picnicker", "f", ["Grass", "Normal", "Water"]),
  regular("hiker", "Hiker", "hiker", "m", ["Rock", "Ground"]),
  regular("fisherman", "Fisherman", "fisherman", "m", ["Water"]),
  regular("swimmer", "Swimmer", "swimmer", "m", ["Water"]),
  regular("swimmerf", "Swimmer", "swimmerf", "f", ["Water"], { lines: "swimmer" }),
  regular("sailor", "Sailor", "sailor", "m", ["Water", "Fighting"]),
  regular("birdkeeper", "Bird Keeper", "birdkeeper", "m", ["Flying"]),
  regular("blackbelt", "Black Belt", "blackbelt", "m", ["Fighting"]),
  regular("battlegirl", "Battle Girl", "battlegirl", "f", ["Fighting"]),
  regular("psychic", "Psychic", "psychic", "m", ["Psychic"]),
  regular("psychicf", "Psychic", "psychicf", "f", ["Psychic"], { lines: "psychic" }),
  regular("channeler", "Channeler", "channeler", "f", ["Ghost"]),
  regular("hexmaniac", "Hex Maniac", "hexmaniac", "f", ["Ghost", "Dark"]),
  regular("juggler", "Juggler", "juggler", "m", ["Psychic", "Electric"]),
  regular("engineer", "Engineer", "engineer", "m", ["Electric", "Steel"]),
  regular("supernerd", "Super Nerd", "supernerd", "m", ["Poison", "Electric", "Fire"]),
  regular("burglar", "Burglar", "burglar", "m", ["Fire", "Poison", "Dark"]),
  regular("biker", "Biker", "biker", "m", ["Poison", "Dark"]),
  regular("firebreather", "Firebreather", "firebreather", "m", ["Fire"]),
  regular("pokemaniac", "PokéManiac", "pokemaniac", "m", ["Dragon", "Ground", "Rock"]),
  regular("dragontamer", "Dragon Tamer", "dragontamer", "m", ["Dragon"]),
  regular("skier", "Skier", "skier", "m", ["Ice"]),
  regular("skierf", "Skier", "skierf", "f", ["Ice"], { lines: "skier" }),
  regular("rocketgrunt", "Team Rocket Grunt", "teamrocketgruntm", "m", ["Poison", "Normal", "Dark"], { lines: "rocket" }),
  regular("rocketgruntf", "Team Rocket Grunt", "teamrocketgruntf", "f", ["Poison", "Normal", "Dark"], { lines: "rocket" }),
  wealthy("gentleman", "Gentleman", "m", ["Normal", "Fire"]),
  wealthy("lady", "Lady", "f", ["Fairy", "Normal"]),
  wealthy("richboy", "Rich Boy", "m", ["Normal"]),
  wealthy("beauty", "Beauty", "f", ["Normal", "Water", "Grass"]),
  ace("acetrainer", "m"),
  ace("acetrainerf", "f"),
].map((c) => [c.key, c]));

export const ACE_KEYS = Object.keys(TRAINER_CLASSES).filter((k) => TRAINER_CLASSES[k].ace);
export const REGULAR_KEYS = Object.keys(TRAINER_CLASSES).filter((k) => !TRAINER_CLASSES[k].ace);

// The same rule as the leaders' displaySprite: the first sprite that can be unlocked.
export const classSprite = (key) => enabledSprites(TRAINER_CLASSES[key].spriteKey).files[0];

// Everyday first names for route Trainers, none of them a named character.
export const NAMES = {
  m: [
    "Joey", "Ben", "Calvin", "Dan", "Rick", "Tim", "Mikey", "Eddie", "Josh", "Chad",
    "Ian", "Gene", "Owen", "Kurt", "Theo", "Wade", "Leo", "Gus", "Hank", "Marco",
    "Nico", "Ray", "Sam", "Toby", "Vic", "Walt", "Abe", "Cole", "Drew", "Finn",
    "Jake", "Kent", "Lars", "Milo", "Otto", "Reed",
  ],
  f: [
    "Robin", "Ali", "Ann", "Dana", "Gina", "Haley", "Janice", "Kay", "Lea", "Lisa",
    "Mia", "Nancy", "Olive", "Paige", "Sally", "Tara", "Uma", "Vera", "Wendy", "Yoko",
    "Zoe", "Abby", "Cara", "Dee", "Ella", "Faye", "Gwen", "Holly", "Jill", "Kim",
    "Liz", "Mae", "Nora", "Pia", "Tess",
  ],
};
