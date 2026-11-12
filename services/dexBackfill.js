// ==========================================================
// services/dexBackfill.js: the bot fills in each player's Pokédex from its
// own backup history (docs/adr/0001).
//
// After the first boot of the Pokédex release, the bot walks the Discord
// storage channel from newest to oldest, reads each trainerData backup it
// posted, and adds every species (and shiny) a player had in it to that
// player's Pokédex. Nothing else is taken from old backups. The Pokédex only
// grows, so this is safe while people play. Raw backups are never written
// to disk; a small state file records the cursor so a restart resumes, and
// the finished flag so it never runs twice.
//
// Pure core (runDexBackfill) + Discord adapter (persistence/discordBackups.js
// listBackupPage). tests/dexBackfill.test.js drives the core with fakes.
// ==========================================================

import fs from "fs";
import path from "path";
import { mergeDex } from "./box.js";
import { evaluate } from "../progression/achievements.js";
import { BY_METRIC } from "../catalog/achievements.js";

export const STATE_FILE = "pokedex-backfill-state.json";

/**
 * Species bits per player in one backup's user map:
 * { userId: { speciesId: 1 normal | 2 shiny | 3 both } }. Form keys
 * ("52:galar") never count; a legacy list-of-names `pokemon` is ignored.
 */
export function speciesMasksOf(data) {
  const out = {};
  for (const [uid, u] of Object.entries(data ?? {})) {
    if (!u || typeof u !== "object" || !/^\d{5,25}$/.test(uid)) continue;
    const masks = {};
    const add = (id, bits) => { const k = Number(id); if (Number.isInteger(k) && k > 0 && bits) masks[k] = (masks[k] ?? 0) | bits; };
    const p = u.pokemon;
    if (p && typeof p === "object" && !Array.isArray(p)) {
      for (const [id, e] of Object.entries(p)) {
        if (!/^\d+$/.test(id)) continue;
        add(id, ((Number(e?.normal) || 0) > 0 ? 1 : 0) | ((Number(e?.shiny) || 0) > 0 ? 2 : 0));
      }
    }
    for (const [id, m] of Object.entries(u.pokedex ?? {})) add(id, Number(m) & 3);
    if (Object.keys(masks).length) out[uid] = masks;
  }
  return out;
}

/** The user map inside a backup file's text (bare map or { data } wrapper). */
export function parseBackupText(text) {
  const parsed = JSON.parse(text);
  return parsed?.data && typeof parsed.data === "object" ? parsed.data : parsed;
}

// Achievement metrics that read the Pokédex (dexSpecies, dexRegion:Kanto, …).
const DEX_METRIC_KEYS = () => [...BY_METRIC.keys()].filter((k) => k.startsWith("state:dex"));

export function readState(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, STATE_FILE), "utf8")); } catch { return null; }
}

export function writeState(dir, state) {
  const file = path.join(dir, STATE_FILE);
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(state));
  fs.renameSync(`${file}.tmp`, file);
}

/**
 * Walk the backup history and merge it into live player records.
 *   listPage(beforeId|null) → { items: [{ id, at, url }] newest first, next: id to page
 *                             from, or null when the channel has no older messages }
 *   download(url)           → backup file text
 *   trainerData             → live user map (merged in place; only players that exist now)
 *   state                   → previous state ({ cursor, done, … }) or null
 *   saveState(state)        → persist progress
 *   onChanged()             → called after a backup changed someone (queue a save)
 *   shouldStop()            → true to stop early (shutdown); resumes next boot
 *   pauseMs                 → wait between backups (be gentle with the live bot)
 * @returns the final state
 */
export async function runDexBackfill({ listPage, download, trainerData, state = null, saveState = () => {}, onChanged = () => {}, shouldStop = () => false, pauseMs = 500, now = () => Date.now(), log = () => {}, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const st = { done: false, cursor: null, backups: 0, skipped: 0, added: 0, players: 0, unlocks: 0, startedAt: now(), ...(state ?? {}) };
  if (st.done) return st;
  const touched = new Set(st.touchedIds ?? []);
  const metricKeys = DEX_METRIC_KEYS();

  for (;;) {
    if (shouldStop()) break;
    const page = await listPage(st.cursor);
    for (const b of page.items) {
      if (shouldStop()) break;
      let masksByUser = null;
      try {
        masksByUser = speciesMasksOf(parseBackupText(await download(b.url)));
      } catch (err) {
        st.skipped++;
        log(`skip backup ${b.id}: ${err?.message || err}`);
      }
      let changed = false;
      for (const [uid, masks] of Object.entries(masksByUser ?? {})) {
        const user = trainerData[uid];
        if (!user || typeof user !== "object") continue; // only players that exist now
        const n = mergeDex(user, masks);
        if (!n) continue;
        st.added += n;
        touched.add(uid);
        changed = true;
        st.unlocks += evaluate(user, metricKeys, now()).length;
      }
      if (masksByUser) st.backups++;
      st.cursor = b.id;
      st.players = touched.size;
      st.touchedIds = [...touched];
      if (changed) onChanged();
      saveState({ ...st });
      if (pauseMs) await sleep(pauseMs);
    }
    if (shouldStop()) break;
    // A page with no backups on it still moves the cursor on.
    if (!page.next) { st.done = true; st.finishedAt = now(); break; }
    st.cursor = page.next;
    saveState({ ...st });
  }
  const final = { ...st };
  if (final.done) delete final.touchedIds; // keep the finished file small
  saveState(final);
  return final;
}
