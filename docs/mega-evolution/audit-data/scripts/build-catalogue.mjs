// Joins Showdown (@pkmn/dex 0.10.12) Mega data with PokéAPI CSVs (e2710d30), the bot's
// battleData/pokemonData/forms.json, the sprite probe and the prior audit's attribution.
import fs from "fs";
const [S, R, OUT] = process.argv.slice(2);
const rd = (p) => fs.readFileSync(p, "utf8");
const csv = (p) => {
  const [h, ...rows] = rd(p).trim().split(/\r?\n/);
  const k = h.split(",");
  return rows.map((r) => Object.fromEntries(r.split(",").map((v, i) => [k[i], v])));
};
function parseQuoted(txt) {
  const rows = []; let row = [], f = "", q = false;
  for (let i = 0; i < txt.length; i++) {
    const c = txt[i];
    if (q) { if (c === '"') { if (txt[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(f); f = ""; }
    else if (c === "\n") { row.push(f.replace(/\r$/, "")); rows.push(row); row = []; f = ""; }
    else f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  const [h, ...rest] = rows;
  return rest.map((r) => Object.fromEntries(h.map((k, i) => [k, r[i]])));
}
const megas = JSON.parse(rd(`${S}/showdown-megas.json`));
const probe = Object.fromEntries(JSON.parse(rd(`${S}/probe-results.json`)).map((r) => [r.name, r]));
const forms = csv(`${S}/pokemon_forms.csv`);
const stats = csv(`${S}/pokemon_stats.csv`);
const ptypes = csv(`${S}/pokemon_types.csv`);
const tnames = Object.fromEntries(csv(`${S}/types.csv`).map((t) => [t.id, t.identifier]));
const species = Object.fromEntries(csv(`${S}/pokemon_species.csv`).map((s) => [s.id, s]));
const battle = JSON.parse(rd(`${R}/battleData.json`)).species;
const dex = JSON.parse(rd(`${R}/pokemonData.json`));
const botForms = Object.fromEntries(JSON.parse(rd(`${R}/data/pokedex/forms.json`)).forms.map((f) => [f.name, f]));
const inv = Object.fromEntries(parseQuoted(rd(`${R}/docs/audits/pokemon-gen6-9/pokemon-sprite-inventory.csv`)).map((r) => [r.pokemon_name, r]));
const toid = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const SK = ["hp", "atk", "def", "spa", "spd", "spe"];
const fmt = (b) => SK.map((k) => b[k]).join("/");
const bst = (b) => SK.reduce((a, k) => a + b[k], 0);
const paIdent = (m) => toid(m.name.replace("-M-", "-Male-").replace("-F-", "-Female-"));

function groupOf(m) {
  if (m.forme === "Primal") return "ORAS (Primal Reversion - not a Mega)";
  const pf = forms.find((f) => toid(f.identifier) === paIdent(m));
  const vg = pf?.introduced_in_version_group_id;
  if (vg === "15") return "X/Y";
  if (vg === "16") return "ORAS";
  if (["Heatran-Mega", "Darkrai-Mega", "Zeraora-Mega"].includes(m.name)) return "Legends Z-A: Mega Dimension";
  const n = m.item?.num;
  if (n >= 2559 && n <= 2587) return "Legends Z-A (base game)";
  if (n >= 2635) return "Legends Z-A: Mega Dimension";
  return "UNKNOWN";
}
const ok = (f) => !!(f && f.w);
const pix = (f) => ok(f) && f.colours <= 64 && f.alphaLevels <= 2;

const rows = [];
for (const m of megas) {
  const pf = forms.find((f) => toid(f.identifier) === paIdent(m));
  const pid = pf?.pokemon_id;
  const paStats = pid ? Object.fromEntries(stats.filter((s) => s.pokemon_id === pid).map((s) => [SK[Number(s.stat_id) - 1], Number(s.base_stat)])) : null;
  const paTypes = pid ? ptypes.filter((t) => t.pokemon_id === pid).sort((a, b) => a.slot - b.slot).map((t) => tnames[t.type_id]) : [];
  const statsAgree = !!paStats && SK.every((k) => paStats[k] === m.baseStats[k]);
  const typesAgree = paTypes.join("/") === m.types.map((t) => t.toLowerCase()).join("/");
  const bot = battle[m.num];
  const sp = species[m.num];
  const P = probe[m.name]?.files ?? {};

  const anim = ok(P.sd_ani) ? ["SD gen5ani", P.sd_ani] : ok(P.pa_ani) ? ["PokeAPI BW animated", P.pa_ani] : null;
  const animSh = ok(P.sd_ani_shiny) ? ["SD gen5ani-shiny", P.sd_ani_shiny] : ok(P.pa_ani_shiny) ? ["PokeAPI BW animated shiny", P.pa_ani_shiny] : null;
  const stat = pix(P.sd_static) ? ["SD gen5", P.sd_static] : pix(P.pa_static) ? ["PokeAPI BW", P.pa_static] : null;
  const statSh = pix(P.sd_static_shiny) ? ["SD gen5-shiny", P.sd_static_shiny] : pix(P.pa_static_shiny) ? ["PokeAPI BW shiny", P.pa_static_shiny] : null;
  const nf = (anim || stat)?.[1], sf = (animSh || statSh)?.[1];
  const notes = [];
  if (ok(P.sd_static) && !pix(P.sd_static)) notes.push(`Showdown gen5 static is a downscaled 3D render (${P.sd_static.colours} colours, ${P.sd_static.alphaLevels} alpha levels): rejected`);
  if (m.name.startsWith("Meowstic")) notes.push("M and F static sprites are byte-identical");
  if (P.sd_3d_ani?.exists) notes.push("3D Showdown ani GIF exists: rejected for style");

  const special = [];
  if (m.requiredMove) special.push(`No stone: requires knowing ${m.requiredMove}`);
  if (m.name === "Floette-Mega") special.push("Only Floette-Eternal (Eternal Flower) can Mega Evolve; the bot has only regular Floette (#670)");
  if (m.name === "Zygarde-Mega") special.push("Requires Zygarde Complete Forme; the bot has only base Zygarde; Mega HP 216 vs 108");
  if (m.name.startsWith("Meowstic")) special.push("One stone (Meowsticite) for both genders; gender picks the form; the bot stores no gender");
  if (m.name.startsWith("Tatsugiri")) special.push("One stone (Tatsugirinite); appearance picks the form; the bot stores no appearance");
  if (m.name.startsWith("Magearna")) special.push("One stone (Magearnite); Original Color picks Magearna-Original-Mega; the bot stores no colour variant");
  if (m.forme === "Primal") special.push("Primal Reversion (orb), not Mega Evolution: out of scope");
  if (/Mega-[XYZ]$/.test(m.forme)) special.push("Species has more than one Mega form");

  const variantPrefix = m.forme.match(/^(.*)-Mega$/)?.[1];
  const suffix = m.forme.match(/^Mega-([XYZ])$/)?.[1];
  const stableId = m.forme === "Primal" ? `primal-${toid(m.baseSpecies)}`
    : variantPrefix ? `mega-${toid(m.baseSpecies)}-${toid(variantPrefix)}`
    : `mega-${toid(m.baseSpecies)}${suffix ? "-" + suffix.toLowerCase() : ""}`;
  const display = m.forme === "Primal" ? `Primal ${m.baseSpecies}`
    : `Mega ${m.baseSpecies}${suffix ? " " + suffix : ""}${variantPrefix ? ` (${variantPrefix === "M" ? "Male" : variantPrefix === "F" ? "Female" : variantPrefix})` : ""}`;
  const legend = sp?.is_legendary === "1" ? "Legendary" : sp?.is_mythical === "1" ? "Mythical" : "Regular";
  const botBase = bot?.baseStats;
  const activation = m.forme === "Primal" ? "OUT OF SCOPE (Primal)"
    : !nf || !sf ? "BLOCKED: no acceptable 2D sprite"
    : m.requiredMove ? "BLOCKED: no stone; needs a rule decision"
    : m.name === "Floette-Mega" ? "BLOCKED: prerequisite forme not in bot"
    : m.name.startsWith("Tatsugiri") || m.name === "Magearna-Original-Mega" || m.name.startsWith("Meowstic") ? "NEEDS DECISION: variant data not in bot"
    : "ELIGIBLE (ability mechanics pending)";
  rows.push({
    base_dex: m.num, base_species: m.baseSpecies, mega_form_id: stableId,
    existing_form_key: botForms[m.name]?.key ?? "(not in forms.json)", display_name: display, showdown_name: m.name,
    intro_group: groupOf(m), mega_stone: m.requiredItem || "(none)",
    proposed_item_id: m.requiredItem ? `megastone_${toid(m.requiredItem)}` : "",
    official_status: legend, bot_rarity_tier: dex[m.num]?.tier ?? "",
    base_types: m.baseTypes.join("/"), mega_types: m.types.join("/"),
    type_change: m.baseTypes.join("/") === m.types.join("/") ? "none" : `${m.baseTypes.join("/")} -> ${m.types.join("/")}`,
    base_stats_modern: fmt(m.baseStatsBase), base_stats_bot: botBase ? fmt(botBase) : "",
    bot_base_differs_from_modern: botBase && SK.some((k) => botBase[k] !== m.baseStatsBase[k]) ? "yes" : "no",
    mega_stats: fmt(m.baseStats), base_bst_modern: bst(m.baseStatsBase), mega_bst: bst(m.baseStats),
    hp_changes: botBase && botBase.hp !== m.baseStats.hp ? `yes (${botBase.hp} -> ${m.baseStats.hp})` : "no",
    base_abilities: Object.values(m.baseAbilities).join(" / "), mega_ability: Object.values(m.abilities).join(" / "),
    normal_animated_2d: anim?.[0] ?? "no", shiny_animated_2d: animSh?.[0] ?? "no",
    normal_static_2d: stat?.[0] ?? "no", shiny_static_2d: statSh?.[0] ?? "no",
    chosen_normal: nf ? `${nf.url} | ${nf.w}x${nf.h} | ${nf.frames}f | ${nf.colours}c | sha1 ${nf.sha1}` : "NONE",
    chosen_shiny: sf ? `${sf.url} | ${sf.w}x${sf.h} | ${sf.frames}f | ${sf.colours}c | sha1 ${sf.sha1}` : "NONE",
    sprite_notes: notes.join("; "), attribution: inv[m.name]?.attribution_licensing ?? "",
    special_rules: special.join("; "),
    data_verification: `stats ${statsAgree ? "agree" : "DIFFER"}, types ${typesAgree ? "agree" : "DIFFER"} (Showdown 0.10.12 vs PokeAPI e2710d30)`,
    activation_status: activation,
  });
}
const cols = Object.keys(rows[0]);
const esc = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
fs.writeFileSync(OUT, [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n") + "\n");
fs.writeFileSync(OUT.replace(/\.csv$/, ".json"), JSON.stringify(rows, null, 1));
const count = (f) => rows.reduce((a, r) => ((a[f(r)] = (a[f(r)] || 0) + 1), a), {});
console.log(rows.length);
console.log(count((r) => r.intro_group));
console.log(count((r) => r.activation_status));
console.log(count((r) => r.data_verification));
console.log("hp changes:", rows.filter((r) => r.hp_changes !== "no").map((r) => r.showdown_name + " " + r.hp_changes));
console.log("bot base differs:", rows.filter((r) => r.bot_base_differs_from_modern === "yes").map((r) => r.showdown_name));
