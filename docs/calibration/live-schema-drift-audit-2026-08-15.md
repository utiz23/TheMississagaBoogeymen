# Live schema drift audit — migration 0056 vs. the live database (2026-08-15)

**Scope:** read-only audit of the live PostgreSQL schema against the repository's expected
schema at `HEAD = 540777a`, to determine whether migration `0056_period_family_review_status.sql`
is applied, whether any earlier drift exists, and whether rescue execution may proceed.

**Nothing was written.** No migration was applied, no schema or data was changed, no container
was restarted or rebuilt, no rescue window was executed, no allowlist was created.

**Session read-only proof** — every database statement in this audit ran through a connection
opened with `PGOPTIONS='-c default_transaction_read_only=on'`:

```
 default_transaction_read_only    transaction_read_only
------------------------------   -----------------------
 on                               on
```

`current_database=eanhl` · `current_user=eanhl` · `PostgreSQL 16.13 on x86_64-pc-linux-musl`.

---

## 1. Verdict

# 🔴 BLOCKED

Migration 0056 is **entirely absent** from the live database — zero of its eleven artifacts
exist. Drift is **confined to 0056**: every schema artifact of migrations 0046 through 0055 is
present and correct on the live database.

The block is **not merely procedural**. The repository's current source cannot run against the
live schema: the read boundary `getMatchPeriodSummaries` and the entire period-family review
and promotion surface reference three columns that do not exist, and Drizzle's INSERT builder
emits all three column names unconditionally. Any code path at `HEAD` that reaches those sites
fails with `42703 undefined_column`.

Two facts keep this from being a live outage, and both are confirmed rather than assumed:

- **Neither deployed container carries the 0056-dependent code.** The web image was built
  2026-08-02 and the worker image 2026-06-01; the period-family commits landed 2026-08-07 →
  2026-08-09. Direct `grep` inside both running containers finds **zero** references to the
  family columns. Both services are healthy and are running the pre-0056 whole-row gating.
- **The host-side build is the actual hazard.** `packages/db/dist` and `apps/worker/dist` were
  rebuilt 2026-08-09 21:51–21:52 **with** the family-column code. Local worker CLIs
  (`reconcile-periods`, `auto-drain`, `ingest-ocr-review`) therefore run 0056-dependent code
  against a pre-0056 database today.

---

## 2. Confirmed live schema — `public.match_period_summaries`

14 columns. No triggers, no rules, no dependent views.

| # | column | type | nullable | default |
|--:|---|---|---|---|
| 1 | `id` | bigint | NO | `nextval('match_period_summaries_id_seq')` |
| 2 | `match_id` | bigint | NO | — |
| 3 | `period_number` | integer | NO | — |
| 4 | `period_label` | text | NO | — |
| 5 | `goals_for` | integer | YES | — |
| 6 | `goals_against` | integer | YES | — |
| 7 | `shots_for` | integer | YES | — |
| 8 | `shots_against` | integer | YES | — |
| 9 | `faceoffs_for` | integer | YES | — |
| 10 | `faceoffs_against` | integer | YES | — |
| 11 | `source` | text | NO | — |
| 12 | `ocr_extraction_id` | bigint | YES | — |
| 13 | `review_status` | text | NO | `'pending_review'::text` |
| 14 | `bgm_attack_direction` | text | YES | — |

**Indexes**

- `match_period_summaries_pkey` — PRIMARY KEY btree (`id`)
- `match_period_summaries_match_idx` — btree (`match_id`)
- `match_period_summaries_uniq` — UNIQUE btree (`match_id`, `period_number`, `source`)

**Foreign keys**

- `match_period_summaries_match_id_matches_id_fk` → `matches(id)`
- `match_period_summaries_ocr_extraction_id_ocr_extractions_id_fk` → `ocr_extractions(id)`

**CHECK constraints:** none on this table.
**Column comments:** only `bgm_attack_direction` carries one. `review_status` has **no** comment
— 0056 would have set one; its absence is corroborating evidence that 0056 never ran.

**Size and population**

| metric | value |
|---|---|
| rows | **259** |
| distinct matches | **65** |
| total relation size | 112 kB (32 kB heap) |
| rows with `goals_for` non-NULL | 198 |
| rows with `shots_for` non-NULL | 136 |
| rows with `faceoffs_for` non-NULL | 161 |

**Existing review-status distribution** (all rows are `source='ocr'`; no `ea` or `manual` rows)

| source | review_status | rows |
|---|---|--:|
| ocr | `pending_review` | 171 |
| ocr | `reviewed` | 88 |
| | **total** | **259** |

No row holds a `review_status` outside the `('pending_review','reviewed','rejected')` union, so
0056's three CHECK constraints would validate cleanly against the current corpus.

---

## 3. Expected repository schema

`packages/db/src/schema/match-enrichments.ts` (`matchPeriodSummaries`) plus migration 0056
define **17** columns — the 14 above plus three per-family status columns:

