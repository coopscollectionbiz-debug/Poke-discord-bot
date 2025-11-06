// ==========================================================
// utils/gifComposer.js
// Compose multiple animated GIFs into a single horizontal strip
// Preserves animation timing - FIXED VERSION
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
    // The key insight: we need to +append AFTER coalescing all frames
    // This ensures each frame of the output is a composite of the corresponding frames
    // from all input GIFs
    let command = `convert`;
    for (const gifPath of gifPaths) {
      command += ` "${gifPath}"`;
    }
    // The magic sequence:
    // 1. -coalesce: Expand all frames of all GIFs into separate images
    // 2. +append: Append all images horizontally (frame-by-frame because of coalesce)
    // 3. -background transparent: Transparent background for empty space
    // 4. -set delay 10: 10 ticks per frame (100ms)
    // 5. -loop 0: Infinite loop
    // 6. -layers Optimize: Optimize animation (reduce file size)
    command += ` -coalesce -background transparent +append -set delay 10 -loop 0 -layers Optimize "${outputPath}"`;

    console.log(`🧩 [GIFComposer] Executing ImageMagick compose command...`);

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
      const infoCommand = `identify -verbose "${outputPath}" | grep -E "Geometry|Delay|Scene" | head -20`;
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
 * Alternative method - uses -extent to ensure consistent sizing
 * For when sprites have different dimensions
 * @param {Array} gifPaths - Array of GIF file paths
 * @param {string} outputPath - Output path
 * @returns {Promise<boolean>}
 */
export async function combineGifsHorizontalFixed(gifPaths, outputPath) {
  if (!gifPaths || gifPaths.length === 0) {
    throw new Error("No GIF paths provided");
  }

  console.log(`🧩 [GIFComposer] Using fixed-size method for ${gifPaths.length} GIFs...`);

  try {
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // First, get dimensions of first GIF to use as standard
    const sizeCommand = `identify -format "%w,%h" "${gifPaths[0]}"`;
    const sizeStr = execSync(sizeCommand, { encoding: "utf-8" }).trim();
    const [width, height] = sizeStr.split(',').map(Number);
    
    console.log(`📐 Standard size from first GIF: ${width}x${height}`);

    // Build command with -extent to normalize sizes
    let command = `convert`;
    for (const gifPath of gifPaths) {
      command += ` "${gifPath}" -coalesce -extent ${width}x${height} -background transparent -gravity Center`;
    }
    command += ` -background transparent +append -set delay 10 -loop 0 -layers Optimize "${outputPath}"`;

    execSync(command, { 
      stdio: ["pipe", "pipe", "pipe"],
      shell: "/bin/bash"
    });

    if (!fs.existsSync(outputPath)) {
      throw new Error("Output GIF was not created");
    }

    console.log(`✅ Fixed-size GIF created successfully`);
    return true;
  } catch (error) {
    console.error(`❌ Fixed-size GIF composition failed: ${error.message}`);
    throw error;
  }
}

/**
 * Alternative method using montage for side-by-side layout
 * For when standard approach fails
 * @param {Array} gifPaths - Array of GIF file paths
 * @param {string} outputPath - Output path
 * @returns {Promise<boolean>}
 */
export async function combineGifsHorizontalAlt(gifPaths, outputPath) {
  if (!gifPaths || gifPaths.length === 0) {
    throw new Error("No GIF paths provided");
  }

  console.log(`🧩 [GIFComposer] Using montage alternative for ${gifPaths.length} GIFs...`);

  try {
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Use montage with coalesced frames
    const gifList = gifPaths.map(p => `"${p}"`).join(" ");
    const command = `convert ${gifList} -coalesce -background transparent -tile ${gifPaths.length}x1 -geometry +0+0 -gravity Center +append -set delay 10 -loop 0 "${outputPath}"`;

    execSync(command, { 
      stdio: ["pipe", "pipe", "pipe"],
      shell: "/bin/bash"
    });

    if (!fs.existsSync(outputPath)) {
      throw new Error("Output GIF was not created");
    }

    console.log(`✅ Alternative GIF created successfully`);
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
    // Same coalesce strategy as horizontal
    let command = `convert`;
    for (const gifPath of gifPaths) {
      command += ` "${gifPath}"`;
    }
    command += ` -coalesce -background transparent -append -set delay 10 -loop 0 -layers Optimize "${outputPath}"`;

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
    
    // Try multiple patterns for extracting frame count
    let frames = 1;
    const iterMatch = output.match(/Iterations: (\d+)/);
    const sceneMatch = output.match(/Scenes: (\d+)/);
    if (iterMatch) frames = parseInt(iterMatch[1]);
    else if (sceneMatch) frames = parseInt(sceneMatch[1]);
    
    const delayMatch = output.match(/Delay: ([\d.]+)x([\d.]+)/);
    const sizeMatch = output.match(/Geometry: (\d+)x(\d+)/);
    
    return {
      frames,
      delay: delayMatch ? parseInt(delayMatch[1]) : 10,
      width: sizeMatch ? parseInt(sizeMatch[1]) : 0,
      height: sizeMatch ? parseInt(sizeMatch[2]) : 0,
      path: gifPath
    };
  } catch (error) {
    console.warn(`⚠️ Could not get GIF info: ${error.message}`);
    return { frames: 1, delay: 10, width: 0, height: 0, path: gifPath };
  }
}

/**
 * Debug helper - list all frames in a GIF
 * @param {string} gifPath - Path to GIF file
 */
export async function debugGifFrames(gifPath) {
  try {
    const command = `identify "${gifPath}"`;
    const output = execSync(command, { encoding: "utf-8" });
    console.log(`🔍 Frames in ${path.basename(gifPath)}:\n${output}`);
  } catch (error) {
    console.warn(`⚠️ Could not debug GIF: ${error.message}`);
  }
}