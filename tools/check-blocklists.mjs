// ==========================================================
// tools/check-blocklists.mjs — would common ad/tracker blockers stop our URLs?
//   node tools/check-blocklists.mjs <dir of filter lists .txt> [url …]
// Lists: easylist.txt, easyprivacy.txt (easylist.to) and uBlock Origin's
// filters.txt / privacy.txt (ublockorigin.github.io/uAssets/filters/).
// A simplified Adblock Plus matcher: network rules only (no ## cosmetics),
// `||` domain anchor, `|` start/end anchors, `^` separator, `*` wildcard,
// `/regex/` rules, `$domain=` and `$third-party` honoured as far as a
// same-site request needs, `@@` exceptions. Prints each blocked URL with the
// rule and list that blocks it. With no urls, checks the dashboard's TM URLs.
// ==========================================================
import fs from "fs";
import path from "path";

const SITE = "bot.coopscollection.com";
const dir = path.resolve(process.argv[2] ?? ".");
const urls = process.argv.slice(3).length ? process.argv.slice(3) : [
  "/api/tm-shop?id=1", "/api/shop/buy-tm", "/api/pokemon/tm-options?id=1", "/api/pokemon/teach-tm",
  "/public/dashboardshop/tms.js", "/public/shared/teachTm.js", "/public/shared/moveMeta.js", "/public/sprites/items/tm/fire.png",
].map((u) => `https://${SITE}${u}`);

const escapeRe = (s) => s.replace(/[.+?${}()|[\]\\]/g, "\\$&");
function compile(pattern) {
  if (pattern.length > 2 && pattern.startsWith("/") && pattern.endsWith("/")) {
    try { return new RegExp(pattern.slice(1, -1), "i"); } catch { return null; }
  }
  let re = "";
  let p = pattern;
  if (p.startsWith("||")) { re = "^[a-z-]+://([^/?#]*\\.)?"; p = p.slice(2); }
  else if (p.startsWith("|")) { re = "^"; p = p.slice(1); }
  let end = "";
  if (p.endsWith("|")) { end = "$"; p = p.slice(0, -1); }
  re += p.split("").map((c) => (c === "*" ? ".*" : c === "^" ? "(?:[^\\w.%-]|$)" : escapeRe(c))).join("") + end;
  try { return new RegExp(re, "i"); } catch { return null; }
}

// Whether a rule's options can apply to a same-site request from our pages.
function applies(opts) {
  if (!opts) return true;
  for (const o of opts.split(",")) {
    const [k, v = ""] = o.split("=");
    if (k === "third-party" || k === "3p") return false;
    if (k === "domain" || k === "from") {
      const doms = v.split("|");
      const inc = doms.filter((d) => !d.startsWith("~"));
      if (inc.length && !inc.some((d) => SITE === d || SITE.endsWith(`.${d}`))) return false;
      if (doms.some((d) => d.startsWith("~") && (SITE === d.slice(1) || SITE.endsWith(`.${d.slice(1)}`)))) return false;
    }
    if (["popup", "document", "doc", "csp", "redirect", "removeparam", "header", "permissions"].includes(k)) return false;
  }
  return true;
}

const rules = [];
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".txt"))) {
  for (const line of fs.readFileSync(path.join(dir, f), "utf8").split(/\r?\n/)) {
    const l = line.trim();
    if (!l || l.startsWith("!") || l.startsWith("[") || /#[@?$%]?#/.test(l)) continue;
    const exception = l.startsWith("@@");
    const body = exception ? l.slice(2) : l;
    const at = body.lastIndexOf("$");
    const [pat, opts] = at > 0 && !body.endsWith("/") ? [body.slice(0, at), body.slice(at + 1)] : [body, ""];
    if (!pat || pat.length < 3 || !applies(opts)) continue;
    const re = compile(pat);
    if (re) rules.push({ re, exception, raw: l, list: f });
  }
}
let blocked = 0;
for (const u of urls) {
  const hits = rules.filter((r) => !r.exception && r.re.test(u));
  const saved = rules.some((r) => r.exception && r.re.test(u));
  if (hits.length && !saved) {
    blocked++;
    console.log(`BLOCKED  ${u}\n         ${hits.slice(0, 3).map((h) => `${h.raw}  (${h.list})`).join("\n         ")}`);
  } else console.log(`ok       ${u}`);
}
process.exitCode = blocked ? 1 : 0;
