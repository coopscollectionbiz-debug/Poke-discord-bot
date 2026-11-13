// ==========================================================
// public/shared/shell.js — dashboard shell shared by every player page
//   • navigation: desktop sidebar + phone tab bar, real <a href> links
//     carrying ?id=, aria-current="page" on the current page
//   • session expiry: any /api/* 403 shows one consistent message
//   • toasts (role="status") and in-page dialogs replacing alert()
//   • keyboard/screen-reader support for the pages' JS-built modals
// Import it first: <script type="module" src="/public/shared/shell.js">.
// The page is chosen by <body data-page="overview|pokemon|teams|battle|records|trainers|bag|achievements|shop">.
// No game logic lives here; the only API call is GET /api/battle/enabled for the nav.
// ==========================================================

export const EXPIRED_MESSAGE = "Your dashboard link expired — run /dashboard in Discord.";
export const MISSING_ID_MESSAGE = "This page needs your dashboard link — run /dashboard in Discord.";

export const NAV_ITEMS = Object.freeze([
  { key: "overview", label: "Overview", short: "Home", href: "/public/overview/", icon: "home" },
  { key: "pokemon", label: "Collection", short: "Box", href: "/public/picker-pokemon/", icon: "box" },
  { key: "pokedex", label: "Pokédex", short: "Dex", href: "/public/pokedex/", icon: "dex" },
  { key: "teams", label: "Teams", href: "/public/teams/", icon: "teams" },
  // Shown only while DASHBOARD_FIGHTS_ENABLED is on (GET /api/battle/enabled).
  { key: "battle", label: "Battle", href: "/public/battle/", icon: "bolt", flag: "battle" },
  { key: "records", label: "Battle Records", short: "Records", href: "/public/battlerecords/", icon: "swords" },
  { key: "trainers", label: "Trainers", href: "/public/picker/", icon: "person" },
  { key: "bag", label: "Bag", href: "/public/bag/", icon: "bag" },
  { key: "achievements", label: "Achievements", short: "Awards", href: "/public/achievements/", icon: "star" },
  { key: "shop", label: "Shop", href: "/public/dashboardshop/", icon: "shop" },
]);

const ICONS = `
<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false">
  <symbol id="cc-i-box" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><rect x="14" y="3" width="7" height="7" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><rect x="3" y="14" width="7" height="7" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><rect x="14" y="14" width="7" height="7" rx="2" fill="none" stroke="currentColor" stroke-width="2"/></symbol>
  <symbol id="cc-i-dex" viewBox="0 0 24 24"><rect x="4" y="3" width="16" height="18" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="10" r="3" fill="none" stroke="currentColor" stroke-width="2"/><path stroke="currentColor" stroke-width="2" d="M8 17h8"/></symbol>
  <symbol id="cc-i-home" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2" d="M3 11 12 4l9 7v9h-6v-6H9v6H3z"/></symbol>
  <symbol id="cc-i-teams" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path stroke="currentColor" stroke-width="2" d="M3 12h6m6 0h6"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/></symbol>
  <symbol id="cc-i-swords" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M4 4l10 10M4 4h4M4 4v4M20 4 10 14M20 4h-4M20 4v4M7 17l3-3M14 14l3 3M5 19l2-2M19 19l-2-2"/></symbol>
  <symbol id="cc-i-bolt" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" d="M13 2 4 14h7l-1 8 9-12h-7z"/></symbol>
  <symbol id="cc-i-bag" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2" d="M5 8h14l-1 13H6zM9 8V6a3 3 0 0 1 6 0v2"/></symbol>
  <symbol id="cc-i-star" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2" d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/></symbol>
  <symbol id="cc-i-person" viewBox="0 0 24 24"><circle cx="12" cy="8" r="4" fill="none" stroke="currentColor" stroke-width="2"/><path fill="none" stroke="currentColor" stroke-width="2" d="M4 21c1-4 4-6 8-6s7 2 8 6"/></symbol>
  <symbol id="cc-i-shop" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2" d="M4 9h16l-1-5H5zM5 9v11h14V9M9 20v-6h6v6"/></symbol>
</svg>`;

export const playerId = () => new URLSearchParams(window.location.search).get("id");

