// ==========================================================
// tests/megaSprites.test.js — Mega Evolution Phase M0 sprite assets:
// every imported file exists, matches its SHA-256/SHA-1, decodes, is
// transparent 2D pixel art, has a distinct shiny, and comes from an
// audited 2D source. The species sprite manifest is untouched.
// ==========================================================

import fs from "fs";
import crypto from "crypto";
import { assertTrue, assertEqual, section, finish } from "./harness.js";

const read = (rel) => JSON.parse(fs.readFileSync(new URL(rel, import.meta.url), "utf8"));
const MANIFEST = read("../data/sprites/megas.json");
const SOURCE = read("../data/sprites/mega-source-manifest.json").entries;
const PROBE = read("../docs/mega-evolution/audit-data/probe-results.json");
const MEGAS = read("../data/pokedex/megas.json").forms;
const { gifFrames } = await import("../tools/lib/spriteCodec.mjs");
const { megaSpritePath } = await import("../utils/megas.js");
const { pokemonSpritePath, PLACEHOLDER_PATH } = await import("../utils/sprites.js");

const DIR = new URL("../public/sprites/pokemon/mega/", import.meta.url);
const sha = (algo, buf) => crypto.createHash(algo).update(buf).digest("hex");
const recs = Object.values(MANIFEST.forms);

section("Coverage");
assertEqual(recs.length, 95, "95 forms have sprites (97 records − Mega Zygarde − Mega Magearna Original)");
// Community animations that replaced static forms (data/sprites/animated-imports.json, tools/import-animated-sprites.mjs)
const IMPORTS = new Map(read("../data/sprites/animated-imports.json").entries.filter((e) => e.target.startsWith("mega:")).map((e) => [e.megaId, e]));
const isImport = (r) => r.normal.origin === "animated-import" && IMPORTS.has(r.id);
const audited = recs.filter((r) => !isImport(r));
assertEqual(audited.filter((r) => r.normal.kind === "animated").length, 24, "24 audited animated normal (Showdown gen5ani / PokéAPI)");
assertEqual(audited.filter((r) => r.shiny.kind === "animated").length, 24, "24 audited animated shiny");
assertEqual(IMPORTS.size, 61, "61 static forms replaced by reviewed community animations");
assertTrue(recs.filter(isImport).length === IMPORTS.size && recs.filter(isImport).every((r) => r.normal.kind === "animated" && r.shiny.kind === "animated"), "every imported form is animated, normal and shiny");
assertEqual(recs.filter((r) => r.normal.kind === "static").length, 71 - IMPORTS.size, "the remaining static pixel-art fallbacks (71 − imports)");
assertTrue(recs.every((r) => r.normal.kind === r.shiny.kind), "normal and shiny are the same kind for every form");
assertTrue(!MANIFEST.forms["mega-zygarde"] && !MANIFEST.forms["mega-magearna-original"], "no sprite for Mega Zygarde (none acceptable) or Mega Magearna Original (D-8)");
assertTrue(MEGAS.every((f) => !!MANIFEST.forms[f.id] === !!f.sprite.normal), "catalogue sprite references match the manifest");
for (const dir of ["normal", "shiny", "grayscale"]) assertEqual(fs.readdirSync(new URL(`${dir}/`, DIR)).filter((f) => f.endsWith(".gif")).length, 95, `${dir}/ holds exactly 95 GIFs`);

section("File integrity (SHA-256 + SHA-1) and decoding");
const bad = [];
for (const r of recs) {
  for (const v of ["normal", "shiny", "grayscale"]) {
    const buf = fs.readFileSync(new URL(r[v].file, DIR));
    if (sha("sha256", buf) !== r[v].fileSha256 || sha("sha1", buf) !== r[v].fileSha1) bad.push(`${r.id} ${v} hash`);
    const g = gifFrames(buf);
    if (v !== "grayscale" && (g.frames.length !== r[v].frames || `${g.width}x${g.height}` !== r[v].size)) bad.push(`${r.id} ${v} frames/size`);
    if (g.width < 32 || g.width > 160 || g.height < 32 || g.height > 160) bad.push(`${r.id} ${v} size ${g.width}x${g.height}`);
    let transparent = false;
    const colours = new Set();
    for (const { rgba } of g.frames) for (let p = 0; p < rgba.length; p += 4) {
      if (rgba[p + 3] === 0) transparent = true; else colours.add((rgba[p] << 16) | (rgba[p + 1] << 8) | rgba[p + 2]);
    }
    if (!transparent) bad.push(`${r.id} ${v} not transparent`);
    if (colours.size > 64) bad.push(`${r.id} ${v} ${colours.size} colours`);
    if (v === "grayscale" && [...colours].some((c) => (c >> 16) !== ((c >> 8) & 255) || (c >> 16) !== (c & 255))) bad.push(`${r.id} grayscale has colour`);
    if (buf.length > 1_000_000) bad.push(`${r.id} ${v} over 1 MB`);
  }
}
assertEqual(bad, [], "every file matches its SHA-256/SHA-1, decodes, is 32–160 px, transparent, ≤ 64 colours, grayscale is gray, < 1 MB (Discord-safe)");

