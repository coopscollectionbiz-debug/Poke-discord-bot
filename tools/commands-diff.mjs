#!/usr/bin/env node
// ==========================================================
// tools/commands-diff.mjs — slash-command registration dry run
//
// The bot registers commands with ONE guild-scoped bulk overwrite
// (bot_final.js registerCommands: PUT applicationGuildCommands(CLIENT_ID,
// GUILD_ID) with every commands/*.js definition) when REGISTER_COMMANDS
// is "true" at boot. A bulk PUT deletes any guild command not in source,
// so diff before registering.
//
// Usage (never prints the token):
//   node tools/commands-diff.mjs --list
//   node tools/commands-diff.mjs --registered saved.json [--expect-add inventory] [--expect-remove restoretrainers]
//   BOT_TOKEN=… CLIENT_ID=… GUILD_ID=… node tools/commands-diff.mjs --fetch [--save-registered before.json] [--expect-…]
//        (read-only GET of the guild's registered commands; also lists global ones)
//   BOT_TOKEN=… CLIENT_ID=… GUILD_ID=… node tools/commands-diff.mjs --fetch --register-source --expect-add … --expect-remove … --confirm-guild <GUILD_ID>
//        (REGISTRATION: diffs against the live set first and refuses unless the
//         diff matches the expectations exactly, then does the bot's bulk PUT)
//   BOT_TOKEN=… CLIENT_ID=… GUILD_ID=… node tools/commands-diff.mjs --put-from before.json --confirm-guild <GUILD_ID>
//        (ROLLBACK ONLY: re-registers a saved set. Requires the guild id twice.)
//
// Exit codes: 0 = diff matches expectations; 3 = unexpected add/remove/change;
// 2 = usage/fetch error.
// ==========================================================

import fs from "fs/promises";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Every command definition in commands/*.js, as Discord JSON, sorted by name. */
export async function loadSourceCommands(dir = path.join(root, "commands")) {
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".js")).sort();
  const out = [];
  for (const f of files) {
    const mod = await import(pathToFileURL(path.join(dir, f)).href);
    const cmd = mod.default || mod;
    if (!cmd?.data?.name || typeof cmd.execute !== "function") continue; // same rule as loadLocalCommands
    out.push({ file: f, json: cmd.data.toJSON() });
  }
  return out.sort((a, b) => a.json.name.localeCompare(b.json.name));
}

// Fields that matter for registration (Discord adds ids/versions/etc.).
function canonical(c) {
  const opt = (o) => ({
    type: o.type,
    name: o.name,
    description: o.description ?? "",
    required: !!o.required,
    choices: (o.choices || []).map((ch) => ({ name: ch.name, value: ch.value })),
    options: (o.options || []).map(opt),
    min_value: o.min_value ?? null,
    max_value: o.max_value ?? null,
    autocomplete: !!o.autocomplete,
  });
  return {
    name: c.name,
    type: c.type ?? 1,
    description: c.description ?? "",
    default_member_permissions: c.default_member_permissions ?? null,
    options: (c.options || []).map(opt),
  };
}

/** Compare source definitions with registered ones. */
export function diffCommands(source, registered) {
  const src = new Map(source.map((c) => [c.name, canonical(c)]));
  const reg = new Map(registered.map((c) => [c.name, canonical(c)]));
  const added = [...src.keys()].filter((n) => !reg.has(n)).sort();
  const removed = [...reg.keys()].filter((n) => !src.has(n)).sort();
  const changed = [...src.keys()].filter((n) => reg.has(n) && JSON.stringify(src.get(n)) !== JSON.stringify(reg.get(n))).sort();
  const unchanged = [...src.keys()].filter((n) => reg.has(n) && !changed.includes(n)).sort();
  return { added, removed, changed, unchanged };
}

/** Pass only if additions/removals are exactly the expected ones and nothing else changed. */
export function checkExpectations(diff, { expectAdd = [], expectRemove = [], allowChanged = [] } = {}) {
  const problems = [];
  const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
  if (!same(diff.added, expectAdd)) problems.push(`added ${JSON.stringify(diff.added)} ≠ expected ${JSON.stringify(expectAdd)}`);
  if (!same(diff.removed, expectRemove)) problems.push(`removed ${JSON.stringify(diff.removed)} ≠ expected ${JSON.stringify(expectRemove)}`);
  const unexpectedChanged = diff.changed.filter((n) => !allowChanged.includes(n));
  if (unexpectedChanged.length) problems.push(`changed definitions: ${JSON.stringify(unexpectedChanged)}`);
  return problems;
}

