// ==========================================================
// tools/import-animated-sprites.mjs — community animations for sprites that
// were static (and so got the PR #71 rig idle). Each one replaces the static
// normal + shiny with a reviewed animated pair, rebuilds the grayscale from
// the normal, and records where it came from and who to credit.
//
//   node tools/import-animated-sprites.mjs --from <export dir>
//        stage a reviewed export (<dir>/index.json + <dir>/{normal,shiny}/<key>.gif):
//        copies the GIFs into public/, writes data/sprites/animated-imports.json, then applies it
//   node tools/import-animated-sprites.mjs
//        re-apply data/sprites/animated-imports.json to sprites.json / megas.json (run after
//        import-sprites / import-mega-sprites, which rebuild those manifests from the audit)
//   node tools/import-animated-sprites.mjs --check
//        verify only: every listed GIF exists with its recorded SHA-1, the manifests point at it
//        as kind "animated", and the grayscale matches the normal (exit 1 if not)
//
// Then run tools/generate-pokemon-idles.mjs (the rig skips animated art) and
// tools/generate-credits.mjs (the credits page lists every imported animation).
//
// Rules
//   • normal and shiny always have the same size, frame count and frame delays, so a
//     shiny never falls out of step with its normal;
//   • GIFs are lossless (binary alpha, dispose 2) — the export already used
//     tools/lib/spriteCodec.mjs encodeGif; this tool never re-encodes the colour sprites;
//   • the grayscale ("not owned" cards) is rebuilt from the normal with BT.709 luma, as for
//     every other sprite;
//   • the record keeps the audited credit fields and gains origin "animated-import" plus the
//     animation's credit, licence/terms and shiny method.
// ==========================================================

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { gifFrames, encodeGif, toGrayscale } from "./lib/spriteCodec.mjs";

const ROOT = new URL("..", import.meta.url);
const P = (rel) => new URL(rel, ROOT);
const IMPORTS = P("data/sprites/animated-imports.json");
const SPECIES = P("data/sprites/sprites.json");
const MEGAS = P("data/sprites/megas.json");
const sha1 = (b) => crypto.createHash("sha1").update(b).digest("hex");
const sha256 = (b) => crypto.createHash("sha256").update(b).digest("hex");
const args = process.argv.slice(2);
const FROM = args.includes("--from") ? args[args.indexOf("--from") + 1] : null;
const CHECK = args.includes("--check");

const fileFor = (e, v) => e.target.startsWith("mega:") ? `public/sprites/pokemon/mega/${v}/${e.megaId}.gif` : `public/sprites/pokemon/${v}/${e.dex}.gif`;
const relFor = (e, v) => e.target.startsWith("mega:") ? `${v}/${e.megaId}.gif` : `${v}/${e.dex}.gif`;