/** Link to a dashboard page for this player (keeps ?id=). */
export function pageHref(href, id = playerId()) {
  return id ? `${href}?id=${encodeURIComponent(id)}` : href;
}

// short: the phone tab bar's label when the full one doesn't fit six tabs.
function navList(active, id, { short = false } = {}) {
  const ul = document.createElement("ul");
  ul.className = "cc-nav-list";
  for (const item of NAV_ITEMS) {
    const li = document.createElement("li");
    if (item.flag) {
      li.dataset.flag = item.flag;
      li.hidden = !flagOn(item.flag) && item.key !== active;
    }
    const a = document.createElement("a");
    a.className = "cc-nav-link";
    a.href = pageHref(item.href, id);
    if (item.key === active) a.setAttribute("aria-current", "page");
    a.innerHTML = `<svg aria-hidden="true" focusable="false"><use href="#cc-i-${item.icon}"/></svg>`;
    const label = document.createElement("span");
    label.textContent = short && item.short ? item.short : item.label;
    if (short && item.short) a.setAttribute("aria-label", item.label);
    a.append(label);
    li.append(a);
    ul.append(li);
  }
  return ul;
}

// Flagged nav items: remembered for the tab's session so the nav doesn't jump on every page.
const FLAG_KEY = (flag) => `cc-flag-${flag}`;
function flagOn(flag) {
  try { return sessionStorage.getItem(FLAG_KEY(flag)) === "1"; } catch { return false; }
}
async function syncFlags() {
  try {
    const res = await fetch("/api/battle/enabled", { credentials: "same-origin" });
    const on = res.ok && (await res.json()).enabled === true;
    try { sessionStorage.setItem(FLAG_KEY("battle"), on ? "1" : "0"); } catch { /* storage blocked */ }
    for (const li of document.querySelectorAll('li[data-flag="battle"]')) li.hidden = !on;
  } catch { /* offline: keep what's shown */ }
}

function mountShell() {
  const body = document.body;
  if (!body || body.dataset.ccShell === "on") return;
  body.dataset.ccShell = "on";
  body.classList.add("cc-shell");
  const active = body.dataset.page || "";
  const id = playerId();

  body.insertAdjacentHTML("afterbegin", ICONS);

  const skip = document.createElement("a");
  skip.className = "cc-skip";
  skip.href = "#ccMain";
  skip.textContent = "Skip to content";

  const side = document.createElement("nav");
  side.className = "cc-sidebar";
  side.setAttribute("aria-label", "Dashboard");
  const brand = document.createElement("div");
  brand.className = "cc-brand";
  brand.innerHTML = `<i aria-hidden="true"></i><span>Coop’s Collection</span>`;
  const foot = document.createElement("p");
  foot.className = "cc-sidebar-foot";
  foot.textContent = "Opened from /dashboard in Discord. Sessions last 30 minutes after your last action, up to 4 hours. ";
  const credits = document.createElement("a");
  credits.href = "/credits";
  credits.target = "_blank";
  credits.rel = "noopener";
  credits.textContent = "Sprite credits";
  foot.append(credits);
  side.append(brand, navList(active, id), foot);

  const tabs = document.createElement("nav");
  tabs.className = "cc-tabbar";
  tabs.setAttribute("aria-label", "Dashboard");
  tabs.append(navList(active, id, { short: true }));

  body.prepend(skip, side);
  body.append(tabs);

  // Status area (banners) sits right under the page header.
  if (!document.getElementById("ccStatus")) {
    const status = document.createElement("div");
    status.id = "ccStatus";
    const head = document.querySelector(".cc-page-head");
    if (head) head.after(status);
    else side.after(status);
  }

  const toasts = document.createElement("div");
  toasts.id = "ccToasts";
  toasts.setAttribute("role", "status");
  toasts.setAttribute("aria-live", "polite");
  body.append(toasts);

  if (!id) showBanner(MISSING_ID_MESSAGE, { tone: "error", key: "missing-id" });
  syncFlags();
}

