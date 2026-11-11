// ==========================================================
// public/shared/spriteFx.js — the Discord card backdrops, on the dashboard
//
// Browser ports of the two animated backdrops the rendered Discord cards
// draw (same recipes, same constants, same 24-frame × 100 ms loop):
//   • shiny Pokémon  — utils/render/shinyBackdrop.js: rising gold motes and
//                      twinkling stars (Legendary-tier gold #facc15), no halo
//   • Epic+ trainers — utils/render/trainerBackdrop.js: Epic purple halo +
//                      motes; Legendary amber halo + gold motes + twinkles;
//                      Mythic red/pink halo, motes, twinkles + meteor shower
// tests/spriteFx.test.js keeps the constants in step with the server files.
//
// Pixel art like the sprites: one backdrop cell = one sprite pixel at its
// on-screen size, tint stepped to a few levels with a 2×2 ordered dither,
// drawn on a small canvas scaled up with image-rendering: pixelated, behind
// the sprite. Nothing is placed where the sprite is (silhouette dilated 3
// cells), so it never passes behind the Pokémon or trainer.
//
// Usage: mark the sprite's box and call scanFx(root) after rendering.
//   <div data-fx="shiny" data-fx-seed="25"><img …></div>
//   <div data-fx="trainer" data-fx-tier="legendary"><img …></div>
// Only boxes on screen animate (IntersectionObserver); with
// prefers-reduced-motion the first frame is drawn and nothing moves.
// ==========================================================

export const FRAMES = 24;
export const DELAY_MS = 100;
export const SHINY_GOLD = [250, 204, 21]; // #facc15

const BAYER = [[0, 2], [3, 1]];
const rand = (seed) => { const s = Math.sin(seed * 12.9898) * 43758.5453; return s - Math.floor(s); };
function stepper(levels) {
  return (t, x, y) => {
    let i = 0;
    while (i < levels.length - 1 && levels[i + 1] <= t) i++;
    if (i === levels.length - 1) return levels[i];
    const lo = levels[i], hi = levels[i + 1];
    return ((t - lo) / (hi - lo)) * 4 > BAYER[y & 1][x & 1] + 0.5 ? hi : lo;
  };
}
export const backdropSeed = (id) => [...String(id)].reduce((s, c) => (s * 31 + c.charCodeAt(0)) % 9973, 7);

// ---------- shiny (utils/render/shinyBackdrop.js) ----------
export const SHINY = Object.freeze({ DILATE: 3, MARGIN: 2, LEVELS: [0, 0.07, 0.13, 0.2, 0.3, 0.45, 0.7], REF_AREA: 120 * 104 });

/**
 * @param solid Uint8Array(LW*LH): 1 where the sprite is (undilated)
 * @returns { draw(put, frame) } or null; put(x, y, rgb, alpha)
 */
