import fs from "fs/promises";

const FILE_PATH = "public/pokemonData.json";

let cache = null;           // parsed object
let lastLoadedAt = 0;       // ms
let loadingPromise = null;  // de-dupe concurrent loads

// How often you're willing to re-read disk (optional)
const TTL_MS = 5 * 60 * 1000; // 5 minutes

export async function getPokemonDataCached({ force = false } = {}) {
  const now = Date.now();

  // Serve cache if fresh
  if (!force && cache && (now - lastLoadedAt) < TTL_MS) return cache;

  // If another request is already loading, wait for it
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    const raw = await fs.readFile(FILE_PATH, "utf8");
    const parsed = JSON.parse(raw);

    // Basic sanity
    if (!parsed || typeof parsed !== "object") {
      throw new Error("pokemonData.json parsed invalid");
    }

    cache = parsed;
    lastLoadedAt = Date.now();
    return cache;
  })();

  try {
    return await loadingPromise;
  } finally {
    loadingPromise = null;
  }
}
