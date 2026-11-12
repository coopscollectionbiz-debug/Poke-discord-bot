// ==========================================================
// utils/render/renderWorker.js
// One render thread (utils/render/renderPool.js). Receives
// { id, name, args }, runs RENDERERS[name](...args) and sends the image
// back as { id, bytes } (the ArrayBuffer is transferred, not copied), or
// { id, error, code } when rendering throws.
// ==========================================================

import { parentPort } from "worker_threads";
import { RENDERERS } from "./renderers.js";

parentPort.on("message", async ({ id, name, args }) => {
  try {
    const render = RENDERERS[name];
    if (!render) throw new Error(`unknown renderer "${name}"`);
    const buf = await render(...args);
    const bytes = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    parentPort.postMessage({ id, bytes }, [bytes]);
  } catch (err) {
    parentPort.postMessage({ id, error: err?.message || String(err), code: err?.code ?? null });
  }
});

parentPort.postMessage({ ready: true });