async function discord(method, route, body) {
  const { BOT_TOKEN } = process.env;
  const res = await fetch(`https://discord.com/api/v10${route}`, {
    method,
    headers: { Authorization: `Bot ${BOT_TOKEN}`, "Content-Type": "application/json", "User-Agent": "DiscordBot (commands-diff, 1.0)" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${route.replace(/\d{6,}/g, "<id>")} → HTTP ${res.status}`);
  return res.json();
}

function args(argv) {
  const a = { expectAdd: [], expectRemove: [], allowChanged: [] };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    const v = () => argv[++i];
    if (k === "--list") a.list = true;
    else if (k === "--fetch") a.fetch = true;
    else if (k === "--registered") a.registered = v();
    else if (k === "--save-registered") a.saveRegistered = v();
    else if (k === "--expect-add") a.expectAdd.push(v());
    else if (k === "--expect-remove") a.expectRemove.push(v());
    else if (k === "--allow-changed") a.allowChanged.push(v());
    else if (k === "--put-from") a.putFrom = v();
    else if (k === "--register-source") a.registerSource = true;
    else if (k === "--confirm-guild") a.confirmGuild = v();
    else throw new Error(`unknown argument ${k}`);
  }
  return a;
}

async function main() {
  const a = args(process.argv);
  const source = await loadSourceCommands();

  if (a.list) {
    console.log(`${source.length} commands in source (guild-scoped bulk registration):`);
    for (const { file, json } of source) console.log(`  /${json.name}  (${file})${json.default_member_permissions ? "  [admin]" : ""}`);
    return 0;
  }

  if (a.putFrom) {
    const { CLIENT_ID, GUILD_ID, BOT_TOKEN } = process.env;
    if (!BOT_TOKEN || !CLIENT_ID || !GUILD_ID) throw new Error("BOT_TOKEN, CLIENT_ID and GUILD_ID are required");
    if (a.confirmGuild !== GUILD_ID) throw new Error("--confirm-guild must equal GUILD_ID");
    const saved = JSON.parse(await fs.readFile(a.putFrom, "utf8"));
    const body = saved.map(({ name, type, description, options, default_member_permissions, dm_permission, nsfw }) => ({ name, type, description, options, default_member_permissions, dm_permission, nsfw }));
    await discord("PUT", `/applications/${CLIENT_ID}/guilds/${GUILD_ID}/commands`, body);
    console.log(`Re-registered ${body.length} guild commands from ${path.basename(a.putFrom)}.`);
    return 0;
  }

  let registered;
  if (a.fetch) {
    const { CLIENT_ID, GUILD_ID, BOT_TOKEN } = process.env;
    if (!BOT_TOKEN || !CLIENT_ID || !GUILD_ID) throw new Error("BOT_TOKEN, CLIENT_ID and GUILD_ID are required for --fetch");
    registered = await discord("GET", `/applications/${CLIENT_ID}/guilds/${GUILD_ID}/commands`);
    const global = await discord("GET", `/applications/${CLIENT_ID}/commands`);
    console.log(`Global commands (not touched by guild registration): ${global.length ? global.map((c) => "/" + c.name).join(", ") : "none"}`);
    if (a.saveRegistered) {
      await fs.writeFile(a.saveRegistered, JSON.stringify(registered, null, 2));
      console.log(`Saved the current guild registration (${registered.length} commands) to ${path.basename(a.saveRegistered)} for rollback.`);
    }
  } else if (a.registered) {
    registered = JSON.parse(await fs.readFile(a.registered, "utf8"));
  } else {
    throw new Error("use --list, --fetch or --registered <file>");
  }

  const diff = diffCommands(source.map((s) => s.json), registered);
  console.log(`Source: ${source.length} · Registered (guild): ${registered.length}`);
  console.log(`  + add:     ${diff.added.map((n) => "/" + n).join(", ") || "none"}`);
  console.log(`  - remove:  ${diff.removed.map((n) => "/" + n).join(", ") || "none"}`);
  console.log(`  ~ changed: ${diff.changed.map((n) => "/" + n).join(", ") || "none"}`);
  console.log(`  = same:    ${diff.unchanged.length}`);
  const problems = checkExpectations(diff, a);
  if (problems.length) {
    console.log(`\n⛔ NOT SAFE to register as-is:\n  - ${problems.join("\n  - ")}`);
    return 3;
  }
  console.log("\n✅ Registration diff matches expectations.");

  if (a.registerSource) {
    const { CLIENT_ID, GUILD_ID } = process.env;
    if (!a.fetch) throw new Error("--register-source requires --fetch (diff against the live registration first)");
    if (a.confirmGuild !== GUILD_ID) throw new Error("--confirm-guild must equal GUILD_ID");
    const body = source.map((x) => x.json);
    await discord("PUT", `/applications/${CLIENT_ID}/guilds/${GUILD_ID}/commands`, body);
    console.log(`Registered ${body.length} guild commands from source.`);
  }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
    .then((code) => process.exit(code))
    .catch((e) => {
      console.error(`commands-diff: ${e.message}`);
      process.exit(2);
    });
}