| column | type | nullable | default | constraint |
|---|---|---|---|---|
| `goals_review_status` | text | NOT NULL | `'pending_review'` | `match_period_summaries_goals_review_status_chk` |
| `shots_review_status` | text | NOT NULL | `'pending_review'` | `match_period_summaries_shots_review_status_chk` |
| `faceoffs_review_status` | text | NOT NULL | `'pending_review'` | `match_period_summaries_faceoffs_review_status_chk` |

Each CHECK pins the column to `IN ('pending_review','reviewed','rejected')`, mirroring the
`OcrReviewStatus` union. 0056 additionally sets four column comments (the three new columns plus
a rewritten comment on legacy `review_status`).

---

## 4. Exact live-versus-repository drift table

### 4.1 Migration 0056 — every artifact

| # | artifact | kind | expected | live | drift |
|--:|---|---|---|---|---|
| 1 | `match_period_summaries.goals_review_status` | column | present | **MISSING** | ❌ |
| 2 | `match_period_summaries.shots_review_status` | column | present | **MISSING** | ❌ |
| 3 | `match_period_summaries.faceoffs_review_status` | column | present | **MISSING** | ❌ |
| 4 | `match_period_summaries_goals_review_status_chk` | constraint | present | **MISSING** | ❌ |
| 5 | `match_period_summaries_shots_review_status_chk` | constraint | present | **MISSING** | ❌ |
| 6 | `match_period_summaries_faceoffs_review_status_chk` | constraint | present | **MISSING** | ❌ |
| 7 | backfill `goals_review_status ← review_status` | data | 259 rows | **not performed** | ❌ |
| 8 | backfill `shots_review_status ← review_status` | data | 259 rows | **not performed** | ❌ |
| 9 | backfill `faceoffs_review_status ← review_status` | data | 259 rows | **not performed** | ❌ |
| 10 | comments on the three new columns | comment | present | **MISSING** | ❌ |
| 11 | rewritten comment on `review_status` | comment | present | **MISSING** | ❌ |

**11 of 11 artifacts missing. 0056 is entirely absent — not partially applied.**

### 4.2 Migrations 0046 → 0055 — verified artifact by artifact

| migration | artifact | kind | live |
|---|---|---|---|
| 0046 | `player_loadout_snapshots.ocr_extraction_id` | column | ✅ PRESENT |
| 0046 | FK `…ocr_extraction_id → ocr_extractions(id)` | constraint | ✅ PRESENT¹ |
| 0047 | `ocr_field_evidence_match_screen_slot_idx` | index | ✅ PRESENT |
| 0048 | `ocr_decoder_runs` | table | ✅ PRESENT |
| 0048 | `ocr_decoder_runs_provenance_uniq` | index | ✅ PRESENT |
| 0048 | `ocr_decoder_runs_one_active_per_match` | index | ✅ PRESENT |
| 0048 | `run_id` on `ocr_capture_batches` / `ocr_segments` / `ocr_field_evidence` / `ocr_extractions` / `ocr_promotions` | 5 columns | ✅ ALL PRESENT |
| 0048 | `ocr_capture_batches_video_sha_dir_run_uniq` | index | ✅ PRESENT |
| 0048 | `ocr_segments_match_segment_run_uniq` | index | ✅ PRESENT |
| 0048 | `ocr_promotions_target_run_uniq` | index | ✅ PRESENT |
| 0049 | `player_loadout_snapshots.is_cpu` | column | ✅ PRESENT |
| 0049 | `player_loadout_snapshots_match_human_idx` | index | ✅ PRESENT |
| 0050 | `ocr_run_quality_reports` | table | ✅ PRESENT |
| 0050 | `ocr_run_quality_reports_run_id_uniq` | index | ✅ PRESENT |
| 0050 | `ocr_run_quality_reports_l1_score_range_chk` | constraint | ✅ PRESENT |
| 0051 | `overall_pass`, `l2_score`, `l2_lineup_score`, `l3_score` DROP NOT NULL | nullability | ✅ ALL NULLABLE |
| 0052 | `player_loadout_snapshots.is_captain_confidence` | column | ✅ PRESENT |
| 0053 | `player_loadout_snapshots.subject_slot_key` | column | ✅ PRESENT |
| 0054 | `ocr_run_quality_reports.l4_score` | column | ✅ PRESENT |
| 0054 | `ocr_run_quality_reports_l4_range_chk` | constraint | ✅ PRESENT |
| 0055 | `ocr_match_associations` | table | ✅ PRESENT |
| 0055 | `ocr_match_associations_reel_uniq` | index | ✅ PRESENT |
| 0055 | `ocr_match_associations_confidence_range_chk` | constraint | ✅ PRESENT |

¹ The migration names this constraint
`player_loadout_snapshots_ocr_extraction_id_ocr_extractions_id_fk` (64 chars). PostgreSQL
truncates identifiers to 63 bytes, so it exists live as
`player_loadout_snapshots_ocr_extraction_id_ocr_extractions_id_f`. The constraint definition is
correct (`FOREIGN KEY (ocr_extraction_id) REFERENCES ocr_extractions(id)`). **Cosmetic naming
artifact of PostgreSQL truncation, not drift.** Any future tooling that matches this constraint
by its full literal name will not find it.

