// Shared build-time paths (pinned source versions).
export const POKEAPI_SHA = "e2710d30d14b3f4dc6a02a4a71e8619cd835b7ff";
export const POKEAPI_CACHE = new URL(`../../.cache/pokeapi-${POKEAPI_SHA.slice(0, 8)}/`, import.meta.url);
