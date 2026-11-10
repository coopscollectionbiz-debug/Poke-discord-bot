// ==========================================================
// tests/dashboardFoundation.test.js
// Milestone D guards for the player dashboard (public/):
//   • the browser names copy matches utils/render/names.js and the
//     stored slugs in pokemonData.json; search matches both names
//   • every player page loads the shared tokens + shell, has no own
//     :root palette, no emoji nav buttons and no alert()/confirm()
//   • the shared type colors match utils/render/tokens.js
// Static checks only: no server, no browser, no bot import.
// ==========================================================

import fs from "fs";
import * as browserNames from "../public/shared/names.js";
import { DISPLAY_NAMES } from "../utils/render/names.js";
import { TYPE } from "../utils/render/tokens.js";

let testsRun = 0;
let testsPassed = 0;
let testsFailed = 0;

function assertTrue(cond, message) {
  if (cond) {
    console.log(`  ✅ ${message}`);
    testsPassed++;
  } else {
    console.error(`  ❌ ${message}`);
    testsFailed++;
  }
}
function assertEqual(actual, expected, message) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) console.error(`     Expected: ${JSON.stringify(expected)}\n     Actual:   ${JSON.stringify(actual)}`);
  assertTrue(ok, message);
}
function test(name, fn) {
  testsRun++;
  console.log(`\n🧪 ${name}`);
  try {
    fn();
  } catch (e) {
    console.error(`  ❌ threw: ${e?.stack || e}`);
    testsFailed++;
  }
}

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const pokemonData = JSON.parse(read("public/pokemonData.json"));

const PAGES = {
  pokemon: "public/picker-pokemon",
  trainers: "public/picker",
  shop: "public/dashboardshop",
  bag: "public/bag",
  achievements: "public/achievements",
};

test("browser names copy matches the server copy", () => {
  assertEqual({ ...browserNames.DISPLAY_NAMES }, { ...DISPLAY_NAMES }, "DISPLAY_NAMES identical in public/shared/names.js and utils/render/names.js");
  for (const [id, slug] of Object.entries(browserNames.STORED_SLUGS)) {
    assertTrue(pokemonData[id]?.name === slug, `stored slug for #${id} is "${slug}"`);
  }
  assertEqual(Object.keys(browserNames.STORED_SLUGS), Object.keys(DISPLAY_NAMES), "a stored slug for every display name");
});

test("display names are display-only; search matches both names", () => {
  assertEqual(browserNames.displaySpeciesName(122, "Mr-mime"), "Mr. Mime", "#122 shows as Mr. Mime");
  assertEqual(browserNames.displaySpeciesName(25, "Pikachu"), "Pikachu", "unmapped species keep their stored name");
  assertEqual(browserNames.displayNameFromStored("Nidoran-f"), "Nidoran♀", "stored slug maps to the display name");
  assertEqual(browserNames.displayNameFromStored("Bulbasaur"), "Bulbasaur", "other stored names pass through");
  assertTrue(browserNames.nameMatches("mr. m", 122, "Mr-mime"), "search by display name");
  assertTrue(browserNames.nameMatches("mr-mime", 122, "Mr-mime"), "search by stored name");
  assertTrue(!browserNames.nameMatches("pikachu", 122, "Mr-mime"), "non-matching search is rejected");
  assertTrue(browserNames.nameMatches("", 1, "Bulbasaur"), "empty search matches everything");
});

test("every player page uses the shared foundation", () => {
  for (const [key, dir] of Object.entries(PAGES)) {
    const html = read(`${dir}/index.html`);
    assertTrue(html.includes("/public/shared/tokens.css") && html.includes("/public/shared/components.css"), `${key}: loads tokens.css + components.css`);
    assertTrue(html.indexOf("/public/shared/tokens.css") < html.indexOf(`${dir.replace("public", "/public")}/style.css`) || !html.includes(`${dir.replace("public", "/public")}/style.css`), `${key}: shared CSS loads before the page CSS`);
    assertTrue(html.includes(`data-page="${key}"`), `${key}: <body data-page="${key}">`);
    assertTrue(html.indexOf("/public/shared/shell.js") > -1 && html.indexOf("/public/shared/shell.js") < html.lastIndexOf("script.js\""), `${key}: shell.js loads before the page script`);
    assertTrue(!/class="nav-tab/.test(html) && !/id="go(Pokemon|Trainers|Shop|Bag|Achievements)"/.test(html), `${key}: old emoji nav buttons removed`);
    assertTrue(!/<style[\s>]/.test(html), `${key}: no inline <style> palette`);

    const css = read(`${dir}/style.css`);
    assertTrue(!/:root\s*\{/.test(css), `${key}: style.css has no own :root palette`);
    assertTrue(!/#00ff9d/i.test(css), `${key}: no neon-green brand color left`);

    const js = read(`${dir}/script.js`);
    assertTrue(!/\balert\(|\bconfirm\(/.test(js), `${key}: no alert()/confirm()`);
    assertTrue(!/location\.href\s*=/.test(js), `${key}: navigation is real links, not location.href`);
  }
});

test("shared shell: nav targets and expiry message", () => {
  const shell = read("public/shared/shell.js");
  for (const dir of Object.values(PAGES)) assertTrue(shell.includes(`"/${dir}/"`), `nav links to /${dir}/`);
  assertTrue(shell.includes("Your dashboard link expired — run /dashboard in Discord."), "one expiry message");
  assertTrue(shell.includes('aria-current", "page"'), "current page marked with aria-current");
});

test("type colors match the Discord renderer", () => {
  const css = read("public/shared/tokens.css");
  for (const [name, { fill }] of Object.entries(TYPE)) {
    const m = new RegExp(`\\.cc-type\\[data-type="${name.toLowerCase()}"\\]\\s*\\{\\s*background:\\s*(#[0-9a-f]{6})`, "i").exec(css);
    assertEqual(m?.[1]?.toLowerCase(), fill.toLowerCase(), `${name} chip uses ${fill}`);
  }
});

console.log("\n" + "=".repeat(50));
console.log(`\n📊 Results: ${testsPassed} passed, ${testsFailed} failed, ${testsRun} total`);
if (testsFailed > 0) {
  console.log("\n❌ Some tests failed\n");
  process.exit(1);
} else {
  console.log("\n✅ All tests passed!\n");
  process.exit(0);
}
