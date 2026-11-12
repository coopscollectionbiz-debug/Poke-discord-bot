// ==========================================================
// tests/mutationGuard.test.js
// bot_final.js can't be imported in tests (it starts the bot), so this
// guard reads the source and fails if a fixed data-integrity bug pattern
// comes back. Each rule names the defect it protects against.
// ==========================================================

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { assertTrue, assertEqual, section, finish } from "./harness.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");

// Unused legacy modules (not imported by the bot); excluded until retired.
const LEGACY_UNUSED = new Set(["utils/trainerDataHelper.js", "utils/schemaMigration.js", "utils/schemaValidator.js"]);

function sourceFiles() {
  const out = ["bot_final.js"];
  for (const dir of ["commands", "utils", "utils/battle", "services", "persistence"]) {
    const abs = path.join(root, dir);
    if (!fs.existsSync(abs)) continue;
    for (const f of fs.readdirSync(abs)) if (f.endsWith(".js")) out.push(`${dir}/${f}`);
  }
  return out.filter((f) => !LEGACY_UNUSED.has(f));
}

const lines = [];
for (const f of sourceFiles()) {
  read(f).split(/\r?\n/).forEach((text, i) => lines.push({ f, n: i + 1, text }));
}
const where = (hits) => hits.map((h) => `${h.f}:${h.n}`);

section("D1: trainers are only changed through services/assets.js");
const trainerWrites = lines.filter(
  (l) => l.f !== "services/assets.js" && /\btrainers\s*\[[^\]]+\]\s*(=[^=]|\?\?=|\+\+|\+=)|delete\s+[\w.?]*trainers\s*\[|\btrainers\s*(=|\?\?=)\s*\{/.test(l.text)
);
assertEqual(where(trainerWrites), [], "no keyed writes into user.trainers");

section("D2: a user record is never replaced by a copy");
const replacements = lines.filter((l) => /\btrainerData\s*\[[^\]]+\]\s*=[^=]/.test(l.text));
const SAFE_RHS = [
  /=\s*normalizeUserSchema\(\s*(\w+)\s*,\s*(trainerData\[\s*\1\s*\]|user|u)\s*\)\s*;?\s*$/, // in-place normalizer on the live record
  /=\s*(user|u)\s*;?\s*$/, // the same live record
];
const ALLOWED_CREATE = new Set(["utils/userInitializer.js"]); // creates a NEW user only when missing
const unsafe = replacements.filter((l) => !ALLOWED_CREATE.has(l.f) && !SAFE_RHS.some((re) => re.test(l.text)));
assertEqual(where(unsafe), [], "every trainerData[id] = … keeps the live record");
assertTrue(!/\{\s*\.\.\.base\s*,\s*\.\.\.patch\s*\}/.test(read("bot_final.js")), "/api/updateUser no longer merges into a new object");
assertTrue(!/trainerData\[[^\]]+\]\s*(\?\?)?=\s*\{/.test(lines.map((l) => l.text).join("\n")), "no hand-built user objects");

