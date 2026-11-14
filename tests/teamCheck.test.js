// ==========================================================
// tests/teamCheck.test.js — services/teamCheck.js (Teams page "Team check").
// Fixed teams with known type matchups. Synthetic players only.
// ==========================================================

import { assertTrue, assertEqual, section, finish } from "./harness.js";

const { teamCheck } = await import("../services/teamCheck.js");

// 445 Garchomp (Dragon/Ground), 149 Dragonite (Dragon/Flying), 373 Salamence (Dragon/Flying),
// 384 Rayquaza (Dragon/Flying), 6 Charizard (Fire/Flying), 395 Empoleon (Water/Steel).
const player = () => ({
  id: "600000000000000001", name: "Check Tester",
  pokemon: { 445: { normal: 1 }, 149: { normal: 1 }, 373: { normal: 1 }, 6: { normal: 1 }, 395: { normal: 1 } },
  training: { "445:normal": { exp: 30000 }, "149:normal": { exp: 300000 } },
  displayedPokemon: [], battleTeam: [],
});
const slots = (...ids) => ids.map((id) => ({ id, variant: "normal" }));

section("Shared weakness: three dragons");
let r = teamCheck(player(), { team: "battle", slots: slots(445, 149, 373) }, { env: {} });
assertTrue(r.ok, "builds");
const ice = r.check.weaknesses.find((w) => w.type === "Ice");
assertEqual([ice.weak, ice.resist, ice.immune], [3, 0, 0], "Ice: all three weak (Garchomp ×4, the flyers ×4)");
assertEqual(r.check.headline.type, "Ice", "headline names Ice");
assertEqual(r.check.headline.text, "3 of 3 are weak to Ice, and none resist it.", "headline sentence");
assertEqual(r.check.headline.tryTypes, ["Fire", "Water", "Ice"], "suggests up to three types that resist Ice");
const ground = r.check.weaknesses.find((w) => w.type === "Ground");
assertEqual(ground.immune, 2, "Ground: the two flyers are immune");
const elec = r.check.weaknesses.find((w) => w.type === "Electric");
assertEqual([elec.weak, elec.immune], [0, 1], "Electric: Dragon cancels Flying's weakness, Garchomp immune");

section("Adding a Steel type covers it");
r = teamCheck(player(), { team: "battle", slots: slots(445, 149, 373, 395) }, { env: {} });
const ice2 = r.check.weaknesses.find((w) => w.type === "Ice");
assertEqual([ice2.weak, ice2.resist], [3, 1], "Empoleon resists Ice");
assertEqual(r.check.headline.text, "3 of 4 are weak to Ice, and only 1 resists it.", "headline counts the cover");
assertTrue(!r.check.headline.tryTypes.includes("Steel") && !r.check.headline.tryTypes.includes("Water"), "doesn't suggest a type already on the team");

section("Ranked: speed at Lv 50, moves from the real Level");
r = teamCheck(player(), { team: "battle", slots: slots(445, 149) }, { env: {} });
assertEqual(r.check.level, 50, "Ranked check is at Lv 50");
assertEqual(r.check.speed.map((x) => x.name), ["Garchomp", "Dragonite"], "Garchomp (base 102) outspeeds Dragonite (80)");
assertEqual(r.check.speed[0].speed, 114, "Garchomp's Speed at Lv 50 is 114");
const casual = teamCheck(player(), { team: "display", slots: slots(445, 149) }, { env: {} });
assertEqual(casual.check.level, null, "Casual check uses real Levels");
assertTrue(casual.check.speed.find((x) => x.name === "Garchomp").speed < 114, "a Lv 30 Garchomp is slower at its real Level");
const mix = r.check.moves.mix;
assertTrue(mix.Physical + mix.Special + mix.Status > 0 && r.check.moves.types.length > 0, "moves are counted");

section("Only owned Pokémon; bad input refused");
r = teamCheck(player(), { team: "battle", slots: slots(445, 150) }, { env: {} });
assertEqual(r.check.size, 1, "an unowned Mewtwo is not counted");
assertEqual(teamCheck(player(), { team: "showcase", slots: [] }).ok, false, "Showcase never fights: refused");
assertEqual(teamCheck(player(), { team: "battle", slots: slots(1, 2, 3, 4, 5, 6, 7) }).ok, false, "more than 6 slots refused");
assertEqual(teamCheck(player(), { team: "battle", slots: [{ id: "x" }] }).ok, false, "bad id refused");
r = teamCheck(player(), { team: "battle", slots: [] }, { env: {} });
assertEqual([r.ok, r.check.size, r.check.headline], [true, 0, null], "an empty team has no headline");

finish();
