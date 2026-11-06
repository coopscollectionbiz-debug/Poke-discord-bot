// ==========================================================
// tests/gift.test.js
// /gift moves normal copies only, so it must never send more normals
// than the sender has, whatever shiny copies they also own. Giving away
// the last normal also resets that Level.
// ==========================================================

import { giftPokemon } from "../commands/gift.js";

let failed = 0;
function check(condition, message) {
  console.log(`  ${condition ? "✅" : "❌"} ${message}`);
  if (!condition) failed++;
}

const owner = (normal, shiny) => ({ pokemon: { 25: { normal, shiny } } });
const copies = (...users) => users.reduce((t, u) => t + (u.pokemon[25]?.normal ?? 0) + (u.pokemon[25]?.shiny ?? 0), 0);

{
  const sender = owner(1, 3);
  const recipient = { pokemon: {} };
  const refusal = giftPokemon(sender, recipient, "25", "Pikachu", 3);
  check(refusal !== null, "3 normals with only 1 normal (and 3 shiny) is refused");
  check(JSON.stringify([sender.pokemon[25], recipient.pokemon[25]]) === JSON.stringify([{ normal: 1, shiny: 3 }, undefined]), "a refused gift moves nothing");
}

{
  const sender = owner(3, 0);
  const recipient = { pokemon: {} };
  check(giftPokemon(sender, recipient, "25", "Pikachu", 2) === null, "2 of 3 normals is allowed");
  check(sender.pokemon[25].normal === 1 && recipient.pokemon[25].normal === 2, "the copies move from sender to recipient");
}

{
  const sender = owner(1, 2);
  const recipient = { pokemon: {} };
  check(giftPokemon(sender, recipient, "25", "Pikachu", 1) === null, "the last normal can go while shinies remain");
  check(JSON.stringify(sender.pokemon[25]) === JSON.stringify({ normal: 0, shiny: 2 }), "the shinies stay with the sender");
}

{
  // Levels are per species + Variant, so the shiny Level stays with the shiny copies.
  const sender = { pokemon: { 25: { normal: 1, shiny: 1 } }, training: { "25:normal": { exp: 8000 }, "25:shiny": { exp: 27000 } } };
  giftPokemon(sender, { pokemon: {} }, "25", "Pikachu", 1);
  check(JSON.stringify(sender.training) === JSON.stringify({ "25:shiny": { exp: 27000 } }), "gifting the last normal resets its Level; the shiny keeps its Level");

  const keeper = { pokemon: { 25: { normal: 2, shiny: 0 } }, training: { "25:normal": { exp: 8000 } } };
  giftPokemon(keeper, { pokemon: {} }, "25", "Pikachu", 1);
  check(keeper.training["25:normal"]?.exp === 8000, "a sender with a normal left keeps its Level");
}

check(giftPokemon(owner(1, 0), { pokemon: {} }, "25", "Pikachu", 1)?.includes("last"), "the very last copy can't be gifted");
check(giftPokemon({ pokemon: {} }, { pokemon: {} }, "25", "Pikachu", 1) !== null, "a Pokémon the sender doesn't own is refused");

let conserved = true;
for (let normal = 0; normal <= 3; normal++) {
  for (let shiny = 0; shiny <= 3; shiny++) {
    for (let amount = 1; amount <= 4; amount++) {
      const sender = owner(normal, shiny);
      const recipient = owner(1, 0);
      const before = copies(sender, recipient);
      giftPokemon(sender, recipient, "25", "Pikachu", amount);
      if (copies(sender, recipient) !== before || sender.pokemon[25].normal < 0) conserved = false;
    }
  }
}
check(conserved, "no gift creates or destroys copies (every mix of 0-3 normal, 0-3 shiny, amount 1-4)");

console.log(failed ? `\n❌ ${failed} failed\n` : "\n✅ All tests passed!\n");
process.exit(failed ? 1 : 0);
