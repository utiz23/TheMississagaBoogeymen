# Phase 3A Manual Audit Runbook

This replaces the sloppy parts of the external plan with an operator-first runbook.

You run every command manually.
Codex does not run anything unless you explicitly ask.

## Scope

This runbook covers:

1. Persona alias audit for matches `250` and `463`
2. Build-class audit for matches `250` and `463`
3. Verification of what actually affects the Phase 3b benchmark

This runbook does not assume the original plan is fully correct.

## Important Correction

The original Task A assumption is wrong or at least incomplete.

`match-250-benchmark.test.ts` does **not** score the consolidated canonical rows.
It reads raw `pre_game_lobby_state_2` snapshot rows directly:

- file: [match-250-benchmark.test.ts](/home/michal/projects/eanhl-team-website/.claude/worktrees/phase-3a/apps/worker/src/__tests__/match-250-benchmark.test.ts:1593)
- function: `loadLobbySnapshotsForMatch`

That means:

- seeding `player_persona_aliases` helps the consolidator
- but alias seeding alone may not move the Phase 3b lobby persona gate
- manual audit must distinguish `consolidator output fixed` from `benchmark source fixed`

## Already Observed

These observations came from live audit work already performed before switching back to operator mode:

1. One alias was already inserted into the live DB:
   `Evgeni Wanhg => E. WANHG`
2. Re-running consolidation for match `250` updated the reviewed canonical row for `MrHomiecide`.
3. The benchmark still failed after that.
4. Therefore the benchmark is still reading unresolved raw lobby rows, not benefiting from that alias alone.

Treat this as current state until you prove otherwise.

## Operator Rules

1. Run commands from the phase-3a worktree unless the step says DB-only:
   `/home/michal/projects/eanhl-team-website/.claude/worktrees/phase-3a`
2. Source the main repo `.env` before any worker CLI:
   `set -a && source /home/michal/projects/eanhl-team-website/.env && set +a`
3. After each command, record:
   - command run
   - important output
   - decision taken
   - whether the result affects consolidator only or the benchmark itself
4. Do not add junk OCR contamination to the closed vocabulary.

## Task 1: Establish Current Truth

Run these manually and paste the outputs into your notes.

### 1.1 Consolidator status for match 250

```bash
cd /home/michal/projects/eanhl-team-website/.claude/worktrees/phase-3a
set -a && source /home/michal/projects/eanhl-team-website/.env && set +a
pnpm --filter worker exec node dist/consolidate-loadouts-cli.js --match 250 2>&1 | tail -n 120
```

Record:

- unresolved personas
- unresolved gamertags
- any persona alias hits
- whether `MrHomiecide` resolves to `E. WANHG`

### 1.2 Consolidator status for match 463

```bash
cd /home/michal/projects/eanhl-team-website/.claude/worktrees/phase-3a
set -a && source /home/michal/projects/eanhl-team-website/.env && set +a
pnpm --filter worker exec node dist/consolidate-loadouts-cli.js --match 463 2>&1 | tail -n 120
```

Record:

- unresolved personas
- unresolved gamertags
- any raw rows that look like contamination rather than real players

### 1.3 Benchmark status for match 250

```bash
cd /home/michal/projects/eanhl-team-website/.claude/worktrees/phase-3a
pnpm --filter @eanhl/worker build
set -a && source /home/michal/projects/eanhl-team-website/.env && set +a
node --test apps/worker/dist/__tests__/match-250-benchmark.test.js 2>&1 | grep -E "lobby typed_v1|persona accuracy|^ok|^not ok"
```

Expected current failure shape:

- `not ok 19 - match 250: lobby typed_v1 hard-field accuracy ≥ 90%`
- `not ok 20 - match 250: lobby typed_v1 soft-field accuracy ≥ 75%`
- `lobby persona accuracy: 3/10`

If this changes, write down the exact new numbers.

## Task 2: Audit Persona Aliases

Use the V2 benchmark as canonical truth:

[Manual OCR benchmark for verification V2.md](/home/michal/projects/eanhl-team-website/research/OCR-SS/Manual%20OCR%20benchmark%20for%20verification%20V2.md)

### 2.1 Known alias situation

Already confirmed in the DB:

- `E.Wanhg => E. WANHG`
- `H.Jenkins => H. JENKINS`
- `H.Yoint => H. YOINT`
- `L.Hutson => L. HUTSON`
- `Whoosah => WHOOSAH`

Already inserted during the accidental live pass:

- `Evgeni Wanhg => E. WANHG`

Likely still unresolved:

- `Yuzza lead lafallo`

### 2.2 Decision rule

For each unresolved persona, decide which bucket it belongs to:

1. Real persona with known canonical from V2:
   seed alias
2. Real persona but canonical unknown from V2:
   stop and look it up manually before writing anything
3. Junk OCR / contamination:
   do not seed an alias just to silence the warning

### 2.3 Alias seeding command

Use only when the canonical is confirmed:

```bash
pnpm --filter worker promote-persona-alias --map "RAW_OCR=>CANONICAL"
```

