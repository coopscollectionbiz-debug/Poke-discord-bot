// ==========================================================
// persistence/localStore.js
// Durable local snapshots of trainerData in TRAINERDATA_DIR (default ".").
//
//   trainerData.json / .meta.json            current snapshot
//   trainerData.prev.json / .prev.meta.json  previous generation
//   snapshots/trainerData-YYYY-MM-DD.json    one per UTC day, last 7 kept
//
// Write order (crash-safe: a valid snapshot always survives):
//   1. write + fsync trainerData.json.tmp
//   2. current meta -> prev meta, current data -> prev data
//   3. tmp -> current, fsync dir
//   4. write meta (tmp + fsync + rename)
// A crash between 3 and 4 leaves meta that doesn't match the data; the
// loader detects that via sha256 and falls back to the file's mtime.
//
// The user-map format is unchanged (metadata lives in separate files).
// ==========================================================

import fs from "fs/promises";
import path from "path";
import { buildMeta, validateSnapshot } from "./snapshot.js";

export const DAILY_SNAPSHOTS_KEPT = 7;

export function dataDir() {
  return path.resolve(process.env.TRAINERDATA_DIR || ".");
}

export function paths(dir = dataDir()) {
  return {
    dir,
    current: path.join(dir, "trainerData.json"),
    currentMeta: path.join(dir, "trainerData.meta.json"),
    prev: path.join(dir, "trainerData.prev.json"),
    prevMeta: path.join(dir, "trainerData.prev.meta.json"),
    tmp: path.join(dir, "trainerData.json.tmp"),
    metaTmp: path.join(dir, "trainerData.meta.json.tmp"),
    snapshots: path.join(dir, "snapshots"),
  };
}

// ----------------------------------------------------------
// Sequence counter (shared by local writes and Discord uploads)
// ----------------------------------------------------------
let seq = 0;
export const getSeq = () => seq;
export const nextSeq = () => ++seq;
/** After loading a snapshot, continue numbering above it. */
export function setSeqAtLeast(n) {
  if (Number.isInteger(n) && n > seq) seq = n;
}

// ----------------------------------------------------------
// Helpers
// ----------------------------------------------------------
async function writeFileDurable(file, text) {
  const fh = await fs.open(file, "w");
  try {
    await fh.writeFile(text, "utf8");
    await fh.sync();
  } finally {
    await fh.close();
  }
}

async function fsyncDir(dir) {
  // Linux: makes renames durable. Windows can't open a dir; skip there.
  try {
    const fh = await fs.open(dir, "r");
    try { await fh.sync(); } finally { await fh.close(); }
  } catch {}
}

async function renameIfExists(from, to) {
  try {
    await fs.rename(from, to);
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
}

const utcDay = (ms) => new Date(ms).toISOString().slice(0, 10);
let lastDailyDay = null;

// ----------------------------------------------------------
// Write
// ----------------------------------------------------------
/**
 * Durably write a snapshot. Throws on failure (the save queue retries).
 * @returns {Promise<object>} the metadata written
 */
export async function writeSnapshot(data, { now = Date.now() } = {}) {
  const p = paths();
  await fs.mkdir(p.dir, { recursive: true });

  const text = JSON.stringify(data, null, 2);
  const meta = buildMeta(text, { seq: nextSeq(), savedAt: now, userCount: Object.keys(data).length });

  try {
    await writeFileDurable(p.tmp, text);
  } catch (e) {
    try { await fs.unlink(p.tmp); } catch {}
    throw e;
  }
  await renameIfExists(p.currentMeta, p.prevMeta);
  await renameIfExists(p.current, p.prev);
  await fs.rename(p.tmp, p.current);
  await fsyncDir(p.dir);

  await writeFileDurable(p.metaTmp, JSON.stringify(meta));
  await fs.rename(p.metaTmp, p.currentMeta);
  await fsyncDir(p.dir);

  await writeDailySnapshot(p, now).catch((e) =>
    console.warn("⚠️ Daily snapshot failed (current save is fine):", e?.message || e)
  );
  return meta;
}

async function writeDailySnapshot(p, now) {
  const day = utcDay(now);
  if (lastDailyDay === day) return;
  await fs.mkdir(p.snapshots, { recursive: true });
  const base = path.join(p.snapshots, `trainerData-${day}`);
  await fs.copyFile(p.current, `${base}.json`);
  await fs.copyFile(p.currentMeta, `${base}.meta.json`);
  lastDailyDay = day;

  const days = (await fs.readdir(p.snapshots))
    .map((f) => /^trainerData-(\d{4}-\d{2}-\d{2})\.json$/.exec(f)?.[1])
    .filter(Boolean)
    .sort()
    .reverse();
  for (const old of days.slice(DAILY_SNAPSHOTS_KEPT)) {
    await fs.unlink(path.join(p.snapshots, `trainerData-${old}.json`)).catch(() => {});
    await fs.unlink(path.join(p.snapshots, `trainerData-${old}.meta.json`)).catch(() => {});
  }
}

// ----------------------------------------------------------
// Read
// ----------------------------------------------------------
async function readText(file) {
  try {
    return await fs.readFile(file, "utf8");
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
}

async function readMeta(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return null;
  }
}

async function mtime(file) {
  try {
    return (await fs.stat(file)).mtimeMs;
  } catch {
    return null;
  }
}

/** Validate a snapshot file (and optional sidecar meta) as a candidate. */
export async function readFileCandidate(file, metaFile = null, source = "file") {
  try {
    const text = await readText(file);
    const meta = metaFile ? await readMeta(metaFile) : null;
    return validateSnapshot({ source, id: file, text, meta, fallbackTime: await mtime(file) });
  } catch (e) {
    return { ok: false, source, id: file, reason: `read error (${e.code || e.message})` };
  }
}

/** Current and previous local snapshots as validated candidates. */
export async function readLocalCandidates() {
  const p = paths();
  return [
    await readFileCandidate(p.current, p.currentMeta, "local"),
    await readFileCandidate(p.prev, p.prevMeta, "local-prev"),
  ];
}

export function __resetLocalStoreForTests() {
  seq = 0;
  lastDailyDay = null;
}