---

## 5. Earliest and latest provable migration state

### 5.1 The ledger exists — the preliminary inspection looked in the wrong schema

`__drizzle_migrations` **does exist**, in the **`drizzle`** schema, not `public`:

```
drizzle.__drizzle_migrations (id integer PK, hash text NOT NULL, created_at bigint)
```

It holds **47 rows**, ids 1–49 (27 and 28 absent), spanning 2026-04-11 → 2026-05-25.

### 5.2 The ledger is not a trustworthy record of 0046+

`packages/db/migrations/meta/_journal.json` contains **46 entries**, `0000` → `0045_simple_blindfold`.
Migrations **0046–0056 are not in the journal at all** — they are the hand-written idempotent SQL
applied directly via `psql`, per the convention 0056's own header documents (lines 50–53).

Comparing SHA-256 of every migration file against the ledger:

| migration | SHA in ledger? | actually applied to live schema? |
|---|---|---|
| 0046 | ❌ no | ✅ **yes** (verified by inspection) |
| 0047 | ❌ no | ✅ **yes** |
| 0048 | ✅ **yes** | ✅ yes |
| 0049–0055 | ❌ no | ✅ **yes** (all verified) |
| 0056 | ❌ no | ❌ **no** |

**The ledger under-reports by nine applied migrations.** Exactly one hand-written migration
(0048) had a ledger row inserted manually — row id 49, `created_at = 1779683545919`
(2026-05-25), the latest row in the table. This is precisely why the audit brief's instruction
not to infer migration state from the ledger is correct: had the ledger been trusted, 0046,
0047 and 0049–0055 would have been wrongly reported as missing.

### 5.3 Provable bounds

- **Earliest provable state:** migrations `0000` → `0045` are attested by the ledger *and*
  consistent with live schema. One journal file, `0001_tiny_morph`, has a file hash absent from
  the ledger — the file was edited after application (the known manual-fixup pattern). This is
  cosmetic; see §5.4.
- **Latest provable state:** **0055 is fully applied.** Every artifact of 0046–0055 was
  independently confirmed present on the live database by direct catalogue inspection, without
  reliance on any ledger.
- **0056 is the sole unapplied migration**, and it is unapplied in full.

### 5.4 `drizzle-kit migrate` is currently a no-op — but `drizzle-kit generate` is a live hazard

The Drizzle migrator gate (`drizzle-orm@0.45.2`, `pg-core/dialect.js:62`) is:

```js
if (!lastDbMigration || Number(lastDbMigration.created_at) < migration.folderMillis) { /* apply */ }
```

The gate is **timestamp-based, not hash-based**. Latest ledger `created_at` is `1779683545919`
(2026-05-25, the manual 0048 row); the highest journal `folderMillis` is `1779232670828` (0045).
Since every journal entry predates the last ledger row, **`pnpm --filter db migrate` applies
nothing today** — including the hash-mismatched `0001_tiny_morph`. That is a safe accident, not
a designed guarantee.

`pnpm --filter db generate` is the real danger. `drizzle.config.ts` points at
`./migrations`, and the newest snapshot in `migrations/meta/` is **`0045_snapshot.json`** — there
is no 0046+ snapshot. `drizzle-kit generate` would therefore diff the current
`src/schema/index.ts` against the *0045* snapshot and emit a migration attempting to re-create
everything introduced by 0046–0055 (already live) alongside 0056. Running it would produce a
migration that errors or damages the schema.

⚠️ **The `schema-change` skill (`.claude/skills/schema-change/SKILL.md`, §1) still instructs
`pnpm --filter db generate` then `pnpm --filter db migrate`.** Following that skill literally for
0056 would be actively harmful. The skill is stale with respect to the frozen-journal convention
and should be corrected in the same session that applies 0056.

---

## 6. Is drift limited to migration 0056?

**Yes.** Every schema artifact of migrations 0046 through 0055 is present and correct on the
live database (§4.2), verified by direct catalogue inspection rather than by ledger inference.
The only substantive divergence between the live database and the repository's expected schema
is the complete absence of migration 0056.

The single naming discrepancy (§4.2 footnote 1) is PostgreSQL's 63-byte identifier truncation of
a 64-character constraint name from 0046, not a missing object.

---

## 7. Affected application paths

Every site below is at `HEAD = 540777a` and would raise
`ERROR 42703: column "…_review_status" does not exist` against the live schema.

### 7.1 Read boundary — web

| path | site | consequence |
|---|---|---|
| `packages/db/src/queries/match-enrichments.ts:74` `getMatchPeriodSummaries` | selects and filters on all three family columns (lines 81–119) | throws 42703 |
| `apps/web/src/app/games/[id]/page.tsx:115` | calls it inside `safe(() => …, [])` | **silently degrades** — the `safe` helper (line 355) swallows the error and returns `[]`, so the match page renders with **no period summaries at all** rather than crashing |

