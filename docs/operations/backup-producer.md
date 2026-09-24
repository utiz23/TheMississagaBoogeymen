# Backup producer — snapshot and artifact foundation (Phase 1A)

**Status: implemented, verified in isolation, NOT ACTIVATED.** Nothing here is
scheduled, nothing is installed, no key exists, no real backup has been taken,
and no transport path is implemented. This document describes one component —
the thing that turns the live database into one encrypted artifact on local
disk — and states precisely what it does and does not establish.

Backing plan: `~/.claude/plans/model-opus-5-effort-modular-fountain.md`
(revision 2), Part 2.2 / 2.6 / 2.7 and Part 3. This session implemented the
first component of that plan's Phase 1 and nothing else.

---

## 1. What the component is

| File                                                          | Role                                                                                                                         |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `ops/backup/eanhl-backup.mjs`                                 | CLI entry point. Argument parsing, signal-safe teardown, exit status.                                                        |
| `ops/backup/lib/backup-config.mjs`                            | The configuration contract. No defaults; every rejection is fail-closed.                                                     |
| `ops/backup/lib/backup-producer.mjs`                          | All orchestration and every decision. Every boundary injected.                                                               |
| `ops/backup/lib/backup-boundaries.mjs`                        | The only place anything is spawned: `docker`, the encryption executable, `git`.                                              |
| `ops/backup/eanhl-backup-selfcheck.mjs`                       | Attestation-gated integration proof against a disposable database with synthetic data.                                       |
| `ops/backup/eanhl-backup.example.json`                        | Proposed production configuration. Not read by anything automatically.                                                       |
| `ops/backup/lib/backup-{config,producer,boundaries}.test.mjs` | 78 injected-fake tests: no Docker, PostgreSQL, `age`, key or network.                                                        |
| `ops/backup/lib/backup-lifecycle.test.mjs`                    | 31 REAL-child-process tests: spawns, pipes, signals, cancellation ordering, the ciphertext budget, and the CLI under SIGINT. |
| `ops/backup/lib/testdoubles/`                                 | The fake `docker` and fake encryption executables those tests put on PATH. Never used by a real backup.                      |

### Deviation from the plan's file list, and why

Plan Part 3 names `ops/backup/eanhl-backup.sh`. This is implemented as Node ESM
instead. Three reasons, all specific to this component:

1. The snapshot property requires holding one `psql` session open _while a
   separate process runs to completion_, then talking to that same session
   again. In shell that is a coprocess or a FIFO with hand-rolled framing; in
   Node it is a child process with an explicit sentinel protocol that a test
   can drive.
2. This repository's strongest verification convention is the injected-`deps`
   pattern in `apps/worker/scripts/lib/` — the reason the verification-database
   guard is testable without Docker at all. The same pattern applies here and
   is what makes the failure matrix in §5 checkable.
3. The manifest is JSON, and it must be built without ever letting a value that
   could be a secret into it.

The bash convention is preserved where it matters: units stay in-repo,
`--config` is always explicit, and `--dry-run` exists on the CLI.

---

## 2. The contract

One run produces exactly one **artifact triple** in the destination directory,
plus a `latest.json` pointer:

```
<prefix>-<snapshotTs>.dump.age            ciphertext
<prefix>-<snapshotTs>.dump.age.sha256     sidecar, "<sha256>  <filename>"
<prefix>-<snapshotTs>.manifest.json       plaintext metadata, no secret values
latest.json
```

`<snapshotTs>` is the UTC instant of `pg_export_snapshot()`, compacted to
`YYYYMMDDTHHMMSSZ`. It is the recovery point, and it is the artifact's identity.

### 2.1 The snapshot property — the only reason the manifest is worth anything

The worker writes every five minutes. Counting rows in a session other than the
dump's produces numbers that do not describe the dump. So:

1. One session opens `BEGIN ISOLATION LEVEL REPEATABLE READ` and calls
   `pg_export_snapshot()`, recording the snapshot id, the transaction's `now()`
   (fixed for the life of a REPEATABLE READ transaction), the backend pid, the
   server version and the cluster `system_identifier`.
2. `pg_dump --snapshot=<id>` runs on a **second** connection and reads exactly
   that snapshot. Ingestion is never paused.
3. The producer re-probes the first session: same backend pid **and** identical
   `now()` ⇒ same backend, same transaction, therefore the same snapshot.
4. Only then are the critical-table counts, extension set and migration
   high-water mark read — inside that same transaction — and the transaction
   committed.

**A run that cannot complete every step fails.** There is no
`counts_snapshot: false` degradation path and no advisory-counts artifact: a
published artifact carries counts provably taken from the dump's own snapshot,
or it does not exist. The manifest still writes `counts_snapshot: true`
explicitly, so a consumer asserts on it rather than inferring it. _(This is a
deliberate correction to plan §2.6, which allowed a downgraded manifest.)_

A missing critical table, or a count that does not come back, is also a
failure — `required_relation_missing` / `required_count_missing`.

### 2.2 Tool versions

`pg_dump` and `pg_restore` are **always** the ones inside the database
container, reached by `docker exec`. There is no code path to a host client. A
host `pg_dump` 18.x dumps a 16.x server successfully and produces an archive
`postgres:16-alpine`'s `pg_restore` cannot read — a failure that would surface
only during a recovery.

Archive validation feeds the staged file to the container's `pg_restore` over
**stdin**, so nothing is ever copied into the database container.

### 2.3 Validation before encryption (no key involved)

- Every run: `pg_restore --list` on the plaintext. Note its limit — it reads the
  header and table of contents and stops, so it **cannot** detect a truncated
  archive whose TOC survived.
- `--full-archive-read` (or `run.fullArchiveReadDefault`): `pg_restore -f
/dev/null`, which reads and decodes every block. This is the check that
  detects truncation. The plan schedules it for the weekly `00:00Z` artifact;
  the producer exposes it per run and does not schedule anything.

### 2.4 The encryption boundary

The producer never holds a private identity and never decrypts. It invokes an
external executable with exactly:

```
<executable> --encrypt --recipients-file <recipientFile> <inPath>
```

**There is no `--output`.** The ciphertext comes back on **stdout** and the
producer owns the file descriptor it lands in. That is not a style choice:

- it makes the byte ceiling a **bound** rather than a measurement (§2.7);
- the tool never touches the staging directory, so a child that outlives a
  forced teardown cannot write into a directory being deleted.

`age` supports this natively — with no `-o`/`--output` it writes encrypted
output to standard output, refusing only when stdout is a terminal, and it is a
pipe here. **UNVERIFIED against the real binary**; `age` is not installed (§6.1).

Preflight refuses the run before any dump if the executable does not resolve,
the recipients file is unreadable or empty, or any non-comment line is not an
`age1…` or SSH public key (a private key pasted where a recipient belongs is
refused). After the run it refuses to publish if the tool exited non-zero, wrote
no output, wrote an empty file, produced bytes identical to the plaintext, or
produced output that does not begin with the configured
`encryption.expectedHeader`.

**None of this is cryptographic verification.** See §6.1.

### 2.5 Artifact completion — the definition

`verifyArtifactCompletion()` decides it, and the producer runs it against the
destination after publishing. An artifact is complete **iff**:

1. all three files exist;
2. the manifest parses and its `schema_version` is recognised;
3. `manifest.artifact` names the ciphertext file;
4. the sidecar names the ciphertext file;
5. `sha256(ciphertext)` equals the sidecar hash;
6. `sha256(ciphertext)` equals `manifest.ciphertext.sha256`;
7. the ciphertext's byte length equals `manifest.ciphertext.bytes`.

Presence of three files is **not** completion. The destination may be a drvfs
mount where rename atomicity is not assertable, so a partially-copied file can
appear under its final name; the hash equality, not the rename, is what makes
that harmless. If the published artifact does not verify, the producer withdraws
every file it published and fails with `artifact_incomplete`.

Publication order is ciphertext → sidecar → manifest last. That only shortens
the window for a naive consumer; it is not the safety property.

### 2.6 Artifact identity, concurrent runs, and the run lock

- Every run has a unique `run_id` (`<UTC compact>-<8 hex>`), which also names
  its staging directory, and is recorded in the manifest.
- Artifact names use second granularity. **Any collision at the destination is a
  hard refusal** (`artifact_identity_collision`) — a retained artifact is never
  overwritten, even by a retry within the same second.
- Exclusion is a lock file created with `O_CREAT|O_EXCL`. That atomic create is
  the entire mechanism, and it is the only mutation the acquire path ever
  performs on an existing lock: **nothing unlinks a lock it did not create.**

