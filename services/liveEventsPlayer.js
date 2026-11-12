// ==========================================================
// services/liveEventsPlayer.js — what players see of Live events:
// the dashboard view (GET /api/live-events), the "Use Live event" choice
// for paid rolls, the /events reply, and the start/end posts.
// ==========================================================

import { EmbedBuilder } from "discord.js";
import { listLiveEvents, liveEffects, optedIn, setOptIn, duePosts, markPosted, liveEventSettings } from "./liveEvents.js";
import { statusOf, stopAt, hasCatchEffects, discountedPrice, DISCOUNT_CATEGORIES } from "../utils/liveEventRules.js";
import { publicEvent, effectText, discordTime } from "../utils/liveEventText.js";
import { emptyBalls } from "../utils/weightedRandom.js";
import { acquirablePokemon } from "../utils/speciesCatalog.js";
import { readFileSync } from "fs";

const pokemonData = JSON.parse(readFileSync(new URL("../pokemonData.json", import.meta.url), "utf8"));

const UPCOMING_SHOWN = 5;
export const EVENT_COLOR = 0xf5a524;

/** Running and upcoming events, the player's choice, and today's prices. */
export function playerView(user, now = Date.now()) {
  const events = listLiveEvents();
  const fx = liveEffects(now);
  const running = events.filter((e) => statusOf(e, now) === "running").map((e) => publicEvent(e, "running", stopAt(e)));
  const upcoming = events
    .filter((e) => statusOf(e, now) === "scheduled")
    .sort((a, b) => a.startAt - b.startAt)
    .slice(0, UPCOMING_SHOWN)
    .map((e) => publicEvent(e, "scheduled", stopAt(e)));
  // What 100 CC costs in each category right now (the pages scale their own prices).
  const discounts = Object.fromEntries(Object.keys(DISCOUNT_CATEGORIES).map((c) => [c, discountedPrice(fx, c, 10_000) / 10_000]));
  return {
    running,
    upcoming,
    catchEvents: fx.catchEvents,
    // With the choice on, these balls can't give anything (greyed out).
    paidChoice: hasCatchEffects(fx) ? { on: optedIn(user, fx), emptyBalls: emptyBalls(acquirablePokemon(Object.values(pokemonData)), fx) } : null,
    discounts,
  };
}

/** POST /api/live-events/opt-in { id, on }. */
export function createOptInHandler({ getTrainerData, lockUser, save }) {
  return async function optIn({ body, isAuthorized }) {
    const id = body?.id;
    if (!id) return { status: 400, body: { ok: false, error: "Missing id" } };
    if (!isAuthorized(id)) return { status: 403, body: { ok: false, error: "Invalid or expired session" } };
    if (!getTrainerData()[id]) return { status: 404, body: { ok: false, error: "User not found" } };
    const fx = liveEffects();
    if (body.on && !hasCatchEffects(fx)) return { status: 409, body: { ok: false, error: "No Catch boost or limit is running." } };
    const on = await lockUser(id, () => setOptIn(getTrainerData()[id], Boolean(body.on)));
    const ack = await save(getTrainerData());
    return { status: 200, body: { ok: true, on, note: ack?.note ?? null } };
  };
}

// ----------------------------------------------------------
// Discord
// ----------------------------------------------------------

const effectLines = (e) => e.effects.map((f) => `• ${effectText(f)}`).join("\n");

/** The /events embed. */
export function eventsEmbed(user, now = Date.now()) {
  const v = playerView(user, now);
  const all = listLiveEvents();
  const byId = new Map(all.map((e) => [e.id, e]));
  const embed = new EmbedBuilder().setColor(EVENT_COLOR).setTitle("🎪 Live events");
  if (!v.running.length && !v.upcoming.length) {
    return embed.setDescription("Nothing is on right now, and nothing is scheduled.");
  }
  for (const r of v.running) {
    embed.addFields({ name: `On now: ${r.name}`, value: `${effectLines(byId.get(r.id))}\nEnds ${discordTime(r.endAt, "R")} (${discordTime(r.endAt)})`.slice(0, 1024) });
  }
  for (const u of v.upcoming) {
    embed.addFields({ name: `Coming up: ${u.name}`, value: `${effectLines(byId.get(u.id))}\nStarts ${discordTime(u.startAt, "R")} (${discordTime(u.startAt)}), ends ${discordTime(u.endAt)}`.slice(0, 1024) });
  }
  if (v.paidChoice) {
    embed.setFooter({ text: `Poké Balls and /recruit ${v.paidChoice.on ? "use" : "don't use"} ${v.catchEvents.join(" + ")}. Chat catches, /daily, quests and the weekly pack always do.` });
  }
  return embed;
}

/** The start or end post for one event. */
export function announcementEmbed(kind, e) {
  if (kind === "start") {
    return new EmbedBuilder().setColor(EVENT_COLOR).setTitle(`🎪 ${e.name} has started!`)
      .setDescription(`${effectLines(e)}\n\nEnds ${discordTime(stopAt(e), "R")} (${discordTime(stopAt(e))}). See \`/events\` for details.`);
  }
  const early = e.endedAt != null && e.endedAt < e.endAt;
  return new EmbedBuilder().setColor(0x8a8f98).setTitle(`🎪 ${e.name} has ended`)
    .setDescription(early ? "It was ended early. Everything is back to normal." : "Everything is back to normal. Thanks for playing!");
}

/**
 * Post every due start/end announcement. `send(channelId, embed)` resolves
 * true when posted. An end whose start was never posted (the bot was down for
 * the whole event) is marked done without a post. Without a channel set,
 * posts are marked done so they never flood out later.
 */
export async function postDueAnnouncements({ send, now = Date.now() }) {
  const channelId = liveEventSettings().channelId;
  let posted = 0;
  for (const d of duePosts(now)) {
    if (d.kind === "end" && d.skippedStart) { await markPosted(d.event.id, "end"); continue; }
    if (!channelId) { await markPosted(d.event.id, d.kind); continue; }
    const ok = await send(channelId, announcementEmbed(d.kind, d.event)).catch(() => false);
    if (ok) { await markPosted(d.event.id, d.kind); posted++; }
  }
  return posted;
}
