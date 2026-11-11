// ==========================================================
// tools/generate-credits.mjs — builds public/credits/index.html (served at
// /credits) from data/sprites/sprites.json, so attribution always matches
// the sprites actually shipped. Run after import-sprites.
// Run: npm run generate:credits
// ==========================================================

import fs from "fs";

const ROOT = new URL("..", import.meta.url);
const manifest = JSON.parse(fs.readFileSync(new URL("data/sprites/sprites.json", ROOT), "utf8")).species;
const pokemon = JSON.parse(fs.readFileSync(new URL("pokemonData.json", ROOT), "utf8"));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const PROJECTS = [
  ["Smogon X/Y Sprite Project", "https://www.smogon.com/forums/threads/x-y-sprite-project.3486712/", "Generation 6 Black/White-style sprites and animations. Co-led by Layell and princessofmusic."],
  ["Smogon Sun/Moon Sprite Project", "https://www.smogon.com/forums/threads/sun-moon-sprite-project.3577711/", "Generation 7 Black/White-style sprites and animations. Led by Layell; leParagon."],
  ["Smogon Sprite Project (Generation 8 onward)", "https://www.smogon.com/forums/threads/smogon-sprite-project.3647722/", "Generation 8 and 9 Black/White-style sprites and animations. Led by G.E.Z.; leParagon."],
  ["Pokémon Showdown", "https://play.pokemonshowdown.com/sprites/", "Hosts the Smogon project sprites (gen5ani / gen5) and the type icons; credits at pokemonshowdown.com/credits."],
  ["PokéAPI sprites", "https://github.com/PokeAPI/sprites", "Official Black/White sprites for #1–649, a mirror of the Smogon project sprites, and the official held-item and Mega Stone bag icons (Pokémon games © Nintendo / Creatures / GAME FREAK)."],
];

// Trainer sprites: artists of the community-drawn ones (data/sprites/trainer-credits.json,
// built by tools/import-trainer-credits.mjs from Pokémon Showdown's credits).
const trainerCredits = JSON.parse(fs.readFileSync(new URL("data/sprites/trainer-credits.json", ROOT), "utf8"));
const byArtist = new Map();
for (const [file, artist] of Object.entries(trainerCredits.credited)) {
  if (!byArtist.has(artist)) byArtist.set(artist, []);
  byArtist.get(artist).push(file.replace(/\.png$/, ""));
}
const trainerRows = [...byArtist.entries()]
  .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
  .map(([artist, files]) => `<tr><td>${esc(artist)}</td><td>${files.length}</td><td><details><summary>Show sprites</summary><span class="muted">${files.map(esc).join(", ")}</span></details></td></tr>`);
const trainerCount = Object.keys(trainerCredits.credited).length;

const rows = [];
for (const [id, rec] of Object.entries(manifest)) {
  if (Number(id) < 650) continue;
  const p = pokemon[id];
  const artist = rec.credit?.artist ? esc(rec.credit.artist) : "<span class=\"muted\">project team</span>";
  const kind = rec.normal.kind === "animated" ? "Animated" : "Static";
  rows.push(`<tr><td>#${id}</td><td>${esc(p.name)}</td><td>${kind}</td><td>${esc(rec.credit?.project)}</td><td>${artist}</td></tr>`);
}

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Coop’s Collection — Sprite Credits</title>
  <style>
    :root { color-scheme: dark; --bg:#0f1115; --card:#181b22; --text:#e5e7eb; --muted:#9ca3af; --brand:#facc15; }
    body { margin:0; background:var(--bg); color:var(--text); font:15px/1.5 system-ui, sans-serif; }
    main { max-width: 980px; margin: 0 auto; padding: 24px 16px 48px; }
    h1 { color: var(--brand); margin: 0 0 4px; }
    a { color: #93c5fd; }
    section { background: var(--card); border-radius: 12px; padding: 16px; margin: 16px 0; }
    table { width: 100%; border-collapse: collapse; font-size: 14px; }
    th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #2a2f3a; vertical-align: top; }
    th { color: var(--muted); font-weight: 600; }
    .muted { color: var(--muted); }
    .scroll { overflow-x: auto; }
  </style>
</head>
<body>
<main>
  <h1>Sprite credits</h1>
  <p class="muted">Pokémon and all related names and designs are © Nintendo, Creatures Inc. and GAME FREAK (The Pokémon Company).</p>
  <section>
    <h2>Projects and sources</h2>
    <ul>
${PROJECTS.map(([n, u, d]) => `      <li><a href="${u}" rel="noopener">${esc(n)}</a> — ${esc(d)}</li>`).join("\n")}
    </ul>
    <p class="muted">The Generation 6–9 sprites are fan-made pixel art by the Smogon sprite project contributors, credited here as the projects ask. The Fairy type icon comes from Pokémon Showdown’s type icons, like the other 17.</p>
  </section>
  <section>
    <h2>Generation 6–9 sprites</h2>
    <p class="muted">Artist names come from the projects’ public trackers where one is listed.</p>
    <div class="scroll"><table>
      <thead><tr><th>#</th><th>Pokémon</th><th>Sprite</th><th>Project</th><th>Artist / animator</th></tr></thead>
      <tbody>
${rows.join("\n")}
      </tbody>
    </table></div>
  </section>
  <section>
    <h2>Trainer sprites</h2>
    <p class="muted">Trainer sprites come from <a href="${esc(trainerCredits.hostedAt)}" rel="noopener">Pokémon Showdown</a>. Most older sprites are taken from the games. The ${trainerCount} sprites below are fan-made pixel art by community artists, credited here as Showdown asks (<a href="${esc(trainerCredits.source)}" rel="noopener">source</a>).</p>
    <div class="scroll"><table>
      <thead><tr><th>Artist</th><th>Sprites</th><th></th></tr></thead>
      <tbody>
${trainerRows.join("\n")}
      </tbody>
    </table></div>
    <p class="muted">Community sprites with no artist listed by Showdown: ${trainerCredits.uncreditedCommunity.map((f) => esc(f.replace(/\.png$/, ""))).join(", ")}.</p>
  </section>
</main>
</body>
</html>
`;
fs.mkdirSync(new URL("public/credits/", ROOT), { recursive: true });
fs.writeFileSync(new URL("public/credits/index.html", ROOT), html);
console.log(`credits page: ${rows.length} Gen 6–9 species; ${trainerCount} credited trainer sprites by ${byArtist.size} artists`);