**Stale locks are never reclaimed automatically.** An earlier version broke a
lock whose recorded holder was provably gone — read the holder, `kill(pid,0)`
fails, unlink, re-create. That is a check-then-unlink race with a concrete
two-winner interleaving:

```
A reads the dead holder H
B reads the dead holder H
A unlinks H and creates A's lock      → A holds the lock
B unlinks A's LIVE lock, creates B's  → B also holds the lock
```

Both producers then dump, stage and publish concurrently. No variant of "check,
then unlink" repairs this — by the time the unlink runs it is unconditional —
and re-checking afterwards only narrows the window. So the reclamation is gone.

Outcomes when a lock file already exists:

| Situation                                               | Code                  | What happens                                                         |
| ------------------------------------------------------- | --------------------- | -------------------------------------------------------------------- |
| Holder is running                                       | `concurrent_run`      | Refuse. The lock is untouched.                                       |
| Holder is running and older than `run.lockStaleAfterMs` | `concurrent_run_hung` | Refuse, and say it is probably hung.                                 |
| Holder is gone                                          | `lock_stale`          | Refuse, print the exact `rm` command, leave the file byte-identical. |
| Lock names another host                                 | `lock_foreign_host`   | Refuse.                                                              |
| Lock is not readable JSON                               | `lock_unreadable`     | Refuse; the file is left exactly as found.                           |

The cost is deliberate: a run that dies without unwinding — SIGKILL, power cut,
OOM kill — blocks later runs until a human confirms nothing is running and
removes the file. Two producers publishing into the same destination is the
worse failure. The compensating control is `run.operationTimeoutMs` (§2.7a): no
single boundary operation may run long enough to hold the lock indefinitely, so
the operator-recovery case is limited to processes that died outright.

### 2.7 Bounded staging, on both filesystem layers

`df` inside WSL is not the truth for anything on the ext4 root: it reports the
sparse VHDX's logical size. Measured on this host, 2026-09-05:

| Path     | `df` reports available | What it actually is                                 |
| -------- | ---------------------- | --------------------------------------------------- |
| `/`      | **945 GB**             | ext4 inside `ext4.vhdx` on `C:`                     |
| `/mnt/c` | **21.08 GB**           | the NTFS volume that backs it — the real headroom   |
| `/mnt/k` | 1512 GB                | drvfs over NTFS; `df` here _is_ the real free space |

So `staging.backingVolume` and `destination.backingVolume` are **required keys**
that must be either an explicit `{mountPoint, minFreeBytes}` or an explicit
`null`. Omitting one is a configuration error, because "I did not think about
whether `df` lies here" and "`df` tells the truth here" must not look the same.

Bounds, all configured and all enforced:

- `staging.minFreeBytes` and `staging.backingVolume.minFreeBytes` — preflight
  floors, checked before anything is created.
- `staging.maxPlaintextBytes` — enforced **on the dump stream**, which is cut
  and the run failed if it is crossed. Not measured after the fact.
- Re-check before encrypting, this time with the real artifact size added, on
  both layers — encryption roughly doubles peak usage.
- `staging.maxStagingBytes` — the plaintext + ciphertext ceiling.
- `staging.maxCiphertextBytes` — an explicit, independently configured ceiling
  on the ciphertext **alone**, regardless of how much of `maxStagingBytes` the
  plaintext left behind. **Required, with no default and no derivation from
  `maxStagingBytes`** — an operator who has not thought about the destination
  acceptor's own ceiling must not be able to publish a ciphertext the acceptor
  is configured to refuse (`docs/operations/backup-acceptance.md`
  §2.8, `acceptance.maxCiphertextBytes`). The validator requires
  `staging.maxCiphertextBytes <= staging.maxStagingBytes`; equality is valid
  and is the shipped example's shape (§8).

  The effective ciphertext budget for one run is:

  ```
  stagingRemainder = staging.maxStagingBytes - plaintextBytes
  ciphertextBudget = Math.min(stagingRemainder, staging.maxCiphertextBytes)
  ```

  That budget is enforced **on the stream**, by the same producer-owned
  bounded writer the dump uses: the crossing chunk is dropped, never written,
  so the staged ciphertext cannot exceed the permitted count at any instant
  (§2.4, §6.6). Two post-write checks remain as defence in depth, not the
  bound: ciphertext bytes over `maxCiphertextBytes` alone, and
  plaintext + ciphertext bytes over `maxStagingBytes` in aggregate — the first
  can fire when the second would not, because the explicit cap can be the
  tighter of the two. Every refusal and log line along this path names which
  ceiling — the explicit cap or the remaining staging budget — was actually
  binding, because raising the wrong one changes nothing.

**The ~27 MB observed dump (from a 466 MB database) and the ~60 MB peak in the
plan are observations from 2026-09, not size guarantees.** They are not
hardcoded anywhere. Raise the ceilings deliberately, together with the free-space
floors, when the database grows.

Staging lives at `<staging.root>/<runId>` (mode 0700) and is removed on **every**
exit path, success or failure, including a `SIGINT`/`SIGTERM` (the CLI is handed
a synchronous emergency teardown, because the async `finally` does not run when
the process is killed). With `staging.shredPlaintext: true` the plaintext dump
is overwritten with zeros before unlinking — see §6.3 for why that is a
reduction in exposure and not erasure.

### 2.7a Cancellation, deadlines, and exclusion

Every spawned child — `pg_dump`, both `pg_restore` modes, the encryption tool
and the snapshot `psql` session — registers a cancellation handle with the run
for as long as it is alive, carrying an **identity token** taken from its own
command line (`--snapshot=<id>` for the dump, `eanhl_run=<runId>` for the
session, the literal `pg_restore` for validation).

**Bounded deadlines.** Each boundary operation runs under
`run.operationTimeoutMs`. On expiry its children are cancelled and the run fails
with `operation_timeout`. This is not a performance knob: because a stale lock
is never reclaimed (§2.6), a wedged `docker exec` or a hung encryptor would
otherwise hold the lock — and block every future backup — until someone noticed.

**Bounded cancellation.** Cancelling a child sends SIGTERM, escalates to SIGKILL
at the halfway point of `run.cancelGraceMs`, and reports `timeout` rather than
waiting forever. A handle is dropped from the registry **only** when its child is
known to have closed; a timed-out or errored handle is kept, both because it is
still an exclusion signal and because a leaked piped-stdio child keeps two
Socket handles and a ChildProcess handle referenced, which is enough to stop the
owning process from ever exiting.

**Abandonment is not stopping.** A boundary that gives up on a wedged output
rejects promptly but does **not** claim the child or the file closed, and it
keeps its handle registered. Handles are released only when something was
actually observed to stop: an ordinary completion, or a local child seen to
close. That distinction is load-bearing — an earlier version set the
child-closed and stream-closed flags itself so the promise could settle, and
then released the handle because the child was `local` rather than
`docker-exec`, discarding the only signal that unconfirmed work was still
running. Exclusion is now retained after a stall unless a later cancellation
confirms the process stopped.

**Internally initiated terminations count too.** The boundaries kill their own
children in three situations that have nothing to do with cancellation: a byte
ceiling breach, an output-stream failure, and an input failure during archive
validation. Each of those leaves a dead `docker exec` client and an unknown
container-side command, so the operation is **kept registered** with a
`locallyTerminated` marker and goes through exactly the same probe-or-retain
path as a cancelled one. A child that ended _on its own_ — whatever its exit
code — is an ordinary completion and releases its handle, so a clean run never
leaks one and is never probed. An earlier version untracked unconditionally on
settle, so an internally killed dump disappeared from the registry before
teardown could account for it, and exclusion was released on no evidence.

#### Confirmed stop versus retained exclusion

Stopping a `docker exec` client is **not** evidence that the command inside the
container ended. Without a TTY there is no signal forwarding. The producer
therefore never treats a dead client as a stopped command; instead:

| Operation                                                         | How termination is established                                                                                                                                                                                                                         |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Encryption (`kind: local`)                                        | The process closed after SIGTERM/SIGKILL. That **is** proof.                                                                                                                                                                                           |
| `pg_dump`, `pg_restore`, the `psql` session (`kind: docker-exec`) | The producer runs one **read-only** `docker exec <container> ps -A -o args=` and looks for that operation's own identity token. Absent ⇒ confirmed gone. Present, or the probe cannot answer within `run.containerProbeTimeoutMs` ⇒ **not confirmed**. |
| The `psql` session closed in the orderly way                      | `stdin` is ended, psql sees EOF and exits, and the client reports its status. That **is** proof; only a SIGKILL after a close timeout is not.                                                                                                          |

