// ==========================================================
// public/bag/script.js — read-only Bag view (Release B)
// Data comes from GET /api/inventory (server-built rows from the item
// catalog). All text is inserted with textContent, never as HTML.
// ==========================================================

const params = new URLSearchParams(window.location.search);
const userId = params.get("id");
const $ = (id) => document.getElementById(id);
let rows = [];

function nav() {
  if (!userId) return;
  const go = (path) => () => (window.location.href = `${path}?id=${encodeURIComponent(userId)}`);
  $("goPokemon").onclick = go("/public/picker-pokemon/");
  $("goTrainers").onclick = go("/public/picker/");
  $("goShop").onclick = go("/public/dashboardshop/");
  $("goBag").onclick = go("/public/bag/");
  $("goAchievements").onclick = go("/public/achievements/");
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function render() {
  const grid = $("bagGrid");
  grid.replaceChildren();
  const q = $("bagSearch").value.trim().toLowerCase();
  const sort = $("bagSort").value;
  let list = rows.filter((r) => !q || r.name.toLowerCase().includes(q) || r.description.toLowerCase().includes(q));
  if (sort === "name") list = [...list].sort((a, b) => a.name.localeCompare(b.name));
  if (sort === "quantity") list = [...list].sort((a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name));

  if (!list.length) {
    $("bagStatus").textContent = "";
    grid.append(el("p", "bag-empty", rows.length ? "No items match your search." :
      $("bagCategory").value ? "You have no items in this category." :
      "Your bag is empty. Evolution Stones come from /daily, and Shiny Dust from donating Pokémon."));
    return;
  }
  $("bagStatus").textContent = `${list.length} item type${list.length === 1 ? "" : "s"}`;

  for (const r of list) {
    const card = el("div", "shop-item bag-item");
    if (r.icon) {
      const img = el("img", "item-icon");
      img.src = `/public/sprites/${r.icon}`;
      img.alt = "";
      img.onerror = () => img.remove();
      card.append(img);
    }
    card.append(el("h3", null, r.name));
    card.append(el("p", "qty", `×${Number(r.quantity).toLocaleString()}`));
    card.append(el("p", "desc", r.description));
    card.append(el("p", "usage", r.usage));
    card.append(el("span", "bag-badge", `${r.categoryLabel} · ${r.rarity}`));
    if (!r.known) card.append(el("span", "bag-badge inactive", "legacy item"));
    else if (r.status !== "active") card.append(el("span", "bag-badge inactive", "not usable yet"));
    grid.append(card);
  }
}

async function load() {
  const category = $("bagCategory").value;
  const url = `/api/inventory?id=${encodeURIComponent(userId)}${category ? `&category=${encodeURIComponent(category)}` : ""}`;
  $("bagStatus").textContent = "Loading…";
  let res;
  try {
    res = await fetch(url, { credentials: "same-origin" });
  } catch {
    $("bagStatus").textContent = "Network error. Please try again.";
    return;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) {
    $("bagStatus").textContent =
      res.status === 403 ? "Your session expired. Open a new link with /dashboard in Discord." : data.error || "Could not load your bag.";
    return;
  }
  const select = $("bagCategory");
  if (select.options.length === 1) {
    for (const c of data.categories || []) {
      const o = el("option", null, `${c.emoji} ${c.label}`);
      o.value = c.key;
      select.append(o);
    }
  }
  rows = Array.isArray(data.items) ? data.items : [];
  render();
}

nav();
if (!userId) {
  $("bagStatus").textContent = "Missing player id. Open the dashboard from Discord with /dashboard.";
} else {
  $("bagCategory").onchange = load;
  $("bagSort").onchange = render;
  $("bagSearch").oninput = render;
  load();
}
