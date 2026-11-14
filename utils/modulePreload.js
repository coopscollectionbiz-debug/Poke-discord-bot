// ==========================================================
// utils/modulePreload.js — <link rel="modulepreload"> hints for the
// dashboard pages, added when the server sends a page.
//
// A page's entry scripts import modules that import more modules. Without
// hints the browser finds each level only after the level above it has
// downloaded: one round trip per level, which a phone feels on every page
// change. The hints list every static import below the entry scripts so
// they all start at once.
//
// Computed from the files when a page is first served (not written into
// the HTML), so a new import never leaves a page's list stale. Cached per
// file until it changes on disk.
// ==========================================================

import fs from "fs";
import path from "path";

// A top-level import statement starts its line (this codebase's style); a
// commented-out one ("// import …") or a dynamic import() does not match.
const STATIC_IMPORT = /^import\s+(?:[^"'`;]*?\sfrom\s+)?["'](\/public\/[^"']+\.js)["']/gm;
const ENTRY = /<script\s+type="module"\s+src="(\/public\/[^"]+\.js)"/g;

const fileOf = (root, url) => path.join(root, url.replace(/^\/public\//, ""));

/** Static /public imports of one module. `root` is the public/ directory. */
export function importsOf(root, url) {
  return [...fs.readFileSync(fileOf(root, url), "utf8").matchAll(STATIC_IMPORT)].map((m) => m[1]);
}

/** Every module a page loads below its entry scripts, in first-seen order. */
export function preloadList(root, html) {
  const entries = [...html.matchAll(ENTRY)].map((m) => m[1]);
  const seen = new Set(entries);
  const out = [];
  const queue = [...entries];
  while (queue.length) {
    const url = queue.shift();
    if (!fs.existsSync(fileOf(root, url))) continue;
    for (const dep of importsOf(root, url)) {
      if (seen.has(dep)) continue;
      seen.add(dep);
      out.push(dep);
      queue.push(dep);
    }
  }
  return out;
}

/** The page's HTML with the hints added right before </head>. */
export function withPreloads(root, html) {
  const list = preloadList(root, html);
  if (!list.length || !html.includes("</head>")) return html;
  const links = list.map((u) => `<link rel="modulepreload" href="${u}">`).join("");
  return html.replace("</head>", `${links}</head>`);
}

const cache = new Map(); // file → { mtimeMs, html }

/**
 * Express middleware: serves public/<page>/ and public/<page>/index.html
 * with the hints. Anything else (and a page without index.html) falls
 * through to express.static.
 */
export function modulePreloadPages(root) {
  return (req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    const m = /^\/([a-z0-9-]+)\/?(?:index\.html)?$/.exec(req.path);
    if (!m) return next();
    const file = path.join(root, m[1], "index.html");
    let stat;
    try { stat = fs.statSync(file); } catch { return next(); }
    let hit = cache.get(file);
    if (!hit || hit.mtimeMs !== stat.mtimeMs) {
      try { hit = { mtimeMs: stat.mtimeMs, html: withPreloads(root, fs.readFileSync(file, "utf8")) }; } catch { return next(); }
      cache.set(file, hit);
    }
    res.type("html");
    res.set("Cache-Control", "no-cache"); // pages always revalidate (ETag); the scripts they list are cached by the browser
    res.send(hit.html);
  };
}