// ----------------------------------------------------------
// Banners, toasts, dialogs
// ----------------------------------------------------------
/** Persistent in-page message in the game text-box style. */
export function showBanner(message, { tone = "error", key = null, title = null } = {}) {
  const host = document.getElementById("ccStatus");
  if (!host) return null;
  if (key && host.querySelector(`[data-key="${key}"]`)) return host.querySelector(`[data-key="${key}"]`);
  const box = document.createElement("div");
  box.className = `cc-banner cc-banner--${tone}`;
  box.setAttribute("role", tone === "error" ? "alert" : "status");
  if (key) box.dataset.key = key;
  const text = document.createElement("div");
  if (title) {
    const t = document.createElement("strong");
    t.textContent = title;
    text.append(t);
  }
  const p = document.createElement("p");
  p.textContent = message;
  text.append(p);
  box.append(text);
  host.append(box);
  return box;
}

let expired = false;
export const isExpired = () => expired;

/** One consistent expiry message on every page; safe to call repeatedly. */
export function showExpired() {
  if (!expired) {
    expired = true;
    document.body.classList.add("cc-expired");
    // Close any JS-built modal so the message isn't hidden behind it.
    document.querySelectorAll(".overlay, #trainerModalOverlay, #shopModalOverlay").forEach((o) => o.remove());
    window.hideProcessing?.();
  }
  const box = showBanner(EXPIRED_MESSAGE, { tone: "error", key: "expired", title: "Session expired" });
  box?.scrollIntoView?.({ block: "center" });
}

/** Auto-dismissing toast (4 s), announced politely. */
export function toast(message, { tone = "info", timeout = 4000 } = {}) {
  const host = document.getElementById("ccToasts");
  if (!host) return;
  const t = document.createElement("div");
  t.className = `cc-toast cc-toast--${tone}`;
  t.textContent = message;
  host.append(t);
  setTimeout(() => t.remove(), timeout);
}

/** In-page replacement for alert(): resolves when dismissed. */
/**
 * In-page yes/no dialog (replaces confirm()). Resolves true for OK.
 */
export function confirmDialog({ title, message = "", okText = "OK", cancelText = "Cancel", tone = "info" }) {
  return new Promise((resolve) => {
    const d = document.createElement("dialog");
    d.className = `cc-dialog${tone === "error" ? " is-error" : ""}`;
    const h = document.createElement("h2");
    h.textContent = title;
    h.id = `ccDialog${Date.now()}`;
    d.setAttribute("aria-labelledby", h.id);
    const p = document.createElement("p");
    p.textContent = message;
    const row = document.createElement("div");
    row.className = "cc-dialog-actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "cc-btn";
    cancel.textContent = cancelText;
    const ok = document.createElement("button");
    ok.type = "button";
    ok.className = `cc-btn ${tone === "error" ? "cc-btn--danger" : "cc-btn--primary"}`;
    ok.textContent = okText;
    let result = false;
    cancel.addEventListener("click", () => d.close());
    ok.addEventListener("click", () => { result = true; d.close(); });
    row.append(cancel, ok);
    d.append(h, ...(message ? [p] : []), row);
    d.addEventListener("close", () => { d.remove(); resolve(result); });
    document.body.append(d);
    d.showModal();
    cancel.focus();
  });
}

export function showMessage({ title, message = "", tone = "info", okText = "OK" }) {
  return new Promise((resolve) => {
    const d = document.createElement("dialog");
    d.className = `cc-dialog${tone === "error" ? " is-error" : ""}`;
    const h = document.createElement("h2");
    h.textContent = title;
    h.id = `ccDialog${Date.now()}`;
    d.setAttribute("aria-labelledby", h.id);
    const p = document.createElement("p");
    p.textContent = message;
    const row = document.createElement("div");
    row.className = "cc-dialog-actions";
    const ok = document.createElement("button");
    ok.type = "button";
    ok.className = `cc-btn ${tone === "error" ? "cc-btn--danger" : "cc-btn--primary"}`;
    ok.textContent = okText;
    ok.addEventListener("click", () => d.close());
    row.append(ok);
    d.append(h, ...(message ? [p] : []), row);
    d.addEventListener("close", () => { d.remove(); resolve(); });
    document.body.append(d);
    d.showModal();
    ok.focus();
  });
}

