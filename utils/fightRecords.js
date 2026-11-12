// ==========================================================
// utils/fightRecords.js — the Fight record store (Battle Records)
// ==========================================================
//
// One append-only NDJSON file, fight-records.ndjson, next to
// events.ndjson in TRAINERDATA_DIR. It is not game state: it is not in
// trainerData and not in the Discord backups (docs/design/battle-records.md).
// Losing it loses history, never anything a player owns.
//
// Each line is one Fight record (utils/fightRecordBuild.js). A Battle is
// stored once and indexed under both players. Each player keeps their
// newest KEEP_PER_GROUP records per group (battles, challenges,
// encounters). A record is dead once no player still has it in their
// lists. Dead lines stay in the file until a compaction rewrites it
// (tmp file + rename) without them.
//
// The index (id → byte offset and length, players, group) lives in
// memory. Records are read from the file by offset when a page asks.
// Every operation runs through one queue, so a read never sees offsets
// from a file that a compaction is replacing.
//
// Nothing here throws to a fight: add() catches and warns, like logEvent.
// ==========================================================

import fs from "fs/promises";
import path from "path";
import { randomBytes } from "crypto";
import { atomicWrite } from "./atomicWrite.js";

export const KEEP_PER_GROUP = 50;
export const FIGHT_GROUPS = Object.freeze(["battles", "challenges", "encounters"]);
export const FORMER_TRAINER = "Former trainer";

const FILE = "fight-records.ndjson";

/** A new record id: short, unguessable, safe in a URL fragment. */
export const newFightId = () => `f_${randomBytes(9).toString("base64url")}`;

/**
 * @param {object} [opts]
 * @param {() => string} [opts.dir]  directory (default TRAINERDATA_DIR or ".")
 * @param {number} [opts.keep]        records kept per player per group
 */