export function shinyRecipe({ LW, LH, solid, seed = 1 }) {
  const { DILATE, MARGIN, LEVELS, REF_AREA } = SHINY;
  const stepped = stepper(LEVELS);
  const open = (x, y, r = 0) => {
    for (let dy = -r - DILATE; dy <= r + DILATE; dy++) for (let dx = -r - DILATE; dx <= r + DILATE; dx++) {
      const X = x + dx, Y = y + dy;
      if (X < 0 || Y < 0 || X >= LW || Y >= LH) continue;
      if (solid[Y * LW + X]) return false;
    }
    return x >= MARGIN && y >= MARGIN && x < LW - MARGIN && y < LH - MARGIN;
  };
  const count = Math.max(3, Math.min(8, Math.round((8 * LW * LH) / REF_AREA)));
  const stars = [];
  for (let i = 0; i < count; i++) {
    for (let t = 0; t < 200; t++) {
      const x = Math.round(MARGIN + rand(seed * 97 + i * 131 + t * 13 + 1) * (LW - 2 * MARGIN - 1));
      const y = Math.round(MARGIN + rand(seed * 61 + i * 71 + t * 7 + 3) * (LH - 2 * MARGIN - 1));
      if (open(x, y, 1) && !stars.some((p) => Math.abs(p.x - x) + Math.abs(p.y - y) < 6)) { stars.push({ x, y, ph: rand(i * 5 + 2 + seed) }); break; }
    }
  }
  const yLow = LH - 1 - MARGIN, yHigh = MARGIN, wob = 2;
  const columnOpen = (x) => { for (let y = yHigh; y <= yLow; y++) for (let d = -wob; d <= wob; d++) if (!open(x + d, y)) return false; return true; };
  const cols = [];
  for (let x = MARGIN + wob; x < LW - MARGIN - wob; x++) if (columnOpen(x)) cols.push(x);
  const motes = [];
  if (cols.length) for (let i = 0; i < count; i++) {
    motes.push({ x: cols[Math.floor(rand(seed * 13 + i * 29 + 5) * cols.length)], r: rand(i * 7 + 1 + seed), laps: 1 + (i % 2) });
  }
  if (!stars.length && !motes.length) return null;
  return {
    stars: stars.length,
    motes: motes.length,
    draw(put, frame) {
      const tint = new Map();
      const plot = (x, y, a) => {
        if (x < 0 || y < 0 || x >= LW || y >= LH || solid[y * LW + x]) return;
        const k = y * LW + x;
        if (a > (tint.get(k) ?? 0)) tint.set(k, a);
      };
      for (const m of motes) {
        const t = ((frame / FRAMES) * m.laps + m.r) % 1;
        const y = Math.round(yLow - t * (yLow - yHigh));
        const x = Math.round(m.x + Math.sin((t + m.r) * Math.PI * 2) * wob);
        plot(x, y, 0.75 * (t < 0.15 ? t / 0.15 : t > 0.75 ? (1 - t) / 0.25 : 1));
      }
      for (const st of stars) {
        const a = 0.25 + 0.6 * Math.max(0, Math.sin(((frame / FRAMES + st.ph) % 1) * Math.PI * 2));
        plot(st.x, st.y, a);
        if (a > 0.6) for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) plot(st.x + dx, st.y + dy, a * 0.5);
      }
      for (const [k, t] of tint) {
        const x = k % LW, y = (k - x) / LW;
        const a = stepped(Math.min(1, t), x, y);
        if (a > 0) put(x, y, SHINY_GOLD, a);
      }
    },
  };
}

// ---------- trainers (utils/render/trainerBackdrop.js) ----------
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const PURPLE = hex("#a855f7"), AMBER = hex("#f59e0b"), GOLD = hex("#facc15"), RED = hex("#ef4444"), PINK = hex("#f472b6");
export const TRAINER_TIERS = Object.freeze({
  epic: { halo: PURPLE, haloK: 1, accent: PURPLE, motes: 8 },
  legendary: { halo: AMBER, haloK: 0.55 / 0.6, accent: GOLD, motes: 8, twinkles: 8 },
  mythic: { halo: RED, haloK: (0.7 * 0.96) / 0.6, accent: RED, alt: PINK, motes: 12, twinkles: 8, meteors: true },
});
export const TRAINER_LEVELS = [0, 0.07, 0.13, 0.2, 0.3, 0.45, 0.7, 0.85];
export const hasTrainerBackdrop = (tier) => Boolean(TRAINER_TIERS[String(tier ?? "").toLowerCase()]);

