// utils/gifComposer.js
import { exec } from "child_process";
import { promisify } from "util";
import path from "path";
const run = promisify(exec);

/**
 * Combines multiple GIFs into a single horizontal animated GIF.
 * Requires ImageMagick installed on Render (it's preinstalled on most builds).
 * 
 * @param {string[]} gifPaths - Array of local or remote GIF paths.
 * @param {string} outputPath - Output filename.
 */
export async function combineGifsHorizontal(gifPaths, outputPath) {
  const quoted = gifPaths.map(p => `"${p}"`).join(" ");
  const cmd = `convert ${quoted} +append -coalesce -resize 128x128 ${outputPath}`;
  await run(cmd);
  return outputPath;
}
