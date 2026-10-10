# Discord Post — Lineup Image with Per-Game Cards — Design

**Status:** design approved in conversation 2026-10-10; awaiting operator review of this spec.
**Amends:** [`2026-10-10-discord-game-results-design.md`](./2026-10-10-discord-game-results-design.md).
Only the image changes. Everything else in that spec (webhook, opt-in
service, settle/claim/no-double-post rules, dry run, message text, 3 stars as
text lines, DNF short post, error handling) stays as built (`df27251`).

## 1. Change

| Before (`df27251`)                                | After                                                                   |
| ------------------------------------------------- | ----------------------------------------------------------------------- |
| Image = the **member stars'** cards, side by side | Image = **BGM's lineup** for that game, every player, in position slots |
| Cards show **season** totals                      | Cards show **that game's** stats                                        |
| Guests/opponents never get a card                 | Every BGM player gets a card; guests get a plain default card           |

The 3 stars stay in the post as text lines, unchanged. Opponents never appear
in the image.

## 2. Decisions (operator, 2026-10-10)

| Decision        | Choice                                                                                                                                               |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Who gets a card | **Everyone who played for BGM**: members, the AI goalie, guests (plain default card).                                                                |
| Skater stats    | G · A · +/- · **PTS** (PTS is the large "lead" slot).                                                                                                |
| Goalie stats    | SA · SV · GA · **SV%**.                                                                                                                              |
| Top-left block  | `GS <game score>` in place of the season record; `⭐ <1st/2nd/3rd> star` in place of win % when the player was one of the 3 stars (blank otherwise). |
| Layout          | **Two rows.** 6s: `LW C RW` / `LD G RD`. 3s: `W C` / `D G`.                                                                                          |
| Site cards      | **Unchanged.** The per-game card exists only for the Discord image.                                                                                  |
| Build approach  | New card _data_ builder; the card component is not modified.                                                                                         |

## 3. Design

### 3.1 One lineup, shared with the match page

The match page builds BGM's lineup as: OCR lobby slots when any OCR lineup
exists for the match (re-keyed onto the ladder for 3s), otherwise positions
from the box score (`buildLineupFromStats`). That logic moves into one exported
function, `bgmLineupForMatch(match, playerStats, opponentPlayerStats, lineups)`,
called by both `/games/[id]` and the Discord loader, so the image can never
show a different lineup than the site (same pattern as `starsForMatch`).

### 3.2 Game card builder (pure)

`cardForGame(input)` returns the existing `CardViewModel` with:

- identity from the player's normal card source when they have one (members
  and the AI goalie: EA roster + carry-overs row and card progression — theme,
  tier, level, badge, name, platform, flag); jersey from the lineup slot, else
  the roster;
- **guests**: name = gamertag, theme `away`, tier 1, level 1, no badge, no flag;
- `position` = the slot (LW, C, RW, LD, RD, G, W, D); `role` = goalie for `G`;
- `record` = `GS 17.53` (`score.toFixed(2)`, the same score the 3 stars use);
- `winPct` = `⭐ 2nd star` for a star, else empty;
- `stats` = skater `G, A, +/-, PTS` (signed +/-: `+2`, `-1`, `0`; PTS = G + A),
  goalie `SA, SV, GA, SV%` (GA = SA − SV; SV% via the site's `formatSavePct`,
  `—` when SA = 0);
- `back: null`.

A slot with no player renders an empty, card-sized outline labelled with its
position. A lineup slot that can't be matched to a stat row (OCR saw a player
with no box-score line) also renders as an empty outline with the gamertag.

### 3.3 Hidden page and service

- `/internal/discord/stars/[matchId]` is **replaced** by
  `/internal/discord/lineup/[matchId]` (same token guard, same full-viewport
  backdrop). It renders `#discord-lineup`: a CSS grid, 3 columns (6s) or 2
  (3s), slots in the order above, at the card's normal size.
- The JSON contract (`@eanhl/db/discord`) replaces `cardPlayerIds` with
  `lineupCardCount: number` (players with a card in the image). The service
  renders the image when it is > 0, screenshotting `#discord-lineup`.
- DNF: unchanged (no image, `lineupCardCount = 0`).
- Render failure: unchanged (text-only post).

## 4. Testing

- **Unit:** `cardForGame` — skater, goalie (incl. SA = 0), guest, star tag,
  non-star, signed +/-; slot ordering for 6s and 3s; empty slot; unmatched
  OCR slot. `bgmLineupForMatch` — OCR path vs box-score fallback. Contract —
  `lineupCardCount` parse. Cycle — renders only when `lineupCardCount > 0`.
- **Visual (operator review before deploy):** previews from past games — a 6s
  game, a 3s game, one with a guest, one with the AI goalie.
- Gates: typecheck, unit tests, prettier.

## 5. Rollout

Redeploy `web` and `discord` on Hotel-Echo (docker-redeploy skill, rollback
tags, `--no-deps`). No migration. `#bot-test` keeps the current format until
then.

## 6. Out of scope

Changing site cards; opponent lineup; extra stats beyond the four slots;
animated images.