The probe **never signals anything**. It reads `ps` and nothing else, and it
matches only a token from the producer's own argv, so it cannot act on — or even
form an opinion about — a process this run did not start. `pg_restore` takes no
inert argv slot for a unique token, so its token is the literal `pg_restore`:
deliberately broad, meaning an unrelated `pg_restore` in the database container
makes the probe inconclusive, which retains the lock. Over-retention is the safe
direction; it never kills anything.

**If termination is not confirmed, the run lock is RETAINED, not released.** The
lock file is rewritten in place with `retained: true`, the reason, the list of
unconfirmed operations, and explicit recovery steps. The next producer refuses
with `lock_retained_uncertain` and prints all of it. Availability does not
silently override mutual exclusion.

**Teardown order is load-bearing**, on every exit path including a signal:

1. wait for any abort already in flight (cancelling a child makes its operation
   reject immediately, so the main promise reaches teardown while the probe is
   still running — deciding release-vs-retain on a half-finished probe is
   exactly the trade this is meant to prevent)
2. cancel every still-running child, bounded by `run.cancelGraceMs`
3. establish container-side termination, bounded by `run.containerProbeTimeoutMs`
4. roll back and close the snapshot session, bounded
5. overwrite and delete the staging directory
6. **release the run lock — only if everything above is confirmed stopped**

**Signals.** The CLI runs three layers. The first SIGINT/SIGTERM triggers the
asynchronous bounded abort and does _not_ exit, so the ordering holds; a second
signal, or an escape timer of `cancelGraceMs × 2 + 5s`, forces a synchronous
SIGKILL-everything-tracked teardown and exits 130; a `process.on('exit')`
handler is the last resort. The synchronous layers cannot await anything and
cannot run the probe, so they **always retain the lock** when any operation was
in flight — including a purely local one. Issuing SIGKILL is not confirmation of
termination: nothing awaits the `close`. A local child poses no data risk (it
writes to a pipe this process owns, never into staging), but "poses no risk" and
"is confirmed stopped" are different claims and only the second justifies giving
up the lock. Bounded exit and retained exclusion are compatible: the CLI still
stops promptly, it just does not trade exclusion for promptness.

**Exit status.** `0` success, `130` when the operator signalled or the run
reports `run_aborted`, `1` for any other refusal or failure.

### 2.8 Manifest contents

No secret values. Recorded: `schema_version`, `artifact`, `run_id`,
`snapshot_ts`, `produced_at`; source host / container / database /
`system_identifier` / `server_version` / git commit / image digests; plaintext
and ciphertext sha256 and byte lengths; the encryption executable path,
recipients-file path, recipients-file **sha256 fingerprint** and recipient
count; validation outcomes; `counts_snapshot: true`; the critical-table counts;
the migration high-water mark; the extension set; and a `warnings` array.

Provenance that cannot be read (git commit, image digests) is recorded as
`null` **and** as an explicit warning — never silently omitted.

### 2.9 Refusal codes

Every refusal carries a machine-readable `code`, printed as
`FAILED [<code>] <message>` and returned as exit status 1 (130 for
`run_aborted`).

| Area                | Codes                                                                                                                                                                                                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Configuration       | `config_unreadable`, `config_unparseable`, `config_field_type`, `config_field_missing`, `config_field_invalid`, `config_field_not_absolute`                                                                                                                   |
| Run exclusion       | `concurrent_run`, `concurrent_run_hung`, `lock_stale`, `lock_retained_uncertain`, `lock_unreadable`, `lock_foreign_host`, `lock_unwritable`                                                                                                                   |
| Lifecycle           | `operation_timeout`, `run_aborted`                                                                                                                                                                                                                            |
| Capacity            | `insufficient_capacity`, `staging_budget_exceeded`                                                                                                                                                                                                            |
| Encryption boundary | `encryption_executable_missing`, `recipient_file_unreadable`, `recipient_file_empty`, `recipient_file_malformed`, `encryption_failed`, `encryption_produced_no_output`, `encryption_no_budget`, `ciphertext_header_unexpected`, `ciphertext_equals_plaintext` |
| Snapshot            | `snapshot_export_failed`, `snapshot_session_failed`, `snapshot_transaction_lost`, `snapshot_timestamp_malformed`, `required_relation_missing`, `required_count_missing`                                                                                       |
| Dump / archive      | `dump_failed`, `archive_validation_failed` — a wedged output surfaces through these as `output_stalled`, naming the blocked side                                                                                                                              |
| Artifact            | `artifact_identity_collision`, `artifact_incomplete`, `checksum_sidecar_malformed`                                                                                                                                                                            |

## 3. Running it

```bash
# Unit and boundary suites — no Docker, no PostgreSQL, no key, no network.
# Runs each file separately under a per-file deadline, with captured logs; a
# stall names the file, the running test and the surviving children.
pnpm test:backup-producer
node ops/backup/run-suite.mjs --file-timeout-ms 30000 --keep-logs   # tighter, logs kept
node ops/backup/run-suite.mjs --list-runs     # other invocations' roots, and whether they are live
node ops/backup/run-suite.mjs --reap-stale    # delete only roots whose owner is gone; kills nothing

# Integration proof against the disposable VERIFICATION cluster, synthetic data
# only. Requires the verification env file; NEVER the application `.env`.
set -a && . ~/.config/eanhl/verify.env && set +a
node ops/backup/eanhl-backup-selfcheck.mjs

# The producer itself. --config is mandatory and has no default.
node ops/backup/eanhl-backup.mjs --config ~/.config/eanhl/backup.json --dry-run
```

`--dry-run` validates the config, proves the encryption boundary, checks
capacity on both layers, takes the run lock, opens the snapshot transaction,
reads the critical counts, commits, and reports the paths it _would_ write. It
does not dump, encrypt, or create the destination. It does open a brief
read-only REPEATABLE READ transaction against the configured database.

`--keep-staging` leaves an **unencrypted full copy of the database** on disk.
Debugging only.

Exit status: `0` success, `130` when the operator signalled (or the run reports
`run_aborted`), `1` for any other refusal or failure. A first `SIGINT`/`SIGTERM`
cancels the running children and lets the teardown finish in order; a second one
forces an immediate synchronous teardown (§2.7a).

Recovering from a `lock_stale` or `lock_retained_uncertain` refusal is a
deliberate operator action. The lock file says which it is and, when retained,
carries the reason and the unconfirmed operations:

```bash
cat /var/tmp/eanhl-backup/producer.lock            # who held it, why, what was unconfirmed
pgrep -af eanhl-backup                             # nothing running on this host?
docker exec eanhl-team-website-db-1 ps -A -o args= # nothing left inside the container?
rm /var/tmp/eanhl-backup/producer.lock             # only then
```

Do not kill container-side processes you have not positively identified as that
run's — the producer deliberately never does.

---

## 4. Validation evidence (2026-09-05)

Two kinds of evidence appear below, and the difference matters:

- **Injected-fake tests** replace the process boundaries with in-memory doubles.
  They prove what the orchestrator _decides_ — which refusal code, what lands in
  the manifest, whether the lock is released or retained.
- **Real-child-process tests** spawn actual processes through the actual
  boundaries, with only the executables faked (`ops/backup/lib/testdoubles/`).
  They prove what happens to real pipes, real signals and real files. Every
  defect corrected so far lived in that layer.

Database-backed checks ran against the disposable verification cluster
`eanhl-verify-test-db-test-1` (Compose project `eanhl-verify-test`, label
`eanhl.nonproduction=true`, `system_identifier 7681538289363537954`), through
`attestNonProductionTarget()`. **Neither production database was contacted.**
The shared `eanhl_test` seed was neither read nor written; each run created and
dropped its own `eanhl_scratch_bkp*` databases.

### 4.1 Focused suite — 109/109 pass (producer files only)

`pnpm test:backup-producer` runs `ops/backup/run-suite.mjs`, which executes each
file as its own `node --test` process, sequentially, under a per-file deadline,
capturing logs.

**Correction.** An earlier revision of this document reported this suite as
`105/105` with a split of 15 / 51 / 9 / 30. That total was wrong. The producer
files are **109**: 15 configuration, 54 producer, 9 boundary, 31 lifecycle —
counted from the runner's own summary and confirmed independently outside this
environment. Nothing about the suite changed to make the number move; the
earlier figure was simply a miscount, and the `105/105` in §4.6a is the same
miscount preserved in a quoted historical result.

Per-file wall clock, three consecutive runs on 2026-09-05: 0.13–0.15 s /
1.05–1.20 s / 0.19–0.23 s / 9.4–9.8 s; producer files ≈ 11 s.

The runner now also executes `backup-acceptance.test.mjs` (56 tests), so the
whole suite is **165/165**. Those 56 belong to the destination acceptance
component, which is Phase 1B and is documented separately in
`docs/operations/backup-acceptance.md`. The producer's own regression total is
the 109 above and is unchanged by that work.