This is the most treacherous failure mode in the set: a schema error becomes a silent, total
loss of per-period display with no user-visible error and no log entry.

### 7.2 Review / promotion surface — `packages/db`

| site | function | role |
|---|---|---|
| `match-enrichments.ts:294–311` | `FAMILY_COLUMNS` | maps each family to its status column |
| `match-enrichments.ts:317–321` | `REVIEWED_PATCH` | the one-column-per-family promotion patch |
| `match-enrichments.ts:473` | `promoteOcrPeriodFamily` | per-family promotion |
| `match-enrichments.ts:345` | `periodFamilyRejectionBarrier` | rejection barrier predicate |
| `match-enrichments.ts:874–888` | `countPendingOcrPeriodFamilies` | pending-review queue counts |

### 7.3 Worker

| site | reached via |
|---|---|
| `apps/worker/src/lib/review-cascade.ts:242–257, 505–507` | `pnpm --filter worker auto-drain`, `pnpm --filter worker ingest-ocr-review` |
| `apps/worker/src/reconcile-periods-cli.ts` | `pnpm --filter worker reconcile-periods` |

### 7.4 The promoter INSERT — latent, and directly relevant to rescue

`apps/worker/src/ocr-promoters/box-score.ts` does **not** name the family columns in source. It
nonetheless breaks, because Drizzle's insert builder emits the table's **entire** column list.
Confirmed by `.toSQL()` (built, never executed, never connected):

```sql
insert into "match_period_summaries" ("id","match_id","period_number","period_label",
  "goals_for","goals_against","shots_for","shots_against","faceoffs_for","faceoffs_against",
  "source","ocr_extraction_id","review_status",
  "goals_review_status","shots_review_status","faceoffs_review_status",   -- ← do not exist live
  "bgm_attack_direction")
values (default,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,default,default,default,default,default)
```

Two distinct behaviours follow, and the difference matters:

- **UPDATE path** (`box-score.ts:98–107`, taken when the `(match_id, period_number, source='ocr')`
  row already exists) — sets only explicitly named columns. **Would succeed** against the live
  schema.
- **INSERT path** (`box-score.ts:123`, taken when no such row exists) — emits all 17 column
  names. **Fails with 42703.**

The promoter dispatcher and the rest of the `ingest-ocr` call graph contain no other reference
to the family columns. `net-chart.ts`'s `recomputeAllPeriodsAggregate` writes
`match_shot_type_summaries`, not `match_period_summaries`, and is unaffected by 0056.

---

## 8. Current deployment compatibility assessment

### Confirmed runtime facts

| container | image | image built | started | family-column references found inside |
|---|---|---|---|---|
| `eanhl-team-website-web-1` | `eanhl-team-website-web:latest` | **2026-08-02T16:50:43Z** | 2026-08-15T16:46:13Z | **none** |
| `eanhl-team-website-worker-1` | `eanhl-team-website-worker:latest` | **2026-06-01T06:06:56Z** | 2026-08-15T16:46:13Z | **none** |

The "none" column is backed by two independent greps for `goalsReviewStatus` / `goals_review_status`
inside each running container: a targeted scan of `/app/apps` + `/app/packages`, and a full-tree
scan of `/app` (including `node_modules`). **Both returned zero matches in both containers.**
| `eanhl-team-website-db-1` | `postgres:16-alpine` | — | up 9h, healthy | — |

The period-family commits (`ab8dd28` → `3038821`) landed 2026-08-07 → 2026-08-09. **Both images
predate them**, and the in-container `grep` confirms the code is absent rather than merely
assumed absent.

Both services are healthy. The worker completed a normal cycle
(`[worker] Cycle done in 12544ms`); the web app reports `✓ Ready`. `docker-compose.yml` defines
**no migration service** — migrations are never applied automatically at deploy time.

### Inference (clearly flagged as such)

- The deployed web app uses the **pre-0056 whole-row** gating on `review_status`, so the 88
  `reviewed` rows are currently exposed as whole rows. This follows from the image predating the
  commits and the in-container grep; it was not observed by exercising the running page.
- **The live site is presently consistent with the live schema.** The drift is between the
  *repository* and the database, not between the *deployment* and the database.

### The genuine present-day hazard: the host build

| artifact | built | contains family-column code |
|---|---|---|
| `packages/db/dist/queries/match-enrichments.js` | 2026-08-09 21:51:59 | **yes** |
| `apps/worker/dist/lib/review-cascade.js` | 2026-08-09 21:52:21 | **yes** |
| `apps/worker/dist/reconcile-periods-cli.js` | 2026-08-09 | **yes** |

Any local worker CLI invoked today — `reconcile-periods`, `auto-drain`, `ingest-ocr-review` —
runs 0056-dependent compiled code against a pre-0056 database and will fail with 42703. **This
is a live footgun right now, independent of any rescue decision.**

### Ordering consequence

