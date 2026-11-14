// ==========================================================
// tests/modulePreload.test.js — dashboard pages get modulepreload hints for
// every static import below their entry scripts (utils/modulePreload.js).
// ==========================================================

import path from "path";
import { fileURLToPath } from "url";
import { assertTrue, assertEqual, section, finish } from "./harness.js";

const { preloadList, withPreloads, modulePreloadPages } = await import("../utils/modulePreload.js");
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const fs = await import("fs");

section("The Teams page preloads its deep imports");
const teamsHtml = fs.readFileSync(path.join(root, "teams", "index.html"), "utf8");
const list = preloadList(root, teamsHtml);
for (const dep of ["/public/teams/moves.js", "/public/shared/teachTm.js", "/public/shared/moveMeta.js", "/public/picker-pokemon/copyChoice.js"]) {
  assertTrue(list.includes(dep), `lists ${dep}`);
}
assertTrue(!list.includes("/public/teams/script.js") && !list.includes("/public/shared/shell.js"), "entry scripts are not repeated");
assertEqual(new Set(list).size, list.length, "no duplicates");
const out = withPreloads(root, teamsHtml);
assertTrue(out.includes('<link rel="modulepreload" href="/public/shared/teachTm.js">'), "the hint is in the served HTML");
assertTrue(out.indexOf("modulepreload") < out.indexOf("</head>"), "hints sit inside <head>");

section("Every dashboard page that uses modules gets hints");
for (const dir of fs.readdirSync(root)) {
  const file = path.join(root, dir, "index.html");
  if (!fs.existsSync(file)) continue;
  const html = fs.readFileSync(file, "utf8");
  if (!/type="module"/.test(html)) continue;
  for (const dep of preloadList(root, html)) assertTrue(fs.existsSync(path.join(root, dep.replace(/^\/public\//, ""))), `${dir}: ${dep} exists`);
}

section("Middleware: pages only, everything else falls through");
const mw = modulePreloadPages(root);
const run = (p, method = "GET") => {
  const res = { headers: {}, body: null, type(t) { this.headers["content-type"] = t; return this; }, set(k, v) { this.headers[k] = v; return this; }, send(b) { this.body = b; } };
  let passed = false;
  mw({ method, path: p }, res, () => { passed = true; });
  return { res, passed };
};
for (const p of ["/teams/", "/teams", "/teams/index.html"]) {
  const r = run(p);
  assertTrue(!r.passed && r.res.body.includes("modulepreload") && r.res.headers["Cache-Control"] === "no-cache", `${p} is served with hints`);
}
for (const p of ["/pokemonData.json", "/teams/script.js", "/sprites/", "/nope/", "/../bot_final.js"]) assertTrue(run(p).passed, `${p} falls through`);
assertTrue(run("/teams/", "POST").passed, "POST falls through");

finish();
