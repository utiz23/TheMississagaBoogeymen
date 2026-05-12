# Phase 0: Land In-Flight Skater Stats Work — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the dirty `feat/skater-stats-expansion` working tree as 14 focused commits, run final verification, fast-forward-merge the branch to `main`, push, and delete the merged branch — leaving `main` clean for the design-system renovation branch.

**Architecture:** Each task is one focused commit (stage → verify scope → typecheck if code → commit → verify). DB schema/query changes come first because web code depends on the new field shapes; `pnpm --filter @eanhl/db build` is required after Task 2 so consumer typechecks resolve `@eanhl/db/queries` correctly. After 14 commits, full repo typecheck + dev-server walkthrough, then ff-merge to `main`, push, delete branch.

**Tech Stack:** git, pnpm, Drizzle ORM, conventional commits per CLAUDE.md commit protocol.

**Working assumptions:**
- Current branch: `feat/skater-stats-expansion`. HEAD = `b4fdf2b` (the design spec commit just pushed).
- `main` is behind this branch and a fast-forward is possible (verify in Task 15).
- The renovation spec at `docs/superpowers/specs/2026-05-07-boogeymen-renovation-design.md` is already committed and pushed; it does NOT appear in this plan's commits.
- Run all commands from the repo root: `/home/michal/projects/eanhl-team-website`.

