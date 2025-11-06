// ==========================================================
// utils/gifComposer.js - IMAGEMAGICK 6 COMPATIBLE
// Compose multiple animated GIFs into a single horizontal strip
// Uses frame-by-frame approach for reliable animation preservation
// ==========================================================

import { execSync } from "child_process";
import path from "path";
import fs from "fs";
import os from "os";

/**
 * Combines multiple animated GIFs horizontally while preserving animation
 * Frame-by-frame approach with proper timing synchronization
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

  // Create temporary working directory
  const workDir = path.resolve(path.dirname(outputPath), `.compose_work_${Date.now()}`);
  
  try {
    // Ensure output directory exists
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Create work directory
    if (!fs.existsSync(workDir)) {
      fs.mkdirSync(workDir, { recursive: true });
    }

    console.log(`📁 Working directory: ${workDir}`);

    // Step 1: Extract frames and get metadata from each GIF
    console.log(`📋 Extracting frames from ${gifPaths.length} GIFs...`);
    
    const frameLists = [];
    const gifMetadata = [];
    
    for (let i = 0; i < gifPaths.length; i++) {
      const gifPath = gifPaths[i];
      const gifName = `gif_${i}`;
      const framePattern = path.join(workDir, `${gifName}_%d.gif`);
      
      // Extract all frames
      const extractCmd = `convert "${gifPath}" "${framePattern}"`;
      execSync(extractCmd, { 
        stdio: ["pipe", "pipe", "pipe"],
        shell: "/bin/bash",
        maxBuffer: 50 * 1024 * 1024
      });
      
      // Get frame files
      const frameDir = fs.readdirSync(workDir).filter(f => f.startsWith(`${gifName}_`)).sort();
      console.log(`  ✅ GIF ${i + 1}: Extracted ${frameDir.length} frames`);
      frameLists.push(frameDir.map(f => path.join(workDir, f)));
      
      // Get GIF info for timing
      try {
        const infoCmd = `identify -format "%T " "${gifPath}"`;
        const delays = execSync(infoCmd, { encoding: "utf-8" }).trim().split(" ").filter(d => d).map(d => parseInt(d) || 10);
        gifMetadata.push({ frames: frameDir.length, delays });
        console.log(`     Delays: ${delays.slice(0, 5).join(",")}${delays.length > 5 ? "..." : ""}`);
      } catch (e) {
        gifMetadata.push({ frames: frameDir.length, delays: Array(frameDir.length).fill(10) });
      }
    }

    // Step 2: Calculate LCM of frame counts for perfect looping
    const frameCountsLCM = calculateLCM(frameLists.map(f => f.length));
    console.log(`📊 Frame counts: ${frameLists.map(f => f.length).join(", ")} → LCM: ${frameCountsLCM}`);
    
    // Limit to avoid excessive processing (max 100 output frames)
    const outputFrames = Math.min(frameCountsLCM, 100);
    console.log(`🎯 Output frames: ${outputFrames}`);

    // Step 3: Expand each GIF to match output frames
    const expandedFrameLists = frameLists.map((frames, idx) => {
      const expanded = [];
      for (let i = 0; i < outputFrames; i++) {
        // Cycle through frames smoothly
        const frameIdx = Math.floor((i / outputFrames) * frames.length);
        expanded.push(frames[frameIdx]);
      }
      return expanded;
    });

    // Step 4: Combine frames horizontally
    console.log(`🧩 Combining ${outputFrames} frames horizontally...`);
    
    const combinedFrames = [];
    for (let frameIdx = 0; frameIdx < outputFrames; frameIdx++) {
      const framesToCombine = expandedFrameLists.map(frameList => `"${frameList[frameIdx]}"`).join(" ");
      const combinedPath = path.join(workDir, `combined_${String(frameIdx).padStart(5, '0')}.gif`);
      
      const combineCmd = `convert ${framesToCombine} -background transparent -gravity Center -extent 96x96 +append "${combinedPath}"`;
      
      execSync(combineCmd, { 
        stdio: ["pipe", "pipe", "pipe"],
        shell: "/bin/bash",
        maxBuffer: 50 * 1024 * 1024
      });
      
      combinedFrames.push(combinedPath);
      
      if ((frameIdx + 1) % 20 === 0 || frameIdx === outputFrames - 1) {
        console.log(`  ✅ Combined ${frameIdx + 1}/${outputFrames} frames`);
      }
    }

    // Step 5: Stitch combined frames into final animated GIF with uniform delay
    console.log(`🎬 Stitching ${outputFrames} frames into final GIF...`);
    
    const framePattern = path.join(workDir, "combined_*.gif");
    // Use consistent 10ms delay (100ms per frame) for smooth animation
    const stitchCmd = `convert ${framePattern} -delay 10 -loop 0 -layers Optimize "${outputPath}"`;
    
    execSync(stitchCmd, { 
      stdio: ["pipe", "pipe", "pipe"],
      shell: "/bin/bash",
      maxBuffer: 50 * 1024 * 1024
    });

    // Verify output was created
    if (!fs.existsSync(outputPath)) {
      throw new Error("Output GIF was not created");
    }

    const stats = fs.statSync(outputPath);
    const sizeKB = (stats.size / 1024).toFixed(2);
    console.log(`✅ GIF created successfully: ${sizeKB}KB (${outputFrames} synchronized frames)`);

    return true;
  } catch (error) {
    console.error(`❌ GIF composition failed: ${error.message}`);
    throw new Error(`Failed to compose GIF: ${error.message}`);
  } finally {
    // Cleanup work directory
    try {
      if (fs.existsSync(workDir)) {
        execSync(`rm -rf "${workDir}"`, { 
          stdio: ["pipe", "pipe", "pipe"],
          shell: "/bin/bash"
        });
        console.log(`🧹 Cleaned up work directory`);
      }
    } catch (cleanupError) {
      console.warn(`⚠️ Failed to cleanup work directory: ${cleanupError.message}`);
    }
  }
}

/**
 * Calculate Greatest Common Divisor
 * @param {number} a 
 * @param {number} b 
 * @returns {number}
 */
