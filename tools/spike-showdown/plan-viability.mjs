// Plan viability probe (full-sim design spike). Usage:
//   node tools/spike-showdown/plan-viability.mjs <trainer backup JSON>
// Counts species that can use each plan's key moves (level-up at any Level vs
// any learn method, @pkmn/dex learnsets with the battle-data generator's rules)
// and, over the Teams in the given backup, how many have each plan's pieces.

import fs from "fs";
import { Dex } from "@pkmn/dex";
import { Generations } from "@pkmn/data";
const gens = new Generations(Dex, () => true);
const MODERN = [9,8,7].map(n=>gens.get(n));
const g5 = gens.get(5);
const id = (x) => String(x).toLowerCase().replace(/[^a-z0-9]+/g, "");
const GROUPS = {
  setup: "swordsdance dragondance nastyplot calmmind quiverdance shellsmash bulkup shiftgear coil workup growth howl honeclaws tailglow victorydance tidyup bellydrum",
  cripple: "thunderwave glare stunspore willowisp toxic spore sleeppowder hypnosis sing yawn lovelykiss grasswhistle darkvoid",
  recovery: "recover roost softboiled slackoff synthesis moonlight morningsun milkdrink healorder shoreup wish strengthsap",
  protect: "protect detect kingsshield spikyshield banefulbunker",
  trickroom: "trickroom",
  rainmove: "raindance", sunmove: "sunnyday", sandmove: "sandstorm", snowmove: "snowscape hail",
  hazards: "stealthrock spikes toxicspikes stickyweb",
  screens: "reflect lightscreen auroraveil",
  tailwind: "tailwind",
  pivot: "uturn voltswitch flipturn partingshot teleport",
  boom: "explosion selfdestruct memento healingwish finalgambit mistyexplosion",
};
for (const k in GROUPS) GROUPS[k] = GROUPS[k].split(" ");
const AB = {
  rainSet:["drizzle"], sunSet:["drought","orichalcumpulse"], sandSet:["sandstream"], snowSet:["snowwarning"],
  rainUse:["swiftswim","raindish","hydration","dryskin"], sunUse:["chlorophyll","solarpower","flowergift","leafguard","harvest","protosynthesis"],
  sandUse:["sandrush","sandforce","sandveil"], snowUse:["slushrush","icebody","snowcloak"],
};
const base = new Map(); for (const s of Dex.species.all()) if (s.num>=1&&s.num<=1025&&!s.forme&&!base.has(s.num)) base.set(s.num,s);
async function info(num) {
  const s = base.get(num);
  const gen = num<=649 ? g5 : MODERN.find(g=>g.species.get(s.name));
  // learnset incl. prevos (Showdown stores level-up per species; walk the line)
  const any = new Set(), lvl = new Set();
  let cur = s;
  while (cur) {
    for (const g of [gen]) {
      const ls = (await g.learnsets.get(cur.name))?.learnset ?? {};
      for (const [m, srcs] of Object.entries(ls)) {
        if (srcs.some(x=>x.startsWith(String(g.num)))) any.add(m);
        if (srcs.some(x=>new RegExp(`^${g.num}L`).test(x))) lvl.add(m);
      }
    }
    // also all-gens union for "any"
    const all = (await Dex.learnsets.get(cur.id))?.learnset ?? {};
    for (const m of Object.keys(all)) any.add(m);
    cur = cur.prevo ? Dex.species.get(cur.prevo) : null;
  }
  const abilities = Object.values(s.abilities).map(id);
  return { s, any, lvl, abilities, spe: s.baseStats.spe, types: s.types };
}
const INFO = new Map(); for (const num of base.keys()) INFO.set(num, await info(num));
const has = (i, g, pool) => GROUPS[g].some(m => i[pool].has(m));
const hasAb = (i, k) => AB[k].some(a => i.abilities.includes(a));
// species-level counts
const rows = {};
for (const g of Object.keys(GROUPS)) rows[g] = { levelUp: 0, anyMethod: 0 };
for (const i of INFO.values()) for (const g of Object.keys(GROUPS)) { if (has(i,g,"lvl")) rows[g].levelUp++; if (has(i,g,"any")) rows[g].anyMethod++; }
console.log("Species (of", INFO.size, ") that can use each move group:"); console.table(rows);
const abRows = {}; for (const k of Object.keys(AB)) abRows[k] = [...INFO.values()].filter(i=>hasAb(i,k)).length;
console.log("Species with ability (any slot incl. hidden):", abRows);
console.log("Species with base Speed <= 60:", [...INFO.values()].filter(i=>i.spe<=60).length);

// team-level viability over the 99 real teams in oldTrainerBackup.json
const backup = JSON.parse(fs.readFileSync(process.argv[2] ?? "oldTrainerBackup.json","utf8"));
const teams = Object.values(backup.trainers ?? backup).map(u=>u.displayedPokemon).filter(t=>Array.isArray(t)&&t.length)
  .map(t=>t.map(x=>typeof x==="object"?x.id:x).map(Number).filter(n=>INFO.has(n)).map(n=>INFO.get(n)));
const weather = (t, pool, w) => {
  const setter = t.some(i => hasAb(i, w+"Set") || has(i, w+"move", pool));
  const users = t.filter(i => hasAb(i, w+"Use") || (w==="rain"&&i.types.includes("Water")) || (w==="sun"&&i.types.includes("Fire")) || (w==="sand"&&(i.types.includes("Rock")||i.types.includes("Ground")||i.types.includes("Steel"))) || (w==="snow"&&i.types.includes("Ice"))).length;
  return setter && users >= 2;
};
const PLANS = {
  "All-out attack": () => true,
  "Set up & sweep (>=2 setup users)": (t,p) => t.filter(i=>has(i,"setup",p)).length>=2,
  "Status & stall (>=2 cripplers, >=1 recovery)": (t,p) => t.filter(i=>has(i,"cripple",p)).length>=2 && t.some(i=>has(i,"recovery",p)),
  "Trick Room (setter + >=3 base Spe<=60)": (t,p) => t.some(i=>has(i,"trickroom",p)) && t.filter(i=>i.spe<=60).length>=3,
  "Weather, best of 4 (setter + >=2 users)": (t,p) => ["rain","sun","sand","snow"].some(w=>weather(t,p,w)),
  "Hazards (>=1 setter)": (t,p) => t.some(i=>has(i,"hazards",p)),
  "Screens (>=1 setter)": (t,p) => t.some(i=>has(i,"screens",p)),
  "Tailwind (>=1 setter)": (t,p) => t.some(i=>has(i,"tailwind",p)),
  "Pivot (>=2 pivot users)": (t,p) => t.filter(i=>has(i,"pivot",p)).length>=2,
};
const out = {};
for (const [name, ok] of Object.entries(PLANS)) out[name] = { levelUpOnly: teams.filter(t=>ok(t,"lvl")).length, anyMethod: teams.filter(t=>ok(t,"any")).length };
console.log(`Real Teams (of ${teams.length}) where the plan has the pieces it needs (level-up any level vs any learn method):`);
console.table(out);
