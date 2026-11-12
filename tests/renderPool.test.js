// ==========================================================
// tests/renderPool.test.js
// Render threads (utils/render/renderPool.js): thread count from
// RENDER_THREADS, line order and priority, the queue wait limit, crashed
// and failing threads, falling back to the main thread, cardImage's
// "(threads busy)" PNG, real cards drawn on a thread matching the main
// thread byte for byte, and the loop-lag summary (utils/loopLag.js).
// ==========================================================

import { assertEqual, assertTrue, section, finish } from "./harness.js";
import { createRenderPool, renderThreadCount, threaded, renderOptions, DEFAULT_RENDER_THREADS } from "../utils/render/renderPool.js";
import { cardImage } from "../utils/render/stage.js";
import { startLoopLagMonitor } from "../utils/loopLag.js";

const FAKE = new URL("./fixtures/fakeRenderWorker.js", import.meta.url);
const quiet = () => {};
const codeOf = (p) => p.then(() => "resolved", (err) => err.code ?? err.message);

section("RENDER_THREADS");
{
  assertEqual(renderThreadCount({}), DEFAULT_RENDER_THREADS, "unset: the default");
  assertEqual(DEFAULT_RENDER_THREADS, 3, "the default is 3 (VPS benchmark)");
  assertEqual(renderThreadCount({ RENDER_THREADS: "0" }), 0, "0: off");
  assertEqual(renderThreadCount({ RENDER_THREADS: "5" }), 5, "a number: that many");
  assertEqual(renderThreadCount({ RENDER_THREADS: "lots" }), 0, "not a number: off (main thread), not a guess");
  assertEqual(renderThreadCount({ RENDER_THREADS: "99" }), 16, "capped at 16");
}

section("Line order, priority and the wait limit");
{
  const pool = createRenderPool({ size: 1, workerUrl: FAKE, log: quiet });
  await pool.run("echo", ["warm", 0]); // the thread is up, so "a" starts at once
  const order = [];
  const track = (p, tag) => p.then((b) => { order.push(tag); return b.toString(); });
  const first = track(pool.run("echo", ["a", 150]), "a");
  const second = track(pool.run("echo", ["b", 0]), "b");
  const urgent = track(pool.run("echo", ["c", 0], { priority: true }), "c");
  const late = codeOf(pool.run("echo", ["d", 0], { waitMs: 30 }));
  assertEqual(await first, "a", "a job's image comes back");
  await Promise.all([second, urgent]);
  assertEqual(order, ["a", "c", "b"], "a priority job goes to the front of the line");
  assertEqual(await late, "RENDER_QUEUE_TIMEOUT", "a job not started within waitMs is dropped");
  const s = pool.status();
  assertEqual([s.completed, s.queueTimeouts, s.busy, s.queued], [4, 1, 0, 0], "status counts jobs and timeouts");
  await pool.close();
}

section("Failing and crashed threads");
{
  const pool = createRenderPool({ size: 1, workerUrl: FAKE, log: quiet });
  const failed = await pool.run("fail", ["bad sprite"]).catch((e) => e.message);
  assertEqual(failed, "bad sprite", "a renderer's error reaches the caller");
  assertEqual(await codeOf(pool.run("crash", [])), "RENDER_THREAD_CRASHED", "a crash rejects that job");
  assertEqual((await pool.run("echo", ["after", 0])).toString(), "after", "a new thread takes over");
  assertEqual(pool.status().crashes, 1, "the crash is counted");
  await pool.close();
}

section("Threads that can't start: back to the main thread");
{
  const lines = [];
  const pool = createRenderPool({ size: 1, workerUrl: FAKE, workerData: { failStart: true }, log: (l) => lines.push(l) });
  assertEqual(await codeOf(pool.run("echo", ["x", 0])), "RENDER_POOL_DOWN", "queued jobs are told the pool is down");
  assertTrue(pool.status().down !== null && lines.some((l) => l.includes("main thread")), "the pool shuts off and says so");
  const viaPool = threaded("echo", async () => Buffer.from("direct"), { pool: () => pool });
  assertEqual((await viaPool("x")).toString(), "direct", "threaded renderers fall back to the main thread");
  await pool.close();
}

