// ==========================================================
// utils/battle/narrate.js — the text-box line for one full-sim step
// (utils/battle/showdown/result.js), in the games' and Showdown's wording.
// Hits are narrated by turnText (render.js) and moveText (the browser);
// this covers everything else: status, hazards, weather, fields, stat
// changes and the like. Switch-ins are shown, not told, so they and
// anything with nothing to say return null.
// ==========================================================

const STAT = { atk: "Attack", def: "Defense", spa: "Sp. Atk", spd: "Sp. Def", spe: "Speed", accuracy: "accuracy", evasion: "evasiveness" };
const STATUS_ON = {
  psn: "was poisoned!", tox: "was badly poisoned!", brn: "was burned!", par: "is paralyzed! It may be unable to move!",
  slp: "fell asleep!", frz: "was frozen solid!",
};
const CANT = { par: "is paralyzed! It can't move!", slp: "is fast asleep.", frz: "is frozen solid!", flinch: "flinched and couldn't move!", recharge: "must recharge!" };
const WEATHER_ON = { RainDance: "It started to rain!", SunnyDay: "The sunlight turned harsh!", Sandstorm: "A sandstorm kicked up!", Snowscape: "It started to snow!", Hail: "It started to hail!" };
const SIDE_ON = {
  "Stealth Rock": "Pointed stones float in the air!", Spikes: "Spikes were scattered on the ground!", "Toxic Spikes": "Poison spikes were scattered on the ground!",
  "Sticky Web": "A sticky web spreads out on the ground!", Reflect: "Reflect raised its team's Defense!", "Light Screen": "Light Screen raised its team's Sp. Def!",
  "Aurora Veil": "Aurora Veil made its team stronger against physical and special moves!", Tailwind: "The Tailwind blew from behind its team!",
};
const SIDE_OFF = { Reflect: "Reflect wore off!", "Light Screen": "Light Screen wore off!", "Aurora Veil": "Aurora Veil wore off!", Tailwind: "The Tailwind petered out!" };
const HURT_BY = {
  psn: "was hurt by poison!", tox: "was hurt by poison!", brn: "was hurt by its burn!", "Stealth Rock": "was hurt by the pointed stones!",
  Spikes: "was hurt by the spikes!", Sandstorm: "is buffeted by the sandstorm!", hail: "is buffeted by the hail!", "Leech Seed": "had its health sapped by Leech Seed!",
  confusion: "hurt itself in its confusion!", "item: Life Orb": "lost some of its HP!",
};

const effectName = (s = "") => s.replace(/^(move|ability|item): /, "");
const whoIn = (ident, names) => {
  const m = /^p([12])[a-z]?: s(\d+)$/.exec(ident ?? "");
  return m ? names[Number(m[1]) - 1]?.[Number(m[2])] ?? "It" : null;
};

/** The line for a step, or null when there's nothing to say. names[side][slot] = the Pokémon's name. */
export function stepText(step, names) {
  const name = (s) => names[s.side]?.[s.slot] ?? "It";
  switch (step.kind) {
    case "status":
      if (step.status) return STATUS_ON[step.status] ? `${name(step)} ${STATUS_ON[step.status]}` : null;
      return step.cured === "slp" ? `${name(step)} woke up!` : step.cured === "frz" ? `${name(step)} thawed out!` : `${name(step)}'s status returned to normal!`;
    case "hp": {
      const n = name(step);
      const from = step.from;
      if (!from) return step.heal ? `${n} had its HP restored.` : null; // an unexplained drop is the hit itself
      if (from === "Recoil" || from === "drain") return null; // the hit's own line covers these
      if (from === "Leech Seed") return step.heal ? null : `${n} ${HURT_BY[from]}`;
      if (from.startsWith("item: ")) {
        if (step.heal) return `${n} restored HP using its ${effectName(from)}!`;
        return HURT_BY[from] ? `${n} ${HURT_BY[from]}` : `${n} was hurt by its ${effectName(from)}!`;
      }
      if (step.heal) return `${n} restored HP with ${effectName(from)}!`;
      return HURT_BY[from] ? `${n} ${HURT_BY[from]}` : `${n} was hurt by ${effectName(from)}!`;
    }
    case "faint":
      return `${name(step)} fainted!`;
    case "note":
      return noteText(step.type, step.args ?? [], names);
    default:
      return null;
  }
}

function noteText(type, args, names) {
  const who = whoIn(args[0], names);
  switch (type) {
    case "weather":
      if (args.includes("[upkeep]")) return null;
      return args[0] === "none" ? "The weather cleared up." : WEATHER_ON[args[0]] ?? null;
    case "fieldstart":
      return effectName(args[0]) === "Trick Room" ? "The dimensions were twisted!" : `${effectName(args[0])} started!`;
    case "fieldend":
      return effectName(args[0]) === "Trick Room" ? "The twisted dimensions returned to normal!" : `${effectName(args[0])} ended.`;
    case "sidestart":
      return SIDE_ON[effectName(args[1])] ?? null;
    case "sideend":
      return SIDE_OFF[effectName(args[1])] ?? null;
    case "boost":
    case "unboost": {
      const n = Number(args[2]);
      const stat = STAT[args[1]] ?? args[1];
      if (n === 0) return `${who}'s ${stat} won't go any ${type === "boost" ? "higher" : "lower"}!`;
      const how = type === "boost" ? ["rose!", "rose sharply!", "rose drastically!"] : ["fell!", "harshly fell!", "severely fell!"];
      return `${who}'s ${stat} ${how[Math.min(n, 3) - 1]}`;
    }
    case "cant":
      return who ? `${who} ${CANT[args[1]] ?? "can't move!"}` : null;
    case "ability":
      return who ? `${who}'s ${args[1]}!` : null;
    case "enditem":
      if (!who) return null;
      return args.includes("[eat]") ? `${who} ate its ${args[1]}!` : `${who} lost its ${args[1]}!`;
    case "item":
      return who ? `${who} obtained one ${args[1]}!` : null;
    case "start": {
      const effect = effectName(args[1]);
      const text = { confusion: "became confused!", Substitute: "put in a substitute!", "Leech Seed": "was seeded!", Yawn: "grew drowsy!", perish3: "will faint in three turns!" }[effect];
      return who && text ? `${who} ${text}` : null;
    }
    case "end": {
      const effect = effectName(args[1]);
      const text = { confusion: "snapped out of its confusion!", Substitute: "'s substitute faded!" }[effect];
      if (!who || !text) return null;
      return text.startsWith("'s") ? `${who}${text}` : `${who} ${text}`;
    }
    case "singleturn":
    case "activate":
      return who && /Protect|Detect|King's Shield|Spiky Shield|Baneful Bunker/.test(args[1] ?? "") ? `${who} protected itself!` : null;
    case "fail":
      return "But it failed!";
    case "transform":
      return who ? `${who} transformed!` : null;
    default:
      return null;
  }
}
