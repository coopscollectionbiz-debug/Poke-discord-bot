// ============================================================
// utils/gifComposer.js — Coop's Collection Discord Bot
// Production-ready GIF combiner for animated sprites
// ============================================================

import { exec as _exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import fss from "fs";
import path from "path";
import fetch from "node-fetch";

const exec = promisify(_exec);
const TEMP_DIR = path.resolve("./temp");

/**
 * Ensure /temp directory exists
 */
async function ensureTempDir() {
  try {
    await fs.mkdir(TEMP_DIR, { recursive: true });
  } catch (err) {
    console.warn("⚠️ Failed to create temp dir:", err.message);
  }
}

/**
 * Download remote GIFs to local temp files (or return local path)
 * Returns { localPath, cleanup: boolean }
 */
async function toLocalGif(sourcePath) {
  // remote .gif
  if (/^https?:\/\//i.test(sourcePath)) {
    const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.gif`;
    const localPath = path.join(TEMP_DIR, fileName);
    const res = await fetch(sourcePath);
    if (!res.ok) throw new Error(`Failed to fetch ${sourcePath} (${res.status})`);
    const buf = await res.arrayBuffer();
    await fs.writeFile(localPath, Buffer.from(buf));
    return { localPath, cleanup: true };
  }

  // local file
  if (!fss.existsSync(sourcePath)) {
    throw new Error(`Local file not found: ${sourcePath}`);
  }
  return { localPath: sourcePath, cleanup: false };
}

/**
 * Combine multiple animated GIFs horizontally (preserving animation)
 * @param {string[]} gifPaths - array of local or remote .gif URLs
 * @param {string} outputPath - where to save the final combined .gif
 * @param {number} size - resize target (default 128px)
 * @param {string} resizeCustom - optional custom resize string (e.g. "96x96")
 * @returns {Promise<string>} outputPath
 */
export async function combineGifsHorizontal(
  gifPaths,
  outputPath,
  size = 128,
  resizeCustom = ""
) {
  await ensureTempDir();

  if (!gifPaths || gifPaths.length === 0) {
    throw new Error("combineGifsHorizontal: gifPaths is empty");
  }

  // === If only one GIF, just copy through (keep animation) ===
  if (gifPaths.length === 1) {
    const { localPath, cleanup } = await toLocalGif(gifPaths[0]);
    await fs.copyFile(localPath, outputPath);
    if (cleanup) try { await fs.unlink(localPath); } catch {}
    return outputPath;
  }

  // === Stage input GIFs locally ===
  const staged = [];
  for (const p of gifPaths) staged.push(await toLocalGif(p));

  // === Build ImageMagick command ===
  const resizeArg = resizeCustom || `${size}x${size}`;
  // Each input wrapped in parentheses to preserve animation
  const groups = staged
    .map(({ localPath }) => `\\( "${localPath}" -coalesce -resize ${resizeArg} \\)`)
    .join(" ");

  const outDir = path.dirname(outputPath);
  await fs.mkdir(outDir, { recursive: true });

  // Delay 7 (~70ms) for smooth animation, optimize layers to reduce size
  const cmd = `convert ${groups} +append -set delay 7 -loop 0 -layers optimize "${outputPath}"`;
  console.log(`🧩 [GIFComposer] ${cmd}`);

  try {
    const { stderr } = await exec(cmd);
    if (stderr && stderr.trim()) console.warn("⚠️ convert stderr:", stderr.trim());
  } catch (err) {
    console.error("❌ ImageMagick convert failed:", err.stderr || err.message);
    throw err;
  } finally {
    // Cleanup downloaded files
    for (const s of staged) {
      if (s.cleanup) try { await fs.unlink(s.localPath); } catch {}
    }
  }

  // Verify output file
  try {
    const stat = await fs.stat(outputPath);
    if (stat.size === 0) throw new Error("Output GIF empty");
  } catch (e) {
    throw new Error(`Failed to create output GIF: ${outputPath}`);
  }

  return outputPath;
}

// ============================================================
// Optional helper: remove all temp files (for debugging / cleanup)
// ============================================================
export async function clearTempGifs() {
  try {
    const files = await fs.readdir(TEMP_DIR);
    await Promise.all(
      files.map(f => fs.unlink(path.join(TEMP_DIR, f)).catch(() => {}))
    );
    console.log("🧹 Cleared temp GIFs.");
  } catch (err) {
    console.warn("⚠️ clearTempGifs failed:", err.message);
  }
}
