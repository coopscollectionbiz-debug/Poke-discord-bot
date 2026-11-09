// ==========================================================
// tests/commandsDiff.test.js — slash-command registration dry run
// (tools/commands-diff.mjs). Offline: compares source definitions with a
// simulated "currently registered" set; nothing is sent to Discord.
// ==========================================================

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { assertTrue, assertEqual, section, finish } from "./harness.js";
import { loadSourceCommands, diffCommands, checkExpectations } from "../tools/commands-diff.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

section("Commands load without starting the bot");
{
  const importers = fs.readdirSync(path.join(root, "commands")).filter((f) => /from\s+["']\.\.\/bot_final(\.js)?["']/.test(fs.readFileSync(path.join(root, "commands", f), "utf8")));
  assertEqual(importers, [], "no command imports bot_final.js");
}

const quiet = { log: console.log, warn: console.warn };
console.log = console.warn = () => {};
const source = (await loadSourceCommands()).map((s) => s.json);
Object.assign(console, quiet);
const names = source.map((c) => c.name);

section("Source command set");
assertTrue(names.includes("inventory"), "/inventory is defined in source");
assertTrue(!names.includes("restoretrainers"), "/restoretrainers is retired from source");
assertEqual(new Set(names).size, names.length, "command names are unique");
assertTrue(source.length >= 25 && source.length <= 100, `${source.length} commands (within Discord's guild limit of 100)`);

// Simulated production registration: everything except /inventory, plus the
// retired /restoretrainers (registered before A1).
const restoretrainers = { name: "restoretrainers", type: 1, description: "Admin: restore trainers from the old backup", default_member_permissions: "8", options: [] };
const registered = source.filter((c) => c.name !== "inventory").map((c) => ({ ...c, id: "1", application_id: "2", version: "3" })).concat(restoretrainers);

section("Expected diff");
{
  const d = diffCommands(source, registered);
  assertEqual([d.added, d.removed, d.changed], [["inventory"], ["restoretrainers"], []], "adds /inventory, removes /restoretrainers, nothing else");
  assertEqual(checkExpectations(d, { expectAdd: ["inventory"], expectRemove: ["restoretrainers"] }), [], "matches the approved expectations");
}

section("Unexpected changes are caught");
{
  const extra = registered.concat({ name: "someothercommand", type: 1, description: "x", options: [] });
  const d1 = diffCommands(source, extra);
  assertTrue(checkExpectations(d1, { expectAdd: ["inventory"], expectRemove: ["restoretrainers"] }).some((p) => /removed/.test(p)), "an unexpected deletion blocks registration");

  const edited = registered.map((c) => (c.name === "daily" ? { ...c, description: "something else" } : c));
  const d2 = diffCommands(source, edited);
  assertEqual(d2.changed, ["daily"], "a changed definition is detected");
  assertTrue(checkExpectations(d2, { expectAdd: ["inventory"], expectRemove: ["restoretrainers"] }).length === 1, "…and blocks registration unless allowed");

  const perm = registered.map((c) => (c.name === "gift" ? { ...c, default_member_permissions: null } : c));
  assertEqual(diffCommands(source, perm).changed, ["gift"], "a permission change is detected");
  assertTrue(checkExpectations(diffCommands(source, source), {}).length === 0, "identical sets need no change");
}

finish();
process.exit(0);
