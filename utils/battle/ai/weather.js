// ==========================================================
// utils/battle/ai/weather.js — which weather a Team plays to: the one that
// helps most of its Pokémon by type or ability. The AI reads it in battle
// (choose.js) and recommended moves read it on the Teams page
// (services/battlePlans.js), so it never loads the engine.
// ==========================================================

/** Each weather move's weather. */
export const WEATHER_OF = Object.freeze({ raindance: "rain", sunnyday: "sun", sandstorm: "sand", snowscape: "snow", hail: "snow" });

/** The types and abilities each weather helps (setters included). */
export const WEATHER_FANS = Object.freeze({
  rain: { types: ["Water"], abilities: ["swiftswim", "raindish", "hydration", "dryskin", "drizzle"] },
  sun: { types: ["Fire"], abilities: ["chlorophyll", "solarpower", "flowergift", "leafguard", "harvest", "protosynthesis", "drought"] },
  sand: { types: ["Rock", "Ground", "Steel"], abilities: ["sandrush", "sandforce", "sandveil", "sandstream"] },
  snow: { types: ["Ice"], abilities: ["slushrush", "icebody", "snowcloak", "snowwarning"] },
});

/** The weather that helps the most of these Pokémon ([{ types, ability }], ability an id), or null. */
export function weatherFor(members) {
  let best = null, bestCount = 0;
  for (const [weather, fans] of Object.entries(WEATHER_FANS)) {
    const count = members.filter((p) => fans.abilities.includes(p.ability) || p.types.some((t) => fans.types.includes(t))).length;
    if (count > bestCount) { best = weather; bestCount = count; }
  }
  return best;
}