Because the containers do not carry the new code, **0056 can be applied before any redeploy
without breaking the running services** — the migration is additive and, per §9, visibility-neutral.
The dangerous ordering is the reverse: redeploying web or worker from `HEAD` *before* applying
0056 would take the match detail page's period summaries silently to empty (§7.1).

---

## 9. Expected backfill and data impact

0056's backfill is a verbatim copy of `review_status` into all three family columns, applied only
when the column is absent.

| step | rows affected |
|---|---|
| `ADD COLUMN goals_review_status … DEFAULT 'pending_review'` | 259 (metadata-only, see §10) |
| `UPDATE … SET goals_review_status = review_status` | **259** |
| `ADD COLUMN shots_review_status` + `UPDATE` | **259** |
| `ADD COLUMN faceoffs_review_status` + `UPDATE` | **259** |
| **total row updates** | **777** (3 × 259) |

Resulting family-status distribution — identical across all three families:

| family status after backfill | rows |
|---|--:|
| `pending_review` | 171 |
| `reviewed` | 88 |

### Visibility parity — verified, not assumed

Simulating both predicates over the live corpus (read-only):

| gating | rows exposed |
|---|--:|
| today's whole-row rule (`source='ea' OR review_status='reviewed'`) | **88** |
| post-0056 family rule (`source='ea' OR any family = 'reviewed'`) | **88** |

**No row changes visibility.** The backfill is compatibility-preserving exactly as the migration
header claims. Note this parity holds only because the backfill is verbatim; it is a property of
the migration, not a permanent invariant.

### Conflict check against existing data

| risk | finding |
|---|---|
| `review_status` values outside the CHECK union | **none** — only `pending_review` (171) and `reviewed` (88) |
| existing columns with the target names | none |
| dependent views | **none** |
| triggers / rules on the table | **none** |
| NOT NULL violated during add | impossible — column is added `NOT NULL DEFAULT` in one statement |
| rows temporarily holding NULL/invalid family status | none — no window exists (single transaction) |

The three CHECK constraints will validate against all 259 rows without error.

---

## 10. Locking and operational risks

### Transactional behaviour

The whole migration is wrapped in a single `BEGIN … COMMIT` (lines 63, 144). The
`--> statement-breakpoint` markers are Drizzle-tooling annotations; when the file is applied by
hand via `psql -f`, they are SQL comments and do **not** split the transaction. **Applying by
hand therefore yields one atomic transaction — either all eleven artifacts land or none do.**
This is the desired property and it should be preserved.

That atomicity comes from the **file's own** `BEGIN`/`COMMIT`, not from any `psql` flag. It needs
no external wrapper, and `-1` / `--single-transaction` must **not** be added on top of it — see
prerequisite 4 in §11 for why the two nest badly.

⚠️ Do **not** apply this file through `drizzle-kit`, which honours the breakpoints and would
split it into separately-committed statements, allowing a partially-applied 0056.

### Idempotency and rerun hazards

Idempotency is genuinely correct here, and deliberately stronger than `ADD COLUMN IF NOT EXISTS`:

- Each column is guarded by an `information_schema.columns` existence check, so the paired
  `UPDATE` runs **only** on first creation. A rerun therefore **cannot clobber family statuses
  that operator review has since advanced** — the failure mode a bare
  `ADD COLUMN IF NOT EXISTS` + unconditional `UPDATE` would have.
- Each CHECK uses the `DO … EXCEPTION WHEN duplicate_object THEN NULL` guard.
- `COMMENT ON COLUMN` is naturally idempotent.

**Rerun is safe.** One residual hazard: if a *future* partial state ever arose in which a column
exists but its backfill did not run, the guard would skip the backfill and leave that family at
the `'pending_review'` default. The file's own `BEGIN`/`COMMIT` boundary makes this unreachable
via `psql -f`, but it is reachable if the file is split (see above).

### Locks

| statement | lock | duration / cost |
|---|---|---|
| `ALTER TABLE … ADD COLUMN … NOT NULL DEFAULT` ×3 | ACCESS EXCLUSIVE | **metadata-only** — PostgreSQL ≥11 stores a non-volatile default in `pg_attribute.attmissingval`; **no table rewrite** |
| `UPDATE … SET family = review_status` ×3 | ROW EXCLUSIVE (within the held ACCESS EXCLUSIVE) | 259 rows each; rewrites 259 tuples ×3 |
| `ALTER TABLE … ADD CONSTRAINT … CHECK` ×3 | ACCESS EXCLUSIVE + full validation scan | 259 rows |
| `COMMENT ON COLUMN` ×4 | ACCESS EXCLUSIVE (catalogue) | trivial |

ACCESS EXCLUSIVE is held on `match_period_summaries` for the **entire transaction**, blocking all
reads and writes to that one table.

**Practical impact: negligible.** The table is 112 kB / 259 rows; the whole transaction should
complete in single-digit milliseconds. No other table is touched. `pg_stat_activity` shows nine
connections, **all `idle` with no open transaction** — no lock contention and no risk of the
`ALTER` queueing behind a long-running statement, which is the usual way a "fast" ACCESS
EXCLUSIVE migration stalls a system.