/** mask: Uint8Array(W*H), 1 where the (dilated) trainer is. halo/floorRow in grid units. */
export function trainerRecipe({ tier, W, H, mask, halo, floorRow }) {
  const recipe = TRAINER_TIERS[String(tier ?? "").toLowerCase()];
  if (!recipe) return null;
  const N = FRAMES;
  const stepped = stepper(TRAINER_LEVELS);
  const inner = { x0: 2, y0: 2, x1: W - 3, y1: Math.min(H - 3, floorRow - 2) };
  const isOpen = (x, y, r = 0) => {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const X = x + dx, Y = y + dy;
      if (X < inner.x0 || Y < inner.y0 || X > inner.x1 || Y > inner.y1 || mask[Y * W + X]) return false;
    }
    return true;
  };
  const openSpot = (seed, r) => {
    for (let t = 0; t < 300; t++) {
      const x = Math.round(inner.x0 + rand(seed * 97 + t * 13 + 1) * (inner.x1 - inner.x0));
      const y = Math.round(inner.y0 + rand(seed * 61 + t * 7 + 3) * (inner.y1 - inner.y0));
      if (isOpen(x, y, r)) return [x, y];
    }
    return null;
  };
  const twinkles = [];
  for (let i = 0; i < (recipe.twinkles ?? 0); i++) {
    const s = openSpot(i + 11, 2);
    if (s) twinkles.push({ x: s[0], y: s[1], phase: rand(i * 5 + 2), alt: recipe.alt && i % 2 === 1 });
  }
  const motes = Array.from({ length: recipe.motes }, (_, i) => ({ r: rand(i * 7 + 1), x: rand(i * 13 + 5), alt: recipe.alt && i % 3 === 0 }));
  const meteors = [];
  if (recipe.meteors) {
    const ang = (40 * Math.PI) / 180, dx = -Math.cos(ang), dy = Math.sin(ang);
    const bands = [[0.06, 0.24, 30, 13], [0.25, 0.49, 18, 9], [0.5, 0.74, 18, 9], [0.75, 0.92, 14, 8]];
    const n = Math.max(1, Math.round((N * 5) / 40));
    const starts = [2, 10, 17, 25, 33, 6, 14, 21].slice(0, n).map((s) => Math.round((s * N) / 40) % N);
    const order = [0, 2, 1, 3, 0, 2, 3, 1];
    const fits = (x0, y0, travel, tail) => {
      for (let s = 0; s <= travel; s++) for (let t = -1; t <= tail; t++) if (!isOpen(Math.round(x0 + dx * (s - t)), Math.round(y0 + dy * (s - t)))) return false;
      return true;
    };
    for (let k = 0; k < n; k++) {
      for (const bi of [order[k], ...[0, 1, 2, 3].filter((i) => i !== order[k])]) {
        const [lo, hi, travel, tail] = bands[bi];
        const cands = [];
        for (let y = Math.round(inner.y1 * lo); y <= Math.round(inner.y1 * hi); y++) for (let x = inner.x0; x <= inner.x1; x++) if (fits(x, y, travel, tail)) cands.push([x, y]);
        if (!cands.length) continue;
        const [x0, y0] = cands[Math.floor(rand(k * 53 + 7) * cands.length)];
        meteors.push({ x0, y0, travel, tail, dx, dy, start: starts[k], life: Math.min(9, Math.max(6, Math.round(travel / 4))) });
        break;
      }
    }
  }
  const tint = new Float32Array(W * H), col = new Array(W * H);
  const plot = (x, y, a, c) => {
    if (x < 0 || y < 0 || x >= W || y >= H || mask[y * W + x]) return;
    const i = y * W + x;
    if (a > tint[i]) { tint[i] = a; col[i] = c; }
  };
  const sparkle = (x, y, a, arm, c) => {
    plot(x, y, a, c);
    for (let k = 1; k <= arm; k++) { const ak = a * (1 - k / (arm + 1)); plot(x - k, y, ak, c); plot(x + k, y, ak, c); plot(x, y - k, ak, c); plot(x, y + k, ak, c); }
  };
  return {
    meteors: meteors.length,
    twinkles: twinkles.length,
    draw(put, f) {
      tint.fill(0);
      col.fill(null);
      const k = 0.6 * recipe.haloK;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const d = Math.hypot((x - halo.cx) / halo.rx, (y - halo.cy) / halo.ry);
        if (d < 1) { const i = y * W + x; tint[i] = 0.24 * (1 - d) * k; col[i] = recipe.halo; }
      }
      for (const m of motes) {
        const t = (f / N + m.r) % 1;
        const y = Math.round(inner.y1 - 4 - t * (inner.y1 - inner.y0 - 6));
        const x = Math.round(inner.x0 + 4 + m.x * (inner.x1 - inner.x0 - 8) + Math.sin((t + m.r) * Math.PI * 2) * 2);
        plot(x, y, 0.75 * (t < 0.15 ? t / 0.15 : t > 0.75 ? (1 - t) / 0.25 : 1), m.alt ? PINK : recipe.accent);
      }
      for (const s of twinkles) {
        const a = 0.25 + 0.6 * Math.max(0, Math.sin(((f / N + s.phase) % 1) * Math.PI * 2));
        sparkle(s.x, s.y, a, a > 0.6 ? 1 : 0, s.alt ? PINK : recipe.accent);
      }
      for (const m of meteors) {
        const step = (((f - m.start) % N) + N) % N;
        if (step > m.life) continue;
        const p = step / m.life;
        const ramp = Math.min(1, (p + 0.12) / 0.4) * Math.min(1, (1 - p + 0.08) / 0.43);
        const len = Math.max(2, Math.round(m.tail * Math.min(1, (p + 0.15) / 0.45)));
        const hx = m.x0 + m.dx * m.travel * p, hy = m.y0 + m.dy * m.travel * p;
        for (let t = 1; t <= len; t++) plot(Math.round(hx - m.dx * t), Math.round(hy - m.dy * t), (0.85 - (t / m.tail) * 0.7) * ramp, t % 3 === 1 ? PINK : RED);
        sparkle(Math.round(hx), Math.round(hy), ramp, ramp > 0.6 ? 1 : 0, [255, 245, 245]);
      }
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (!tint[i]) continue;
        const a = stepped(Math.min(1, tint[i]), x, y);
        if (a) put(x, y, col[i] ?? recipe.accent, a);
      }
    },
  };
}

