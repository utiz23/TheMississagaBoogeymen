# Step 6: The Switch to Live Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (operator's choice: Native/inline) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the player cards, badges, card locker, Build Locker v2 and Career Action Map from the dev preview page into the real site, then deploy them to Hotel-Echo safely.

**Architecture:** The plan has two phases.

- **Phase A (now, local):** wire the new components into the live pages on `feat/player-cards`; delete the preview route and the replaced components; apply the switch notes each step left; add the drop-in path for the operator's badge icons; verify everything with a production build against `eanhl_preview`.
- **Phase B (after the operator's 21 icons arrive, and only on the operator's go):**
  1. Add the icons.
  2. Fast-forward `main` and push.
  3. On Hotel-Echo: take a fresh backup, tag rollback images, apply migration 0060, deploy web + worker, verify.

**Tech Stack:** Next.js 15, Drizzle, Docker Compose on Hotel-Echo, hand-applied SQL migration, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-07-player-cards-badges-design.md`: "Test run" (the Switch steps), D9, D13, D14, and "Testing" (performance). Switch notes come from the execution records of the step plans:

- `docs/superpowers/plans/2026-10-07-cards-step-2.md`
- `…locker-step-3.md`
- `…build-locker-step-4.md`
- `…action-map-step-5.md`

## Context

**Steps 1–5** are built and reviewed on `feat/player-cards`, which is backed up to GitHub. Live (https://boogeymen.app, Hotel-Echo) runs web `351354d` and worker `3f35733`. `main` has not moved since the branch started, so the merge is a fast-forward.

**Operator decisions (2026-10-08):**

- Prepare everything locally now.
- **The live switch waits for the operator's 21 badge icons (D14).**
- **Skip the phone check.** No player is mythic today, so Storm and Inferno are not on any live card yet.

**Live surfaces that change:**

| Surface                                                                     | Today                                                                     | After                                                                                                                                                                                                         |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Home carousel (`app/page.tsx` → `components/home/player-carousel.tsx`)      | old `PlayerCard` from `components/home/player-card.tsx`                   | new `PlayerCard` (`components/cards/player-card.tsx`, context `list`, `active` = centre card, `href` to the player page). Data: `cardFromRosterRow(row, summaries.get(id))` with `getCardProgressForPlayers`. |
| Roster depth chart (`components/roster/depth-chart.tsx`, `depth-chart.css`) | old card, `depth` pill, `.hpc { zoom }`                                   | new card (list, `href`), the DEPTH pill drawn by the depth chart around the card. Zoom retargeted to `.pcard`; `.dc-empty` min-height re-measured for the new card (421 px × 0.66 ≈ 278).                     |
| Player page (`app/roster/[id]/page.tsx`)                                    | `ProfileHero` with `PortraitCard`, `LoadoutHistoryStrip`, `CareerShotMap` | `ProfileHero portrait={<HeroCard … />}` (card + EDIT + locker); `BuildLocker`; `CareerActionMap`; `PlayerBadges` toward the bottom (D13). Same wiring as the preview page, minus the dev-only gallery/params. |

**Kept:**

- `PlayerSilhouette` keeps its export path in `components/home/player-card.tsx` (spec: the lineup and action-tracker components import it).
- `getPlayerLoadoutSnapshots` stays (a db test uses it).

**Deleted:**

- `app/preview/roster/[id]/`, `app/preview/_cards/` (the gallery, row copy and params), `app/preview/badges/` (the icon gallery, 2026-10-08);
- `components/roster/portrait-card.tsx`, `loadout-history-strip.tsx`, `career-shot-map.tsx`;
- the old `PlayerCard`/`RosterRow` card body in `components/home/player-card.tsx` (its `PlayerSilhouette` stays);
- `ProfileHero`'s built-in portrait helpers (`buildPortraitStats`, `buildPortraitRecord`, `aggregateLast10`, if they are no longer used);
- `getPlayerCareerShots` (no other users).

The untracked `apps/web/src/app/preview/archetypes/` is not ours: leave it.

**Switch notes carried from the step records:**

1. **Step 3:** load the card locker lazily (`next/dynamic` on first EDIT), so its JS/CSS isn't in every player-page load; measure the page size.
2. **Step 4:** fix the live `buildClassToArchetype` hyphen split (`apps/web/src/lib/match-recap.ts`): it splits "Two-Way Defenseman" into "Defenseman". Add "Two-Way Defenseman" → `two-way-d`.
3. **Step 5:** correct the stale "elapsed" `clock` comment in `packages/db/src/schema/match-events.ts`; the data is time remaining (19:59 is the first faceoff).
4. **Spec "out of scope until the switch":** long-cache headers for `/images/cards/*` and `/images/badges/*` (`next.config`). The names are not hashed, so use a 1-day `max-age` with `stale-while-revalidate`, not immutable.

## Global Constraints

- **Spec Switch steps:**
  1. Move the new components into the real pages (hero, home carousel, depth chart, Build Locker, Action Map).
  2. Delete the preview route and the replaced components.
  3. Apply migration 0060 on Hotel-Echo after a fresh backup.
  4. Deploy web + worker.
  5. Verify `card-recompute --dry-run` on live reproduces the tier table.
- **D14:** the badge icons are one single-colour SVG per family, with a transparent background and a square viewBox, named `<family id>.svg`. The badge skin tints each icon per theme.
- **D9:** the hero is unchanged except for the new card and the EDIT button.
- **D13:** Badges go toward the bottom of the player page.
- **D1/D10:** EDIT is shown to everyone, read-only.
- **Performance (spec "Testing"):** home and player-page transfer size, and the phone benchmark from the 2026-10-06 perf pass, must not regress beyond noise for a player without a mythic.
- **Live safety (CLAUDE.md, docker-redeploy skill):**
  - production is Hotel-Echo (`ssh hotel-echo`, `~/eanhl-team-website`);
  - always rebuild images;
  - never start the main PC's web/worker;
  - migrations 0046+ are hand-applied idempotent SQL via `psql`;
  - push only verified commits.
  - **Phase B runs only on the operator's explicit go, after the icons arrive.**
- **Gates:** typecheck (db, worker, web), db tests, web unit tests and prettier stay green; eslint per file.
- **Dev server rule:** never run `next build` while the dev server runs. Phase A stops the dev server (task `b4k2451xl`) for its production-build check and restarts it afterwards.

## Review Focus

1. **The roster page's empty depth slots, and goalie slots** keep the chart's row height and alignment with the new (shorter) card. Pinned by the Task 3 browser check.
2. **Player pages for edge cases:**
   - #28, no card standing, no builds, no actions: card at T1, EDIT works, no Build Locker or Action Map, Badges show locked;
   - #12 goalie;
   - a player with no EA season row.

   Pinned by the Task 4 browser check over #3, #12 and #28.

3. **Old URLs:** `/preview/roster/3` must 404 after the deletion (it was dev-only anyway); `/roster/3` must render with no 500. Pinned by Task 5.
4. **First live recompute:** the worker computes every standing on its first cycle after deploy, with no events ("History starts <deploy date>"). An empty `player_card_progress` before that must still render T1 cards, not crash. Pinned by a Task 4 check with the progress tables emptied in a scratch copy of the preview database (see Task 4), and by the Phase B checks.
5. **Rollback:**
   - retagging the rollback images must bring back the old site even with migration 0060 applied (the old code ignores the new tables);
   - the DB rollback is `DROP` of three derived tables.

   Pinned by the Phase B runbook (B3).

## File Structure

| File                                                                                              | Change                                                                                                                                          |
| ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/components/badges/badge-glyphs.ts` + `badge.tsx` + new `badge-icons.ts` (generated) | Use `/images/badges/icons/<id>.svg` (masked, tinted) for families listed in `BADGE_ICON_FILES`; lucide fallback for the rest.                   |
| `docs/design/handoffs/2026-10-cards/import-badge-icons.mjs` (new)                                 | Validates and copies the operator's SVGs, then writes `badge-icons.ts`.                                                                         |
| `apps/web/src/components/home/player-carousel.tsx`, `app/page.tsx`                                | The new card in the carousel.                                                                                                                   |
| `apps/web/src/components/roster/depth-chart.tsx` + `.css`, `app/roster/page.tsx`                  | The new card in the depth chart.                                                                                                                |
| `apps/web/src/app/roster/[id]/page.tsx`                                                           | Hero card + locker, Build Locker, Action Map, Badges.                                                                                           |
| `apps/web/src/components/cards/hero-card.tsx`                                                     | Lazy `CardLocker`.                                                                                                                              |
| `apps/web/src/components/roster/profile-hero.tsx`                                                 | `portrait` becomes required; the built-in portrait code is removed.                                                                             |
| `apps/web/src/lib/match-recap.ts` (+ test)                                                        | Archetype split fix.                                                                                                                            |
| `packages/db/src/schema/match-events.ts`, `packages/db/src/queries/match-events.ts`               | Clock comment; remove `getPlayerCareerShots`.                                                                                                   |
| `apps/web/next.config.*`                                                                          | Cache headers for card/badge images.                                                                                                            |
| Deleted                                                                                           | preview route + `_cards`, `portrait-card.tsx`, `loadout-history-strip.tsx`, `career-shot-map.tsx`, the old card body in `home/player-card.tsx`. |

---

## Phase A — local (now)

### Task 1: Badge icon drop-in path (TDD)

**Produces:**

- `BADGE_ICON_FILES: Partial<Record<BadgeFamilyId, string>>` in generated `apps/web/src/components/badges/badge-icons.ts` (empty object until icons arrive);
- `Badge` renders a masked `<span>` (`mask: url(/images/badges/icons/<id>.svg)`, background = skin icon colour) when a file is listed, otherwise the lucide glyph;
- `import-badge-icons.mjs <dir>`: for each of the 21 family ids, requires `<id>.svg`. It checks:
  - a square `viewBox`;
  - no `<image>`, `<script>` or `<foreignObject>`;
  - at most one distinct fill/stroke colour other than `none` (single colour).

  It then copies the files to `apps/web/public/images/badges/icons/` and writes `badge-icons.ts`. Any problem → non-zero exit with a list.

**Tests:**

- `badge-icons.test.ts`:
  - every listed id is a real family;
  - every listed file exists in `public/images/badges/icons/`;
  - nothing unlisted ships there.
- A script test (`node --test` on fixtures in a temp dir):
  - a valid single-colour square SVG passes;
  - a 2-colour SVG fails;
  - a non-square viewBox fails;
  - a missing family fails;
  - an `<image>` fails.
- Browser check on the preview: with a temporary fixture icon for one family, that badge shows the mask (then remove the fixture; do not commit it).

Commit `feat(web): badge icon drop-in path (operator SVGs, lucide fallback)`.

### Task 2: Home carousel uses the new card

- `app/page.tsx`: after the roster rows load, run `getCardProgressForPlayers(ids)` (try/catch → empty map) and map them to `CardViewModel[]` via `cardFromRosterRow`. Pass `cards` to `PlayerCarousel`.
- `player-carousel.tsx`: take `cards: CardViewModel[]`. Render `<PlayerCard card context="list" active={isActive} href={`/roster/${id}`} />`. Keep its CSS and behaviour (port the preview row's diff).
- Delete `app/preview/_cards/preview-card-row.tsx` here.

**Checks:**

- `/` at 1280 and 390: the centre card animates, the others are still, cards link to `/roster/<id>`, the arrows and keys work, no horizontal scroll;
- `/images/cards` requests: 0 unless a mythic is on screen (none today);
- console clean apart from the pre-existing warning.

Commit `feat(web): home carousel shows the new player card`.

### Task 3: Roster depth chart uses the new card

- `app/roster/page.tsx`: load `getCardProgressForPlayers` for the chart's player ids and attach a `CardViewModel` to each `DepthSlot`.
- `depth-chart.tsx`: render `<PlayerCard card context="list" href />` inside a wrapper that adds the DEPTH pill (`.dc-depth-pill`) when `isDepth`.
- `depth-chart.css`:
  - `.dc-skaters .pcard, .dc-goalies .pcard { zoom: var(--card-zoom) }`;
  - `.dc-empty` `min-height` = the measured new card height × 0.66;
  - the DEPTH pill style, ported from `.hpc-depth-pill`.

**Checks** (Review Focus 1):

- `/roster` at 1280 and 390: rows align, empty slots match the card height (measure), DEPTH pills show on depth slots, the goalie row is fine, and only a hovered card animates;
- console clean.

Commit `feat(web): roster depth chart shows the new player card`.

### Task 4: Player page — card, locker, Build Locker, Action Map, Badges

1. **`app/roster/[id]/page.tsx`** (copy the preview page's wiring, without the gallery/params):
   - `getPlayerCardProgress`;
   - `cardFromProfile` → `HeroCard` (with `buildLockerView`) as `ProfileHero`'s `portrait`;
   - `getPlayerBuilds` → `BuildLocker` where `LoadoutHistoryStrip` was;
   - `getPlayerCareerActions` → `CareerActionMap` where `CareerShotMap` was;
   - `PlayerBadges` toward the bottom.

   Each fetch is in its own try/catch (as on the preview).

2. **`hero-card.tsx`:**
   - load `CardLocker` with `next/dynamic` (`ssr: false`), rendered only once EDIT has been pressed;
   - a fallback is unnecessary because the drawer only appears on click;
   - keep the focus-return behaviour.
3. **`profile-hero.tsx`:**
   - `portrait: ReactNode` becomes required;
   - remove the built-in `PortraitCard` branch and its now-unused helpers and imports;
   - keep everything else byte-identical (D9).
4. **Delete** `portrait-card.tsx`, `loadout-history-strip.tsx`, `career-shot-map.tsx`, the preview route `app/preview/roster/[id]/` and `app/preview/_cards/`. Remove the old `PlayerCard`/`RosterRow` and their CSS from `components/home/player-card.tsx`, keeping `PlayerSilhouette`; move the `RosterRow` type import in `app/page.tsx` to the db query type.
5. **Remove** `getPlayerCareerShots`.

**Checks** (Review Focus 2 and 4):

- `/roster/3`: the card flips, EDIT opens the locker (and loads its chunk only on first open: network check), the Build Locker and Action Map show, Badges sit near the bottom;
- `/roster/12?role=goalie`: the goalie card, Build Locker and Action Map;
- `/roster/28`: T1 card, EDIT works, no Build Locker or Action Map, Badges locked;
- **First-deploy state:** copy the preview database to a scratch database by dump and restore (`docker exec <db> createdb -U eanhl eanhl_preview_scratch`, then `pg_dump -U eanhl eanhl_preview | psql -U eanhl eanhl_preview_scratch`; `createdb -T` would fail while the dev server holds connections). In the copy, empty `player_card_progress`, `player_badge_levels` and `player_card_events`. Point a dev server at it and check that `/`, `/roster` and `/roster/3` still render with T1 cards and no errors. Then point the server back at `eanhl_preview` and drop the scratch copy. This leaves the shared preview data untouched.
- `/preview/roster/3` → 404;
- console clean;
- `rg "PortraitCard|LoadoutHistoryStrip|CareerShotMap|getPlayerCareerShots|preview-params" apps packages` → nothing.

Commit `feat(web): player page switches to the new card, locker, Build Locker, Action Map and badges`, plus a separate `chore(web): delete the preview route and replaced components` if the diff is large.

### Task 5: Switch notes, cache headers, production-build check

1. **Archetype split** (TDD): add tests in `apps/web/src/lib/match-recap.test.ts`:
   - `buildClassToArchetype('Two-Way Defenseman') === 'two-way-d'`;
   - `'Two-Way Forward'` → `'two-way-fwd'`;
   - `'Cole Caufield - Sniper'` → `'sniper'`.

   Watch them fail, then fix: split only on a spaced hyphen (`/\s+-\s+/`) and add the mapping.

2. **`schema/match-events.ts`:** fix the clock comment to "time remaining in the period (MM:SS, 20:00 at period start)", and cite the data.
3. **`next.config`:** add `headers()` entries for `/images/cards/:path*` and `/images/badges/:path*`: `Cache-Control: public, max-age=86400, stale-while-revalidate=604800`.
4. **Production-build check:**
   1. Stop the dev server (task `b4k2451xl`; it's ours).
   2. Run `pnpm --filter web build`.
   3. Run `next start -p 3001` with the preview `DATABASE_URL`.
   4. Measure transfer size for `/`, `/roster` and `/roster/3` (a non-mythic player) with Playwright, against live `https://boogeymen.app` for the same paths (read-only GETs).
   5. Record both. Above noise (> ~10%) → stop and investigate before Phase B.
   6. Check that `/preview/roster/3` is 404 and the response headers on one card image.
   7. Stop the prod server and restart the dev server as before.
5. **Full gates:** db test, web unit, typecheck (db, worker, web), prettier.

Commit `chore: switch notes — archetype split, clock comment, image cache headers`.

### Task 6: Review and records (Phase A)

- One fresh reviewer (opus) on the Phase A range against the spec's switch steps, this plan, and live safety (nothing deploys in Phase A). Re-grade the findings; fix Critical and Important ones with a test or reproduction first; ledger the minors.
- Execution record (Phase A). Handoff update: Phase A done, Phase B waiting for icons.
- Push `feat/player-cards` (the operator approved branch backups).

---

## Phase B — live switch (after the icons, on the operator's explicit go)

### B1: Icons

1. Unzip the operator's icons into a scratch directory.
2. Run `node docs/design/handoffs/2026-10-cards/import-badge-icons.mjs <dir>`. It must exit 0 with 21 icons.
3. Gates: `badge-icons.test.ts` green.
4. Browser: `/roster/3` badges show the new art in several themes (frames Away → Maximus).
5. Commit `feat(web): the operator's badge icons`.
6. Push the branch.

### B2: Merge

1. `git checkout main && git merge --ff-only feat/player-cards`.
2. Full gates on `main`.
3. `git push origin main`. The pre-push hook takes ~3 s; there are no OCR paths.

### B3: Hotel-Echo runbook

Run over `ssh hotel-echo`, in `~/eanhl-team-website`. Each command's output is checked before the next.

1. **Pre-flight:**
   - `git status` is clean;
   - `git log -1` shows the current live commit;
   - `docker compose ps` shows web, worker, db and backup up.
2. **Backup:**
   - `docker compose exec backup backup.sh` must succeed;
   - also `docker compose exec -T db pg_dump -U eanhl -Fc eanhl > ~/eanhl-backups/pre-cards-$(date +%F-%H%M).dump`, recording its size and `sha256sum`.
3. **Rollback images:**
   - `docker tag eanhl-team-website-web:latest eanhl-team-website-web:rollback-he-<date>-pre-cards`;
   - the same for the worker.
4. **Pull:** `git pull --ff-only`, then `git log -1` shows the merged head.
5. **Migration 0060:** use the command in the file header, with `<database> = eanhl`. Expected: `CREATE TABLE ×3`, `ALTER TABLE`, `CREATE INDEX`, `COMMIT`, and 0 rows in each table.
6. **Build and start:**
   - `docker compose build web worker`;
   - `docker compose up -d --no-deps worker web`.
7. **Verify:**
   - worker logs show a normal cycle and the card recompute (`[card-recompute]` or the recompute log line);
   - `docker compose exec worker node dist/card-recompute-cli.js --dry-run` prints the tier table: T4 silkyjoker85, Stick Menace, JoeyFlopfish; T3 HenryTheBobJr, camrazz; T2 MrHomiecide, joseph4577, Pratt2016; T1 Ordinary_Samich, SCOOT BOY 42, with small level differences allowed for newer games;
   - `SELECT count(*) FROM player_card_progress` > 0.
8. **Site checks** (Playwright against https://boogeymen.app, read-only):
   - `/`, `/roster`, `/roster/3`, `/roster/12` and `/roster/28` return 200, cards render, EDIT opens the locker, the Build Locker, Action Map and Badges show, and the console is clean;
   - transfer sizes are compared with the Task 5 baseline.
9. **Rollback** (only if something is wrong):
   - `docker tag …:rollback-he-<date>-pre-cards …:latest` for web and worker;
   - `docker compose up -d --no-deps web worker`;
   - the old code ignores the new tables, so the DB can stay;
   - full DB undo: `DROP TABLE player_card_events, player_card_progress, player_badge_levels`.

### B4: Records

- Journal entry with the commit, backup file and sha256, rollback tags, migration output, tier table and size comparison.
- HANDOFF: production state and the new rollback tag.
- Memory: update `project_hotel_echo_launch_host.md` (live commit, rollback tag).
- Delete nothing else. The preview database `eanhl_preview` can be dropped later, on the operator's say.

## Verification (end to end)

- **Phase A:** gates green; Playwright checks for Tasks 2–4; production-build size comparison against live; `/preview/*` 404.
- **Phase B:** backup succeeded with sha256 recorded; migration output as expected; tier table reproduced; live pages pass; rollback tags exist.