### 4.2 Integration self-check — 18/18 pass

`node ops/backup/eanhl-backup-selfcheck.mjs`, against a fresh
`eanhl_scratch_bkp_<pid>_<stamp>` seeded with 200,000 synthetic match rows, 100
synthetic player rows and a synthetic 49-row `drizzle.__drizzle_migrations`.

| Proof                                                                                                  | Result                                                            |
| ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| Attestation resolves before any mutation                                                               | PASS                                                              |
| A concurrent writer committed during the run (else the next check is vacuous)                          | PASS — snapshot count 200,000, live count after the run 211,500   |
| `counts_snapshot` asserted `true`; the artifact verifies complete                                      | PASS                                                              |
| **Restored database matches the manifest count exactly, and differs from the live count**              | PASS — restored 200,000 = manifest ≠ live 211,500                 |
| Every other critical count, migration high-water mark, extension set                                   | PASS                                                              |
| A snapshot is usable while its transaction is open                                                     | PASS                                                              |
| **The same snapshot is rejected once its transaction has ended**                                       | PASS — `ERROR: invalid snapshot identifier`                       |
| Killing the snapshot session makes `pg_dump` fail rather than dumping a fresh snapshot                 | PASS — `dump_failed`                                              |
| The failed run left no staging directory, no lock, and published nothing                               | PASS                                                              |
| **The read-only container probe answers against a real `postgres:16-alpine`**                          | PASS — busybox `ps -A -o args=` listed the postgres command lines |
| **A token from a finished operation reads as gone**                                                    | PASS — no `--snapshot=` line remains                              |
| **A probe against a missing container returns `null`** (which the producer treats as "cannot confirm") | PASS                                                              |
| CLI dry run reads live counts and writes nothing                                                       | PASS                                                              |

### 4.2a Enforced byte-limit and lifecycle-accounting evidence

The byte-ceiling defect, reproduced before the fix:

```
limitBytes: 262144   actualBytes: 8388608   code: 0   exceeded: false   bytes: 0
```

After replacing sampling with a producer-owned bounded output stream, the same
burst gives `maxObservedBytes: 233472`, `exceeded: true`, partial output removed
— with a concurrent `setImmediate` sampler asserting the staged file never
exceeded the ceiling at any instant.

The lifecycle-accounting defect, reproduced with a fake `docker` that runs
`head -c 8388608 /dev/zero` and `runDump({ maxBytes: 262144 })`:

```
before:  truncated: true  bytes: 241664  handlesRemaining: 0
after:   truncated: true  bytes: 262144  handlesRemaining: 1
         kept: pg_dump [docker-exec] --snapshot=SNAP-1 locallyTerminated=true
```

Zero remaining handles meant the operation had vanished before teardown, so no
container probe ran and exclusion was released on no evidence at all.

### 4.2b Regression probes — each correction was proven load-bearing

Every correction was temporarily reverted in place and the relevant tests
re-run. The repository was restored and re-diffed clean after each probe.

| Correction reverted                                                                        | Tests that then failed                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Stale-lock reclamation reinstated                                                          | 3 lock tests (both producers acquired)                                                                                                                                                                                                     |
| `runDump`'s output-stream `error` listener removed                                         | all 3 output-error tests, including the subprocess regression                                                                                                                                                                              |
| The dump child left untracked                                                              | abort-ordering and hung-dump timeout                                                                                                                                                                                                       |
| **The bounded writer writes the crossing chunk anyway**                                    | `a synchronous 8 MiB burst never puts more than the permitted bytes on disk`. The slower `runaway encryptor` test still passed — which is exactly why the burst test exists: a post-hoc check catches a slow writer and misses a fast one. |
| **Teardown always releases the lock**                                                      | all 4 retained-exclusion tests, including the CLI one                                                                                                                                                                                      |
| **`settle()` untracks unconditionally** (the internally-killed-operation defect)           | 4 tests: both output-error handle-accounting tests, `an oversized dump whose container command is still listed retains the lock`, and `an output-write failure with an unavailable container probe retains the lock`                       |
| **The `pg_dump` double publishes `.started` before `.cmdline`** (window widened to 250 ms) | `a container-side command that OUTLIVES the docker client retains the lock` — see §4.5                                                                                                                                                     |
| **`withDeadline` lets the child's rejection win the race**                                 | `a hung pg_dump hits run.operationTimeoutMs…` reported `dump_failed` instead of `operation_timeout` — see §4.5                                                                                                                             |

### 4.3 Real filesystem capacity refusal

With `staging.minFreeBytes` trivially satisfied by `/` (945 GB free) and
`staging.backingVolume` naming `/mnt/c` with a 100 GB floor:

```
FAILED [insufficient_capacity] capacity preflight failed:
  staging backing volume: /mnt/c has 21076873216 bytes free, needs at least 107374182400
```

A Linux-filesystem-only preflight would have started the dump.

### 4.4 What the tests establish, and what they do not

They establish behaviour observable by an operator: which files exist
afterwards, what the manifest says, which refusal code came back, whether a
child process is still running, whether the lock was released or retained, and
in what order the lock went relative to the children stopping (compared using
timestamps the doubles write from their own signal handlers).

They do **not** establish that `age` works, that any artifact is decryptable,
that any real backup has ever been taken, or that a real container-side
`pg_dump` behaves the way the double does when its client is killed (§6.7).

### 4.5 The intermittent lifecycle failure — found, diagnosed, fixed

A lifecycle test failed once in an early per-file loop and then not again in 30+
attempts, so it was previously reported as unexplained. The new runner caught it
on the third of four consecutive runs and preserved the log, which named it:

```
not ok 16 - a container-side command that OUTLIVES the docker client retains the lock
  pg_dump: container-side command confirmed gone (no "--snapshot=…" in ps)
```

**Cause: a race in the test double, not in the producer.** The `pg_dump` double
wrote its `<label>.started` marker _before_ publishing its container-visible
`<label>.cmdline`. The test synchronises on `.started`, so the abort — and the
probe with it — could run in the window before the command line existed, and the
probe then correctly reported the command gone. Fixed by publishing `.cmdline`
first, which makes `.started` a proper happens-after barrier. Confirmed by
widening the window to 250 ms under the old ordering (fails deterministically),
restoring (passes), then 25 consecutive runs of that test and 6 consecutive
full-suite runs, all clean.

Nothing about the producer changed as a result: the assertion was right and the
fixture was wrong.

**A second, separate race — this one in the producer — surfaced the same way.**
`a hung pg_dump hits run.operationTimeoutMs` intermittently reported
`dump_failed` rather than `operation_timeout`: cancelling the child at the
deadline makes its operation reject too, and `Promise.race` settled with
whichever rejection arrived first. Which one won was a scheduling detail, so the
same hung dump reported two different codes on different runs. `withDeadline`
now records that the deadline fired and reports the timeout regardless — the
same rule that already applied to `run_aborted`. Confirmed by 30 consecutive
runs of both deadline tests.

### 4.6 A stall mechanism — reproduced, bounded, and not the same as a proven root cause

Two review runs, three days of evidence, and the mechanism is now reproduced.

**Run 1** (10 s per-file deadline, private `TMPDIR`) timed out in the lifecycle
file. Reconstructed from the preserved `startedAt` values, the ENOSPC test had
been the active test for ~8.8–10 s; locally it completes in 45–49 ms. Two
candidate mechanisms fit, and both were bounded rather than guessed between: an
explicit `/dev/full` precondition, an 8 MiB backstop in place of 64 MiB, and an
identity-checked, 3 s-bounded child assertion.

**Run 2 used those fixes** — file mtimes precede the run and the copied doubles
are byte-identical — and **still stalled on the same test**. That rules out both
earlier candidates and, because the lifecycle watchdog now warns after 4 s, it
captured the blocked operation:

```
[lifecycle] a test has been running for 5s … 8s … 11s
[lifecycle] active test: a mid-stream write error (ENOSPC) rejects and stops the dump child
[lifecycle] active handles: Socket×2 ChildProcess×1
[lifecycle] child processes:
  pid 130: node …/bin/docker exec c pg_dump … --snapshot=s
[lifecycle] suite state:
  tracked handles: 1
```

with `pg_dump.started` at 12:46:35.560 and `pg_dump.stopped` only at 12:47:04.893
— the child lived **29 seconds** and was ended by the runner's teardown, not by
the producer.

**What that state means, by elimination.** The 8 MiB ceiling never fired, so
fewer than 8 MiB were counted. The stream never errored, so `fail()` never ran
and the child was never killed. Two sockets plus one ChildProcess and nothing
else: the output file held no handle at all. The only state consistent with all
of it is that `out.write()` returned `false` on the first chunk, the child's
stdout was paused, and **the write neither completed nor failed** — so no
`drain`, no `error`, `streamDone` never set, and `settle()` never reachable.

