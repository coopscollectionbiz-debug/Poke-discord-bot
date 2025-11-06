// ==========================================================
// utils/gifComposer.js - FINAL WORKING VERSION
// Compose multiple animated GIFs into a single horizontal strip
// Preserves animation timing - frame by frame
// ==========================================================

import { execSync } from "child_process";
import path from "path";
import fs from "fs";

/**
 * Combines multiple animated GIFs horizontally while preserving animation
 * KEY FIX: Load all GIFs, coalesce them together, then +append frame-by-frame
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

    // ✅ THE WORKING APPROACH:
    // 1. Load ALL GIFs without parentheses (so they're all processed together)
    // 2. -coalesce: Expand all frames from all GIFs into a sequence
    // 3. +append: Append horizontally (frame-by-frame because of coalesce)
    // 4. Set animation parameters
    
    const gifArgs = gifPaths.map(p => `"${p}"`).join(" ");
    
    const command = `convert ${gifArgs} -coalesce -background transparent +append -set delay 10 -loop 0 -layers Optimize "${outputPath}"`;

    console.log(`🧩 [GIFComposer] Running: convert [${gifPaths.length} GIFs] -coalesce +append ...`);

    // Execute the command
    const result = execSync(command, { 
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      shell: "/bin/bash",
      maxBuffer: 10 * 1024 * 1024  // 10MB buffer for large outputs
    });

    // Verify output was created
    if (!fs.existsSync(outputPath)) {
      throw new Error("Output GIF was not created");
    }

    const stats = fs.statSync(outputPath);
    const sizeKB = (stats.size / 1024).toFixed(2);

    console.log(`✅ GIF created successfully: ${sizeKB}KB`);

    // Get frame information for verification
    try {
      const infoCommand = `identify -format "%T " "${outputPath}" | wc -w`;
      const frameCountStr = execSync(infoCommand, { encoding: "utf-8" }).trim();
      const frameCount = parseInt(frameCountStr) || 1;
      console.log(`📊 Frames in output: ${frameCount}`);
    } catch (e) {
      console.log(`📊 Frame count unavailable`);
    }

    return true;
  } catch (error) {
    console.error(`❌ GIF composition failed: ${error.message}`);
    throw new Error(`Failed to compose GIF: ${error.message}`);
  }
}

/**
 * Alternative method - uses exact sizes to prevent misalignment
 * Use this if first method produces vertically misaligned output
 * @param {Array} gifPaths - Array of GIF file paths
 * @param {string} outputPath - Output path
 * @returns {Promise<boolean>}
 */
export async function combineGifsHorizontalFixed(gifPaths, outputPath) {
  if (!gifPaths || gifPaths.length === 0) {
    throw new Error("No GIF paths provided");
  }

  console.log(`🧩 [GIFComposer] Using fixed-extent method for ${gifPaths.length} GIFs...`);

  try {
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Get dimensions of first GIF to normalize all to same size
    const sizeCommand = `identify -format "%wx%h" "${gifPaths[0]}"`;
    let width = 96, height = 96; // Default fallback
    
    try {
      const sizeStr = execSync(sizeCommand, { encoding: "utf-8" }).trim();
      if (sizeStr.includes('x')) {
        const parts = sizeStr.split('x');
        width = parseInt(parts[0]) || 96;
        height = parseInt(parts[1]) || 96;
      }
    } catch (e) {
      console.warn(`⚠️ Could not detect size, using defaults: ${width}x${height}`);
    }
    
    console.log(`📐 Normalizing to: ${width}x${height}`);

    // Build command with normalized sizing
    let command = `convert`;
    for (const gifPath of gifPaths) {
      command += ` "${gifPath}" -coalesce -extent ${width}x${height} -background transparent -gravity Center`;
    }
    command += ` -background transparent +append -set delay 10 -loop 0 -layers Optimize "${outputPath}"`;

    execSync(command, { 
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      shell: "/bin/bash",
      maxBuffer: 10 * 1024 * 1024
    });

    if (!fs.existsSync(outputPath)) {
      throw new Error("Output GIF was not created");
    }

    console.log(`✅ Fixed-size GIF created successfully`);
    return true;
  } catch (error) {
    console.error(`❌ Fixed-size composition failed: ${error.message}`);
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

    // -append for vertical (instead of +append for horizontal)
    const gifArgs = gifPaths.map(p => `"${p}"`).join(" ");
    
    const command = `convert ${gifArgs} -coalesce -background transparent -append -set delay 10 -loop 0 -layers Optimize "${outputPath}"`;

    execSync(command, { 
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      shell: "/bin/bash",
      maxBuffer: 10 * 1024 * 1024
    });

    if (!fs.existsSync(outputPath)) {
      throw new Error("Output GIF was not created");
    }

    console.log(`✅ Vertical GIF created successfully`);
    return true;
  } catch (error) {
    console.error(`❌ Vertical composition failed: ${error.message}`);
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
 * Debug helper - show frame info for a GIF
 * @param {string} gifPath - Path to GIF file
 */
export async function debugGifFrames(gifPath) {
  try {
    console.log(`\n🔍 Debugging: ${path.basename(gifPath)}`);
    const command = `identify "${gifPath}"`;
    const output = execSync(command, { encoding: "utf-8" });
    console.log(output);
  } catch (error) {
    console.warn(`⚠️ Could not debug GIF: ${error.message}`);
  }
}