// Short credit text for one import (also used by the credits page).
export function creditOf(e) {
  const base = (e.terms ?? "").match(/(?:original sprite|sprite|base sprite)s?\s*(?:by|:)\s*([A-Za-z0-9_.\- ]{2,40}?)(?:[.\n,(]|\s{2}|animated|$)/i)?.[1]?.trim();
  return { animator: e.author, baseSprite: base && base.toLowerCase() !== (e.author ?? "").toLowerCase() ? base : null, source: e.source, sourceUrl: e.sourceUrl, licence: e.licence, shiny: e.shinyMethod };
}

function stage(dir) {
  const index = JSON.parse(fs.readFileSync(path.join(dir, "index.json"), "utf8"));
  const excluded = fs.existsSync(path.join(dir, "excluded.json")) ? JSON.parse(fs.readFileSync(path.join(dir, "excluded.json"), "utf8")) : [];
  const entries = index.map((e) => {
    const key = e.target.replace(":", "_"), rec = {
      target: e.target, name: e.name, dex: e.dex, megaId: e.megaId, choice: e.choice,
      author: e.author, source: e.source, sourceUrl: e.sourceUrl, title: e.title,
      licence: /pok[eé]rogue/i.test(e.source ?? "") ? "CC BY-NC-SA 4.0 (PokéRogue assets; artists in PokéRogue CREDITS.md)"
        : /ghasty/i.test(e.source ?? "") ? "Free to use with credit (Ghasty001 and the base-sprite artists)"
        : /showdown|smogon/i.test(e.source ?? "") ? "Smogon sprite projects: non-profit use with credit"
        : "Artist's stated terms (below); owner confirmed permission on 2026-11-11",
      terms: (e.terms ?? "").replace(/\s+/g, " ").trim().slice(0, 400) || null,
      shinyMethod: e.shinyMethod, notes: e.notes, splitFrom: e.splitFrom, upscaleRemoved: e.upscaleRemoved,
      size: e.output.size, frames: e.output.frames, loopMs: e.output.loopMs,
      files: { normal: relFor(e, "normal"), shiny: relFor(e, "shiny"), grayscale: relFor(e, "grayscale") },
      sha1: { normal: e.output.normalSha1, shiny: e.output.shinySha1 },
      sourceSha1: { normal: e.sourceFiles.normalSha1, shiny: e.sourceFiles.shinySha1 },
    };
    for (const v of ["normal", "shiny"]) {
      const buf = fs.readFileSync(path.join(dir, v, `${key}.gif`));
      if (sha1(buf) !== rec.sha1[v]) throw new Error(`${e.target} ${v}: export file does not match its recorded SHA-1`);
      fs.mkdirSync(path.dirname(fileURLToPath(P(fileFor(e, v)))), { recursive: true });
      fs.writeFileSync(P(fileFor(e, v)), buf);
    }
    return rec;
  });
  const doc = {
    note: "Community animations replacing static (rig) sprites. Built by tools/import-animated-sprites.mjs --from <reviewed export>; re-apply with no flags after import-sprites / import-mega-sprites. Do not edit by hand.",
    reviewed: "2026-11-11: every animation and shiny checked against the bot's static normal/shiny; owner picks recorded in `choice`.",
    permission: "Owner statement 2026-11-11: \"We have permission for everything.\" Artists' own terms are kept per entry; all are credited on /credits.",
    excluded, entries,
  };
  fs.writeFileSync(IMPORTS, JSON.stringify(doc, null, 1) + "\n");
  return doc;
}

function apply(doc, check) {
  const species = JSON.parse(fs.readFileSync(SPECIES, "utf8")), megas = JSON.parse(fs.readFileSync(MEGAS, "utf8"));
  const problems = []; let changed = 0;
  for (const e of doc.entries) {
    const isMega = e.target.startsWith("mega:"), rec = isMega ? megas.forms[e.megaId] : species.species[String(e.dex)];
    if (!rec) { problems.push(`${e.target}: not in the manifest`); continue; }
    const bufs = {};
    for (const v of ["normal", "shiny"]) {
      const f = P(fileFor(e, v)); if (!fs.existsSync(f)) { problems.push(`${e.target} ${v}: missing ${fileFor(e, v)}`); continue; }
      bufs[v] = fs.readFileSync(f); if (sha1(bufs[v]) !== e.sha1[v]) problems.push(`${e.target} ${v}: SHA-1 differs from animated-imports.json`);
    }
    if (!bufs.normal || !bufs.shiny) continue;
    const N = gifFrames(bufs.normal), S = gifFrames(bufs.shiny);
    if (N.width !== S.width || N.height !== S.height || N.frames.length !== S.frames.length || N.frames.some((f, i) => f.delayMs !== S.frames[i].delayMs)) problems.push(`${e.target}: normal and shiny out of step`);
    if (N.frames.length < 2) problems.push(`${e.target}: not animated`);
    const gray = encodeGif(N.width, N.height, toGrayscale(N.frames)), grayFile = P(fileFor(e, "grayscale"));
    if (check) { if (!fs.existsSync(grayFile) || sha1(fs.readFileSync(grayFile)) !== sha1(gray)) problems.push(`${e.target}: grayscale stale`); }
    else fs.writeFileSync(grayFile, gray);
    const colours = (fr) => { const s = new Set(); for (const { rgba } of fr) for (let p = 0; p < rgba.length; p += 4) if (rgba[p + 3] >= 128) s.add((rgba[p] << 16) | (rgba[p + 1] << 8) | rgba[p + 2]); return s.size; };
    const variant = (v, buf, G) => {
      const r = { file: e.files[v], kind: "animated", frames: G.frames.length, size: `${G.width}x${G.height}`, fileSha1: sha1(buf),
        source: e.source, sourceUrl: e.sourceUrl, sourceSha1: e.sourceSha1[v], origin: "animated-import",
        transformed: [e.splitFrom ? "split from a two-Pokémon sheet" : null, e.upscaleRemoved ? `upscale ×${e.upscaleRemoved} removed` : null, "lossless re-encode", v === "shiny" ? e.shinyMethod : null].filter(Boolean).join("; ") };
      if (isMega) Object.assign(r, { colours: colours(G.frames), fileSha256: sha256(buf), firstFrameSha1: sha1(Buffer.from(G.frames[0].rgba)) });
      return r;
    };
    const next = { normal: variant("normal", bufs.normal, N), shiny: variant("shiny", bufs.shiny, S), grayscale: { file: e.files.grayscale, fileSha1: sha1(gray), ...(isMega ? { fileSha256: sha256(gray) } : {}) } };
    const c = creditOf(e), creditText = [`animation by ${c.animator}`, c.baseSprite ? `base sprite by ${c.baseSprite}` : null, c.source, c.licence, `shiny: ${c.shiny}`].filter(Boolean).join("; ");
    const animationCredit = { animator: c.animator, baseSprite: c.baseSprite, source: c.source, sourceUrl: c.sourceUrl, licence: c.licence, shiny: c.shiny };
    if (check) {
      for (const v of ["normal", "shiny"]) if (rec[v]?.kind !== "animated" || rec[v]?.origin !== "animated-import" || rec[v]?.fileSha1 !== next[v].fileSha1) problems.push(`${e.target} ${v}: manifest not applied`);
      if (rec.grayscale?.motion) problems.push(`${e.target}: grayscale still marked as rig`);
      continue;
    }
    Object.assign(rec, next, { animationCredit });
    if (isMega) rec.credit = `${rec.credit?.split("; animation by")[0] ?? ""}; ${creditText}`.replace(/^; /, "");
    changed++;
  }
  if (!check) { fs.writeFileSync(SPECIES, JSON.stringify(species, null, 1) + "\n"); fs.writeFileSync(MEGAS, JSON.stringify(megas, null, 1) + "\n"); }
  return { changed, problems };
}

const doc = FROM ? stage(FROM) : JSON.parse(fs.readFileSync(IMPORTS, "utf8"));
const { changed, problems } = apply(doc, CHECK);
for (const p of problems) console.log("  ✗", p);
console.log(`${CHECK ? "checked" : "applied"} ${doc.entries.length} animated imports${CHECK ? "" : ` (${changed} manifest records updated)`}; ${problems.length} problem(s); ${doc.excluded?.length ?? 0} excluded`);
if (problems.length) process.exit(1);
