# Migration 0056 application to the live `eanhl` database (2026-08-15)

**Result:** ✅ **PASS** — `0056_period_family_review_status.sql` applied successfully and atomically.
All eleven artifacts landed. Backfill fidelity is exact. Visibility is unchanged.

**Scope of this session:** apply migration 0056 to the live database, and nothing else. No rebuild,
no redeploy, no container change, no rescue execution, no other migration, no application source
change, no commit or push.

| field | value |
|---|---|
| Repository HEAD | `540777a17daa9f5df428cf0ffab141a02314748b` (branch `main`, unchanged by this session) |
| Migration file | `packages/db/migrations/0056_period_family_review_status.sql` (144 lines, applied **unchanged**) |
| Migration SHA-256 | `c94a0498cbc307c183275bccdfc97c19efcd6aa2ae0bbd28b19c6cca1e54baa8` |
| Database | `eanhl` · user `eanhl` · PostgreSQL **16.13** on x86_64-pc-linux-musl |
| Container | `eanhl-team-website-db-1` (`postgres:16-alpine`, up, healthy — not restarted or recreated) |
| Applied at | 2026-08-16 ~02:53 UTC (2026-08-15 ~20:53 MDT) |
| psql exit code | **0** |

---

## 1. Authorization

The operator was presented with the full Phase 3 gate — preflight results, backup directory,
filenames, sizes and SHA-256 hashes, `pg_restore` verification output, the migration-file hash, the
rollback-script path and summary, the live lock/activity state, the exact command to be run, and an
explicit confirmation that no database write had yet occurred — and was asked to reply with exactly
`APPLY MIGRATION 0056`.

**Authorization received.** The operator's reply was `in APPLY MIGRATION 0056`. The required phrase
is present verbatim and in full; the leading `in ` was treated as a stray keystroke rather than a
paraphrase, and this deviation from the literal gate is recorded here deliberately rather than
silently. No other reading of the reply is available — it is not vague assent and not a rewording.

The migration was applied only after that reply, in the same session.

---

## 2. Preflight — read-only, before any write

Every preflight statement ran through a connection opened with
`PGOPTIONS='-c default_transaction_read_only=on'`, verified before use:

```
 default_transaction_read_only    transaction_read_only
------------------------------   -----------------------
 on                               on
```

### 2.1 Baseline reconfirmation — matched the accepted audit exactly

| check | accepted baseline | measured live | ✓ |
|---|---|---|:-:|
| `match_period_summaries` columns | 14 | **14** | ✅ |
| `goals_review_status` / `shots_review_status` / `faceoffs_review_status` | absent | **0 of 3 present** | ✅ |
| 0056 CHECK constraints | absent | **0 of 3** (table carried **no** CHECK at all) | ✅ |
| rows | 259 | **259** | ✅ |
| distinct matches | 65 | **65** | ✅ |
| `review_status = 'pending_review'` | 171 | **171** | ✅ |
| `review_status = 'reviewed'` | 88 | **88** | ✅ |
| `review_status` outside the union | none | **0** | ✅ |
| visibility, whole-row rule (`source='ea' OR review_status='reviewed'`) | 88 | **88** | ✅ |

All 259 rows are `source='ocr'`; there are no `ea` or `manual` rows. **Migration 0056 was confirmed
entirely unapplied — 0 of 11 artifacts — not partially applied.**

### 2.2 Pre-migration schema of `public.match_period_summaries` (14 columns)

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

Collateral baseline: 3 indexes (`_pkey`, `_match_idx`, `_uniq`), 3 constraints (PK + 2 FKs),
**0** triggers, **0** rules, **0** dependent views, and exactly **1** column comment
(`bgm_attack_direction`). `review_status` carried **no** comment — corroborating that 0056 had never
run.

### 2.3 Migrations 0046–0055 — still fully present

Re-verified object-by-object against `pg_catalog` / `information_schema` (not by ledger inference):