/** Error from a failed action: expiry gets the banner, anything else a dialog. */
export function showActionError(err, fallbackTitle = "Something went wrong") {
  if (err?.status === 403 || expired) return showExpired();
  return showMessage({ title: fallbackTitle, message: err?.message || "Please try again.", tone: "error" });
}

// ----------------------------------------------------------
// Session expiry: every /api/* call goes through fetch, so one hook
// gives every page (and every action) the same 403 handling.
// ----------------------------------------------------------
if (typeof window !== "undefined" && window.fetch && !window.fetch.__ccWrapped) {
  const nativeFetch = window.fetch.bind(window);
  const wrapped = async (input, init) => {
    const res = await nativeFetch(input, init);
    try {
      const url = new URL(typeof input === "string" ? input : input.url, window.location.href);
      if (res.status === 403 && url.origin === window.location.origin && url.pathname.startsWith("/api/")) showExpired();
    } catch {
      /* never let the hook break a request */
    }
    return res;
  };
  wrapped.__ccWrapped = true;
  window.fetch = wrapped;
}

// ----------------------------------------------------------
// The pages' existing JS-built modals (.overlay, #trainerModalOverlay,
// #shopModalOverlay): add dialog semantics, move focus in, trap Tab,
// close on Escape (via the modal's own Cancel/OK), restore focus.
// ----------------------------------------------------------
const MODAL_SELECTOR = ".overlay, #trainerModalOverlay, #shopModalOverlay";
const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
const openModals = [];

function enhanceModal(overlay) {
  if (overlay.dataset.ccModal) return;
  overlay.dataset.ccModal = "1";
  const box = overlay.firstElementChild || overlay;
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  const heading = overlay.querySelector("h2");
  if (heading) {
    heading.id ||= `ccModalTitle${Math.random().toString(36).slice(2, 8)}`;
    overlay.setAttribute("aria-labelledby", heading.id);
  }
  box.tabIndex = -1;
  openModals.push({ overlay, returnTo: document.activeElement });
  // Content (and buttons) is often filled in right after the overlay is added.
  requestAnimationFrame(() => {
    if (!overlay.isConnected) return;
    const first = overlay.querySelector(".cancel-btn, .cancel, .ok-btn") || overlay.querySelector(FOCUSABLE);
    (first || box).focus({ preventScroll: true });
  });
}

function releaseModal(overlay) {
  const i = openModals.findIndex((m) => m.overlay === overlay);
  if (i < 0) return;
  const [{ returnTo }] = openModals.splice(i, 1);
  const next = openModals[openModals.length - 1];
  if (next) next.overlay.querySelector(FOCUSABLE)?.focus({ preventScroll: true });
  else if (returnTo?.isConnected) returnTo.focus({ preventScroll: true });
}

if (typeof document !== "undefined") {
  new MutationObserver((records) => {
    for (const r of records) {
      r.addedNodes.forEach((n) => n.nodeType === 1 && n.matches?.(MODAL_SELECTOR) && enhanceModal(n));
      r.removedNodes.forEach((n) => n.nodeType === 1 && n.matches?.(MODAL_SELECTOR) && releaseModal(n));
    }
  }).observe(document.documentElement, { childList: true, subtree: true });

  document.addEventListener("keydown", (e) => {
    const top = openModals[openModals.length - 1]?.overlay;
    if (!top || !top.isConnected) return;
    if (e.key === "Escape") {
      const enabled = [...top.querySelectorAll("button")].filter((b) => !b.disabled);
      const btn =
        [...top.querySelectorAll(".cancel-btn, .cancel, .ok-btn")].find((b) => !b.disabled) ||
        (enabled.length === 1 ? enabled[0] : null); // a lone "OK" dismisses
      if (btn) { e.preventDefault(); btn.click(); }
      return;
    }
    if (e.key === "Tab") {
      const items = [...top.querySelectorAll(FOCUSABLE)].filter((x) => x.offsetParent !== null);
      if (!items.length) { e.preventDefault(); return; }
      const first = items[0], last = items[items.length - 1];
      if (!top.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  /** Make a click-only card operable with Enter/Space (role="button"). */
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const t = e.target;
    if (t?.dataset?.ccActivate === "1") { e.preventDefault(); t.click(); }
  });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mountShell);
  else mountShell();
}