section("D14: saves report whether they reached disk");
assertEqual(
  where(lines.filter((l) => /\batomicSave\(/.test(l.text) && !/export async function atomicSave/.test(l.text) && l.f !== "commands/adminsave.js")),
  [],
  "only /adminsave still uses atomicSave (it checks .ok); everything else uses saveAndAck"
);
// Allowed bare saves: no player-facing "success" depends on them.
const BARE_SAVE_OK = new Set([
  "bot_final.js#passive chat reward", // background drop; reward stays in memory and is retried
]);
const bare = lines.filter((l) => /^\s*await enqueueSave\(trainerData\)\s*;/.test(l.text));
const unexplained = bare.filter((l) => {
  if (l.f !== "bot_final.js") return true;
  const ctx = lines.filter((x) => x.f === l.f && x.n < l.n && x.n > l.n - 60).map((x) => x.text).join("\n");
  return !(BARE_SAVE_OK.has("bot_final.js#passive chat reward") && /Reward selection failed/.test(ctx));
});
assertEqual(where(unexplained), [], "no unacknowledged save in a player-facing path");

section("D6: weekly pack claims only after every await");
{
  // The handler lives in services/gameplay.js (runtime-tested in
  // tests/gameplayRoutes.test.js); the route in bot_final.js only delegates.
  const g = read("services/gameplay.js");
  const start = g.indexOf("async function weeklyPack(");
  const end = g.indexOf("\n  return {", start);
  const fn = g.slice(start, end);
  const load = fn.indexOf("await loadPokemonCached(");
  const tx = fn.indexOf("await runInventoryTransaction(");
  const mutate = fn.indexOf("mutate: (user) => {");
  const flag = fn.indexOf("weeklyPackClaimed = true");
  assertTrue(load > 0 && tx > load && mutate > tx && flag > mutate, "load → lock/transaction → flag (inside the synchronous mutate)");
  assertTrue(!/\bawait\b/.test(fn.slice(mutate, flag)), "no await between taking the lock and setting the claim flag");
  assertTrue(/gameplay\.weeklyPack\(/.test(read("bot_final.js")), "the bot_final route delegates to the handler");
}

section("D8: dashboard writes are refused until ready");
{
  const bot = read("bot_final.js");
  const gate = bot.indexOf('app.use("/api", (req, res, next)');
  const firstWrite = bot.search(/app\.(post|put|patch|delete)\("\/api\//);
  assertTrue(gate > 0 && gate < firstWrite, "the readiness gate is registered before every /api write route");
  assertTrue(/if \(!isReady\)[\s\S]{0,80}status\(503\)/.test(bot.slice(gate, gate + 600)), "it answers 503 while not ready");
  const nonApiWrites = bot.match(/app\.(post|put|patch|delete)\("(?!\/api\/)/g) || [];
  assertEqual(nonApiWrites.length, 0, "no write routes outside /api (they would bypass the gate)");
}

section("D17: no calls to undefined helpers");
assertEqual(where(lines.filter((l) => /\bpostRareSightings\s*\(/.test(l.text))), [], "postRareSightings is gone");

section("D11: no filters on the non-existent `generation` field");
assertEqual(where(lines.filter((l) => /\.generation\s*<=/.test(l.text))), [], "no p.generation filters");

section("Release B: inventory is only changed through services/inventory.js");
{
  const itemWrites = lines.filter(
    (l) =>
      l.f !== "services/inventory.js" &&
      /\.items\s*(\.[A-Za-z_$][\w$]*|\[[^\]]+\])\s*(\+\+|--|[-+*]?=(?!=)|\?\?=)/.test(l.text)
  );
  assertEqual(where(itemWrites), [], "no direct writes to user.items[...] (grantItem / consumeItem only)");
  const itemsReplaced = lines.filter((l) => l.f !== "services/inventory.js" && /\.items\s*(=|\?\?=)\s*\{/.test(l.text));
  assertEqual(where(itemsReplaced), [], "no code replaces user.items with a new object");
}

section("TM T0: Pokémon ownership is only lowered through services/ownership.js");
{
  // Removing copies anywhere else could destroy a TM-trained copy
  // (user.customPokemon) by picking "any copy" (docs/tm-system).
  const others = lines.filter((l) => l.f !== "services/ownership.js");
  const decrements = others.filter(
    (l) =>
      /\bpokemon\s*\[[^\]]+\]\s*(\.(normal|shiny)|\[[^\]]+\])\s*(-=|--)/.test(l.text) ||
      /\.(normal|shiny)\s*(-=|--)/.test(l.text) ||
      /\.(normal|shiny)\s*=(?!=)[^;]*\s-\s/.test(l.text)
  );
  assertEqual(where(decrements), [], "no direct decrements of Pokémon counts");
  // Every removal resets the Level when the last copy goes, so a removal
  // path written outside the service shows up as a resetLevelIfGone call
  // (catches "pokemon[id][v] = after" style decrements the patterns above miss).
  const levelResets = others.filter((l) => l.f !== "utils/training.js" && /resetLevelIfGone\s*\(/.test(l.text));
  assertEqual(where(levelResets), [], "resetLevelIfGone is only called by services/ownership.js");
  const deletes = others.filter((l) => /delete\s+[\w.?$[\]]*\bpokemon\s*\[/.test(l.text));
  assertEqual(where(deletes), [], "no direct deletes of user.pokemon entries");
  // The only allowed wholesale replacements repair a NON-object pokemon field.
  const replaced = others.filter((l) => /\.pokemon\s*=\s*\{\s*\}/.test(l.text)).map((l) => l.f);
  assertEqual(replaced, ["bot_final.js", "utils/userSchema.js"], "user.pokemon = {} only in the two non-object repairs");
  const customWrites = others.filter((l) => /\bcustomPokemon\s*(\[[^\]]+\]\s*)?(=(?!=)|\?\?=)|delete\s+[\w.?$]*customPokemon\b/.test(l.text));
  assertEqual(where(customWrites), [], "user.customPokemon is only written by services/ownership.js");
}

finish();