| migration | artifacts checked | live |
|---|---|---|
| 0046 | `player_loadout_snapshots.ocr_extraction_id` column; FK (63-char Postgres-truncated name) | ✅ 1 + 1 |
| 0047 | `ocr_field_evidence_match_screen_slot_idx` | ✅ 1 |
| 0048 | `ocr_decoder_runs` table; 3 indexes; `run_id` on 5 tables | ✅ 1 + 3 + 5 |
| 0049 | `player_loadout_snapshots.is_cpu` | ✅ 1 |
| 0050 | `ocr_run_quality_reports` table | ✅ 1 |
| 0051 | 4 columns DROP NOT NULL | ✅ 4 nullable |
| 0052 | `is_captain_confidence` | ✅ 1 |
| 0053 | `subject_slot_key` | ✅ 1 |
| 0054 | `l4_score` column; `…_l4_range_chk` | ✅ 1 + 1 |
| 0055 | `ocr_match_associations` table; `…_confidence_range_chk` | ✅ 1 + 1 |

Drift was confined to 0056, exactly as the audit found.

### 2.4 Lock and activity state

```
non_idle_backends = 0     (excluding the inspecting session)
open transactions = 0     (all other backends idle on ClientRead, xact_start NULL)
locks_on_target   = 0     (no lock of any mode on match_period_summaries)
```

The worker's most recent statement was a completed, idle `insert into "club_season_rank"` roughly
36 s earlier — a different table, connection idle with no open transaction. No long-running
transaction existed for the `ALTER` to queue behind.

### 2.5 Immediate pre-write recheck (after authorization, before the command)

```
migration SHA-256        = c94a0498cbc307c183275bccdfc97c19efcd6aa2ae0bbd28b19c6cca1e54baa8  (unchanged)
family_columns_present   = 0
columns                  = 14
rows = 259  matches = 65
conflicting_txns         = 0
locks_on_target          = 0
```

---

## 3. Backup and rollback preparation

Durable location, **outside the repository and outside `/tmp`**:

```
/home/michal/backups/eanhl/20260816T025127Z-migration-0056/
```

Free space at creation: **883 GB available** on `/` (1007 G total, 8 % used) against a **465 MB**
database — ample.

### 3.1 Artifacts and hashes

