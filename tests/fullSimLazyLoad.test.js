// ==========================================================
// tests/fullSimLazyLoad.test.js
// With FULL_SIM_ENABLED off, the bot never loads the full sim: Showdown's
// engine (@pkmn/sim, about 160 MB of memory) and data/battle/full-sim-data.json
// load only when a full-sim fight or full-sim data is needed (review
// finding C1). Imports every local module bot_final.js imports, plus
// every command, and watches what gets resolved and read.
// ==========================================================

import fs from "fs";
import { registerHooks } from "module";
import { assertEqual, section, finish } from "./harness.js";

const engineLoads = [];
registerHooks({
  resolve(specifier, context, next) {
    const r = next(specifier, context);
    if (r.url.includes("/@pkmn/sim/")) engineLoads.push(r.url);
    return r;
  },
});
const dataReads = [];
const readFileSync = fs.readFileSync;
fs.readFileSync = function (file, ...rest) {
  if (String(file).includes("full-sim-data.json")) dataReads.push(String(file));
  return readFileSync.call(this, file, ...rest);
};

delete process.env.FULL_SIM_ENABLED;
const root = new URL("../", import.meta.url);
const botImports = [...fs.readFileSync(new URL("bot_final.js", root), "utf8").matchAll(/^import [^;]*? from "(\.\/[^"]+)"/gms)].map((m) => m[1]);
const commands = fs.readdirSync(new URL("commands/", root)).filter((f) => f.endsWith(".js")).map((f) => `./commands/${f}`);

section("Switch off: the full sim never loads");
for (const path of [...new Set([...botImports, ...commands])]) await import(new URL(path, root));
assertEqual(engineLoads.length, 0, `importing ${botImports.length} bot modules and ${commands.length} commands loads no @pkmn/sim`);
assertEqual(dataReads.length, 0, "and never reads full-sim-data.json");

finish();
process.exit(0); // some command modules start timers
