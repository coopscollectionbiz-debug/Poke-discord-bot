// ==========================================================
// services/inventoryApi.js — GET /api/inventory logic (Release B)
//
// Kept out of bot_final.js so it can be tested without starting the bot.
// Read-only: never mutates or creates a record, never returns the raw
// player object — only catalog-built display rows.
// ==========================================================

import { listInventory } from "./inventory.js";
import { CATEGORIES } from "../catalog/items.js";

const PUBLIC_FIELDS = ["id", "name", "description", "category", "categoryLabel", "rarity", "quantity", "status", "known", "usable", "usage", "icon"];

/** The JSON body for one player's bag. */
export function inventoryResponse(user, category = null) {
  const items = listInventory(user, { category }).map((r) => Object.fromEntries(PUBLIC_FIELDS.map((k) => [k, r[k]])));
  const categories = Object.entries(CATEGORIES)
    .sort((a, b) => a[1].order - b[1].order)
    .map(([key, c]) => ({ key, label: c.label, emoji: c.emoji }));
  return { items, categories };
}

/**
 * @param {object} args
 * @param {object} args.query - req.query
 * @param {(id:string) => boolean} args.isAuthorized - the dashboard session check for this id
 * @param {object} args.trainerData
 * @returns {{ status:number, body:object }}
 */
export function handleInventoryRequest({ query, isAuthorized, trainerData }) {
  const id = typeof query?.id === "string" ? query.id : "";
  if (!/^\d{5,25}$/.test(id)) return { status: 400, body: { success: false, error: "Missing or invalid id" } };
  if (!isAuthorized(id)) return { status: 403, body: { success: false, error: "Invalid or expired session" } };
  if (!Object.prototype.hasOwnProperty.call(trainerData, id)) return { status: 404, body: { success: false, error: "User not found" } };
  const rawCat = query?.category;
  if (rawCat != null && rawCat !== "" && (typeof rawCat !== "string" || !Object.prototype.hasOwnProperty.call(CATEGORIES, rawCat))) {
    return { status: 400, body: { success: false, error: "Unknown category" } };
  }
  return { status: 200, body: { success: true, ...inventoryResponse(trainerData[id], rawCat || null) } };
}