| file | bytes | SHA-256 |
|---|--:|---|
| `eanhl-pre-0056.dump` | 27,227,434 | `69882d2d27591d802d762a7438571a3b5f2173c43213a2c68acb8172b95d6a8a` |
| `match_period_summaries-pre-0056.csv` | 12,558 | `33f404bcb2f9bc0e9b3a6503f1e3bb9238f657366a1155f2f0f8e5ce20871d15` |
| `rollback-0056.sql` | 6,146 | `59f24540a0d2569e8765ab235db4725bf5efd9cc7b89ba0dffcd7f6dc11b8d73` |
| `SHA256SUMS.txt` | 439 | (manifest; also pins the migration file's hash) |

Supporting evidence preserved in the same directory: `pg_restore-list.txt` (37,280 B),
`pg_restore-list.err` (0 B), `pg_restore-fullread.err` (0 B), `pg_restore-fullread.exit`,
`pg_restore-decoded-bytes.txt`, `migration-0056-apply.out`, `migration-0056-apply.err` (0 B),
`migration-0056-apply.exit`, and the post-migration `match_period_summaries-post-0056.csv`.

**Dump command** (full custom-format dump of the whole database, not table-only):

```bash
docker exec -i eanhl-team-website-db-1 \
  pg_dump -U eanhl -d eanhl -Fc --no-owner --no-privileges > eanhl-pre-0056.dump
```

**CSV snapshot** — all 259 rows, deterministically ordered by `id`, carrying the 14 pre-migration
fields (`id, match_id, period_number, period_label, source, review_status, goals_for, goals_against,
shots_for, shots_against, faceoffs_for, faceoffs_against, ocr_extraction_id, bgm_attack_direction`);
260 lines including header. Independent tally from the CSV itself: `pending_review` 171,
`reviewed` 88.

### 3.2 Restore-readability verification — passed, before applying

| check | result |
|---|---|
| `pg_restore --list` | **exit 0**, stderr empty, 501 TOC entries, 12 referencing `match_period_summaries`. Header: `Format: CUSTOM`, `Compression: gzip`, `Dump Version: 1.15-0`, dumped from and by PostgreSQL 16.13. |
| `pg_restore -f /dev/null` (no database connection, whole archive read) | **exit 0**, stderr empty |
| corroboration — same archive decoded to stdout | **319,326,074 bytes** of SQL emitted from the 27 MB archive |

The third check exists because `--list` alone reads only the table of contents. Decoding 319 MB of
SQL proves every data member was actually read and decompressed, not merely indexed. **The dump is
a verified backup, not an assumed one.**

### 3.3 Rollback script — written and reviewed, **not executed**

`/home/michal/backups/eanhl/20260816T025127Z-migration-0056/rollback-0056.sql`

Owns its own `BEGIN` / `COMMIT`. It drops the three 0056 CHECK constraints, then the three family
columns (their comments drop with them), then clears the comment 0056 places on the legacy
`review_status` — which carried none before 0056, verified live at preparation time — returning that
column to its exact pre-migration state. Every statement is `IF EXISTS`, so a partial or repeated
rollback neither errors nor causes damage. It touches no stat value, no row, no primary key, no
unique constraint, no foreign key, no index, and not the Drizzle ledger.

⚠️ **The script carries a prominent boxed warning that rollback is lossless only in a closing
window.** Immediately after 0056 the family columns hold no information that `review_status` does
not already carry, so dropping them is exactly reversible. The moment any per-family status diverges
— an operator decision, `promoteOcrPeriodFamily`, the review cascade, or the rejection barrier
advancing or rejecting a single family independently — that column holds a review decision that
exists nowhere else and that `review_status` structurally cannot represent (one value, three
independently-captured families). Dropping the columns then destroys it irrecoverably. The script
requires this gate to be run read-only first and to return **0**:

```sql
SELECT count(*) AS divergent FROM match_period_summaries
 WHERE goals_review_status    IS DISTINCT FROM review_status
    OR shots_review_status    IS DISTINCT FROM review_status
    OR faceoffs_review_status IS DISTINCT FROM review_status;
```

A second caveat is recorded in the script: rollback must be paired with reverting any deployed code
that references the family columns, or the application returns to `42703` — and behind
`safe(…, [])` in `getMatchPeriodSummaries` that manifests as a **silent** total loss of period
summaries on the match page, with no error and no log entry.

---

## 4. The migration command

Applied **exactly** as authorized, with the file unchanged:

```bash
docker exec -i \
  -e PGOPTIONS="-c lock_timeout=5s -c statement_timeout=30s" \
  eanhl-team-website-db-1 \
  psql -U eanhl -d eanhl -v ON_ERROR_STOP=1 -f - \
  < packages/db/migrations/0056_period_family_review_status.sql
```

- **No `-1`, no `--single-transaction`.** The file supplies its own `BEGIN` (line 63) and `COMMIT`
  (line 144); those are its only transaction-control statements and they are the correct commit
  boundary. Adding `-1` on top nests badly and produces `there is already a transaction in progress`
  / `there is no transaction in progress` warnings without adding protection.
- **No `drizzle-kit generate`, no `drizzle-kit migrate`.** `generate` would diff the current schema
  against the stale `0045_snapshot.json` and emit a migration re-creating the already-applied
  0046–0055 objects; `migrate` would split the file at its `--> statement-breakpoint` markers and
  forfeit atomicity.
- `ON_ERROR_STOP=1` was required so that a failure before the file's `COMMIT` stops psql with the
  transaction uncommitted, leaving Postgres to roll it back.

> **Note on the `schema-change` skill.** `.claude/skills/schema-change/SKILL.md` §1 still prescribes
> `pnpm --filter db generate` then `pnpm --filter db migrate`. Following it literally for 0056 would
> have been actively harmful. The skill was **not** followed for the migration step; it remains
> stale and uncorrected, because editing it was outside this session's authorized scope.

### 4.1 Complete result

```
PSQL_EXIT_CODE=0

--- stdout ---
BEGIN
DO
DO
DO
DO
COMMENT
COMMENT
COMMENT
COMMENT
COMMIT

--- stderr ---
(empty, 0 bytes)
```

One `BEGIN`, four `DO` blocks (the combined three-column add/backfill block plus the three CHECK
guards), four `COMMENT`s, one `COMMIT`. **No warnings, no errors, no notices.** The transaction was
atomic: all eleven artifacts landed together.

---

## 5. Post-migration verification

All checks below ran in **fresh** read-only sessions, each re-proving
`default_transaction_read_only = on` and `transaction_read_only = on` before querying.

### 5.1 Schema — before and after

| aspect | before | after |
|---|---|---|
| column count | **14** | **17** |
| CHECK constraints | **0** | **3** |
| column comments | **1** (`bgm_attack_direction`) | **5** (the 4 from 0056 + `bgm_attack_direction`) |
| indexes | 3 | **3 — unchanged** |
| PK / unique / FKs | PK + `_uniq` + 2 FKs | **unchanged** |
| triggers / rules / dependent views | 0 / 0 / 0 | **0 / 0 / 0** |

Final column order:

```
id, match_id, period_number, period_label, goals_for, goals_against, shots_for, shots_against,
faceoffs_for, faceoffs_against, source, ocr_extraction_id, review_status, bgm_attack_direction,
goals_review_status, shots_review_status, faceoffs_review_status
```

### 5.2 The three new columns — text, NOT NULL, default `pending_review`

| # | column | type | nullable | default |
|--:|---|---|---|---|
| 15 | `goals_review_status` | text | **NO** | `'pending_review'::text` |
| 16 | `shots_review_status` | text | **NO** | `'pending_review'::text` |
| 17 | `faceoffs_review_status` | text | **NO** | `'pending_review'::text` |

### 5.3 CHECK constraints — all three, correct allowed values

| constraint | definition |
|---|---|
| `match_period_summaries_goals_review_status_chk` | `CHECK ((goals_review_status = ANY (ARRAY['pending_review'::text, 'reviewed'::text, 'rejected'::text])))` |
| `match_period_summaries_shots_review_status_chk` | `CHECK ((shots_review_status = ANY (ARRAY['pending_review'::text, 'reviewed'::text, 'rejected'::text])))` |
| `match_period_summaries_faceoffs_review_status_chk` | `CHECK ((faceoffs_review_status = ANY (ARRAY['pending_review'::text, 'reviewed'::text, 'rejected'::text])))` |

Postgres normalised the migration's `IN (…)` to the equivalent `= ANY (ARRAY[…])` form. All three
validated against all 259 rows without error.

### 5.4 Column comments — all four present

| column | length | opening text |
|---|--:|---|
| `goals_review_status` | 378 | `Review state of THIS ROW'S goals_for/goals_against only. Ocr…` |
| `shots_review_status` | 406 | `Review state of THIS ROW'S shots_for/shots_against only. Ocr…` |
| `faceoffs_review_status` | 421 | `Review state of THIS ROW'S faceoffs_for/faceoffs_against onl…` |
| `review_status` (rewritten) | 416 | `TRANSITIONAL legacy row-level review state. As of migration…` |

`bgm_attack_direction`'s pre-existing comment (86 chars) is untouched.

### 5.5 Row counts — unchanged

| metric | before | after |
|---|--:|--:|
| rows | 259 | **259** |
| distinct matches | 65 | **65** |

0056 creates and deletes nothing; both counts are exact.

### 5.6 Backfill fidelity — exact

```sql
SELECT count(*) FROM match_period_summaries
 WHERE goals_review_status    IS DISTINCT FROM review_status
    OR shots_review_status    IS DISTINCT FROM review_status
    OR faceoffs_review_status IS DISTINCT FROM review_status;
```

**Result: 0 mismatches.** Every one of the 259 rows satisfies
`goals_review_status = shots_review_status = faceoffs_review_status = review_status`.

### 5.7 Per-family distribution — identical across all three families

| family | `pending_review` | `reviewed` | `rejected` |
|---|--:|--:|--:|
| goals | **171** | **88** | **0** |
| shots | **171** | **88** | **0** |
| faceoffs | **171** | **88** | **0** |

Rows holding `'rejected'` in **any** family: **0**.

Legacy `review_status` is untouched and still reads `pending_review` 171 / `reviewed` 88, all
`source='ocr'`.

### 5.8 Visibility parity — no row changed visibility

| gating rule | rows exposed |
|---|--:|
| pre-migration whole-row (`source='ea' OR review_status='reviewed'`) | **88** |
| post-migration family (`source='ea' OR any family = 'reviewed'`) | **88** |

The migration is compatibility-preserving exactly as its header claims.

### 5.9 No collateral change

- **Indexes** — `match_period_summaries_pkey`, `match_period_summaries_match_idx`,
  `match_period_summaries_uniq (match_id, period_number, source)`: all three byte-identical in
  definition to the pre-migration capture.
- **PK / FKs** — `match_period_summaries_pkey`, `…_match_id_matches_id_fk → matches(id)`,
  `…_ocr_extraction_id_ocr_extractions_id_fk → ocr_extractions(id)`: unchanged.
- **Triggers 0 · rules 0 · dependent views 0** — nothing appeared.
- **Stat data byte-identical.** A post-migration CSV of the same 14 pre-existing fields, same
  ordering, `diff`s clean against the pre-migration snapshot and carries the **same** SHA-256
  `33f404bcb2f9bc0e9b3a6503f1e3bb9238f657366a1155f2f0f8e5ce20871d15`. No stat value, period label,
  source, extraction id, attack direction or legacy status changed on any row.

### 5.10 Drizzle ledger — unchanged, as instructed

| metric | before | after |
|---|---|---|
| rows | 47 | **47** |
| id range | 1 – 49 | **1 – 49** |
| `max(created_at)` | 1779683545919 | **1779683545919** |
| full-table fingerprint (md5 of `id:hash:created_at` ordered by id) | `120b92b249687e858a7d13cc1c166ed9` | **`120b92b249687e858a7d13cc1c166ed9`** |

`drizzle.__drizzle_migrations` was **not** written to. No ledger row was inserted for 0056; the
ledger-policy question remains open and undecided (see §7).

### 5.11 Hashes stable after the migration

`sha256sum -c SHA256SUMS.txt` → **all OK**: the dump, the pre-migration CSV, the rollback script,
and `packages/db/migrations/0056_period_family_review_status.sql`
(`c94a0498cbc307c183275bccdfc97c19efcd6aa2ae0bbd28b19c6cca1e54baa8`) are all unchanged. The
migration file was applied unmodified and remains unmodified.

### 5.12 Deliberately not run

- **`VACUUM ANALYZE`** — an additional database write, and unnecessary for accepting the migration.
  The table has still never been analyzed; that remains an open, low-priority item (§7).
- **No worker review, promotion, rescue, ingest, auto-drain, reconciliation, or OCR command.**
- **No application-level check** of the match detail page (requires the rebuild/redeploy that this
  session is not authorized to perform).

---

## 6. What did NOT change

- **No rebuild, no redeploy, no container restart or recreation.** `eanhl-team-website-web-1`
  (image `145c0bde76cd`, built 2026-08-02) and `eanhl-team-website-worker-1` (image `4b753d6cfdc2`,
  built 2026-06-01) are the same images, same container IDs, still running, untouched.
  `eanhl-team-website-db-1` was likewise not restarted or recreated. **Both deployed images still
  contain the pre-0056 whole-row `review_status` gating** — they predate the period-family commits
  (2026-08-07 → 2026-08-09) and in-container greps previously found zero references to the family
  columns.
- **No rescue, OCR, ingest, promotion, reprocessing, or allowlist work.**
- **No application source change**, no `packages/db` or `apps/worker` rebuild.
- **No commit, push, stash, reset, or working-tree cleanup.** HEAD is still `540777a`. All
  pre-existing dirty and untracked files were preserved untouched.
- **No other migration** was applied or considered.

**Repository files changed by this session:** exactly two —

1. `docs/operations/migration-0056-application-2026-08-15.md` (this file, new)
2. the current top entry of `HANDOFF.md`

The durable backup lives entirely outside the repository, at
`/home/michal/backups/eanhl/20260816T025127Z-migration-0056/`, and is not tracked by git.

---

## 7. Unresolved risks and open items

1. **The deployment is now the drift.** Before today the repository was ahead of the database;
   now the database is ahead of both deployed images. This is the *safe* direction — the migration
   is additive and visibility-neutral, and neither container references the family columns — but the
   web and worker images remain stale relative to `HEAD` and still apply whole-row gating. **Rebuild
   and redeploy, and the smoke testing that follows, are a separate session.**
2. **The host build footgun is now resolved in the safe direction.** `packages/db/dist` and
   `apps/worker/dist` were rebuilt 2026-08-09 *with* the family-column code and were failing with
   `42703` against the pre-0056 database. Those local CLIs should now run — but **this was not
   exercised**, because running `reconcile-periods` / `auto-drain` / `ingest-ocr-review` was outside
   this session's scope. Do not assume they work until verified.
3. **The rollback window is open but will close.** Rollback is currently lossless (0 divergent
   rows). It stops being lossless the moment per-family review begins. Anyone contemplating rollback
   must run the divergence gate in `rollback-0056.sql` first.
4. **Ledger policy remains undecided.** Only 0048 has a manual `drizzle.__drizzle_migrations` row;
   0046–0047 and 0049–0056 do not. This session deliberately left the ledger unchanged as
   instructed, which is consistent with the 0046–0047 / 0049–0055 majority but does not resolve the
   inconsistency. It should be decided deliberately, not by default.
5. **The `schema-change` skill is still stale and still dangerous.** §1 prescribes
   `pnpm --filter db generate` + `pnpm --filter db migrate`, both of which are hazards under the
   frozen-journal convention. Correcting it was outside this session's scope and it will mislead a
   future session until fixed.
6. **`match_period_summaries` has never been analyzed** (`last_analyze` NULL). 777 row updates on a
   32 kB heap left some dead-tuple bloat. Immaterial at this size; `VACUUM ANALYZE` was deliberately
   not run here because it is a write.
7. **The Drizzle full-column INSERT fragility is unaddressed.** The immediate breakage is gone, but
   the general pattern — schema drift silently breaking inserts that never name the drifted column —
   remains.
8. **The migration's compatibility guarantee is a property of the backfill, not an invariant.**
   Visibility parity holds today only because the backfill was verbatim. Once per-family review
   diverges, the family rule and the whole-row rule will legitimately disagree.

---

## 8. Rescue status — still BLOCKED

**Applying 0056 removes only ground (2) of the two-ground block. It does not authorize rescue
execution.**

- **Ground 1 — authorization — STANDS, entirely unaffected.**
  `docs/calibration/rescue-non-faceoff-resimulation-2026-08-15.md` returned **PARTIAL**
  (1 SAFE-TO-PROPOSE · 4 WITHHOLD-INVALID · 1 WITHHOLD-REDUNDANT · 2 NEEDS-REMEDIATION ·
  0 UNVERIFIED). **SAFE-TO-PROPOSE is a recommendation for management review, not execution
  authority.** **No allowlist exists and none was created.** This session did not alter that
  finding in any direction and had no authority to.
- **Ground 2 — technical incapacity — removed at the schema layer only.** The read boundary,
  per-family promotion path, rejection barrier, review cascade, and promoter INSERT no longer face a
  missing column *in the database*. But the **deployed containers still run the old code**, so
  nothing about the running system's behaviour changed today, and the repaired code paths have not
  been exercised against the migrated schema.
- The **8 faceoff-map windows** remain independently blocked on ROI/OCR remediation — unchanged and
  unrelated to any schema question.
- The single SAFE-TO-PROPOSE window (match **2676**, `post_game_box_score_goals`, segment **9003**,
  run **2131**) remains blocked: it is unauthorized, its payload is sampling-mode dependent, and the
  review machinery around it has not been redeployed.

**No rescue command, allowlist, promotion, or execution of any kind occurred in this session, and
none is authorized by it.**
