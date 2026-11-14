// ==========================================================
// tests/viewState.test.js — public/shared/viewState.js: pages keep their
// filters and sort between visits (sessionStorage), and storage failures
// never break a page. Runs against a stub sessionStorage/window.
// ==========================================================

import { assertTrue, assertEqual, section, finish } from "./harness.js";

const store = new Map();
let broken = false;
globalThis.sessionStorage = {
  getItem: (k) => { if (broken) throw new Error("blocked"); return store.has(k) ? store.get(k) : null; },
  setItem: (k, v) => { if (broken) throw new Error("blocked"); store.set(k, String(v)); },
};
const listeners = {};
globalThis.window = { scrollY: 0, addEventListener: (t, f) => { (listeners[t] ??= []).push(f); }, scrollTo: (x, y) => { globalThis.window.scrollY = y; } };
globalThis.document = { visibilityState: "visible", addEventListener: () => {}, documentElement: { scrollHeight: 5000 } };
globalThis.requestAnimationFrame = (f) => f();

const { viewState, debounce } = await import("../public/shared/viewState.js");

section("Saved values come back on the next visit");
const a = viewState("collection", { q: "", sort: "dex", shiny: false });
assertEqual(a.get(), { q: "", sort: "dex", shiny: false }, "first visit: the defaults");
a.set({ sort: "level-desc", shiny: true });
const b = viewState("collection", { q: "", sort: "dex", shiny: false });
assertEqual(b.get(), { q: "", sort: "level-desc", shiny: true }, "next visit: the saved filters");
assertEqual(viewState("teams", { sort: "power" }).get(), { sort: "power" }, "pages don't share state");

section("Only declared keys, with the default's type");
store.set("cc:view:bag", JSON.stringify({ sort: 5, q: "dust", evil: "<script>" }));
assertEqual(viewState("bag", { sort: "", q: "" }).get(), { sort: "", q: "dust" }, "wrong type and unknown keys are dropped");
store.set("cc:view:dex", "{not json");
assertEqual(viewState("dex", { show: "all" }).get(), { show: "all" }, "corrupt storage: defaults");

section("Scroll position");
window.scrollY = 1234;
const c = viewState("pokedex", { show: "all" });
c.trackScroll();
for (const f of listeners.pagehide ?? []) f();
window.scrollY = 0;
viewState("pokedex", { show: "all" }).restoreScroll();
assertEqual(window.scrollY, 1234, "leaving saves the scroll, coming back restores it after render");

section("Storage blocked: the page still works");
broken = true;
const d = viewState("collection", { sort: "dex" });
assertEqual(d.get(), { sort: "dex" }, "reads fall back to defaults");
d.set({ sort: "name" });
assertEqual(d.get(), { sort: "name" }, "set still updates this visit");
broken = false;

section("debounce");
let calls = 0;
const f = debounce(() => calls++, 20);
f(); f(); f();
await new Promise((r) => setTimeout(r, 60));
assertEqual(calls, 1, "three quick calls run once");

finish();