export function createFightStore({ dir = () => process.env.TRAINERDATA_DIR || ".", keep = KEEP_PER_GROUP } = {}) {
  const file = () => path.join(dir(), FILE);
  let index = new Map(); // id -> { id, at, group, players, offset, length }
  let lists = new Map(); // playerId -> { battles: [ids oldest→newest], ... }
  let size = 0; // bytes in the file
  let dead = 0; // dead lines still in the file
  let torn = false; // the file doesn't end in a newline (a write cut short)
  let loaded = false;
  let queue = Promise.resolve();

  const run = (fn) => {
    const p = queue.then(fn);
    queue = p.catch(() => {});
    return p;
  };

  const listOf = (playerId) => {
    let l = lists.get(playerId);
    if (!l) {
      l = Object.fromEntries(FIGHT_GROUPS.map((g) => [g, []]));
      lists.set(playerId, l);
    }
    return l;
  };
  const isLive = (id) => {
    const meta = index.get(id);
    return !!meta && meta.players.some((p) => lists.get(p)?.[meta.group]?.includes(id));
  };

  // Files a record under each of its players; returns ids that fell out of a list.
  function fileUnder(meta) {
    index.set(meta.id, meta);
    const dropped = [];
    for (const p of meta.players) {
      const l = listOf(p)[meta.group];
      l.push(meta.id);
      while (l.length > keep) dropped.push(l.shift());
    }
    return dropped;
  }

  // Reads the whole file into the index. Lines that don't parse are dead.
  async function load() {
    if (loaded) return;
    index = new Map();
    lists = new Map();
    size = 0;
    dead = 0;
    let buf;
    try {
      buf = await fs.readFile(file());
    } catch (err) {
      if (err?.code !== "ENOENT") throw err;
      buf = Buffer.alloc(0);
    }
    let start = 0;
    while (start < buf.length) {
      let end = buf.indexOf(10, start);
      if (end === -1) end = buf.length;
      const length = end - start;
      if (length > 0) {
        let rec = null;
        try { rec = JSON.parse(buf.toString("utf8", start, end)); } catch { /* a torn last line */ }
        if (rec?.id && FIGHT_GROUPS.includes(rec.group) && Array.isArray(rec.players)) {
          fileUnder({ id: rec.id, at: rec.at, group: rec.group, players: rec.players, offset: start, length });
        } else dead++;
      }
      start = end + 1;
    }
    size = buf.length;
    torn = size > 0 && buf[size - 1] !== 10;
    for (const id of [...index.keys()]) if (!isLive(id)) { index.delete(id); dead++; }
    loaded = true;
  }

  async function readRecords(metas) {
    if (!metas.length) return [];
    const fh = await fs.open(file(), "r");
    try {
      const out = [];
      for (const m of metas) {
        const b = Buffer.alloc(m.length);
        await fh.read(b, 0, m.length, m.offset);
        try { out.push(JSON.parse(b.toString("utf8"))); } catch { /* skip */ }
      }
      return out;
    } finally {
      await fh.close();
    }
  }

  // Rewrites the file with the live records only, each passed through
  // `transform` (null drops it), then rebuilds the index from the new file.
  async function compact(transform = (r) => r) {
    const live = [...index.values()].filter((m) => isLive(m.id)).sort((a, b) => a.offset - b.offset);
    const records = (await readRecords(live)).map(transform).filter(Boolean);
    await atomicWrite(file(), records.map((r) => `${JSON.stringify(r)}\n`).join(""));
    loaded = false;
    await load();
  }

  async function addNow(record) {
    await load();
    // After a torn write, start on a fresh line so the torn one stays alone (and dead).
    const lead = torn ? "\n" : "";
    const json = JSON.stringify(record);
    await fs.appendFile(file(), `${lead}${json}\n`, "utf8");
    const length = Buffer.byteLength(json);
    const meta = { id: record.id, at: record.at, group: record.group, players: record.players, offset: size + lead.length, length };
    size += lead.length + length + 1;
    torn = false;
    for (const id of fileUnder(meta)) {
      if (!isLive(id) && index.delete(id)) dead++;
    }
    if (dead > Math.max(200, index.size)) await compact();
  }

  return {
    /** Stores a finished fight. Never throws; resolves true when written. */
    add(record) {
      if (!record?.id || !FIGHT_GROUPS.includes(record.group) || !Array.isArray(record.players)) {
        console.warn("⚠️ fight record skipped: malformed");
        return Promise.resolve(false);
      }
      return run(() => addNow(record)).then(() => true, (err) => {
        console.warn("⚠️ fight record write failed:", err?.message || err);
        loaded = false; // re-read the file on the next call
        return false;
      });
    },

    /** A player's records, newest first; `group` filters to one group. */
    list(playerId, { group = null } = {}) {
      return run(async () => {
        await load();
        const l = lists.get(String(playerId));
        if (!l) return [];
        const groups = group ? [group] : FIGHT_GROUPS;
        const metas = groups.flatMap((g) => l[g] ?? []).map((id) => index.get(id)).filter(Boolean);
        metas.sort((a, b) => b.at - a.at || b.offset - a.offset);
        return readRecords(metas);
      });
    },

    /** One record, only if `playerId` is in it. */
    get(playerId, fightId) {
      return run(async () => {
        await load();
        const meta = index.get(String(fightId));
        // Only from the player's own history: a shared Battle that left it is gone for them.
        if (!meta || !lists.get(String(playerId))?.[meta.group]?.includes(meta.id)) return null;
        const [rec] = await readRecords([meta]);
        return rec ?? null;
      });
    },

    /**
     * Removes a player from Battle Records: their own records go, and in
     * every record they share with another player their id and name become
     * FORMER_TRAINER (the teams and turns stay, so the replay still works).
     */
    forgetPlayer(playerId) {
      const who = String(playerId);
      return run(async () => {
        await load();
        let removed = 0, anonymised = 0;
        await compact((r) => {
          if (!r.players.includes(who)) return r;
          const players = r.players.filter((p) => p !== who);
          if (!players.length) { removed++; return null; }
          anonymised++;
          const rewards = { ...(r.rewards ?? {}) };
          delete rewards[who];
          return {
            ...r,
            players,
            sides: r.sides.map((s) => (s.id === who ? { ...s, id: null, name: FORMER_TRAINER, trainer: null } : s)),
            rewards,
          };
        });
        // Their lists go with them, and records only they held are now dead.
        lists.delete(who);
        if ([...index.keys()].some((id) => !isLive(id))) await compact();
        return { removed, anonymised };
      });
    },

    /** Rewrites the file without dead lines. */
    compact: () => run(async () => { await load(); await compact(); }),

    /** Counts for tests and the measure tool. */
    stats: () => run(async () => { await load(); return { live: index.size, dead, bytes: size, players: lists.size }; }),

    path: file,
  };
}

/** The bot's one store. */
export const fightRecords = createFightStore();