**A mechanism reproduced locally** — with a FIFO whose reader never reads, which
blocks the writer in the kernel the way an output whose write never returns
would. This demonstrates that the signature _can_ be produced by a write that
neither completes nor fails, and that the code then hangs. It does **not**
establish that this is what happened in the review container: that environment
was never reproduced, and no evidence from it identifies the write's fate:

```
+   225ms reader pid … — fifo has a reader that never reads
+  8238ms *** runDump NEVER SETTLED ***
+  8238ms active handles: ChildProcess Socket Socket ChildProcess
+  8238ms tracked handles: 1
+  8238ms dump child pid … state S (alive)
```

Same signature, including `tracked handles: 1` and the live, paused child — a
_consistent_ mechanism, not a proven one.

**A candidate environment difference, not a confirmed one.** The earlier
precondition probed `fs.writeSync`; the test exercises `fs.createWriteStream`,
which writes through the libuv threadpool. Those are different code paths, and a
divergence between them would explain the observation: the synchronous 4 KiB
write returned ENOSPC (the probe passed and the test proceeded) while the
streamed write did not complete. That is inference from the captured state, not
measurement of that container — it is not reproducible here, where `/dev/full`
returns ENOSPC on both paths.

**Two fixes, so neither path can hang again:**

| Fix                                                         | Effect                                                                                                                                                                                                                                                                               |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The precondition now probes the **stream**, not `writeSync` | An environment whose `/dev/full` does not report ENOSPC on a streamed write fails in milliseconds with _"does not report ENOSPC on a STREAMED write (got: …)"_. Verified to report `ENOSPC` for `/dev/full` and `accepted the write` for `/dev/null`, a plain file and a FIFO.       |
| `spawnCapturingToFile` gained a **stall bound**             | If nothing progresses — no byte accepted, no stream event, no child exit — for `stallTimeoutMs`, the operation fails with `output_stalled` naming the blocked side instead of pending forever. It marks the operation **abandoned**; it does not claim the child or the file closed. |

The stall bound turns the reproduction into:

```
+  3218ms REJECTED output_stalled pg_dump made no progress for 2964ms:
        65543 byte(s) written to …/wedged.fifo, child still running,
        output stream neither drained nor errored.
```

65543 bytes is the 7-byte header plus one 64 KiB chunk — the paused-after-first-chunk
state, confirmed rather than inferred. The ENOSPC path is unchanged at 45–51 ms.

The producer passes `stallTimeoutMs` at 80 % of `run.operationTimeoutMs`, so a
wedged output is reported as the specific thing it is and the boundary's promise
actually settles instead of dangling past the run. This also closes a real
product gap: the boundary previously relied entirely on its caller for liveness.

Verified afterwards under the reported invocation shape (private `TMPDIR`,
`--file-timeout-ms 10000`): 2 of 2 clean, lifecycle 6.37–6.48 s. Four default
runs: clean, lifecycle 6.59–6.69 s.

### 4.6a Runner cleanup is now ownership-scoped

The previous runner swept `/tmp` at startup by filename prefix and SIGKILLed
every process whose command line mentioned one. That is unsound: it cannot tell
a dead run's debris from a **live concurrent invocation's working set**.

Each invocation now owns one tree — `<tmpdir>/eanhl-backup-suite-<id>/` with
`owner`, `logs/`, `state/` and `sandboxes/` — and points the child processes'
`TMPDIR` at `sandboxes/`, so every sandbox the test files create is inside it by
construction. The runner never scans `/proc`, never matches prefixes, and
signals only its own descendants, each re-identified by command line
immediately before being signalled so a recycled pid cannot be hit. Other runs
are reported, never touched: `--list-runs` shows them with owner liveness,
`--reap-stale` deletes only roots whose owner pid is gone and signals nothing.

Per-file results now resolve on the child's `exit` rather than its `close`, with
a 2 s pipe grace, so a grandchild holding an inherited pipe open cannot stall
teardown. Logs are written with `writeSync`, because the earlier investigation's
evidence directory contained four **zero-byte** logs — a buffered stream loses
everything when an outer `timeout` kills the runner.

Demonstrated:

| Check                                                                             | Result                                                                                                                                                                         |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Invocation X stalling with a 25 s deadline while invocation Y runs the full suite | Y: all files pass, exit 0, 9.85 s (reported at the time as "105/105"; the real total was 109 — see §4.1). Y logged _"1 other suite run directory present … None was touched."_ |
| X's run root, its stalling grandchild and its runner, after Y finished            | all three untouched                                                                                                                                                            |
| X reaching its own deadline                                                       | named its own 2 descendants, stopped them, preserved logs and stall log; grandchild gone afterwards                                                                            |
| A bystander process whose command line contains `<tmpdir>/eanhl-lifecycle-…`      | **survived**. A replay of the removed matcher confirms it _"WOULD HAVE SIGKILLed 1 process"_ — that one                                                                        |
| A test file killed while a grandchild holds its stdio open                        | bounded: deadline + teardown, no wait on `close`                                                                                                                               |
| Captured log after a timeout                                                      | 560 bytes, plus a stall log naming the test and `Socket×2 ChildProcess×1`                                                                                                      |

### 4.7 One open, captured, unexplained flake

The runner caught this once, in 1 of 6 consecutive suite runs, and has not
reproduced it in 24 runs since (12 of the lifecycle file alone, 12 through
`pnpm test:backup-producer`):

```
not ok 5 - a well-behaved run publishes through the stdout contract
  code: 'snapshot_session_failed'
  error: the snapshot-owning session failed while confirming the snapshot
         transaction was still open after pg_dump:
         psql session exited (signal SIGKILL) before completing the statement
```

The session double was SIGKILLed during an otherwise clean run, between the dump
and the liveness re-probe. Nothing in the producer signals a session at that
point — `session.kill()` is reached only from `emergency()` and from
`endSnapshotSession()` after a close timeout, neither of which had run. **The
cause is not established and no claim is made about it.** The log is preserved
and the failure mode is loud (the run fails closed, publishes nothing, and
cleans up), so if it recurs the watchdog state and the captured log will name it
again.

Worth noting for whoever picks it up: the producer's behaviour on that path is
correct — a session that dies mid-run _must_ fail the backup, and it did. What
is unexplained is why the double died.

### 4.8 The later review timeouts were a different failure — a starved marker wait

Two more review runs timed out in the lifecycle file: one at a 30 s per-file
deadline, one at 60 s. **These are not the §4.6 stall.** The preserved state and
stall logs
(`/tmp/eanhl-backup-suite-3FwpPe`, `/tmp/eanhl-backup-suite-1ZtsjZ`) show a
different signature entirely — the file was _progressing_, and every test that
waited on a double took almost exactly its own timeout:

```
5940ms  aborting during the dump: the probe confirms the command is gone …
5932ms  aborting during archive validation releases the lock once pg_restore …
5925ms  aborting during encryption releases the lock — a local child …
5889ms  a container-side command that OUTLIVES the docker client retains the lock
5910ms  a container probe that cannot answer retains the lock
5902ms  a container probe that hangs is bounded, and still retains the lock
5890ms  the forced synchronous teardown retains the lock and records recovery steps
```

with, at every sample, `active handles: none` and `child processes: (none)`.
5.9 s is `waitForFile`'s 6000 ms default; nothing was running to write the marker
it was waiting for. In the 60 s run the CLI SIGINT test then entered
`runCliUntilDump`'s **20 000 ms** marker wait and was 14,768 ms into it when the
deadline fired.

**What the SIGINT test awaits, established by measurement:** a marker file, not a
process, pipe, cancellation or cleanup. Removing node's directory from `PATH`
locally reproduces it exactly —

|                                      | duration      | outcome                                                         |
| ------------------------------------ | ------------- | --------------------------------------------------------------- |
| normal `PATH`                        | **235 ms**    | passes                                                          |
| node's directory removed from `PATH` | **19,975 ms** | `timed out after 20000ms waiting for …/markers/pg_dump.started` |

**Sufficient cause, reproduced; not proven for that container.** The lifecycle
doubles carried `#!/usr/bin/env node`, while every other test file's doubles are
`#!/bin/sh` — which matches the file-level split exactly (config, producer and
boundaries passed; only lifecycle failed). A `node` that does not resolve on the
spawned child's `PATH` starts nothing, writes no marker, and leaves every
waiting test to burn its full budget. That reproduces the whole signature here.
It is **not** confirmed for the review container, and one earlier capture
actively argues against it being the only story: the 12:46 run's stall log shows
a _running_ `node …/bin/docker exec c pg_dump …` child, so `node` resolved then.
Two failures, two signatures.