Example:

```bash
pnpm --filter worker promote-persona-alias --map "Yuzza lead lafallo=>YUZZA LEAD LAFALLO"
```

### 2.4 Verification after each alias batch

Re-run:

```bash
pnpm --filter worker exec node dist/consolidate-loadouts-cli.js --match 250
pnpm --filter worker exec node dist/consolidate-loadouts-cli.js --match 463
```

Then re-run the benchmark:

```bash
node --test apps/worker/dist/__tests__/match-250-benchmark.test.js 2>&1 | grep -E "lobby typed_v1|persona accuracy|^ok|^not ok"
```

### 2.5 Stop condition

If benchmark persona accuracy does not move after alias seeding, stop pretending aliases are the real fix.
That means the remaining problem is in raw lobby snapshots or promotion behavior, not in the alias table.

## Task 3: Audit Build Classes

### 3.1 Pull live distinct build_class values

```bash
docker exec eanhl-team-website-db-1 psql -U eanhl -d eanhl -At -c "
SELECT DISTINCT build_class
FROM player_loadout_snapshots
WHERE match_id IN (250, 463) AND build_class IS NOT NULL
ORDER BY build_class;
"
```

### 3.2 Current values already observed

These are the values previously seen:

- `#11-E.Wanhg`
- `#48-L.Hutson`
- `#48-Lane Hutson`
- `Cole Caufield-SNP`
- `MatthewTkachuk-PWF`
- `Orygoon-Ducks`
- `Playmaker`
- `Power Forward`
- `Puck Moving Defenseman`
- `Sniper`
- `Two-Way Defenseman`
- `Two-Way Forward`

### 3.3 Current YAML canonicals

File:
[build_classes.yaml](/home/michal/projects/eanhl-team-website/.claude/worktrees/phase-3a/tools/game_ocr/game_ocr/configs/closed_vocab/nhl26/build_classes.yaml)

Current canonical set:

- `Defensive Defenseman`
- `Grinder`
- `Offensive Defenseman`
- `Playmaker`
- `Power Forward`
- `Puck Moving Defenseman`
- `Sniper`
- `Two-Way Defenseman`
- `Two-Way Forward`

### 3.4 Decision table

Do not use the raw DB diff blindly.

Values that are real aliases and already match the current closed vocab:

- `Cole Caufield-SNP` -> matches `Sniper`
- `Tage Thompson - PowerForward` -> matches `Power Forward`
- `MatthewTkachuk-PWF` -> matches `Power Forward`

Values that are junk contamination and should **not** be added as canonicals:

- `Orygoon-Ducks`
- `#11-E.Wanhg`
- `#48-L.Hutson`
- `#48-Lane Hutson`

This means the YAML gap is smaller than the raw DB list suggests.

### 3.5 Manual matcher check

```bash
cd /home/michal/projects/eanhl-team-website/.claude/worktrees/phase-3a
PYTHONPATH=tools/video_ingest:tools/game_ocr python3 -c "from game_ocr.loadout_extractors.closed_vocab import load_closed_vocab; v=load_closed_vocab('build_classes', version='nhl26'); samples=['Cole Caufield-SNP','Tage Thompson - PowerForward','MatthewTkachuk-PWF','Orygoon-Ducks','#11-E.Wanhg','#48-L.Hutson']; [print(s, '=>', v.match_canonical(s)) for s in samples]"
```

Expected result pattern:

- real aliases return a canonical tuple
- junk contamination returns `None`

### 3.6 Only edit YAML if you confirm a real missing canonical

Do not add entries just because the DB contains garbage.

Use V2 as the source of truth for whether a themed build is actually in scope.

## Task 4: Record What Actually Blocks the Benchmark

The benchmark reads raw lobby rows, not consolidated rows.

Manual proof step:

1. Open [match-250-benchmark.test.ts](/home/michal/projects/eanhl-team-website/.claude/worktrees/phase-3a/apps/worker/src/__tests__/match-250-benchmark.test.ts:1593)
2. Confirm `loadLobbySnapshotsForMatch` joins `ocr_extractions`
3. Confirm it filters `screenType = 'pre_game_lobby_state_2'`
4. Confirm it compares raw `playerNamePersona` values directly

If that code is unchanged, then this is the real conclusion:

- consolidator fixes are downstream
- benchmark gate requires upstream raw-row improvement or different benchmark logic

## Recommended Manual Order

1. Reproduce current consolidator output for `250` and `463`
2. Reproduce current benchmark output for `250`
3. Confirm unresolved persona list against V2
4. Seed only canonically confirmed aliases
5. Re-run consolidator and benchmark
6. If persona score still sticks at `3/10`, stop Task A and log it as a plan flaw
7. Audit build-class values using the decision table above

## What Success Looks Like

Best case:

- unresolved persona list is exhausted
- benchmark numbers improve
- build-class audit yields zero junk YAML additions

Acceptable honest outcome:

- alias table is correct
- consolidator output improves
- benchmark still fails because the benchmark source is upstream of consolidation

That is not operator failure. That is the plan being wrong.
