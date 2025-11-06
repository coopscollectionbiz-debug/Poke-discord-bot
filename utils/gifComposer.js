// ==========================================================
// utils/gifComposer.js
// Compose multiple animated GIFs into a single horizontal strip
// Preserves animation timing
// ==========================================================

import { execSync } from "child_process";
import path from "path";
import fs from "fs";

/**
 * Combines multiple animated GIFs horizontally while preserving animation
 * @param {Array} gifPaths - Array of GIF file paths to combine
 * @param {string} outputPath - Path where combined GIF will be saved
 * @returns {Promise<boolean>} True if successful
 */
export async function combineGifsHorizontal(gifPaths, outputPath) {
  if (!gifPaths || gifPaths.length === 0) {
    throw new Error("No GIF paths provided");
  }

  // Validate all input files exist
  for (const gifPath of gifPaths) {
    if (!fs.existsSync(gifPath)) {
      throw new Error(`GIF file not found: ${gifPath}`);
    }
  }

  console.log(`🧩 [GIFComposer] Combining ${gifPaths.length} GIFs horizontally...`);

  try {
    // Ensure output directory exists
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Build ImageMagick command for horizontal composition with animation preservation
    // Strategy: Use parentheses to process each GIF separately, then composite frames
    // Key points:
    // 1. Process each GIF in parentheses with -coalesce to expand all frames
    // 2. +append combines images horizontally within each frame sequence
    // 3. -set delay sets frame timing (10 = 100ms per frame)
    // 4. -loop 0 = infinite loop
    // 5. -layers Optimize reduces file size
    
    let command = `convert`;
    for (const gifPath of gifPaths) {
      command += ` \\( "${gifPath}" -coalesce \\)`;
    }
    command += ` -background transparent +append -set delay 10 -loop 0 -layers Optimize "${outputPath}"`;

    console.log(`🧩 [GIFComposer] Command: convert [inputs with -coalesce] +append -set delay 10 -loop 0 -layers Optimize`);

    // Execute the command
    execSync(command, { 
      stdio: ["pipe", "pipe", "pipe"],
      shell: "/bin/bash"
    });

    // Verify output was created
    if (!fs.existsSync(outputPath)) {
      throw new Error("Output GIF was not created");
    }

    const stats = fs.statSync(outputPath);
    const sizeKB = (stats.size / 1024).toFixed(2);

    console.log(`✅ GIF created successfully: ${sizeKB}KB`);

    // Get frame information
    try {
      const infoCommand = `identify -verbose "${outputPath}" | grep -E "Geometry|Delay|Scene"`;
      const info = execSync(infoCommand, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
      console.log(`ℹ️ GIF Info:\n${info}`);
    } catch {
      // Silent fail on info extraction
    }

    return true;
  } catch (error) {
    console.error(`❌ GIF composition failed: ${error.message}`);
    throw new Error(`Failed to compose GIF: ${error.message}`);
  }
}

/**
 * Alternative method using different ImageMagick approach
 * For when the standard approach fails
 * @param {Array} gifPaths - Array of GIF file paths
 * @param {string} outputPath - Output path
 * @returns {Promise<boolean>}
 */
export async function combineGifsHorizontalAlt(gifPaths, outputPath) {
  if (!gifPaths || gifPaths.length === 0) {
    throw new Error("No GIF paths provided");
  }

  console.log(`🧩 [GIFComposer] Using alternative method for ${gifPaths.length} GIFs...`);

  try {
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Alternative approach: explicitly handle animation
    const command = `convert \\
      -dispose Background \\
      $(for f in ${gifPaths.map(p => `"${p}"`).join(" ")}; do echo "$f"; done) \\
      -background transparent \\
      -gravity Center \\
      -extent 128x128 \\
      +append \\
      -set delay 10 \\
      -loop 0 \\
      "${outputPath}"`;

    execSync(command, { 
      stdio: ["pipe", "pipe", "pipe"],
      shell: "/bin/bash"
    });

    if (!fs.existsSync(outputPath)) {
      throw new Error("Output GIF was not created");
    }

    console.log(`✅ GIF created successfully (alt method)`);
    return true;
  } catch (error) {
    console.error(`❌ Alternative GIF composition failed: ${error.message}`);
    throw error;
  }
}

/**
 * Compose GIFs vertically instead of horizontally
 * @param {Array} gifPaths - Array of GIF paths
 * @param {string} outputPath - Output path
 * @returns {Promise<boolean>}
 */
export async function combineGifsVertical(gifPaths, outputPath) {
  if (!gifPaths || gifPaths.length === 0) {
    throw new Error("No GIF paths provided");
  }

  console.log(`🧩 [GIFComposer] Combining ${gifPaths.length} GIFs vertically...`);

  try {
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // -append for vertical composition (instead of +append)
    const command = `convert ${gifPaths.map(p => `"${p}"`).join(" ")} \\
      -background transparent \\
      -append \\
      -set delay 10 \\
      -loop 0 \\
      -layers Optimize \\
      "${outputPath}"`;

    execSync(command, { 
      stdio: ["pipe", "pipe", "pipe"],
      shell: "/bin/bash"
    });

    if (!fs.existsSync(outputPath)) {
      throw new Error("Output GIF was not created");
    }

    console.log(`✅ Vertical GIF created successfully`);
    return true;
  } catch (error) {
    console.error(`❌ Vertical GIF composition failed: ${error.message}`);
    throw error;
  }
}

/**
 * Get detailed information about a GIF
 * @param {string} gifPath - Path to GIF file
 * @returns {Promise<Object>} GIF metadata
 */
export async function getGifInfo(gifPath) {
  try {
    const command = `identify -verbose "${gifPath}"`;
    const output = execSync(command, { encoding: "utf-8" });
    
    const frameMatch = output.match(/Iterations: (\d+)/);
    const delayMatch = output.match(/Delay: ([\d.]+)x([\d.]+)/);
    const sizeMatch = output.match(/Geometry: (\d+)x(\d+)/);
    
    return {
      frames: frameMatch ? parseInt(frameMatch[1]) : 1,
      delay: delayMatch ? parseInt(delayMatch[1]) : 10,
      width: sizeMatch ? parseInt(sizeMatch[1]) : 0,
      height: sizeMatch ? parseInt(sizeMatch[2]) : 0
    };
  } catch (error) {
    console.warn(`⚠️ Could not get GIF info: ${error.message}`);
    return { frames: 1, delay: 10, width: 0, height: 0 };
  }
}