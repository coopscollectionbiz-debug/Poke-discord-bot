# Battles and Challenges from the dashboard

Decided 2026-11-13. A player can start a Casual battle, a Ranked battle or a Challenge from a new Battle page on the dashboard. The bot posts the fight to Discord exactly as `/battle` or `/challenge` would.

## Scope

In scope:

- Casual battles and Ranked battles against another player.
- Gym Leader, Blue and Red Challenges.
- The Elite Four run, with Revive picks on the page.

Out of scope. These stay command-only:

- Wager battles. Their escrow and the Defender's Accept step stay in `/battle`.
- Rematch requests. After 3 Casual battles against the same Defender in a UTC day (`CAPS.perOpponent = 3`, utils/battle/tuning.js:56), the page refuses and points to `/battle`.

The feature sits behind `DASHBOARD_FIGHTS_ENABLED`, off by default. With the flag off, the Battle page is hidden from the nav and the new endpoints return 404.

## Where the fight is posted

1. Casual battle: `CASUAL_BATTLE_CHANNEL_ID` when it is set.
2. Challenge or Elite Four run: `CHALLENGE_CHANNEL_ID` when it is set.
3. Otherwise, including every Ranked battle: the channel where the player ran `/dashboard`. The login token already stores it (`generateToken(userId, channelId)`, utils/dashboardAuth.js:37). The session has to carry that channel forward. `getChannelIdForToken` (utils/dashboardAuth.js:116) has no callers today.

If that channel is a DM, can't be fetched, or the bot lacks View Channel, Send Messages or Attach Files there, the fight still runs. The bot posts nothing to Discord, and the replay plays on the dashboard from the fight's Fight record. The page tells the player before they fight: "This fight won't be posted to Discord. Run /dashboard in a server channel to post it."

The public post matches the command's: the same header ("@A challenged @B!"), VS card, turn-by-turn edits and result embed, built by `playBattle(channel, ...)` (utils/battle/playback.js:278) and `playChallenge` / `playRun`. Nothing marks it as coming from the dashboard.

## What the player sees on the page

- The Battle page is a new nav item with two tabs, Battle and Challenges. Battle Records stays a separate page.
- Battle tab:
  - A Casual or Ranked toggle.
  - A Defender search box. It matches server members who have a Trainer and, for Ranked, a full Ranked team.
  - Above the search box, the player's recent Defenders from their Fight records.
  - Each row shows the name, the Ranked rating and how many battles are left against that Defender today.
- Every Defender row has a Team button. It opens the team that Defender would field in the selected mode: their Casual team at real Levels, or their Ranked team at Lv 50. The page shows their trainer over their equipped Aura, and each Pokémon's sprite, name, Level, shiny mark and held item. Moves and stats stay private. The VS card posted in Discord already shows these teams.
- Challenges tab: the same board as `/challenge` (8 Gyms, Elite Four, Blue, Red, with lock state). Picking one opens the preview with the exact CC a loss costs. The buttons are "Fight with Casual team" and "Fight with Ranked team".
- The preview shows the player's displayed trainer over their equipped Aura, then every trainer they'll face: one for a Gym, Blue or Red, all four for the Elite Four. Each opponent stands over the Aura they give when beaten (catalog/auras.js), drawn only once that Aura's art exists (`auraReady`), so each one appears the day its art is added. Until then the opponent stands on a plain backdrop. Clicking an opponent opens their party with names and Levels. The hidden Challenge stat boost (`CHALLENGE.statBoost`, utils/battle/tuning.js:75) isn't shown.
- After a fight resolves, the page shows:
  - win or loss
  - EXP, CC, rating, Badge and Aura changes, the same content as the private EXP card in Discord
  - a link to the channel message
  - a Watch replay button that opens the replay in Battle Records
- Discord gets no private EXP card or DM. The dashboard shows the result.

## Elite Four run

The run behaves exactly as it does in Discord. The server plays the run into one channel message, as `playRun` does today. After each won fight, once that fight's replay has finished, the page shows the Revive picker with the same 60 s window (`CHALLENGE.pickMs`, utils/battle/tuning.js:75). If the window passes with no pick, or the tab is closed, or the session expires, the run carries on with no Revive. Reopening the Battle page mid-run shows the current step.

When the run has no channel, the server waits as long as the channel replay would have taken before it opens the Revive window. Both modes then give the player the same time to pick.

## Rules shared with the commands

- Battles and Challenges use the same checks: `battleBlock` (utils/battle/runBattle.js:199) and `challengeBlock` (utils/challenge/runChallenge.js:49). The server runs them again when Fight is pressed. The page's button states are only a hint.
- Dashboard fights count toward the same caps:
  - 10 battles a day and 3 per Defender (`CAPS`, utils/battle/tuning.js:56)
  - 5 Challenges a day (`CHALLENGE.perDay`, utils/battle/tuning.js:75)
  - Past the daily cap, a Casual battle still runs and earns no EXP.