section("Shiny distinct from normal");
assertTrue(recs.every((r) => r.normal.fileSha1 !== r.shiny.fileSha1 && r.normal.firstFrameSha1 !== r.shiny.firstFrameSha1), "every shiny differs from its normal (bytes and pixels)");

section("Provenance: audited 2D sources only");
const probed = new Map(PROBE.flatMap((p) => Object.values(p.files).filter((f) => f.sha1).map((f) => [`${f.url} ${f.sha1}`, f])));
const probeOf = (x) => probed.get(`${x.sourceUrl} ${x.sourceSha1}`);
assertTrue(audited.every((r) => ["normal", "shiny"].every((v) => probeOf(r[v]))), "every audited source file is the exact file the audit probed (URL + SHA-1)");
assertTrue(audited.every((r) => ["normal", "shiny"].every((v) => probeOf(r[v]).colours <= 64 && probeOf(r[v]).alphaLevels <= 2)), "every audited source passed the 2D pixel-art test (≤ 64 colours, hard alpha)");
assertTrue(recs.filter(isImport).every((r) => { const e = IMPORTS.get(r.id); return r.normal.fileSha1 === e.sha1.normal && r.shiny.fileSha1 === e.sha1.shiny && r.normal.sourceSha1 === e.sourceSha1.normal && r.shiny.sourceSha1 === e.sourceSha1.shiny; }), "every imported animation is the reviewed file recorded in animated-imports.json (output and source SHA-1)");
assertTrue(recs.filter(isImport).every((r) => /animation by /.test(r.credit) && r.animationCredit?.animator && r.animationCredit?.licence && r.animationCredit?.shiny), "every imported animation credits its animator, terms and shiny method");
assertTrue(recs.every((r) => ["normal", "shiny"].every((v) => !/\/sprites\/(ani|ani-shiny|dex|home|gen6)\//.test(r[v].sourceUrl))), "no 3D source (Showdown ani/dex/home/gen6)");
assertTrue(audited.every((r) => r.normal.kind !== "animated" || /gen5ani|black-white\/animated/.test(r.normal.sourceUrl)), "audited animations are BW-style gen5ani (or its PokéAPI mirror)");
assertTrue(SOURCE.filter((e) => !IMPORTS.has(e.id)).every((e) => MANIFEST.forms[e.id]?.normal.sourceSha1 === e.normal.sha1 && MANIFEST.forms[e.id]?.shiny.sourceSha1 === e.shiny.sha1), "audited files match data/sprites/mega-source-manifest.json");
assertTrue(recs.every((r) => typeof r.credit === "string" && /Smogon/.test(r.credit) && !/Official artwork/.test(r.credit)), "every form carries a sprite-project credit (never an artwork credit)");
assertEqual(recs.filter((r) => r.creditVerified === false).map((r) => r.id).sort(), ["mega-meowstic-f", "mega-meowstic-m"], "only Mega Meowstic M/F lack a tracker-verified artist (flagged, not invented)");

section("No base-form substitution");
assertTrue(MEGAS.every((f) => megaSpritePath(f.id) !== pokemonSpritePath(f.species) && megaSpritePath(f.id, "shiny") !== pokemonSpritePath(f.species, "shiny")), "a Mega never resolves to its base species' sprite");
assertEqual([megaSpritePath("mega-zygarde"), megaSpritePath("mega-magearna-original", true), megaSpritePath("mega-unknown")], [PLACEHOLDER_PATH, PLACEHOLDER_PATH, PLACEHOLDER_PATH], "missing Mega sprites resolve to the Poké Ball placeholder");
assertEqual(megaSpritePath("mega-charizard-x", true), "/public/sprites/pokemon/mega/shiny/mega-charizard-x.gif", "path is under /public/sprites/pokemon/mega/ (served by the existing /public static route)");

section("Species sprite manifest pinned");
const norm = (rel) => sha("sha256", fs.readFileSync(new URL(rel, import.meta.url), "utf8").replace(/\r\n/g, "\n"));
// Pinned after the community animation import (tools/import-animated-sprites.mjs) and the rig idle for the
// remaining static sprites (tools/generate-pokemon-idles.mjs); only those tools change it.
assertEqual(norm("../data/sprites/sprites.json"), "89034463c936f3bb1bad4fd1d0765431cb0a2a25be9e1f33e89e774c9fad1da6", "data/sprites/sprites.json unchanged since the animation import + rig idle build");

finish();
