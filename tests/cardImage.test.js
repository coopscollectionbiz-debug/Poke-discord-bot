// ==========================================================
// tests/cardImage.test.js
// utils/render/stage.js cardImage: file names (fixed, or unique for cards
// that replace an earlier image) and the per-card timing log line.
// ==========================================================

import { assertEqual, assertTrue, section, finish } from "./harness.js";
import { cardImage } from "../utils/render/stage.js";
import { createRenderGate } from "../utils/render/renderGate.js";

const GIF = Buffer.concat([Buffer.from("GIF89a"), Buffer.alloc(2048)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(1024)]);
const render = (animate) => (animate ? GIF : PNG);

section("File names");
{
  const lines = [];
  const log = (l) => lines.push(l);
  const fixed = await cardImage(render, "team", { gate: createRenderGate(1), env: {}, log });
  assertEqual(fixed.name, "team.gif", "a card posted once keeps its plain name");
  const a = await cardImage(render, "pokedex", { gate: createRenderGate(1), env: {}, log, unique: true });
  const b = await cardImage(render, "pokedex", { gate: createRenderGate(1), env: {}, log, unique: true });
  assertTrue(/^pokedex-[a-z0-9]+\.gif$/.test(a.name), "a card that replaces an earlier image gets a suffix");
  assertTrue(a.name !== b.name, "each replacement has a new name, so a failed load can't stick");
  const still = await cardImage(render, "pokedex", { gate: createRenderGate(1), env: { CARDS_ANIMATED: "0" }, log, unique: true });
  assertTrue(/^pokedex-[a-z0-9]+\.png$/.test(still.name), "PNG cards get the suffix too");
}

section("Timing log");
{
  const lines = [];
  const log = (l) => lines.push(l);
  await cardImage(render, "battlecard", { gate: createRenderGate(1), env: {}, log });
  assertTrue(/^🖼️ card battlecard gif 2 KB \d+ ms$/.test(lines[0]), `one line per card: name, kind, KB, ms (${lines[0]})`);

  const full = createRenderGate(1);
  const hold = full.tryAcquire();
  await cardImage(render, "team", { gate: full, env: {}, log });
  assertTrue(/^🖼️ card team png 1 KB \d+ ms \(gate full\)$/.test(lines[1]), `a PNG sent because the gate was full says so (${lines[1]})`);
  hold();

  await cardImage(render, "team", { gate: createRenderGate(1), env: { CARDS_ANIMATED: "0" }, log });
  assertTrue(!lines[2].includes("gate full"), "a PNG because animation is off isn't blamed on the gate");
}

finish();