// ---------- browser mounting ----------
const reduceMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const live = new Set(); // { box, canvas, ctx, img, recipe, W, H, visible, frame }
let io = null;
let timer = null;

/** Sprite alpha → grid cells (k×k sprite pixels per cell), offset (ox, oy) in sprite pixels. */
function silhouette(img, W, H, ox, oy, k = 1) {
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  let data;
  try { data = g.getImageData(0, 0, c.width, c.height).data; } catch { return null; } // cross-origin: skip
  const solid = new Uint8Array(W * H);
  for (let sy = 0; sy < c.height; sy++) for (let sx = 0; sx < c.width; sx++) {
    if (data[(sy * c.width + sx) * 4 + 3] <= 8) continue;
    const gx = Math.floor((ox + sx) / k), gy = Math.floor((oy + sy) / k);
    if (gx >= 0 && gy >= 0 && gx < W && gy < H) solid[gy * W + gx] = 1;
  }
  return solid;
}

function dilate(solid, W, H, r) {
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!solid[y * W + x]) continue;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const X = x + dx, Y = y + dy;
      if (X >= 0 && Y >= 0 && X < W && Y < H) out[Y * W + X] = 1;
    }
  }
  return out;
}

function mount(box) {
  const img = box.querySelector("img");
  if (!img || !img.naturalWidth) return;
  box.querySelector(":scope > canvas.cc-fx")?.remove();
  const br = box.getBoundingClientRect(), ir = img.getBoundingClientRect();
  if (br.width < 24 || br.height < 24 || ir.width < 4) return;
  // One cell = k whole sprite pixels on screen (at least ~2 CSS px, like the
  // Discord cards' 2 px cells), aligned to the sprite's own pixel grid.
  const u = ir.width / img.naturalWidth;
  const k = Math.max(1, Math.round(2 / u));
  const c = u * k;
  const X0 = ir.left - c * Math.floor((ir.left - br.left) / c);
  const Y0 = ir.top - c * Math.floor((ir.top - br.top) / c);
  const W = Math.floor((br.right - X0) / c), H = Math.floor((br.bottom - Y0) / c);
  const ox = Math.round((ir.left - X0) / u), oy = Math.round((ir.top - Y0) / u); // sprite pixels
  if (W < 12 || H < 12) return;
  const solid = silhouette(img, W, H, ox, oy, k);
  if (!solid) return;
  const kind = box.dataset.fx;
  let recipe = null;
  if (kind === "shiny") recipe = shinyRecipe({ LW: W, LH: H, solid, seed: backdropSeed(box.dataset.fxSeed ?? 1) });
  else if (kind === "trainer") {
    const h = img.naturalHeight;
    recipe = trainerRecipe({
      tier: box.dataset.fxTier, W, H, mask: dilate(solid, W, H, 3),
      halo: { cx: (ox + img.naturalWidth / 2) / k, cy: (oy + h * 0.45) / k, rx: 40 / k, ry: 54 / k },
      floorRow: Math.min(H, Math.floor((oy + h) / k)), // the trainer's feet
    });
  }
  if (!recipe) return;
  const canvas = document.createElement("canvas");
  canvas.className = "cc-fx";
  canvas.width = W;
  canvas.height = H;
  canvas.setAttribute("aria-hidden", "true");
  Object.assign(canvas.style, {
    position: "absolute", left: `${X0 - br.left}px`, top: `${Y0 - br.top}px`,
    width: `${W * c}px`, height: `${H * c}px`, imageRendering: "pixelated", pointerEvents: "none", zIndex: "0",
  });
  if (getComputedStyle(box).position === "static") box.style.position = "relative";
  if (!img.style.position) img.style.position = "relative";
  if (!img.style.zIndex) img.style.zIndex = "1";
  box.prepend(canvas);
  const fx = { box, canvas, ctx: canvas.getContext("2d"), recipe, W, H, visible: true, frame: -1 };
  live.add(fx);
  draw(fx, currentFrame());
  io ??= new IntersectionObserver((entries) => {
    for (const e of entries) for (const f of live) if (f.box === e.target) f.visible = e.isIntersecting;
  });
  io.observe(box);
  startTimer();
}