The worker polls every 300 s and its current image does not touch these columns; a
sub-second lock cannot realistically collide with it. Dead-tuple bloat from 777 row updates on a
32 kB heap is immaterial, though a `VACUUM ANALYZE` afterwards is cheap and worthwhile —
`pg_stat_user_tables` shows this table has **never been analyzed** (`last_analyze` NULL,
`n_live_tup` 0).

### Backup requirements

- A `pg_dump` of the `eanhl` database immediately before applying — the table is tiny, so a
  full-database dump costs almost nothing and is strictly preferable to a table-only dump.
- At minimum, capture the pre-migration state of the 259 rows
  (`id, match_id, period_number, source, review_status`) so the backfill can be independently
  reconstructed.
- Confirm the dump is readable **before** applying. An unverified dump is not a backup.

### Rollback requirements

Rollback is structurally simple because the migration is purely additive:

```sql
BEGIN;
ALTER TABLE match_period_summaries DROP CONSTRAINT IF EXISTS match_period_summaries_goals_review_status_chk;
ALTER TABLE match_period_summaries DROP CONSTRAINT IF EXISTS match_period_summaries_shots_review_status_chk;
ALTER TABLE match_period_summaries DROP CONSTRAINT IF EXISTS match_period_summaries_faceoffs_review_status_chk;
ALTER TABLE match_period_summaries DROP COLUMN IF EXISTS goals_review_status;
ALTER TABLE match_period_summaries DROP COLUMN IF EXISTS shots_review_status;
ALTER TABLE match_period_summaries DROP COLUMN IF EXISTS faceoffs_review_status;
COMMIT;
```

No such rollback script exists in the repository; one should be written and reviewed **before**
applying, not improvised afterwards. Two caveats:

1. `review_status` is untouched by 0056, so rollback restores the pre-migration state exactly —
   **provided no operator review has advanced a family column in the meantime.** Once per-family
   review begins, the family columns hold information that `review_status` does not, and dropping
   them **destroys it irrecoverably**. Rollback is safe only in the window before per-family
   review starts.
2. Rollback must be paired with reverting the deployed code, or the application returns to the
   42703 state of §7.

---

## 11. Safe prerequisites for a future, separately authorized migration session

**None of the following is authorized by this audit.** They are the preconditions such a session
would need.

1. **Take and verify a `pg_dump` backup** of the `eanhl` database, and confirm it restores or at
   minimum reads cleanly.
2. **Do not run `pnpm --filter db generate`.** The newest snapshot is `0045_snapshot.json`;
   generate would diff against it and emit a migration re-creating the already-applied 0046–0055
   objects. This is the single most likely way to damage the database in this session.
3. **Do not run `pnpm --filter db migrate`.** It is currently a no-op by timestamp accident, and
   it would split 0056 at the `statement-breakpoint` markers, forfeiting atomicity.
4. **Apply 0056 by hand, unchanged, letting the file own its transaction**, following the
   0046–0055 convention. The migration supplies its own `BEGIN` (line 63) and `COMMIT` (line 144)
   — those are its only transaction-control statements — so no external transaction wrapper is
   needed or wanted:

   ```bash
   docker exec -i eanhl-team-website-db-1 \
     psql -U eanhl -d eanhl -v ON_ERROR_STOP=1 -f - \
     < packages/db/migrations/0056_period_family_review_status.sql
   ```

   - **`ON_ERROR_STOP=1` is required.** Without it `psql` continues past a failed statement, and
     the file's trailing `COMMIT` would then commit a partially-applied migration.
   - **Failure behaviour is safe.** If any statement fails before the file's `COMMIT`, `psql`
     stops immediately and the connection closes with the internal transaction still uncommitted
     — PostgreSQL rolls it back. Either all eleven artifacts land or none do.
   - **⚠️ Do not add `-1` / `--single-transaction` to this command while the file contains its
     own transaction-control statements.** `-1` opens a transaction before the file is read, so
     the file's own `BEGIN` warns `there is already a transaction in progress`, the file's
     `COMMIT` then ends `-1`'s transaction, and `psql`'s final implicit `COMMIT` warns
     `there is no transaction in progress`. This has been observed directly. The nesting is
     confusing rather than protective, and it silently moves the real commit boundary to the
     file's own `COMMIT` — where it already was. **Do not resolve this by stripping `BEGIN`/
     `COMMIT` from the migration**; the file's own transaction is the correct boundary and must
     stay.
5. **Decide and record the ledger policy.** Only 0048 has a manual ledger row today. Either
   insert a row for 0056 (consistent with 0048) or leave the ledger alone (consistent with
   0046–0047 and 0049–0055). The current state is inconsistent and should be resolved
   deliberately rather than by default. Note that inserting a row is a *write* and is outside
   this audit's authority.
