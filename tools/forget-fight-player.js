// ==========================================================
// tools/forget-fight-player.js — remove a player from Battle Records.
//
//   TRAINERDATA_DIR=/srv/pokebot/data node tools/forget-fight-player.js <discordUserId> [--yes]
//
// Deletes the player's own Fight records, and in records they share with
// another player replaces their id and name with "Former trainer" (the
// opponent keeps the replay). Without --yes it only counts what it would
// change. Stop the bot first (sudo systemctl stop pokebot): the running
// bot keeps its own index of the file and would write over the change.
// ==========================================================

import { createFightStore } from "../utils/fightRecords.js";

const [who, flag] = process.argv.slice(2);
if (!who || !/^\d{5,25}$/.test(who)) {
  console.error("Usage: node tools/forget-fight-player.js <discordUserId> [--yes]");
  process.exit(2);
}
const store = createFightStore();
console.log(`Store: ${store.path()}`);
const theirs = await store.list(who);
const shared = theirs.filter((r) => r.players.length > 1).length;
console.log(`${who}: ${theirs.length} records in their history (${shared} shared with another player).`);
if (flag !== "--yes") {
  console.log("Dry run. Add --yes to remove them.");
  process.exit(0);
}
const res = await store.forgetPlayer(who);
console.log(`Done: ${res.removed} removed, ${res.anonymised} anonymised.`);
