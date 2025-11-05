// ============================================================
// gifComposer.js
// Combines multiple GIFs horizontally (local + remote safe)
// Coop's Collection Discord Bot
// ============================================================

import fs from "fs";
import path from "path";
import fetch from "node-fetch";
import { exec as execCb } from "child_process";
import { promisify } from "util";
const exec = promisify(execCb);

/**
 * Combine multiple GIFs horizontally into one output file.
 * - Downloads remote URLs to temp files first
 * - Creates /temp directory automatically
 * - Cleans up after combining
 * @param {string[]} gifPaths - List of GIF URLs or local paths
 * @param {string} outputPath - Destination .gif file
 * @returns {Promise<string>} The path to the combined GIF
 */
export async function combineGifsHorizontal(gifPaths, outputPath) {
  try {
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    // ✅ Download remote GIFs to local temp files
    const localPaths = [];
    for (const src of gifPaths) {
      try {
        let localFile;
        if (/^https?:\/\//i.test(src)) {
          const res = await fetch(src);
          if (!res.ok) {
            console.warn(`⚠️ Failed to fetch: ${src} (${res.status})`);
            continue;
          }
          const buffer = await res.arrayBuffer();
          localFile = path.join(dir, path.basename(src));
          fs.writeFileSync(localFile, Buffer.from(buffer));
        } else {
          // Local file path
          localFile = src;
          if (!fs.existsSync(localFile)) {
            console.warn(`⚠️ Missing local file: ${localFile}`);
            continue;
          }
        }
        localPaths.push(localFile);
      } catch (err) {
        console.error(`❌ Error downloading ${src}:`, err.message);
      }
    }

    if (localPaths.length === 0) {
      throw new Error("No valid GIFs found to combine.");
    }

    // ✅ Run ImageMagick to combine horizontally
    const quoted = localPaths.map(p => `"${p}"`).join(" ");
    const cmd = `convert ${quoted} +append -coalesce -resize 128x128 "${outputPath}"`;
    console.log(`🧩 Combining ${localPaths.length} GIFs → ${outputPath}`);
    await exec(cmd);

    // ✅ Clean up temporary files (except the final output)
    for (const f of localPaths) {
      if (f !== outputPath && f.includes("/temp/")) {
        try { fs.unlinkSync(f); } catch {}
      }
    }

    console.log(`✅ Combined GIF saved: ${outputPath}`);
    return outputPath;

  } catch (err) {
    console.error("❌ combineGifsHorizontal failed:", err);
    throw err;
  }
}
