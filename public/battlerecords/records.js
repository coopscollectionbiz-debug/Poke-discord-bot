// ==========================================================
// public/battlerecords/records.js — Battle Records logic, no DOM.
// Reads Fight records (utils/fightRecordBuild.js) from the viewing
// player's side: rows, the summary, and the replay's steps.
// Shared by script.js and replay.js; tested in tests/battleRecordsPage.test.js.
// ==========================================================

export const KIND_LABEL = Object.freeze({
  casual: "Casual battle",
  ranked: "Ranked battle",
  wager: "Wager battle",
  gym: "Gym Challenge",
  elite4: "Elite Four run",
  champion: "Champion",
  red: "Red",
  encounter: "Trainer encounter",
});

export const SUMMARY_WINDOW = 20;

export const pokemonSprite = (m) => (m.megaForm
  ? `/public/sprites/pokemon/mega/${m.variant === "shiny" ? "shiny" : "normal"}/${m.megaForm}.gif`
  : `/public/sprites/pokemon/${m.variant === "shiny" ? "shiny" : "normal"}/${m.speciesId}.gif`);
export const trainerSprite = (file) => (file ? `/public/sprites/trainers_2/${file}` : "/public/sprites/items/pokeball.png");
export const itemLabel = (id) => String(id ?? "").replace(/^item_/, "").split(/[_-]/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");

const fullFights = (r) => r.fights.filter((f) => !f.missing && f.result);

/** Which side is the viewer's (0 for Challenges and encounters). */
export const sideOf = (record, me) => {
  const i = record.sides.findIndex((s) => s.id === String(me));
  return i < 0 ? 0 : i;
};

/**
 * The record as the viewer sees it: who won, both teams, and per slot of
 * the viewer's team its KOs and whether it fainted (any fight).
 */
export function perspective(record, me) {
  const mine = sideOf(record, me);
  const theirs = 1 - mine;
  const fights = fullFights(record);
  const first = fights[0];
  const last = fights.at(-1);
  const team = first?.members[mine] ?? [];
  const kos = team.map(() => 0);
  const fainted = team.map(() => false);
  let totalKos = 0, totalFaints = 0, turns = 0;
  for (const f of fights) {
    turns += f.result.turns ?? 0;
    for (const k of f.result.knockouts ?? []) {
      if (k.bySide === mine) { kos[k.bySlot] = (kos[k.bySlot] ?? 0) + 1; totalKos++; }
      if (k.side === mine) { fainted[k.slot] = true; totalFaints++; }
    }
  }
  const reward = record.rewards?.[String(me)] ?? {};
  const delta = reward.rating ? { type: "rating", value: reward.rating.to - reward.rating.from }
    : Number.isFinite(reward.cc) && reward.cc !== 0 ? { type: "cc", value: reward.cc } : null;
  return {
    mine, theirs,
    won: record.winner === mine,
    me: record.sides[mine],
    foe: record.sides[theirs],
    team, kos, fainted,
    foeTeam: last?.members[theirs] ?? [],
    foes: record.fights.map((f) => f.foe).filter(Boolean),
    totalKos, totalFaints, turns,
    delta, reward,
    label: record.kind === "champion" || record.kind === "red" ? `Challenge · ${record.sides[1]?.name ?? ""}`.trim() : KIND_LABEL[record.kind] ?? record.kind,
  };
}

const monKey = (m) => `${m.speciesId}:${m.variant}:${m.megaForm ?? ""}`;

/** The summary over the newest `n` records shown. */
export function summarize(records, me, n = SUMMARY_WINDOW) {
  const recent = records.slice(0, n);
  let wins = 0, kos = 0, faints = 0;
  const mons = new Map();
  let rated = 0, ratingChange = 0, rating = null;
  for (const r of recent) {
    const p = perspective(r, me);
    if (p.won) wins++;
    kos += p.totalKos;
    faints += p.totalFaints;
    p.team.forEach((m, slot) => {
      const k = monKey(m);
      const row = mons.get(k) ?? { ...m, games: 0, wins: 0, kos: 0, faints: 0 };
      row.games++;
      if (p.won) row.wins++;
      row.kos += p.kos[slot] ?? 0;
      if (p.fainted[slot]) row.faints++;
      mons.set(k, row);
    });
    const rr = p.reward.rating;
    if (rr) {
      rated++;
      ratingChange += rr.to - rr.from;
      if (rating == null) rating = rr.to; // newest first
    }
  }
  const top = [...mons.values()].sort((a, b) => b.games - a.games || b.wins - a.wins || b.kos - a.kos).slice(0, 3);
  return {
    count: recent.length, wins, losses: recent.length - wins,
    winRate: recent.length ? Math.round((100 * wins) / recent.length) : 0,
    kos, faints,
    kda: faints ? Math.round((kos / faints) * 100) / 100 : kos,
    top, rating: rated ? { current: rating, change: ratingChange, games: rated } : null,
  };
}

/** "3 hours ago" style. */
export function timeAgo(at, now = Date.now()) {
  const s = Math.max(0, Math.round((now - at) / 1000));
  const unit = [[86400 * 7, "week"], [86400, "day"], [3600, "hour"], [60, "minute"]].find(([sec]) => s >= sec);
  if (!unit) return "just now";
  const n = Math.floor(s / unit[0]);
  return `${n} ${unit[1]}${n === 1 ? "" : "s"} ago`;
}

/** Damage dealt by each slot of side `side` (HP fractions of targets, summed as %). */
export function damageBySlot(record, side) {
  const out = [];
  for (const f of fullFights(record)) {
    let hp = f.result.snapshots?.[0]?.map((s) => [...s]) ?? [[], []];
    f.result.log.forEach((turn, t) => {
      for (const ev of turn) {
        if (ev.side !== side) continue;
        const before = hp[1 - side][ev.targetSlot] ?? 1;
        out[ev.slot] = (out[ev.slot] ?? 0) + Math.max(0, before - ev.hpAfter);
        hp[1 - side][ev.targetSlot] = ev.hpAfter;
        if (ev.userHpAfter != null) hp[side][ev.slot] = ev.userHpAfter;
      }
      hp = f.result.snapshots?.[t + 1]?.map((s) => [...s]) ?? hp;
    });
  }
  return out.map((x) => Math.round((x ?? 0) * 100));
}

// ----------------------------------------------------------
// Replay steps
// ----------------------------------------------------------

/** What one move did, as the caption says it. */
export function moveText(ev, attacker, target) {
  const parts = [`${attacker} used ${ev.move}!`];
  if (ev.missed) parts.push(`${attacker}'s attack missed!`);
  else if (ev.eff === 0) parts.push(`It doesn't affect ${target}…`);
  else {
    if (ev.hits > 1) parts.push(`It hit ${ev.hits} times!`);
    if (ev.crit) parts.push("A critical hit!");
    if (ev.eff > 1) parts.push("It's super effective!");
    else if (ev.eff > 0 && ev.eff < 1) parts.push("It's not very effective…");
  }
  if (ev.drain) parts.push(`${target} had its energy drained!`);
  if (ev.recoil) parts.push(`${attacker} is damaged by recoil!`);
  if (ev.crash) parts.push(`${attacker} kept going and crashed!`);
  for (const n of ev.notes ?? []) parts.push(n);
  return parts.join(" ");
}

const copyHp = (hp) => hp.map((s) => [...s]);

/**
 * The replay as a list of steps, each a full picture: which fight, both
 * teams, HP per slot, the active slot per side, the caption, and what to
 * animate. `mine` is drawn at the bottom left.
 */
export function replaySteps(record, me) {
  const mine = sideOf(record, me);
  const steps = [];
  const total = record.fights.length;
  const nameOf = (members, side, slot) => {
    const n = members[side]?.[slot]?.name ?? "?";
    return side === mine ? n : `the opposing ${n}`;
  };
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  record.fights.forEach((f, fi) => {
    const foe = f.foe ?? record.sides[1 - mine];
    const heading = total > 1 ? `Fight ${fi + 1} of ${total} · ${foe.name}` : `${record.sides[mine].name} vs ${record.sides[1 - mine].name}`;
    const revive = fi > 0 ? record.breaks?.[fi - 1] : null;
    const reviveText = revive?.offered
      ? (revive.slot != null ? ` ${f.members?.[mine]?.[revive.slot]?.name ?? record.fights[0].members?.[mine]?.[revive.slot]?.name ?? "A Pokémon"} was revived.` : " No Revive was picked.")
      : "";
    if (f.missing || !f.result) {
      steps.push({ fight: fi, kind: "intro", heading, foe, caption: `${foe.name}: this fight's turns weren't saved.${reviveText}`, missing: true, turn: 0, turns: 0 });
      return;
    }
    const r = f.result;
    let hp = copyHp(r.snapshots?.[0] ?? f.members.map((side) => side.map((m) => m.hpFraction ?? 1)));
    const firstUp = (side) => Math.max(0, hp[side].findIndex((h) => h > 0));
    const active = [firstUp(0), firstUp(1)];
    const base = { fight: fi, members: f.members, foe, heading, turns: r.turns };
    const push = (extra) => steps.push({ ...base, hp: copyHp(hp), active: [...active], ...extra });

    const surge = f.surge ? ` Underdog surge for ${record.sides[f.surge.side]?.name ?? "the underdog"}!` : "";
    push({ kind: "intro", turn: 0, caption: `${record.sides[mine].name} vs ${foe.name}!${reviveText}${surge}` });

    r.log.forEach((events, t) => {
      const turn = t + 1;
      const pre = events[0]?.preNotes;
      if (pre?.length) push({ kind: "note", turn, caption: pre.join(" ") });
      for (const ev of events) {
        const tSide = 1 - ev.side;
        active[ev.side] = ev.slot;
        active[tSide] = ev.targetSlot;
        const before = hp[tSide][ev.targetSlot];
        hp[tSide][ev.targetSlot] = ev.hpAfter;
        if (ev.userHpAfter != null) hp[ev.side][ev.slot] = ev.userHpAfter;
        push({
          kind: "move", turn,
          attacker: { side: ev.side, slot: ev.slot }, target: { side: tSide, slot: ev.targetSlot },
          damage: Math.round(Math.max(0, before - ev.hpAfter) * 100),
          caption: cap(moveText(ev, nameOf(f.members, ev.side, ev.slot), nameOf(f.members, tSide, ev.targetSlot))),
        });
        if (ev.fainted) push({ kind: "faint", turn, fainted: { side: tSide, slot: ev.targetSlot }, caption: `${cap(nameOf(f.members, tSide, ev.targetSlot))} fainted!` });
        if (ev.userFainted) push({ kind: "faint", turn, fainted: { side: ev.side, slot: ev.slot }, caption: `${cap(nameOf(f.members, ev.side, ev.slot))} fainted!` });
      }
      // End of turn: residual damage (weather, status) is in the snapshot.
      if (r.snapshots?.[turn]) hp = copyHp(r.snapshots[turn]);
      const end = events.at(-1)?.endNotes;
      if (end?.length) push({ kind: "note", turn, caption: end.join(" ") });
    });

    const won = r.winner === mine;
    const winnerName = won ? record.sides[mine].name : foe.name;
    const how = r.endedBy === "turnCap" ? " (turn limit: more HP left)" : "";
    push({ kind: "result", turn: r.turns, won, caption: `${winnerName} won${fi === total - 1 ? "" : " this fight"}!${how}` });
  });
  return steps;
}

/** Index of the first step of the next (+1) or previous (-1) turn. */
export function stepForTurn(steps, at, dir) {
  const cur = steps[at];
  if (!cur) return 0;
  const key = (s) => s.fight * 10000 + s.turn;
  if (dir > 0) {
    const i = steps.findIndex((s, j) => j > at && key(s) > key(cur));
    return i < 0 ? steps.length - 1 : i;
  }
  // Back: the start of this turn, or of the previous one if already there.
  let start = at;
  while (start > 0 && key(steps[start - 1]) === key(cur)) start--;
  if (start < at) return start;
  if (start === 0) return 0;
  const prevKey = key(steps[start - 1]);
  let p = start - 1;
  while (p > 0 && key(steps[p - 1]) === prevKey) p--;
  return p;
}
