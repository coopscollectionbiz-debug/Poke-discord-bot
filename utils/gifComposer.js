// utils/gifComposer.js
import { exec as _exec } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import fss from "fs";
import path from "path";
import fetch from "node-fetch";

const exec = promisify(_exec);

const TEMP_DIR = path.resolve("./temp");

/**
 * Ensure temp directory exists.
 */
async function ensureTempDir() {
  try {
    await fs.mkdir(TEMP_DIR, { recursive: true });
  } catch {}
}

/**
 * Download a remote file (http/https) to a local temp path.
 * If path is already local, returns it unchanged.
 */
async function toLocalGif(sourcePath) {
  if (/^https?:\/\//i.test(sourcePath)) {
    const fileName = `${Date.now()}-${Math.random().toString(36).slice(2)}.gif`;
    const localPath = path.join(TEMP_DIR, fileName);
    const res = await fetch(sourcePath);
    if (!res.ok) throw new Error(`Failed to fetch ${sourcePath} (${res.status})`);
    const buf = await res.arrayBuffer();
    await fs.writeFile(localPath, Buffer.from(buf));
    return { localPath, cleanup: true };
  } else {
    // If file doesn't exist locally, still throw for clarity
    if (!fss.existsSync(sourcePath)) {
      throw new Error(`Local file not found: ${sourcePath}`);
    }
    return { localPath: sourcePath, cleanup: false };
  }
}

/**
 * Combine multiple animated GIFs horizontally into a single animated GIF.
 * - Coalesces EACH input GIF in its own parentheses group (critical!)
 * - Resizes frames
 * - Appends horizontally (+append)
 * - Optimizes layers and sets delay/loop
 *
 * @param {string[]} gifPaths - absolute or remote URLs
 * @param {string} outputPath - desired output .gif path (will be created/overwritten)
 * @param {number} size - target height in px (width scales); if you want a fixed box, pass width x height via resizeCustom
 * @param {string} resizeCustom - optional ImageMagick resize string (e.g. "128x128")
 */
export async function combineGifsHorizontal(gifPaths, outputPath, size = 128, resizeCustom = "") {
  await ensureTempDir();

  if (!gifPaths || gifPaths.length === 0) {
    throw new Error("combineGifsHorizontal: gifPaths is empty");
  }

  // If only one GIF, just copy it through (keeps animation)
  if (gifPaths.length === 1) {
    const { localPath, cleanup } = await toLocalGif(gifPaths[0]);
    await fs.copyFile(localPath, outputPath);
    if (cleanup) { try { await fs.unlink(localPath); } catch {} }
    return outputPath;
  }

  // Cache inputs locally
  const staged = [];
  for (const p of gifPaths) {
    const item = await toLocalGif(p);
    staged.push(item);
  }

  // Build the ImageMagick command using parentheses per input
  // so that -coalesce applies to each sequence independently.
  const resizeArg = resizeCustom ? resizeCustom : `${size}x${size}`;
  const groups = staged
    .map(({ localPath }) => `\\( "${localPath}" -coalesce -resize ${resizeArg} \\)`)
    .join(" ");

  const outDir = path.dirname(outputPath);
  await fs.mkdir(outDir, { recursive: true });

  // Delay ~7 (≈70ms) looks smooth; adjust to taste.
  const cmd = `convert ${groups} +append -set delay 7 -loop 0 -layers optimize "${outputPath}"`;

  console.log(`🧩 ImageMagick: ${cmd}`);
  try {
    await exec(cmd);
  } catch (err) {
    // Surface stderr for easier debugging
    throw new Error(`ImageMagick convert failed: ${err.stderr || err.message}`);
  } finally {
    // Clean temp files
    for (const s of staged) {
      if (s.cleanup) {
        try { await fs.unlink(s.localPath); } catch {}
      }
    }
  }

  // Sanity check: output exists and is non-empty
  try {
    const stat = await fs.stat(outputPath);
    if (!stat.size) throw new Error("Output GIF is empty");
  } catch (e) {
    throw new Error(`Failed to create output GIF: ${outputPath}`);
  }

  return outputPath;
}