function gcd(a, b) {
  return b === 0 ? a : gcd(b, a % b);
}

/**
 * Calculate Least Common Multiple
 * @param {number[]} numbers 
 * @returns {number}
 */
function calculateLCM(numbers) {
  let result = numbers[0];
  for (let i = 1; i < numbers.length; i++) {
    result = (result * numbers[i]) / gcd(result, numbers[i]);
  }
  return Math.min(result, 100); // Cap at 100 to avoid excessive processing
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

  console.log(`🧩 [GIFComposer] Combining ${gifPaths.length} GIFs vertically (frame-by-frame)...`);

  const workDir = path.resolve(path.dirname(outputPath), `.compose_work_${Date.now()}`);
  
  try {
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    if (!fs.existsSync(workDir)) {
      fs.mkdirSync(workDir, { recursive: true });
    }

    // Extract frames
    const frameLists = [];
    for (let i = 0; i < gifPaths.length; i++) {
      const gifPath = gifPaths[i];
      const framePattern = path.join(workDir, `gif_${i}_%d.gif`);
      
      execSync(`convert "${gifPath}" "${framePattern}"`, { 
        stdio: ["pipe", "pipe", "pipe"],
        shell: "/bin/bash",
        maxBuffer: 50 * 1024 * 1024
      });
      
      const frameDir = fs.readdirSync(workDir).filter(f => f.startsWith(`gif_${i}_`));
      frameLists.push(frameDir.map(f => path.join(workDir, f)));
    }

    // Pad frames to max length
    const maxFrames = Math.max(...frameLists.map(f => f.length));
    for (let i = 0; i < frameLists.length; i++) {
      while (frameLists[i].length < maxFrames) {
        const lastFrame = frameLists[i][frameLists[i].length - 1];
        const lastIndex = parseInt(lastFrame.match(/_(\d+)\.gif$/)[1]);
        const newIndex = lastIndex + 1;
        const newPath = lastFrame.replace(/_\d+\.gif$/, `_${newIndex}.gif`);
        fs.copyFileSync(lastFrame, newPath);
        frameLists[i].push(newPath);
      }
    }

    // Combine frames vertically
    const combinedFrames = [];
    for (let frameIdx = 0; frameIdx < maxFrames; frameIdx++) {
      const framesToCombine = frameLists.map(frameList => `"${frameList[frameIdx]}"`).join(" ");
      const combinedPath = path.join(workDir, `combined_${frameIdx}.gif`);
      
      execSync(`convert ${framesToCombine} -background transparent -gravity Center -extent 96x96 -append "${combinedPath}"`, { 
        stdio: ["pipe", "pipe", "pipe"],
        shell: "/bin/bash",
        maxBuffer: 50 * 1024 * 1024
      });
      
      combinedFrames.push(combinedPath);
    }

    // Stitch into final GIF
    execSync(`convert ${path.join(workDir, "combined_*.gif")} -set delay 10 -loop 0 -layers Optimize "${outputPath}"`, { 
      stdio: ["pipe", "pipe", "pipe"],
      shell: "/bin/bash",
      maxBuffer: 50 * 1024 * 1024
    });

    if (!fs.existsSync(outputPath)) {
      throw new Error("Output GIF was not created");
    }

    const stats = fs.statSync(outputPath);
    console.log(`✅ Vertical GIF created: ${(stats.size / 1024).toFixed(2)}KB`);
    return true;
  } catch (error) {
    console.error(`❌ Vertical composition failed: ${error.message}`);
    throw error;
  } finally {
    try {
      if (fs.existsSync(workDir)) {
        execSync(`rm -rf "${workDir}"`, { stdio: ["pipe", "pipe", "pipe"], shell: "/bin/bash" });
      }
    } catch (e) {
      // Silent
    }
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