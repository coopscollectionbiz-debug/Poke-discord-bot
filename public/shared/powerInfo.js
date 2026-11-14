// ==========================================================
// public/shared/powerInfo.js — the "What is Power?" explainer.
// powerInfoButton() returns a small ⓘ button; any click on one (on any page
// that imports this module) opens the same short dialog. Text only, no data.
// ==========================================================

export const RANKED_LEVEL = 50; // utils/battle/tuning.js RANKED.level

export function powerInfoButton(label = "What is Power?") {
  return `<button type="button" class="cc-info-btn" data-power-info aria-label="${label}" title="${label}">i</button>`;
}

function open() {
  const last = document.activeElement;
  const d = document.createElement("dialog");
  d.className = "cc-dialog cc-powerinfo";
  d.setAttribute("aria-labelledby", "powerInfoTitle");
  d.innerHTML = `
    <h2 id="powerInfoTitle">What is Power?</h2>
    <p><b>Power</b> is a Pokémon's six stats added up: HP, Attack, Defense, Sp. Atk, Sp. Def and Speed.</p>
    <p><b>Ranked and wager battles set every Pokémon to Lv ${RANKED_LEVEL}</b>, so there only the species (or its Mega form) decides Power. A Lv 30 Garchomp and a Lv 90 Garchomp have the same Power at Lv ${RANKED_LEVEL}.</p>
    <p>Your real Level still matters: it decides which moves a Pokémon knows, and casual battles, /challenge and Trainer encounters use it.</p>
    <p class="tm-sub">Held items aren't counted. They work during the battle.</p>
    <div class="tm-moves-actions" style="margin-top:12px"><button type="button" class="cc-btn cc-btn--primary" data-close>Got it</button></div>`;
  document.body.append(d);
  const close = () => { if (d.open) d.close(); d.remove(); last?.focus?.({ preventScroll: true }); };
  d.querySelector("[data-close]").onclick = close;
  d.addEventListener("cancel", (e) => { e.preventDefault(); close(); });
  d.addEventListener("click", (e) => { if (e.target === d) close(); });
  d.showModal();
  d.querySelector("[data-close]").focus();
}

if (typeof document !== "undefined" && !globalThis.__ccPowerInfo) {
  globalThis.__ccPowerInfo = true;
  document.addEventListener("click", (e) => {
    const b = e.target.closest?.("[data-power-info]");
    if (!b) return;
    e.preventDefault();
    e.stopPropagation();
    open();
  }, true);
}
