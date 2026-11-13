// ==========================================================
// utils/loopLag.js
// How long the main thread keeps other work waiting: event-loop delay,
// measured continuously (perf_hooks.monitorEventLoopDelay) and summed up
// once a minute. Each minute is logged as
//   ⏱️ loop lag 1m: p50 <ms> p99 <ms> max <ms>
// and the last 5 minutes are kept for /readyz (lagStatus): the median of
// the minutes' p50s, the worst p99 and the worst max. A stall here is a
// command, button or dashboard save that sat waiting behind other work
// (before render threads: mostly image rendering).
// ==========================================================

import { monitorEventLoopDelay } from "perf_hooks";

const WINDOW_MINUTES = 5;
const ms = (ns) => Math.round(ns / 1e6);

export function startLoopLagMonitor({ intervalMs = 60_000, log = console.log, resolution = 20 } = {}) {
  const histogram = monitorEventLoopDelay({ resolution });
  histogram.enable();
  const minutes = [];
  const tick = () => {
    if (!histogram.count) return;
    const m = { p50: ms(histogram.percentile(50)), p99: ms(histogram.percentile(99)), max: ms(histogram.max), at: new Date().toISOString() };
    histogram.reset();
    minutes.push(m);
    if (minutes.length > WINDOW_MINUTES) minutes.shift();
    log(`⏱️ loop lag 1m: p50 ${m.p50} ms p99 ${m.p99} ms max ${m.max} ms`);
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  return {
    tick,
    /** The last few minutes, for /readyz; null before the first minute ends. */
    status() {
      if (!minutes.length) return null;
      const p50s = minutes.map((m) => m.p50).sort((a, b) => a - b);
      return {
        minutes: minutes.length,
        p50Ms: p50s[Math.floor(p50s.length / 2)],
        p99Ms: Math.max(...minutes.map((m) => m.p99)),
        maxMs: Math.max(...minutes.map((m) => m.max)),
        since: minutes[0].at,
      };
    },
    stop() {
      clearInterval(timer);
      histogram.disable();
    },
  };
}