**Out of scope:** Creating the `feat/design-system-renovation` branch (that's Phase 1). Touching any code beyond what's already in the dirty tree.

---

## Task 1: Tighten .gitignore

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Confirm scope**

```bash
git diff HEAD -- .gitignore | tail -20
```
Expected: shows the additions for `/*.png`, `/*.txt`, `* (1).*`, `* (2).*`, `*.zip`, and `docs/design/boogeymen-system/`.

- [ ] **Step 2: Stage**

```bash
git add .gitignore
git status --short | grep -E '^[AM] '
```
Expected: a single `M  .gitignore` line.

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
chore(repo): ignore root debug artifacts, design-system staging, and zip bundles

Root-level *.png/*.txt are Playwright/Chrome DevTools dumps; "* (1).*"
covers accidental browser-download duplicates; *.zip and the boogeymen
design-system staging directory shouldn't be tracked.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: Verify**

```bash
git log --oneline -1
```
Expected: `chore(repo): ignore root debug artifacts...` is HEAD.

---

## Task 2: Land 0022 migration + roster query expansion

**Files:**
- Modify: `packages/db/src/schema/player-profiles.ts` (adds `playerName text` column)
- Modify: `packages/db/src/queries/players.ts` (surfaces new fields in `getRoster`, `getEARoster`, `getPlayerWithProfile`)
- Modify: `packages/db/migrations/meta/_journal.json`
- Create: `packages/db/migrations/0022_mature_paladin.sql`
- Create: `packages/db/migrations/meta/0022_snapshot.json`

- [ ] **Step 1: Stage**

```bash
git add packages/db/src/schema/player-profiles.ts \
        packages/db/src/queries/players.ts \
        packages/db/migrations/meta/_journal.json \
        packages/db/migrations/0022_mature_paladin.sql \
        packages/db/migrations/meta/0022_snapshot.json
git status --short | grep -E '^[AM] '
```
Expected: 5 lines, no other files staged.

- [ ] **Step 2: Build the db package** (required so consumers typecheck against new query shape)

```bash
pnpm --filter @eanhl/db build
```
Expected: TypeScript compilation succeeds for `@eanhl/db`.

- [ ] **Step 3: Apply the migration locally**

```bash
set -a && source .env && set +a
pnpm --filter db migrate
```
Expected: drizzle reports `0022_mature_paladin.sql` applied (or "already applied" if previously run during dev).

- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(db): add player_name column and surface profile/EA fields in roster queries

0022 migration adds player_profiles.player_name (real-name / alias).
getRoster / getEARoster now project favoritePosition, skater W/L/OTL,
goalie W/L/OTL, nationality, playerName, preferredPosition, and
clientPlatform so the home and depth-chart cards can render them
without secondary fetches.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 5: Verify**

```bash
git log --oneline -1
```
Expected: `feat(db): add player_name column ...` is HEAD.

---

## Task 3: Add player meta icons component + replace branding flag set

**Files:**
- Create: `apps/web/src/components/player-meta-icons.tsx`
- Create: `docs/branding/flags/canada.svg`
- Create: `docs/branding/flags/united-states.svg`
- Create: `docs/branding/icons/hockey/hockey-box.svg`
- Create: `docs/branding/icons/hockey/hockey-puck.svg`
- Create: `docs/branding/icons/hockey/hockey-sticks.svg`
- Create: `docs/branding/icons/hockey/hockey-player.svg`
- Create: `docs/branding/logos/platforms/playstation-logo.svg`
- Create: `docs/branding/logos/platforms/xbox-logo.svg`

- [ ] **Step 1: Stage**

```bash
git add apps/web/src/components/player-meta-icons.tsx \
        docs/branding/flags/canada.svg \
        docs/branding/flags/united-states.svg \
        docs/branding/icons/hockey/hockey-box.svg \
        docs/branding/icons/hockey/hockey-puck.svg \
        docs/branding/icons/hockey/hockey-sticks.svg \
        docs/branding/icons/hockey/hockey-player.svg \
        docs/branding/logos/platforms/playstation-logo.svg \
        docs/branding/logos/platforms/xbox-logo.svg
git status --short | grep -E '^[ADM] '
```
Expected: added branding assets; nothing else.

- [ ] **Step 2: Typecheck the web app** (the new component must compile in isolation — no consumer commits yet)

```bash
pnpm --filter web typecheck
```
Expected: passes. (Component is added but not yet imported by anything; it's a fresh module.)

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(web): add player-meta-icons component (platform glyphs, country flag)

NationalityFlag renders ISO-2 country codes as SVG flags; PlatformIcon
maps clientPlatform values to PlayStation / Xbox / PC glyphs. Replaces
the inline ControllerIcon / FlagIcon stubs that lived in player-card.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: Verify**

```bash
git log --oneline -1
```
Expected: `feat(web): add player-meta-icons ...` is HEAD.

---

## Task 4: Wire EA W/L/OTL splits + nationality + platform into player cards

**Files:**
- Modify: `apps/web/src/components/home/player-card.tsx`
- Modify: `apps/web/src/components/roster/depth-chart.tsx`

These two files are coupled: `depth-chart.tsx` imports `StatBox`, `StatBoxFeatured`, and `PlayerSilhouette` from `player-card.tsx`, and both files now share `effectivePosition` resolution + EA-source W/L/OTL split.

- [ ] **Step 1: Stage**

```bash
git add apps/web/src/components/home/player-card.tsx \
        apps/web/src/components/roster/depth-chart.tsx
git status --short | grep -E '^[AM] '
```
Expected: 2 lines, both `M`.

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter web typecheck
```
Expected: passes (depends on Task 2's db build and Task 3's player-meta-icons component).

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(web): wire EA W/L/OTL splits, nationality, and platform into player cards

Home carousel card and depth-chart card now resolve effective position
from preferredPosition/favoritePosition/position, pull skater vs goalie
W/L/OTL from the EA member-season fields (more accurate than the team
appearance record), and render nationality flags + platform glyphs via
the new player-meta-icons component.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: Verify**

```bash
git log --oneline -1
```
Expected: `feat(web): wire EA W/L/OTL splits ...` is HEAD.

---

## Task 5: Support split LD/RD positions in pill + formatter

**Files:**
- Modify: `apps/web/src/components/matches/position-pill.tsx`
- Modify: `apps/web/src/lib/format.ts`

- [ ] **Step 1: Stage**

```bash
git add apps/web/src/components/matches/position-pill.tsx \
        apps/web/src/lib/format.ts
git status --short | grep -E '^[AM] '
```
Expected: 2 lines, both `M`.

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter web typecheck
```
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(web): recognise leftDefenseMen/rightDefenseMen as split LD/RD positions

formatPosition maps the new EA position values to LD/RD short labels;
PositionPill picks the correct color side without needing a separate
defenseSide prop when the position itself is split.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: Verify**

```bash
git log --oneline -1
```
Expected: `feat(web): recognise leftDefenseMen ...` is HEAD.

---

## Task 6: Retune position donut palette

**Files:**
- Modify: `apps/web/src/components/roster/position-donut.tsx`

- [ ] **Step 1: Stage**

```bash
git add apps/web/src/components/roster/position-donut.tsx
git status --short | grep -E '^[AM] '
```
Expected: one `M` line.

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter web typecheck
```
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
refactor(web): retune position donut palette to match position-colors spec

Center / wing / defense / goalie hues updated to align with the agreed
palette in docs/specs/position-colors.md.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: Verify**

```bash
git log --oneline -1
```
Expected: `refactor(web): retune position donut palette ...` is HEAD.

---

## Task 7: Show real-name (AKA) line in profile hero

**Files:**
- Modify: `apps/web/src/components/roster/profile-hero.tsx`

- [ ] **Step 1: Stage**

```bash
git add apps/web/src/components/roster/profile-hero.tsx
git status --short | grep -E '^[AM] '
```
Expected: one `M` line.

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter web typecheck
```
Expected: passes (relies on `playerName` field surfaced in Task 2).

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(web): show real-name line under gamertag in profile hero

Renders player_profiles.player_name as a dim uppercase tracking-widest
secondary line below the gamertag. Hidden when null.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: Verify**

```bash
git log --oneline -1
```
Expected: `feat(web): show real-name line ...` is HEAD.

---

## Task 8: Refine shot-map zone definitions

**Files:**
- Modify: `apps/web/src/components/roster/shot-map-zones.ts`

This is the largest single-file diff (~244 lines). It refines the empirical EA-index → ice-zone mapping; no consumer changes required.

- [ ] **Step 1: Stage**

```bash
git add apps/web/src/components/roster/shot-map-zones.ts
git status --short | grep -E '^[AM] '
```
Expected: one `M` line.

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter web typecheck
```
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
fix(web): refine shot-map zone definitions

Tightens the empirical EA-index to ice-zone mapping so the shot-map
overlay matches the in-game shot ledger more faithfully.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: Verify**

```bash
git log --oneline -1
```
Expected: `fix(web): refine shot-map zone definitions` is HEAD.

---

## Task 9: Promote shot map to standalone section on profile page

**Files:**
- Modify: `apps/web/src/app/roster/[id]/page.tsx` (drops `RecentFormStrip`, lifts `ShotMap` out of `ChartsVisualsSection`)
- Modify: `apps/web/src/components/roster/charts-visuals-section.tsx` (drops the now-unused `shotMap?: ReactNode` prop)

- [ ] **Step 1: Stage**

```bash
git add apps/web/src/app/roster/\[id\]/page.tsx \
        apps/web/src/components/roster/charts-visuals-section.tsx
git status --short | grep -E '^[AM] '
```
Expected: 2 lines, both `M`.

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter web typecheck
```
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
refactor(web): promote shot map to standalone section on profile page

ShotMap was crammed inside ChartsVisualsSection alongside three
"coming soon" tiles, which made it feel like a placeholder. Lifting
it to its own section gives the real visualisation the breathing room
it deserves and lets the charts-visuals zone stay a uniform 1-real-
plus-3-placeholder grid.

Also drops the now-unrendered RecentFormStrip from the page (its data
is duplicated in the hero strip).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: Verify**

```bash
git log --oneline -1
```
Expected: `refactor(web): promote shot map ...` is HEAD.

---

## Task 10: Swap app icon to PNG

**Files:**
- Delete: `apps/web/src/app/icon.tsx`
- Create: `apps/web/src/app/icon.png`

- [ ] **Step 1: Stage**

```bash
git add apps/web/src/app/icon.png
git rm apps/web/src/app/icon.tsx
git status --short | grep -E '^[ADM] '
```
Expected: 1 added, 1 deleted.

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter web typecheck
```
Expected: passes (Next.js resolves icon.png automatically without any TS reference).

- [ ] **Step 3: Commit**

```bash
git commit -m "$(cat <<'EOF'
chore(web): swap app favicon from React component to PNG

Static PNG renders crisper than the prior generated SVG and avoids the
runtime cost of the icon route handler.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: Verify**

```bash
git log --oneline -1
```
Expected: `chore(web): swap app favicon ...` is HEAD.

---

## Task 11: Update position-colors spec

**Files:**
- Modify: `docs/specs/position-colors.md`

- [ ] **Step 1: Stage**

```bash
git add docs/specs/position-colors.md
git status --short | grep -E '^[AM] '
```
Expected: one `M` line.

- [ ] **Step 2: Commit**

```bash
git commit -m "$(cat <<'EOF'
docs(spec): update position-colors palette to match donut + pills

Hex values now match the retuned position-donut palette (Task 6) and
the LD/RD-aware position pill (Task 5).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 3: Verify**

```bash
git log --oneline -1
```
Expected: `docs(spec): update position-colors palette ...` is HEAD.

---

## Task 12: Add player profile template, dossier specs, and news-personalities spec

**Files:**
- Create: `docs/templates/player-profile-fields.md`
- Create: `docs/specs/news-personalities.md`
- Create: `docs/specs/player-dossiers/README.md`
- Create: `docs/specs/player-dossiers/camrazz.md`
- Create: `docs/specs/player-dossiers/henrythebobjr.md`
- Create: `docs/specs/player-dossiers/joeyflopfish.md`
- Create: `docs/specs/player-dossiers/joseph4577.md`
- Create: `docs/specs/player-dossiers/mrhomiecide.md`
- Create: `docs/specs/player-dossiers/ordinary-samich.md`
- Create: `docs/specs/player-dossiers/pratt2016.md`
- Create: `docs/specs/player-dossiers/scoot-boy-42.md`
- Create: `docs/specs/player-dossiers/silkyjoker85.md`
- Create: `docs/specs/player-dossiers/stick-menace.md`

- [ ] **Step 1: Stage**

```bash
git add docs/templates/player-profile-fields.md docs/specs/news-personalities.md docs/specs/player-dossiers/
git status --short | grep -E '^A '
```
Expected: 12 lines (template + news-personalities + 10 dossier files).

- [ ] **Step 2: Commit**

```bash
git commit -m "$(cat <<'EOF'
docs(specs): add player profile template, dossiers, and news-personalities spec

Player-profile-template.md defines the canonical structure for per-player
narrative pages. The 10 dossier files in docs/specs/player-dossiers/ are
filled-out instances for each current roster member, captured for the
upcoming dossier feature. news-personalities.md sketches the related
narrative-tone work.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 3: Verify**

```bash
git log --oneline -1
```
Expected: `docs(specs): add player profile template ...` is HEAD.

---

## Task 13: Record 2026-05-05 profile page restructure plan

**Files:**
- Create: `docs/superpowers/plans/2026-05-05-profile-page-restructure.md`

This plan is the one we've been partially executing on the in-flight branch (profile-hero, charts-visuals, etc.). Recording it preserves the rationale for the restructure that the prior commits embodied.

- [ ] **Step 1: Stage**

```bash
git add docs/superpowers/plans/2026-05-05-profile-page-restructure.md
git status --short | grep -E '^A '
```
Expected: one `A` line.

- [ ] **Step 2: Commit**

```bash
git commit -m "$(cat <<'EOF'
docs(plans): record 2026-05-05 profile page restructure plan

Captures the IA the previous commits implemented (richer hero with
this-season + career strips, recent form, tabbed stats record, club
stats, contribution donut, charts & visuals zone). Useful as the
reference point for Phase 3 of the renovation when we reconcile this
page against the boogeymen design-system spec.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 3: Verify**

```bash
git log --oneline -1
```
Expected: `docs(plans): record 2026-05-05 profile page restructure plan` is HEAD.

---

## Task 14: Add bundled design references and chelhead research screenshots

**Files:**
- Create: `docs/design/1355427032026083102.webp`
- Create: `docs/design/375410102025081649.webp`
- Create: `docs/design/417411112025054300.webp`
- Create: `docs/design/479819122025114000.webp`
- Create: `docs/design/500727032026081701.webp`
- Create: `docs/design/553005022026115046.webp`
- Create: `docs/design/579817022026055431.webp`
- Create: `docs/design/648918032026072352.webp`
- Create: `research/chelhead/FireShot Capture 061 - silkyjoker85 - NHL 26 EASHL Player Stats - ChelHead - [chelhead.com].png`
- Create: `research/chelhead/FireShot Capture 063 - Connor McDavid Stats - NHL EDGE - NHL.com - [www.nhl.com].png`

- [ ] **Step 1: Stage**

```bash
git add docs/design/*.webp
git add "research/chelhead/FireShot Capture 061 - silkyjoker85 - NHL 26 EASHL Player Stats - ChelHead - [chelhead.com].png" \
        "research/chelhead/FireShot Capture 063 - Connor McDavid Stats - NHL EDGE - NHL.com - [www.nhl.com].png"
git status --short | grep -E '^A '
```
Expected: 10 lines (8 webp + 2 png).

- [ ] **Step 2: Commit**

```bash
git commit -m "$(cat <<'EOF'
docs(design): add bundled design references and chelhead research screenshots

Eight .webp design references from the Boogeymen Design System pack,
plus two ChelHead reference screenshots used to anchor the player
profile page IA discussion.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 3: Verify clean tree**

```bash
git status --short
```
Expected: empty output (working tree clean).

---

## Task 15: Verify, merge to main, push, delete merged branch

- [ ] **Step 1: Final repo-wide typecheck**

```bash
pnpm typecheck
```
Expected: passes across all packages.

- [ ] **Step 2: Format pass**

```bash
pnpm format
```
Expected: rewrites any formatting drift; if files change, stage and commit them as `style: pnpm format pass` before continuing.

- [ ] **Step 3: Dev-server walkthrough**

```bash
pnpm --filter web dev
```
Then visit each route in a browser at `localhost:3000`:
- `/`
- `/games`
- `/games/<some-id>`
- `/roster`
- `/roster/<some-skater-id>`
- `/roster/<some-goalie-id>`
- `/stats`

Confirm: no console errors, no missing data shape, position pills/flags/platform glyphs render correctly, shot map renders on the skater profile page.

Stop the dev server.

- [ ] **Step 4: Verify main can fast-forward**

```bash
git fetch origin
git log --oneline main..feat/skater-stats-expansion | head -20
git log --oneline feat/skater-stats-expansion..main | head -5
```
Expected: first command lists Task 1-14 commits + `b4fdf2b` spec commit; second command is empty (main has no commits the branch lacks → ff is possible).

If second command is non-empty, stop and surface to the user — main has diverged and the merge strategy needs to be chosen explicitly.

- [ ] **Step 5: Fast-forward main**

```bash
git checkout main
git merge --ff-only feat/skater-stats-expansion
```
Expected: ff merge succeeds; main now points at the same commit as the feature branch.

- [ ] **Step 6: Push main**

```bash
git push origin main
```
Expected: push succeeds.

- [ ] **Step 7: Delete the merged branch (local + remote)**

```bash
git branch -d feat/skater-stats-expansion
git push origin --delete feat/skater-stats-expansion
```
Expected: local branch deleted (`-d` succeeds because it's fully merged), remote branch deleted.

- [ ] **Step 8: Final verification**

```bash
git status
git log --oneline -20
git branch -a | grep skater-stats
```
Expected: clean working tree on `main`; the last 16 commits are the Phase 0 commits + the spec commit; no `feat/skater-stats-expansion` branch in `git branch -a` output.

---

## Recovery if something goes wrong mid-plan

- If a typecheck fails between tasks: do not commit. Inspect the diff, fix the issue, re-stage, re-typecheck, re-commit. Never `--no-verify` past a failing check.
- If a commit grouping turns out wrong (e.g., a file belongs in the previous commit): `git reset --soft HEAD~1` to undo just the last commit, re-stage correctly, re-commit. Do this only on commits not yet pushed.
- If `pnpm --filter db migrate` reports a problem after Task 2: roll back the local database via `docker compose down db && docker volume rm eanhl-team-website_db_data && docker compose up -d db && pnpm --filter db migrate` — this is a local dev DB only.
- If the ff-merge in Task 15 Step 5 is rejected (main has diverged): do NOT force-push. Stop and surface to the user; rebasing the feature branch on main is the right resolution but a destructive rewrite warrants explicit user approval.