**Fixed by removing the dependency rather than diagnosing the container.** The
doubles are now installed as a `#!/bin/sh` launcher that `exec`s this process's
own interpreter by absolute path, and each sandbox asserts the double actually
runs before any test waits on it. With node's directory removed from `PATH`:
SIGINT test 19,975 ms → **251 ms**; whole lifecycle file **31/31 in 9.6 s**,
identical to a normal `PATH`.

**Aggregate slowness is not a stuck test, and the runner now distinguishes
them.** A deadline report prints `thisTestRunningFor`, so a large value means
that test is stuck and a small one means the file ran out of budget. The
lifecycle file's own cost is ~9.5 s; at the reviewer's 30 s and 60 s deadlines it
now passes with rc 0.

## 5. Failure cases exercised

**Injected fakes** (`backup-producer.test.mjs`, `backup-config.test.mjs`,
`backup-boundaries.test.mjs`):

| Failure                                                                                  | Result                                                                                                                                                                |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Snapshot transaction lost between dump and counts                                        | `snapshot_transaction_lost`, nothing published                                                                                                                        |
| Snapshot session dies mid-run                                                            | `snapshot_session_failed`, nothing published                                                                                                                          |
| Required table or count absent                                                           | `required_relation_missing` / `required_count_missing`                                                                                                                |
| Encryption executable missing                                                            | `encryption_executable_missing`, **before any dump**                                                                                                                  |
| Recipients file missing / empty / not a public key                                       | `recipient_file_unreadable` / `_empty` / `_malformed`                                                                                                                 |
| Encryption exits non-zero, writes nothing, passes plaintext through, or omits the header | `encryption_failed`, `encryption_produced_no_output`, `ciphertext_header_unexpected` / `ciphertext_equals_plaintext`                                                  |
| Backing volume full while the Linux filesystem looks empty                               | `insufficient_capacity`, naming the backing volume                                                                                                                    |
| No room for the ciphertext beside the plaintext                                          | `insufficient_capacity` at the pre-encryption re-check                                                                                                                |
| `pg_dump` non-zero exit / exit 0 with stderr                                             | Refusal, stderr surfaced                                                                                                                                              |
| Archive rejected by `pg_restore`                                                         | `archive_validation_failed`, nothing encrypted                                                                                                                        |
| Duplicate run: live / live-and-old / dead / foreign host / unreadable / retained         | `concurrent_run`, `concurrent_run_hung`, `lock_stale`, `lock_foreign_host`, `lock_unreadable`, `lock_retained_uncertain` — **and zero unlinks on every refusal path** |
| **Cancellation times out**                                                               | Lock RETAINED, `unconfirmed` records `timeout`                                                                                                                        |
| **Cancellation throws**                                                                  | Lock RETAINED, `unconfirmed` records `error`                                                                                                                          |
| **An unstoppable handle**                                                                | Kept in the registry, so a forced teardown can still SIGKILL it                                                                                                       |
| **A docker-exec op with no identity token**                                              | Cannot be confirmed ⇒ lock RETAINED                                                                                                                                   |
| **Probe still lists our token / lists someone else's**                                   | RETAINED / released respectively                                                                                                                                      |
| The probe is read-only                                                                   | Called exactly once, with the container and the configured timeout, and never used to signal                                                                          |
| Artifact identity already present                                                        | `artifact_identity_collision`; existing file byte-unchanged                                                                                                           |
| Incomplete / corrupt published artifact                                                  | `artifact_incomplete`, every published file withdrawn                                                                                                                 |
| Incomplete-artifact detection (six shapes)                                               | All reported incomplete with a specific reason                                                                                                                        |
| Every configuration key omitted in turn                                                  | Fail-closed, no defaults                                                                                                                                              |

**Real child processes** (`backup-lifecycle.test.mjs`):

| Failure                                                          | Result                                                                                                                                                      |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A synchronous 8 MiB burst against a 256 KiB ceiling**          | `exceeded: true`; a concurrent sampler never saw the staged file exceed the ceiling; partial output removed                                                 |
| `runEncryption` called without a positive ceiling                | Refused (`encryption_no_budget`)                                                                                                                            |
| The double handed `--output`                                     | Exits 64 — the producer, not the tool, owns the file                                                                                                        |
| A slow runaway encryptor through a full run                      | `staging_budget_exceeded`, staging cleaned, nothing published, lock released                                                                                |
| A well-behaved run over the stdout contract                      | Artifact published, counts from the snapshot, staging and lock cleared                                                                                      |
| Output file cannot be opened                                     | Rejects `pg_dump output … ENOENT`; the child is not left running                                                                                            |
| **Node terminating on an unhandled stream `error`**              | Subprocess exits 0 with `REJECTED:ENOENT`; no `Unhandled 'error' event`                                                                                     |
| Mid-stream write failure (`/dev/full`)                           | Rejects `ENOSPC`; the child is stopped                                                                                                                      |
| SIGTERM-ignoring child                                           | `cancelChild` escalates to SIGKILL and returns inside its deadline                                                                                          |
| Cancelling a `docker exec` child / a local child                 | `containerSideEnded: null` / `true`                                                                                                                         |
| Abort during dump / validation / encryption, work confirmed gone | `run_aborted`; the child's stop timestamp **≤** the lock-release timestamp; lock released                                                                   |
| **A container-side command that outlives the client**            | Probe reports `STILL RUNNING`; `EXCLUSION RETAINED`; next producer refused `lock_retained_uncertain`                                                        |
| **A probe that fails / a probe that hangs**                      | Bounded, and the lock is RETAINED in both cases                                                                                                             |
| **A forced synchronous teardown**                                | Lock RETAINED with reason and recovery steps; staging still dropped                                                                                         |
| Hung `pg_dump` / hung encryptor                                  | `operation_timeout`, child stopped, staging cleaned, lock released once confirmed                                                                           |
| A lock left by a process that died outright                      | `lock_stale`, left for the operator                                                                                                                         |
| Dump fails outright                                              | `dump_failed` with the double's stderr                                                                                                                      |
| **CLI interrupted by SIGINT, work confirmed gone**               | Exit **130**, `FAILED [run_aborted]`, child stopped, lock and staging gone                                                                                  |
| **CLI interrupted with an orphaned container-side command**      | Exit **130** promptly, `EXCLUSION RETAINED`, lock kept; the next CLI run exits 1 with `lock_retained_uncertain` and `RECOVERY`                              |
| **A stalled LOCAL encryptor** (wedged FIFO output)               | Rejects `output_stalled` in ~2 s and the handle stays **tracked** — abandoning is not stopping, and the rule does not depend on the child being docker-exec |
| **A stalled local encryptor whose stopping cannot be confirmed** | Lock RETAINED, `unconfirmed` records `encryption/timeout`; the next producer is refused                                                                     |
| **A stalled local encryptor that IS confirmed stopped**          | Lock released — the rule is "retain unless confirmed", not "always retain"                                                                                  |
| **An abandoned handle after a forced teardown**                  | Still reachable for a SIGKILL                                                                                                                               |
| **The doubles' interpreter not on PATH**                         | Every sandbox asserts its double runs; the CLI SIGINT test goes 19,975 ms → 251 ms                                                                          |
| **An oversized dump whose container command is still listed**    | The internally killed operation is still probed; `STILL RUNNING`; lock RETAINED; the next producer is refused                                               |
| **An output-write failure with an unavailable container probe**  | Still probed; `probe could not answer`; lock RETAINED                                                                                                       |
| **An internally killed dump whose container command IS gone**    | Confirmed gone; staging cleaned; lock released; the next producer runs                                                                                      |
| **An ordinary completed run**                                    | No probe at all, no retained handle, no retained lock                                                                                                       |
| **A `pg_dump` that exits non-zero on its own**                   | Ordinary completion, not an internal kill: no probe, lock released                                                                                          |

## 6. Limitations — read before relying on any of this

### 6.1 Real encryption integration is UNVERIFIED and PENDING

`age` is **not installed** on either host and **no keypair exists**. Nothing in
this session installed it, generated a key, or handled key material.

Everything above about encryption was exercised with an explicit **test double**:
a shell script that prepends the `age-encryption.org/v1` header and copies the
bytes. That proves the _subprocess contract_ — argv, exit codes, output
handling, header and identity checks. **It proves nothing cryptographic. No
artifact produced so far is encrypted, and no artifact has ever been decrypted.**

Outstanding, all Phase 2:

- install `age` on the production host;
- generate the keypair and escrow the identity (plan §2.3);
- place only the **public** recipient file on the production host;
- produce one artifact with real `age` and confirm it decrypts and restores.

Until that last step passes, the producer is unproven against the tool it is
designed for.

