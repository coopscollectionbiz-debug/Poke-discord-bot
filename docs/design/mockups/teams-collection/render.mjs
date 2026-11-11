// Renders the Teams / Collection mockups to docs/design/previews/redesign-*.png
// with headless Edge/Chrome (no server: the mockups open from file://).
//   node docs/design/mockups/teams-collection/render.mjs [filter]
// BROWSER=<path to msedge/chrome> overrides the default Edge path.
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../../../..");
const out = path.join(repo, "docs/design/previews");
const browser = process.env.BROWSER || "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const { createCanvas, loadImage } = await import(pathToFileURL(path.join(repo, "node_modules/@napi-rs/canvas/index.js")).href);

// [output name, page, query, "desktop"|"phone", height]
export const SHOTS = [
  ["teams-a-desktop", "teams-a.html", "", "desktop", 1500],
  ["teams-a-phone", "teams-a.html", "", "phone", 2300],
  ["teams-a-add-desktop", "teams-a.html", "state=add", "desktop", 1150],
  ["teams-a-empty-phone", "teams-a.html", "state=empty", "phone", 1100],
  ["teams-b-desktop", "teams-b.html", "", "desktop", 1300],
  ["teams-b-phone", "teams-b.html", "", "phone", 1400],
  ["teams-b-add-phone", "teams-b.html", "state=add", "phone", 844],
  ["teams-b-empty-phone", "teams-b.html", "state=empty", "phone", 844],
  ["teams-c-desktop", "teams-c.html", "", "desktop", 1700],
  ["teams-c-phone", "teams-c.html", "", "phone", 1500],
  ["teams-c-add-desktop", "teams-c.html", "state=add", "desktop", 1700],
  ["teams-c-empty-phone", "teams-c.html", "state=empty", "phone", 1000],
  ["collection-a-desktop", "collection-a.html", "", "desktop", 1200],
  ["collection-a-phone", "collection-a.html", "", "phone", 1500],
  ["collection-a-sheet-phone", "collection-a.html", "state=detail", "phone", 844],
  ["collection-b-desktop", "collection-b.html", "", "desktop", 1200],
  ["collection-b-phone", "collection-b.html", "", "phone", 1500],
  ["overview-desktop", "overview.html", "", "desktop", 1100],
  ["overview-phone", "overview.html", "", "phone", 1560],
  ["achievements-desktop", "achievements.html", "", "desktop", 1000],
  ["achievements-phone", "achievements.html", "", "phone", 1400],
];

const filter = process.argv[2];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cc-mock-"));
for (const [name, page, query, kind, h] of SHOTS) {
  if (filter && !name.includes(filter)) continue;
  const pageUrl = pathToFileURL(path.join(here, page)).href + (query ? `?${query}` : "");
  const phone = kind === "phone";
  const url = phone
    ? `${pathToFileURL(path.join(here, "frame.html")).href}?src=${encodeURIComponent(path.basename(page) + (query ? `?${query}` : ""))}&w=390&h=${h}`
    : pageUrl;
  const raw = path.join(tmp, `${name}.png`);
  execFileSync(browser, [
    "--headless=new", "--disable-gpu", "--hide-scrollbars", "--allow-file-access-from-files",
    `--user-data-dir=${path.join(tmp, "profile")}`, "--virtual-time-budget=6000",
    `--window-size=${phone ? 600 : 1280},${h}`, `--screenshot=${raw}`, url,
  ], { stdio: "ignore" });
  const img = await loadImage(fs.readFileSync(raw));
  const w = phone ? 390 : 1280;
  const c = createCanvas(w, h);
  c.getContext("2d").drawImage(img, 0, 0);
  fs.writeFileSync(path.join(out, `redesign-${name}.png`), c.toBuffer("image/png"));
  console.log(`redesign-${name}.png`);
}
fs.rmSync(tmp, { recursive: true, force: true });