6. **Correct the `schema-change` skill** (`.claude/skills/schema-change/SKILL.md` §1), which
   still prescribes the `generate` + `migrate` path that prerequisites 2 and 3 forbid. This is a
   documentation defect that will mislead a future session.
7. **Sequence deployment as: migrate → rebuild → redeploy.** Applying 0056 first is safe for the
   running containers (they do not use the columns). Redeploying `HEAD` first would silently
   empty the match page's period summaries (§7.1).
8. **Rebuild in dependency order** — `pnpm --filter @eanhl/db build`, then
   `pnpm --filter @eanhl/worker build`, then `docker compose build web worker` — per the
   `docker-redeploy` skill. Both images are stale relative to `HEAD` regardless of 0056.
9. **Write the rollback script (§10) before applying**, and note the window in which it stops
   being lossless.
10. **Confirm no long-running transaction holds a lock** on `match_period_summaries` immediately
    before applying (`pg_stat_activity` was clean at audit time, but this must be re-checked).
11. **Keep the migration session separate from any rescue execution session.** They are distinct
    approval decisions with distinct blast radii.

---

## 12. Post-migration verification checklist

All checks below are read-only and should be run in a session proven read-only as in §0.

1. **All three columns exist**, `text`, `NOT NULL`, default `'pending_review'`:
   ```sql
   SELECT column_name, data_type, is_nullable, column_default
   FROM information_schema.columns
   WHERE table_schema='public' AND table_name='match_period_summaries'
     AND column_name LIKE '%\_review\_status';
   ```
   Expect **4** rows (the three new plus legacy `review_status`); the table should have **17**
   columns total.
2. **All three CHECK constraints exist** and read
   `IN ('pending_review','reviewed','rejected')`:
   ```sql
   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
   WHERE conrelid='public.match_period_summaries'::regclass AND contype='c';
   ```
3. **Backfill fidelity — the critical check.** Every row's three family columns must equal its
   `review_status`. Expect **0 rows**:
   ```sql
   SELECT count(*) FROM match_period_summaries
   WHERE goals_review_status IS DISTINCT FROM review_status
      OR shots_review_status IS DISTINCT FROM review_status
      OR faceoffs_review_status IS DISTINCT FROM review_status;
   ```
4. **Distribution matches the pre-migration baseline** — each family: 171 `pending_review`,
   88 `reviewed`; total still **259** rows across **65** matches. No row count change is
   permitted; 0056 creates and deletes nothing.
5. **Visibility parity** — the post-migration family predicate must still expose **88** rows:
   ```sql
   SELECT count(*) FROM match_period_summaries
   WHERE source='ea' OR goals_review_status='reviewed'
      OR shots_review_status='reviewed' OR faceoffs_review_status='reviewed';
   ```
6. **Column comments present** on all four columns (`\d+ match_period_summaries`).
7. **No unintended collateral** — indexes and foreign keys unchanged from §2; still no triggers,
   rules, or dependent views.
8. **Application-level:** after rebuild and redeploy, load a match detail page for a match with
   `reviewed` rows and confirm period summaries render (not silently empty), and that a match
   with only `pending_review` rows exposes no per-period stats.
9. **Worker CLI:** `pnpm --filter worker reconcile-periods --all --json` (read-only, no
   `--promote`) should complete without 42703.
10. **`VACUUM ANALYZE match_period_summaries`** — the table has never been analyzed.
11. **Re-run this audit's §4 drift query** and confirm all 0056 artifacts report `PRESENT`.

---

## 13. Explicit unresolved questions

1. **Why was 0056 never applied?** The code was committed and the host `dist` rebuilt on
   2026-08-09, but the migration was not run. Whether this was an interrupted session, a
   deliberate hold, or an oversight is not determinable from the repository or the database.
   `HANDOFF.md` records the period-family workstream as undocumented elsewhere, which is
   consistent with an interrupted session but does not prove it.
2. **Ledger policy for hand-written migrations is undecided.** 0048 has a manual ledger row;
   0046–0047 and 0049–0055 do not. No document states the intended rule.
3. **Why is `0001_tiny_morph`'s file hash absent from the ledger?** Consistent with a
   post-application edit, but the specific edit is not established. Currently harmless because
   the migrator gate is timestamp-based — a property of `drizzle-orm@0.45.2` that could change on
   upgrade.
4. **Ledger ids 27 and 28 are absent.** Not investigated; the corresponding schema objects are
   present, so this appears inert.
5. **The deployed web app's actual rendering behaviour was not exercised.** The pre-0056 gating
   claim in §8 is inferred from image build dates plus in-container `grep`, not from loading a
   page. Verifying it would require driving the running site, which was out of scope.
6. **Whether other tables carry analogous undetected drift.** This audit verified 0046–0056
   exhaustively. Migrations 0000–0045 were accepted on ledger attestation plus their observable
   consistency with the live schema, not re-verified artifact by artifact.
7. **Whether any *other* uncommitted or unapplied migration is pending.** `0056` is the highest
   numbered file in `packages/db/migrations`; nothing indicates a 0057, but future work may
   assume otherwise.
