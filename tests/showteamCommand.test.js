// ==========================================================
// tests/showteamCommand.test.js
// The live /showteam command: component layout, who may do what, the
// one-at-a-time GIF gate and its PNG fallbacks, the Manage link, and the
// inspect card. Synthetic data only; no Discord connection.
// ==========================================================

import { assertEqual, assertTrue, section, finish } from "./harness.js";
import showteam, {
  renderTeamImage, buildShowteamComponents, routeShowteamInteraction, manageReply, LAYOUT, COLLECTOR_MS,
} from "../commands/showteam.js";
import { createRenderGate } from "../utils/render/renderGate.js";
import { buildTeamView } from "../utils/render/teamView.js";
import { renderInspectCard, INSPECT_SIZE } from "../utils/render/inspectCard.js";
import { validateToken } from "../utils/dashboardAuth.js";
import { FIXTURES } from "./fixtures/showteamFixtures.js";

const view = buildTeamView(FIXTURES.full.user, { displayName: "Coop" });
const ctx = { nonce: "abc123", ownerId: "111", ownerName: "Coop", slotCount: view.slots.length };

section("Command definition unchanged");
{
  const json = showteam.data.toJSON();
  assertEqual([json.name, json.description, (json.options ?? []).length], ["showteam", "Post your Trainer and Showcase team as an image.", 0], "same name, description, no options");
  assertEqual(json.default_member_permissions ?? null, null, "no permission gate (as before)");
  assertEqual(LAYOUT, "refined", "uses the approved refined layout");
  assertEqual(COLLECTOR_MS, 600_000, "controls expire after 10 minutes");
}

section("Components");
{
  const rows = buildShowteamComponents(view, { nonce: "abc123" }).map((r) => r.toJSON());
  const menu = rows[0].components[0], button = rows[1].components[0];
  assertEqual(menu.custom_id, "showteam:abc123:inspect", "inspect menu id is nonce-scoped");
  assertEqual(menu.options.map((o) => o.value), ["1", "2", "3", "4", "5", "6"], "one option per Team slot");
  assertEqual(menu.options[0].label, "1 · Charizard (Lv 62)", "option label: slot, name, Level");
  assertEqual(menu.options[1].label, "2 · Shiny Gengar (Lv 48)", "shiny named in the label");
  assertEqual(menu.options[0].description, "Fire / Flying · Legendary · Lead", "types, rarity and lead in the description");
  assertEqual([button.custom_id, button.label], ["showteam:abc123:manage", "Manage Team"], "manage button");
  const off = buildShowteamComponents(view, { nonce: "abc123", disabled: true }).map((r) => r.toJSON());
  assertTrue(off[0].components[0].disabled && off[1].components[0].disabled, "disabled when the collector ends");
  assertEqual(buildShowteamComponents(buildTeamView(FIXTURES.empty.user), { nonce: "x" }), [], "empty Team: no controls");
}

section("Routing and permissions");
{
  const route = (o) => routeShowteamInteraction(o, ctx);
  assertEqual(route({ customId: "showteam:abc123:inspect", userId: "999", values: ["3"] }), { action: "inspect", slot: 3 }, "anyone may inspect");
  assertEqual(route({ customId: "showteam:abc123:inspect", userId: "111", values: ["7"] }), null, "out-of-range slot ignored");
  assertEqual(route({ customId: "showteam:abc123:manage", userId: "111" }), { action: "manage" }, "owner may manage");
  const deny = route({ customId: "showteam:abc123:manage", userId: "999" });
  assertTrue(deny.action === "deny" && deny.reason.includes("Coop's Showcase team"), "others are told whose Showcase team it is");
  assertEqual(route({ customId: "showteam:zzz:manage", userId: "111" }), null, "another message's nonce is not ours");
  assertEqual(route({ customId: "inv:abc123:next", userId: "111" }), null, "other commands' ids ignored");
}

section("Manage link");
{
  const r = manageReply("111", "chan");
  const url = r.components[0].toJSON().components[0].url;
  const code = new URL(url).searchParams.get("code");
  assertTrue(url.includes("/auth/dashboard?id=111&code="), "the same /auth/dashboard flow as /dashboard");
  assertTrue(validateToken("111", code, "dashboard"), "a valid dashboard token for the owner");
  assertTrue((r.flags & 64) === 64, "ephemeral");
}

section("Image: GIF gate and fallbacks");
{
  const calls = [];
  const fake = async (_v, o) => { calls.push(o.animate ? "gif" : "png"); return Buffer.from(o.animate ? "GIF" : "PNG"); };
  const gate = createRenderGate(1);
  assertEqual((await renderTeamImage(view, { gate, env: {}, render: fake })).name, "team.gif", "free slot: animated");
  assertEqual(gate.active, 0, "slot released after rendering");
  const held = gate.tryAcquire();
  assertEqual((await renderTeamImage(view, { gate, env: {}, render: fake })).name, "team.png", "busy: PNG straight away");
  held();
  assertEqual((await renderTeamImage(view, { gate, env: { SHOWTEAM_ANIMATED: "0" }, render: fake })).name, "team.png", "SHOWTEAM_ANIMATED=0: PNG");
  const failing = async (_v, o) => { if (o.animate) throw new Error("boom"); return Buffer.from("PNG"); };
  const r = await renderTeamImage(view, { gate, env: {}, render: failing });
  assertTrue(r.name === "team.png" && gate.active === 0, "GIF failure falls back to PNG and frees the slot");
  const real = await renderTeamImage(view, { gate: createRenderGate(1), env: { SHOWTEAM_ANIMATED: "0" } });
  assertEqual([real.buffer.readUInt32BE(16), real.buffer.readUInt32BE(20)], [1200, 920], "real render: 1200×920 PNG");
}

section("Inspect card");
for (const slot of [view.slots[0], view.slots[1], buildTeamView(FIXTURES.stress.user).slots[2]]) {
  const png = await renderInspectCard(slot, { owner: "Coop" });
  assertEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [INSPECT_SIZE.w, INSPECT_SIZE.h], `${slot.name}: ${INSPECT_SIZE.w}×${INSPECT_SIZE.h}`);
}

finish();