section("Arguments that can't go to a thread");
{
  const pool = createRenderPool({ size: 1, workerUrl: FAKE, log: quiet });
  const warn = console.warn;
  console.warn = quiet;
  const viaPool = threaded("echo", async () => Buffer.from("direct"), { pool: () => pool });
  assertEqual((await viaPool(() => "a function")).toString(), "direct", "a function argument renders on the main thread");
  console.warn = warn;
  assertEqual((await pool.run("echo", ["still works", 0])).toString(), "still works", "the thread is free again afterwards");
  await pool.close();
}

section("cardImage with render threads");
{
  const GIF = Buffer.concat([Buffer.from("GIF89a"), Buffer.alloc(64)]);
  const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(64)]);
  const seen = [];
  const busy = async (animate) => {
    seen.push({ animate, ...renderOptions.getStore() });
    if (animate) {
      const err = new Error("busy");
      err.code = "RENDER_QUEUE_TIMEOUT";
      throw err;
    }
    return PNG;
  };
  const lines = [];
  const card = await cardImage(busy, "team", { pool: {}, env: {}, log: (l) => lines.push(l) });
  assertEqual(card.name, "team.png", "threads busy past the wait: the still PNG");
  assertEqual(seen, [{ animate: true, waitMs: 2000 }, { animate: false, priority: true }], "the GIF waits up to 2 s; the PNG goes to the front");
  assertTrue(/\(threads busy\)$/.test(lines[0]), `the log line says why (${lines[0]})`);

  const ok = await cardImage(async (a) => (a ? GIF : PNG), "team", { pool: {}, env: {}, log: quiet });
  assertEqual(ok.name, "team.gif", "a free thread: the GIF");
  const off = await cardImage(async (a) => (a ? GIF : PNG), "team", { pool: {}, env: { CARDS_ANIMATED: "0" }, log: quiet });
  assertEqual(off.name, "team.png", "CARDS_ANIMATED=0 still means PNG");
}

section("Real cards: a thread draws the same image as the main thread");
{
  const { RENDERERS } = await import("../utils/render/renderers.js");
  const { catchView } = await import("../utils/render/catchCard.js");
  const { CATCH_FIXTURES } = await import("./fixtures/showteamFixtures.js");
  const fx = CATCH_FIXTURES.newCommon;
  const view = catchView(fx.user, fx);
  const pool = createRenderPool({ size: 1, log: quiet });
  for (const animate of [false, true]) {
    const onThread = await pool.run("catch", [view, { animate }]);
    const onMain = await RENDERERS.catch(view, { animate });
    assertTrue(onThread.equals(onMain), `catch card (${animate ? "GIF" : "PNG"}) is identical`);
  }
  const { simulateBattle } = await import("../utils/battle/sim.js");
  const { renderBattleFrame } = await import("../utils/battle/render.js");
  const mon = (speciesId, name) => ({ speciesId, level: 50, variant: "normal", name });
  const sides = [{ name: "A", members: [mon(6, "Charizard"), mon(25, "Pikachu")] }, { name: "B", members: [mon(9, "Blastoise"), mon(3, "Venusaur")] }];
  const { snapshots } = simulateBattle({ sides, seed: 7 });
  const opts = { sides, hpBefore: snapshots[0], screens: [["The battle begins!", ""]] };
  const frame = await pool.run("battleFrame", [opts]);
  assertTrue(frame.equals(await renderBattleFrame({ ...opts, sprites: new Map() })), "battle frame is identical (thread uses its own sprite cache)");
  await pool.close();
}

section("Loop lag summary");
{
  const lines = [];
  const lag = startLoopLagMonitor({ intervalMs: 1e9, resolution: 10, log: (l) => lines.push(l) });
  assertEqual(lag.status(), null, "nothing to report before the first minute");
  await new Promise((r) => setTimeout(r, 50)); // let the monitor take its first readings
  const until = Date.now() + 120;
  while (Date.now() < until); // a deliberate stall
  await new Promise((r) => setTimeout(r, 30));
  lag.tick();
  const s = lag.status();
  lag.stop();
  assertTrue(s.maxMs >= 100, `a 120 ms stall shows in max (${s.maxMs} ms)`);
  assertTrue(/^⏱️ loop lag 1m: p50 \d+ ms p99 \d+ ms max \d+ ms$/.test(lines[0]), `one log line per minute (${lines[0]})`);
}

finish();
