// ==========================================================
// public/shared/viewState.js — keep a page's filters, sort, mode and scroll
// position when the player goes to another dashboard page and comes back.
//
// Kept in sessionStorage: per browser tab, gone when the tab closes, never
// sent to the server. Storage can be missing or throw (private windows,
// blocked site data); every call then quietly does nothing and the page
// opens with its defaults.
//
//   const view = viewState("collection", { sort: "dex", q: "" });
//   view.get()            → saved values merged over the defaults
//   view.set({ sort })    → merge and save
//   view.trackScroll()    → remember window scroll on leave
//   view.restoreScroll()  → call once, after the first full render
// ==========================================================

const PREFIX = "cc:view:";

function read(key) {
  try {
    const raw = sessionStorage.getItem(PREFIX + key);
    const v = raw ? JSON.parse(raw) : null;
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch { return {}; }
}

function write(key, value) {
  try { sessionStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch { /* storage unavailable */ }
}

/** Only the keys the page declared, with the default's type. */
function clean(saved, defaults) {
  const out = {};
  for (const [k, d] of Object.entries(defaults)) {
    if (!(k in saved)) continue;
    const v = saved[k];
    if (typeof v === typeof d || (d === null && (typeof v === "string" || v === null))) out[k] = v;
  }
  return out;
}

export function viewState(page, defaults = {}) {
  let current = { ...defaults, ...clean(read(page), defaults) };
  let scrollY = Number(read(`${page}:scroll`).y) || 0;
  let tracking = false;
  const saveScroll = () => write(`${page}:scroll`, { y: Math.round(window.scrollY) });

  return {
    get: () => ({ ...current }),
    set(patch) {
      current = { ...current, ...patch };
      write(page, current);
    },
    trackScroll() {
      if (tracking) return;
      tracking = true;
      let t = null;
      window.addEventListener("scroll", () => { clearTimeout(t); t = setTimeout(saveScroll, 200); }, { passive: true });
      window.addEventListener("pagehide", saveScroll);
      document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") saveScroll(); });
    },
    restoreScroll() {
      const y = scrollY;
      scrollY = 0;
      if (!(y > 0)) return;
      // After layout: content is drawn from async data, so the browser's own
      // restore ran before the grid existed.
      requestAnimationFrame(() => window.scrollTo(0, Math.min(y, document.documentElement.scrollHeight)));
    },
  };
}

/** Put one value in the address bar (replaceState: no new history entry). */
export function setUrlParam(name, value) {
  try {
    const url = new URL(location.href);
    if (value == null || value === "") url.searchParams.delete(name);
    else url.searchParams.set(name, value);
    history.replaceState(history.state, "", url);
  } catch { /* ignore */ }
}

/** Run fn at most once per `ms` of quiet (search boxes). */
export function debounce(fn, ms = 120) {
  let t = null;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
