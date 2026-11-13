// ==========================================================
// services/fightRecordsApi.js — Battle Records API (owner only)
//
//   GET /api/fight-records?id=<player>[&group=battles|challenges|encounters]
//       → { records: [lite record, newest first] }
//   GET /api/fight-records/:fightId?id=<player>
//       → { record: full record }   (404 unless the player is in it)
//
// A lite record drops each fight's turn log and HP snapshots (the
// replay's data), keeping everything the rows and the summary show.
// ==========================================================

import { FIGHT_GROUPS } from "../utils/fightRecords.js";

/** A record without its replay data, for the list. */
export function liteRecord(r) {
  return {
    ...r,
    fights: r.fights.map((f) => {
      if (!f.result) return f;
      const { log, snapshots, turnNotes, ...result } = f.result;
      return { ...f, result };
    }),
  };
}

export function createFightRecordHandlers({ store, isAuthorized }) {
  const authorized = (req, res) => {
    const { id } = req.query;
    if (!id) { res.status(400).json({ error: "Missing id" }); return null; }
    if (!isAuthorized(req, id)) { res.status(403).json({ error: "Invalid or expired session" }); return null; }
    return String(id);
  };

  return {
    async list(req, res) {
      const id = authorized(req, res);
      if (!id) return;
      const group = req.query.group || null;
      if (group && !FIGHT_GROUPS.includes(group)) return res.status(400).json({ error: "Unknown group" });
      try {
        const records = await store.list(id, { group });
        return res.json({ records: records.map(liteRecord) });
      } catch (err) {
        console.warn("⚠️ fight records list failed:", err?.message || err);
        return res.status(500).json({ error: "Couldn't load your Battle Records." });
      }
    },

    async get(req, res) {
      const id = authorized(req, res);
      if (!id) return;
      try {
        const record = await store.get(id, req.params.fightId);
        if (!record) return res.status(404).json({ error: "Fight record not found" });
        return res.json({ record });
      } catch (err) {
        console.warn("⚠️ fight record read failed:", err?.message || err);
        return res.status(500).json({ error: "Couldn't load that fight." });
      }
    },
  };
}