### 6.2 What the backup key protects — and what it does not

The asymmetric design means the production host holds only a _public_ recipient
key, so a compromise of that host yields the ability to **write** new artifacts
and cannot decrypt any existing one. That is a real property and it is the
reason `/mnt/k`'s unenforced Unix permissions are not a confidentiality problem.

**It is not host-compromise protection, and must not be described as such.** On
the same host, today:

- `.env` holds `DATABASE_URL` for the `eanhl` role, which is a **superuser and
  the cluster's sole login role**. Anyone who can read that file can read and
  write the live database directly. The backup key is irrelevant to that.
- `~/.ssh/id_ed25519` reaches Hotel-Echo, and Hotel-Echo's `authorized_keys`
  entries carry **no forced commands** (plan §1.9), so that key grants a shell
  on the other host.
- `BETTER_AUTH_SECRET` and the other application secrets are on the same disk.

So: the backup key restricts what an attacker can do **to the artifact
archive**. It does nothing about the far larger unrestricted administrative
credentials that already exist on the host. Restricted transport keys (plan
§2.4) narrow the archive further; they do not change this paragraph either.

Encryption also gives confidentiality only. It does not prevent deletion,
truncation or bit-rot on `/mnt/k`, where any Windows process can remove a file
and where drvfs offers no assertable rename atomicity, fsync semantics or
permission enforcement.

### 6.3 Plaintext staging touches `C:`, and shredding is best-effort

Staging is on the ext4 root, which lives inside a VHDX on `C:` — the volume with
~21 GB free. Peak usage is plaintext + ciphertext, bounded by
`staging.maxStagingBytes` and cleaned up on every exit path.

`shredPlaintext` overwrites the dump with zeros before unlinking. On a
journalling filesystem, over flash with wear levelling, inside a sparse image on
NTFS, **this is a reduction in exposure, not erasure**. The real control is that
the plaintext exists for seconds inside a 0700 directory.

### 6.4 Not implemented here, and not to be assumed

No transfer, no pruning, no re-hash sweep, no freshness metric, no alarm, no
notification, no restore drill, no systemd unit, no timer. The producer writes
to a local directory and stops.

Destination acceptance and receipts have since been implemented — in isolation,
activated nowhere, with no transport to feed them — as a separate component.
See `docs/operations/backup-acceptance.md`. Nothing in _this_ file calls it, and
the producer still asserts nothing about acceptance.

`latest.json` is a producer-local pointer that carries the artifact's hash so a
reader can check the artifact rather than trust the name. It is **not** a
freshness metric and must not be used as one.

### 6.5 `pg_restore --list` cannot detect truncation

It reads the header and TOC and stops. Only `--full-archive-read` reads every
block. Do not treat a passing `list` as proof the archive is whole.

---

### 6.6 The ciphertext ceiling is a bound; the plaintext ceiling is too

Both are enforced by the same producer-owned bounded writer: the producer counts
bytes and **drops the chunk that would cross the ceiling** rather than writing
it, so the staged file cannot exceed the permitted count at any instant. The
earlier sampling design was replaced precisely because it could not do this
(§4.2a). The two post-write size checks that remain are defence in depth
against a defect in the writer, not the mechanism: one compares the ciphertext
alone against `staging.maxCiphertextBytes`, the other compares
plaintext + ciphertext against `staging.maxStagingBytes`. Both are checked,
in that order, because the explicit cap can be the tighter of the two — a run
can stay within the aggregate ceiling while still breaching the cap alone.

What this does **not** bound: how much the external tool tries to produce, or how
long it runs before the ceiling stops it — that is `run.operationTimeoutMs`. And
it says nothing about disk consumed by anything other than the producer's own
staged files.

### 6.6a The deployment invariant between the producer's cap and the acceptor's

`staging.maxCiphertextBytes` (this component) and
`acceptance.maxCiphertextBytes` (`docs/operations/backup-acceptance.md` §2.8)
are configured independently, on different hosts, and nothing in either
component reads the other's value. The relationship that must hold is:

```
acceptance.maxCiphertextBytes >= staging.maxCiphertextBytes      (compatibility minimum)
acceptance.maxCiphertextBytes == staging.maxCiphertextBytes      (least-exposure default)
```

**Compatibility minimum.** If the acceptor's ceiling is ever smaller than the
producer's, the producer can publish a ciphertext the acceptor is configured
to quarantine as oversize on arrival (`backup-acceptance.md` §6, "Ciphertext
above `maxCiphertextBytes`" → `quarantined_oversize`, never hashed, never
read) — a self-inflicted, entirely local failure mode with no attacker
involved.

**Least-exposure default.** Equality is preferred over slack: a larger
acceptor value accepts ciphertexts this producer's own contract does not
currently permit it to publish, which only makes sense as a **deliberate,
documented** migration or version-skew headroom decision (for example,
rolling out a raised producer cap to one host before another). It must never
be the accidental result of editing one config and not the other.

**Raising the acceptor ceiling above the producer's is not free**, even when
compatible. It increases, on the acceptor side only:

- the per-artifact capacity check's own reserved-bytes figure
  (`backup-acceptance.md` §2.8, "What capacity is measured, and when");
