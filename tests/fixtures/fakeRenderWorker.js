// A stand-in render thread for tests/renderPool.test.js. Renderers:
//   echo(text, delayMs)  → Buffer of `text` after delayMs
//   fail(message)        → throws
//   crash()              → the thread exits with code 1
import { parentPort, workerData } from "worker_threads";

if (workerData?.failStart) throw new Error("cannot start");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
parentPort.on("message", async ({ id, name, args }) => {
  try {
    if (name === "crash") process.exit(1);
    if (name === "fail") throw new Error(args[0]);
    await sleep(args[1] ?? 0);
    const buf = Buffer.from(String(args[0]));
    const bytes = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    parentPort.postMessage({ id, bytes }, [bytes]);
  } catch (err) {
    parentPort.postMessage({ id, error: err.message, code: null });
  }
});
parentPort.postMessage({ ready: true });
