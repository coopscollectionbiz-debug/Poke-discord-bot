// ==========================================================
// utils/render/renderGate.js
// Caps how many expensive renders (animated GIFs) run at once. A caller that
// can't get a slot falls back to the cheap path (a PNG) instead of waiting,
// so a burst of /showteam calls never stacks GIF encoders on the 512 MB
// machine (each adds ~54 MB at peak; battles render alongside).
// ==========================================================

export function createRenderGate(limit = 1) {
  let active = 0;
  return {
    /** A release function, or null when the gate is full. */
    tryAcquire() {
      if (active >= limit) return null;
      active++;
      let released = false;
      return () => {
        if (!released) { released = true; active--; }
      };
    },
    get active() { return active; },
  };
}