- The same locks apply: `withBothLocks` for battles and `lockUser` for Challenges. Every step reads the live `trainerData` record inside the lock.
- A player has at most one dashboard fight in progress. A second Fight press, from a double click or another tab, is refused until the first fight's result is saved.
- The fight is saved before the replay starts, as in the commands. A restart during the replay loses only the replay. An open Elite Four run is finished by `finishOpenRunsOnStartup`.

## UI copy

| Where | Text |
|---|---|
| Nav item | Battle |
| Tabs | Battle · Challenges |
| Mode toggle | Casual · Ranked |
| Search placeholder | Search players |
| Defender row | `<name> · Rating <n> · <k> of 3 left today` |
| Fight button (battle) | Battle |
| Fight buttons (challenge) | Fight with Casual team · Fight with Ranked team |
| Cap per Defender reached | 3 battles with them today. Ask for a rematch with /battle. |
| Daily cap reached (Ranked) | 10 battles today. Ranked opens again at 00:00 UTC. |
| Daily cap reached (Casual) | 10 battles today. This one earns no EXP. |
| Ranked team not full | Ranked battles need 6 Pokémon on both Ranked teams. |
| No channel | This fight won't be posted to Discord. Run /dashboard in a server channel to post it. |
| Fight in progress | You're already in a fight. |
| Result link | Posted in #channel |
| Replay button | Watch replay |
| Revive picker | Revive one Pokémon for `<next opponent>` · `<s>` s |
| Revive time out | No Revive picked. The run goes on. |

The other refusals reuse the command's text from `refusal()` (commands/battle.js:53-81) and the Challenge refusals.

## Manual test plan

Run these on a test server with `DASHBOARD_FIGHTS_ENABLED=1`. Use two accounts, A and B, each with a full Casual team and a full Ranked team. Account C has no Ranked team.

1. With the flag off, open the dashboard. There is no Battle item in the nav, and `/public/battle/` returns 404.
2. With the flag on, run `/dashboard` as A in a server channel with `CASUAL_BATTLE_CHANNEL_ID` unset and open the link. Battle shows in the nav, and on phone width the tab bar still fits.
3. On the Battle tab with Casual selected, type B's name. B appears with their rating and "3 of 3 left today".
4. Press Battle. The page shows the result, the EXP gained, "Posted in #channel" and Watch replay. In Discord, the channel gets "@A challenged @B!" and the replay plays out in one message. A gets no private message.
5. Click "Posted in #channel". Discord opens that message.
6. Click Watch replay. Battle Records opens and plays the same fight.
7. Battle B two more times. On the fourth try the button is disabled with the rematch line. `/battle` still lets A send a rematch request.
8. Set `CASUAL_BATTLE_CHANNEL_ID` to another channel and restart. A Casual battle from the dashboard posts there, not where `/dashboard` was run.
9. Switch to Ranked and search for C. C doesn't appear. Search for B and battle. Both Ranked ratings change in Discord's result embed and on the page.
10. Run `/dashboard` in a DM with the bot and open it. The no-channel line shows. Battle anyway. The result and replay appear on the page, and nothing is posted in any channel.
11. Remove the bot's Attach Files permission in a channel, run `/dashboard` there and fight. The fight behaves as in step 10.
12. Double-click Battle, and press Battle in a second tab at the same time. Only one battle runs, and the other press shows "You're already in a fight."
13. On the Challenges tab, pick Brock. The preview shows the loss amount. Press Fight with Casual team. The intro card and replay appear in the challenge channel, and the page shows the Badge.
14. Use up the 5 daily Challenges. The board shows them all as unavailable until UTC midnight.
15. Start an Elite Four run with an account that has all 8 Badges. After Lorelei's replay ends in Discord, the Revive picker appears on the page with a 60 s countdown. Pick a Pokémon. Bruno's fight starts with it at full HP.
16. In the next gap, let the 60 s pass. The run continues with no Revive.
17. In the next gap, close the tab. The run finishes in Discord. Reopen the Battle page. It shows the run's result.
18. Restart the bot during an Elite Four run. On startup the run finishes and the channel message gets its result, as with `/challenge`.
19. On the Challenges tab, pick Brock. Your trainer shows over your equipped Aura and Brock shows on the right. Click Brock. His six Pokémon open with their Levels. Click him again to close the team.
20. Pick the Elite Four. All four members show. Click each in turn to see their parties.
21. Add the art for one opponent's Aura (assets/auras/gymBlaine/aura.json) and restart. Blaine now stands over the Volcano Aura, captioned with its name. The others are unchanged.
22. On the Battle tab, search for B and press Team. B's trainer and Casual team show at real Levels. Switch to Ranked. The open team switches to the Ranked team at Lv 50.
23. Start a battle from Discord with `/battle` while a dashboard battle against the same Defender is resolving. The two run one after the other, and both count toward the caps.

## Open checks

- The Revive window timing with no channel depends on how long a channel replay takes. That time comes from `PLAYBACK.delayMs` and `maxUpdates` (utils/battle/tuning.js:81) plus rendering time. The rendering time needs a measurement on the VPS from a script under `tools/`, timing `playRun` on a stand-in channel.
- Member search relies on the bot being able to list server members. `/fixroles` (commands/fixroles.js:24) fetches the full list today. Confirm that this works in production, with the Server Members intent, before relying on it for search.