function draw(fx, frame) {
  if (fx.frame === frame) return;
  fx.frame = frame;
  const img = fx.ctx.createImageData(fx.W, fx.H);
  fx.recipe.draw((x, y, c, a) => { const i = (y * fx.W + x) * 4; img.data[i] = c[0]; img.data[i + 1] = c[1]; img.data[i + 2] = c[2]; img.data[i + 3] = Math.round(a * 255); }, frame);
  fx.ctx.putImageData(img, 0, 0);
}

const currentFrame = () => (reduceMotion() ? 0 : Math.floor(performance.now() / DELAY_MS) % FRAMES);

function startTimer() {
  if (timer || reduceMotion()) return;
  timer = setInterval(() => {
    const f = currentFrame();
    for (const fx of live) {
      if (!fx.box.isConnected) { live.delete(fx); io?.unobserve(fx.box); continue; }
      if (fx.visible && !document.hidden) draw(fx, f);
    }
    if (!live.size) { clearInterval(timer); timer = null; }
  }, DELAY_MS);
}

// Layout changes (resize, rotation) move the sprites: re-place every backdrop.
let resizeT = null;
if (typeof window !== "undefined") window.addEventListener("resize", () => {
  clearTimeout(resizeT);
  resizeT = setTimeout(() => { for (const fx of [...live]) { live.delete(fx); if (fx.box.isConnected) mount(fx.box); } }, 150);
});

/** Mount backdrops on every [data-fx] box under root (once each sprite has loaded). */
export function scanFx(root = document) {
  for (const box of root.querySelectorAll("[data-fx]")) {
    const img = box.querySelector("img");
    if (!img) continue;
    if (img.complete && img.naturalWidth) mount(box);
    else img.addEventListener("load", () => mount(box), { once: true });
  }
}