8. **The correct long-term fix for the Drizzle full-column INSERT behaviour** (§7.4) — after 0056
   is applied the immediate breakage disappears, but the general fragility (schema drift silently
   breaking inserts that never name the drifted column) remains unaddressed.

---

## 14. Ruling: does rescue work remain blocked?

# ✅ YES — all rescue execution remains BLOCKED.

The block now rests on **two independent grounds**, either of which alone is sufficient.

### Ground 1 — authorization (pre-existing, unchanged)

`docs/calibration/rescue-non-faceoff-resimulation-2026-08-15.md` returned **PARTIAL**:
1 SAFE-TO-PROPOSE · 4 WITHHOLD-INVALID · 1 WITHHOLD-REDUNDANT · 2 NEEDS-REMEDIATION · 0
UNVERIFIED. **SAFE-TO-PROPOSE is a recommendation for management review, not execution
authorization.** No allowlist exists and none may be created without separate approval. This
audit does not alter that finding in any direction.

### Ground 2 — technical incapacity (established by this audit)

The repository's current code cannot safely execute a promotion against the live schema:

- The **read boundary** `getMatchPeriodSummaries` throws 42703 and, behind `safe()`, degrades to
  a silent total loss of period-summary display.
- The **promotion path** `promoteOcrPeriodFamily`, the `FAMILY_COLUMNS` / `REVIEWED_PATCH` maps,
  the rejection barrier, and the worker review cascade all throw 42703.
- The **promoter INSERT path** emits all three missing column names and throws 42703 for any
  window whose payload targets a period lacking an existing row.

### The specific SAFE-TO-PROPOSE window — a precise finding, not a loophole

Match **2676**, `post_game_box_score_goals`, segment **9003**, run **2131** is the one window the
resimulation graded SAFE-TO-PROPOSE. Live inspection confirms all four period rows already exist
with NULL goals:

| id | match | period | label | goals_for | goals_against | shots | faceoffs | review_status |
|---|---|---|---|---|---|---|---|---|
| 239 | 2676 | 1 | 1ST | NULL | NULL | 4–1 | 3–2 | pending_review |
| 240 | 2676 | 2 | 2ND | NULL | NULL | 6–2 | 3–3 | pending_review |
| 237 | 2676 | 3 | 3RD | NULL | NULL | 7–7 | 6–4 | pending_review |
| 238 | 2676 | 4 | OT | NULL | NULL | 1–1 | 1–2 | pending_review |

Because every row exists, this window would take the promoter's **UPDATE** path, which names
only the columns it sets and would **not** hit the 42703 INSERT failure. **This does not unblock
it.** The window remains blocked because:

- it is not authorized (Ground 1);
- the surrounding review/promotion machinery it would need — per-family promotion, the rejection
  barrier, the review cascade — is entirely 42703 against the live schema (Ground 2);
- writing goals values while the family gating columns do not exist would place data in the
  corpus under whole-row `review_status` semantics that 0056 exists specifically to retire —
  reintroducing the exact publication defect the migration closes;
- the resimulation itself notes this window's payload is **sampling-mode dependent** (schema-2
  vs schema-3 disagree on 4 of 8 windows, this one included).

### Additional standing block

The **8 faceoff-map windows** (7 not-attempted + 1 failed, match 2661) remain blocked on ROI/OCR
remediation, unchanged and independent of any schema question.

### Ordering ruling

**Migration 0056 must be applied, and the web and worker images rebuilt and redeployed, before
any rescue execution is even technically possible — and that sequence is itself a separate,
separately-authorized session.** Applying 0056 does not authorize rescue execution; it only
removes Ground 2. Ground 1 would still stand and would require its own management decision.

---

## Appendix — audit method and integrity

- **Database access:** every statement executed over a connection opened with
  `PGOPTIONS='-c default_transaction_read_only=on'`, verified `on` for both
  `default_transaction_read_only` and `transaction_read_only` before any application-table query.
  Only `SELECT`, `SHOW`, and `psql` catalogue meta-commands were issued.
- **Migration state** was established by direct `information_schema` / `pg_catalog` inspection of
  every artifact of migrations 0046–0056, **not** by ledger inference — which §5.2 shows would
  have produced nine false negatives.
- **Drizzle SQL** in §7.4 was obtained via `.toSQL()`, which serialises a query without
  connecting to or contacting the database.
- **Container inspection** used `docker inspect`, `docker logs`, and `docker exec … grep`
  (read-only), the last at two independent breadths (targeted `/app/apps` + `/app/packages`, and
  full-tree `/app`), which agreed. No container was started, stopped, restarted, rebuilt, or
  recreated.
- **Not changed by this session:** database schema, database data, the Drizzle ledger, container
  or image state, rescue state, allowlists, deployment state, and all pre-existing dirty and
  untracked files in the working tree.
- **Changed by this session:** this file, and the current top entry of `HANDOFF.md`.
