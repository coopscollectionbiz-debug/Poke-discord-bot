// ==========================================================
// tests/statusTmDraft.test.js
// The drafted status TMs (catalog/statusTmDraft.js), awaiting owner
// sign-off: each is a real status move that helps a Battle plan, on the
// shop's existing price tiers, and none is sold yet.
// ==========================================================

import { assertEqual, assertTrue, section, finish } from "./harness.js";
import { STATUS_TM_DRAFT } from "../catalog/statusTmDraft.js";
import { TM_PRICE_BY_TIER } from "../catalog/tms.js";
import { moveRoles } from "../catalog/battlePlans.js";
import { Dex } from "@pkmn/sim";

section("Status TM draft");
const entries = Object.entries(STATUS_TM_DRAFT);
assertTrue(entries.length >= 15, `a full list to review (${entries.length} moves)`);
assertEqual(entries.filter(([id]) => Dex.moves.get(id).category !== "Status"), [], "every entry is a status move");
assertEqual(entries.filter(([, tier]) => !(tier in TM_PRICE_BY_TIER)), [], "every entry uses an existing price tier");
assertEqual(entries.filter(([id]) => !moveRoles(id).some((r) => r !== "attack")), [], "every entry helps some plan");
assertTrue(["trickroom", "thunderwave", "stealthrock", "swordsdance", "raindance"].every((id) => id in STATUS_TM_DRAFT), "the moves the plans lean on most are there");
finish();