- worst-case sweep workspace occupancy — capacity is checked **per artifact**,
  not pre-reserved as `maxArtifactsPerSweep × ceiling`, but earlier accepted
  artifacts' work copies are not cleaned up until the whole sweep finishes
  (`backup-acceptance.mjs`'s `workDir` is removed once per sweep, in the
  sweep's own `finally`), so worst-case **actual** occupancy over a full
  backlog sweep can approach that multiplication;
- accepted-input exposure — the acceptor now reads, hashes and archives larger
  untrusted-until-verified artifacts;
- unbounded quarantine/storage-DoS exposure — a larger ceiling is a larger
  amount of disk a misbehaving or compromised producer identity could consume
  before the acceptor's own capacity floors refuse further work.

This document does not set the real production value for either ceiling. See
`docs/planning/proton-drive-transport-feasibility.md` (§9, U5) for what remains
open: a measured production dump series and a deliberate production-ceiling
decision, neither of which this component performs.

### 6.7 Cancelling a `docker exec` does not stop the container-side command

Killing the local `docker` client is all the producer can do — without a TTY
there is no signal forwarding — so a `pg_dump` or `pg_restore` inside the
container may keep running. The producer never claims otherwise: it runs a
read-only `ps` probe for its own identity token and, when it cannot confirm the
command is gone, **retains the run lock** (§2.7a).

The residual limitations of that probe, all in the safe direction:

- **It never kills anything.** Terminating an orphaned container-side process is
  an operator action, deliberately not automated, because the producer cannot
  distinguish "the process I started" from "a process that merely looks like it"
  strongly enough to justify signalling inside a shared container.
- **`pg_restore`'s token is broad.** It has no inert argv slot for a unique
  token, so any concurrent `pg_restore` in the database container makes the
  probe inconclusive and retains the lock.
- **`ps` output is the only signal.** The probe was verified against
  `postgres:16-alpine` (busybox `ps -A -o args=`); an image without a usable
  `ps` would make every probe inconclusive and every cancellation retain the
  lock. That is fail-closed, and it would be very visible.
- **It has not been exercised against a real orphaned `pg_dump`.** Whether a
  container-side `pg_dump` actually survives its client being killed is
  untested here; the design assumes it might, which is the conservative
  assumption.

### 6.8 Retained and stale locks both need an operator

Two distinct situations, both requiring a human, both printing what to do:

| Refusal                   | Cause                                                                                                                          | Recovery                                                                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `lock_stale`              | A producer died without unwinding — SIGKILL, OOM kill, power cut. Reclaiming automatically is a check-then-unlink race (§2.6). | Confirm nothing is running, then `rm` the lock.                                                                                               |
| `lock_retained_uncertain` | A run deliberately kept the lock because it could not confirm its own work had stopped.                                        | Follow the `recovery` field written into the lock: check this host, check the container's `ps` for the listed operations, then `rm` the lock. |

Until the freshness evaluator and an alerting channel exist (Phase 1B, operator
decision D1), **nothing will tell you either has happened** — a retained lock
silently stops every subsequent backup. That is the deliberate cost of not
letting availability override mutual exclusion, and it is the strongest argument
for prioritising the freshness metric in Phase 1B.

### 6.9 The synchronous last-resort teardown cannot confirm anything stopped

`process.on('exit')` and the second-signal path can only issue synchronous
`SIGKILL`s and synchronous `rm`s. **Issuing SIGKILL is not confirmation of
termination** — nothing awaits the `close` — so these paths establish nothing
about any child, local or container-side, and therefore retain the lock whenever
work was in flight. A local child poses no data risk on that path (it writes to a
pipe the producer owns, never into staging), but that is a separate claim from
"confirmed stopped", and only the latter would justify releasing exclusion.

### 6.10 Suite completion depends on never leaking a child

A child spawned with piped stdio holds two `Socket` handles and a
`ChildProcess` handle, which keep the owning process alive indefinitely, and
`node --test` prints nothing for a file until that file's process exits. One
leaked `hang`-mode double is therefore enough to make a whole test file appear
to produce no output. Mitigated five ways: the producer keeps unstoppable and
internally terminated handles instead of discarding them; the lifecycle suite
has an `afterEach` that force-kills everything it started plus a per-test
timeout; every test file installs a watchdog that records the running test to a
state file; every test that waits on a child bounds that wait and checks process
IDENTITY rather than bare liveness; and `pnpm test:backup-producer` runs one file
at a time under a per-file deadline inside its own owned run root, terminating
only its own descendants and failing if it leaks any.

The review-time timeout is now localized to one test and both of its unbounded
paths are bounded (§4.6). **Which of the two mechanisms fired in that
environment is still not established** — the test now checks and names the
difference that would settle it.

## 7. Requirements handed to the later transport session

These are **requirements for the phase that implements transfer and
acceptance**, recorded here because they were identified while defining artifact
completion.

**Status, 2026-09-05.** Requirements 1–6 are now implemented, in isolation and
activated nowhere, by the destination acceptance component
(`docs/operations/backup-acceptance.md`). Requirement 7 is satisfied by
construction — the acceptor reads only the destination inbox and never the
producer's staging — but the _transport sweep_ it constrains does not exist yet.
Requirement 8 (pruning) is **not implemented**. The wording below is left as
originally written so the requirement and its implementation can be compared.

1. **Acceptance is decided solely by the destination.** The destination
   recomputes `sha256(ciphertext)` and checks it against _both_ the sidecar and
   the manifest, then moves the triple into a directory no restricted transport
   key can reach. The producer never asserts acceptance.
2. **Acceptance must use the completion definition in §2.5, not file presence.**
   Rename atomicity is not assertable on the destination filesystems in play.
3. **Partial-arrival race.** A sweep may observe an artifact mid-transfer.
   Required handling: a triple that is incomplete is left alone and retried on
   the next sweep; a triple still incomplete after a bounded age is moved aside
   and reported. It must never be accepted, and it must never be deleted merely
   for being young.
4. **Name collision at the destination.** The producer refuses to overwrite an
   identity locally; the destination must do the same independently. An
   incoming artifact whose name already exists in the archive with a _different_
   hash is a hard rejection and an alert, not an overwrite — the two hosts'
   clocks are not a coordination mechanism.
5. **Same name, same hash** is a benign re-delivery: accept idempotently, do not
   duplicate the receipt, and do not let it advance freshness.
6. **Receipt binding.** A receipt is valid only if its `artifact`,
   `ciphertext_sha256` and `source_snapshot_ts` all match the producer's own
   recorded manifest for that artifact. Freshness is `max(source_snapshot_ts)`
   over binding-valid receipts, so replaying an old receipt cannot advance it.
7. **Concurrent producer and sweeper.** The transport sweep must not read an
   artifact out of the producer's staging directory; it reads only the
   destination, and only artifacts that verify complete.
8. **Pruning runs on the host that owns the directory**, on its own timer, never
   remotely, and never on an artifact that has not been accepted elsewhere.

---

## 8. Recovery and retention values — what E1A approved, and what is still PROPOSED

**Corrected 2026-09-21 (E3J7).** This table was written before **E1A
(2026-09-07, "Recovery and retention targets — approved")** and originally
marked every row PROPOSED. E1A settled several of them, and the two threshold
rows it settled contradicted what was written here. **E1A governs.** A reader
arriving at this document first must not take the superseded numbers: the
authoritative thresholds are **an 8-hour warning and a 24-hour critical alert,
both measured on _verified Proton copies_**. See
`docs/planning/proton-drive-cloud-transport-architecture.md` §5.4 for the
discrepancy as it was diagnosed, and §5.3 for the evaluator that now computes
that number (E3J7, `ops/backup/lib/backup-cloud-freshness.mjs`).

Nothing in the **producer** reads or enforces any row below; it never did.

|                                         | Value                                                                        | Status                                                                                                                                                                               |
| --------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Steady-state recovery age               | ≤ 6 h 45 min                                                                 | **PROPOSED** — operator decision D2, still open                                                                                                                                      |
| WARN threshold                          | **8 h** on a verified Proton copy (~~> 7 h 30 min~~)                         | **APPROVED (E1A)**. The struck value is SUPERSEDED — it was never approved                                                                                                           |
| ALARM threshold                         | **24 h** on a verified Proton copy (~~> 9 h 0 min~~)                         | **APPROVED (E1A)** as the _critical_ threshold. The struck value is SUPERSEDED                                                                                                       |
| RPO                                     | 6 h (a 6-hour rewind is a permanent hole: EA exposes only ~5 recent matches) | **APPROVED (E1A)**; enforced by nothing                                                                                                                                              |
| RTO                                     | **8 h** (single target)                                                      | **APPROVED (E1A)**, replacing the two split RTO rows below                                                                                                                           |
| ~~RTO onto a healthy provisioned host~~ | ~~≤ 1 h~~                                                                    | **SUPERSEDED by E1A's single RTO 8 h**                                                                                                                                               |
| ~~RTO after total host loss~~           | ~~≤ 4 h~~                                                                    | **SUPERSEDED by E1A's single RTO 8 h**                                                                                                                                               |
| Backup cadence                          | every 6 h; the clock times `00/06/12/18Z` are a proposal                     | Cadence **APPROVED (E1A)**; policy decided 2026-09-03; **not scheduled by anything yet**                                                                                             |
| Notification channel                    | Healthchecks.io dead-man's switch; Pushover primary + e-mail secondary       | **DECIDED (D1, 2026-09-23)**, **not activated, no test notification received.** **These backups must not be described as monitored until a human has received a test notification.** |
| Retention (7 d / 30 d / 12 mo)          | 6-hourly 7 d, daily 30 d, monthly 12 mo (≈ 70 artifacts)                     | **APPROVED (E1A)**; not implemented (E3J13, still blocked by C10)                                                                                                                    |

**Still unapproved, and unchanged:** the steady-state recovery age (D2).
**Approved but not implemented** is not the same as done — nothing schedules a
backup, prunes an artifact, or watches a threshold. E3J7 added a read-only
evaluator that computes the 8 h / 24 h status locally, and **E3J8A (2026-09-23)
added a local, non-activated emitter** that classifies that signal and would POST
it to one hosted Healthchecks.io slug check
([`backup-monitoring-export.md`](backup-monitoring-export.md)).

**D1 is now decided, and that is all it is.** No Healthchecks account, check,
ping key, Pushover integration or e-mail integration has been created; nothing
schedules the emitter (it has no shebang, no executable bit and no package
script, and activation is blocked on backup scheduling, which does not exist);
and **no human has received a test notification**. So the sentence in the
Notification channel row above **still holds in full**, and the honest
description of the system remains "attestations are written; nobody is watching
them". Both the freshness signal and the export report carry a fixed
`"monitored": false` field that says so. The remaining work is **E3J8B —
activation**, which needs its own authorization.

---

## 9. Remaining phases

| Phase                  | Content                                                                                                                                                                                                      | Authorization                                                                                                                                                                                                        |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1A — this document** | Producer, snapshot property, artifact contract, isolated verification                                                                                                                                        | Complete and reviewable                                                                                                                                                                                              |
| 1B                     | Transport, destination acceptance and receipts, pruning, re-hash sweep, freshness evaluator, restore-drill runner, systemd units — all written and tested in isolation, still activated nowhere              | **Partly done**: destination acceptance and receipts only (`docs/operations/backup-acceptance.md`). Transport, pruning, re-hash sweep, freshness evaluator, restore-drill runner and units are all still not started |
| 2                      | Install `age`; generate and escrow the keypair; place the public recipient; install restricted `authorized_keys` entries and prove the refusals; enable timers; first real artifact; **first restore drill** | Requires explicit operator authorization; Phase 1 does not imply it                                                                                                                                                  |
| 3                      | ≥ 72 hours / ≥ 12 cycles of scheduled observation. This criterion cannot be claimed inside an implementation session                                                                                         | Elapsed time                                                                                                                                                                                                         |
| 4                      | Cutover to Hotel-Echo, role flip, WSL lifecycle work                                                                                                                                                         | Separate authorization, separate session                                                                                                                                                                             |

**Nothing in Phase 1A authorizes Phase 2.** No key custody decision, no
production activation, no recovery target and no cutover is approved by this
work.
