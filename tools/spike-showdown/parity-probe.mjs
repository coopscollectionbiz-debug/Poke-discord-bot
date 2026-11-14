import { Dex } from "@pkmn/sim";
import { HELD_ITEM_IDS } from "../../catalog/heldItems.js";
import { ABILITY_REGISTRY } from "../../utils/battle/abilities.js";
const d = Dex.forGen(9);
for (const id of HELD_ITEM_IDS) { const i = d.items.get(id.replace(/_/g,"")); console.log("ITEM", id, i.exists, i.isNonstandard, "|", i.shortDesc, "|", Object.keys(i).filter(k=>k.startsWith("on")).join(",")); }
for (const n of Object.keys(ABILITY_REGISTRY)) { const a = d.abilities.get(n); console.log("AB", n, a.exists, a.isNonstandard, "|", a.shortDesc); }
const f=Dex.mod("gen9"); console.log("CHOICE", ["choiceband","lifeorb","rockyhelmet","assaultvest","choicespecs","choicescarf"].map(x=>d.items.get(x).exists+":"+d.items.get(x).isNonstandard).join(" "));
