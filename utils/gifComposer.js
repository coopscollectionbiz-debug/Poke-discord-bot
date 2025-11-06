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
  
  // Key fix: Use individual -coalesce for each input to expand all frames,
  // then +append to tile horizontally. This preserves animation in output.
  const stagedPaths = staged.map(({ localPath }) => `"${localPath}"`).join(" ");

  const outDir = path.dirname(outputPath);
  await fs.mkdir(outDir, { recursive: true });

  // CORRECTED COMMAND: 
  // 1. Load all GIFs
  // 2. -coalesce: Expand animation frames to full canvas (critical for animation)
  // 3. -resize: Resize each frame
  // 4. +append: Tile horizontally across all frames
  // 5. -set delay: Uniform frame delay
  // 6. -loop 0: Infinite loop
  // 7. -layers optimize-frame: Optimize without destroying frames
  const cmd = `convert ${stagedPaths} -coalesce -resize ${resizeArg} +append -set delay 7 -loop 0 -layers optimize-frame "${outputPath}"`;
  console.log(`🧩 [GIFComposer] Combining ${gifPaths.length} GIFs horizontally...`);
  console.log(`🧩 [GIFComposer] Command: convert [inputs] -coalesce -resize ${resizeArg} +append -set delay 7 -loop 0 -layers optimize-frame`);

  try {
    const { stdout, stderr } = await exec(cmd);
    if (stderr && stderr.trim()) {
      console.warn("⚠️ convert stderr:", stderr.trim());
    }
    if (stdout && stdout.trim()) {
      console.log("ℹ️ convert stdout:", stdout.trim());
    }
  } catch (err) {
    console.error("❌ ImageMagick convert failed:", err.stderr || err.message);
    throw err;
  } finally {
    // Cleanup downloaded files
    for (const s of staged) {
      if (s.cleanup) try { await fs.unlink(s.localPath); } catch {}
    }
  }

  // Verify output file and check if animated
  try {
    const stat = await fs.stat(outputPath);
    if (stat.size === 0) throw new Error("Output GIF empty");
    console.log(`✅ GIF created successfully: ${(stat.size / 1024).toFixed(2)}KB`);
    
    // Debug: Check frame count to verify animation
    try {
      const { stdout: identifyOut } = await exec(`identify "${outputPath}" 2>&1 | head -5 || true`);
      if (identifyOut) {
        console.log(`ℹ️ GIF frames: ${identifyOut.split('\n').length - 1} frames detected`);
        console.log(`ℹ️ Output info:\n${identifyOut}`);
      }
    } catch (identErr) {
      console.warn("⚠️ Could not verify frame count (identify not available)");
    }
  } catch (e) {
    console.error(`Failed to verify output GIF: ${outputPath}`, e.message);
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