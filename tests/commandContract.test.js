// ==========================================================
// tests/commandContract.test.js
// bot_final.js calls every command as
//   execute(interaction, trainerData, saveTrainerDataLocal, saveDataToDiscord,
//           lockUser, enqueueSave, client)
// Commands that declared `client` 5th received lockUser instead (D4), so
// e.g. /shop broadcasts silently failed. Parameter names must line up.
// ==========================================================

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { assertTrue, assertEqual, section, finish } from "./harness.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ORDER = ["interaction", "trainerData", "saveTrainerDataLocal", "saveDataToDiscord", "lockUser", "enqueueSave", "client"];
const ALIASES = { saveLocal: "saveTrainerDataLocal", saveDiscord: "saveDataToDiscord" };

const canonical = (name) => {
  const bare = name.replace(/^_+/, "");
  return ALIASES[bare] || bare;
};

function paramsOf(source) {
  const m = /async\s+execute\s*\(([^)]*)\)/.exec(source);
  if (!m) return null;
  return m[1]
    .replace(/\/\/[^\n]*/g, "")
    .split(",")
    .map((p) => p.trim().split("=")[0].trim())
    .filter(Boolean);
}

section("Dispatcher argument order");
const bot = fs.readFileSync(path.join(root, "bot_final.js"), "utf8");
const call = /command\.execute\(([\s\S]*?)\)/.exec(bot);
const passed = call[1].split(",").map((s) => s.trim()).filter(Boolean);
assertEqual(passed, ORDER, "bot_final.js passes the documented argument order");

section("Command signatures");
const files = fs.readdirSync(path.join(root, "commands")).filter((f) => f.endsWith(".js"));
let checked = 0;
for (const f of files) {
  const params = paramsOf(fs.readFileSync(path.join(root, "commands", f), "utf8"));
  if (!params) continue;
  checked++;
  const wrong = params
    .map((p, i) => ({ p, i, c: canonical(p) }))
    .filter(({ c, i }) => ORDER.includes(c) && ORDER.indexOf(c) !== i);
  assertEqual(wrong.map(({ p, i }) => `${p}@${i}`), [], `${f}: every known parameter is in its dispatcher position`);
}
assertTrue(checked >= 20, `checked ${checked} command files`);

finish();
