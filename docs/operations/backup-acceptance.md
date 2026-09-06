# Destination acceptance and receipts (Phase 1B, first slice)

**Status: implemented, verified in isolation, NOT ACTIVATED and NOT DEPLOYED.**
Nothing here is scheduled, nothing is installed, no directory exists on any
host, no transport writes into any inbox, and no artifact has ever been
accepted. There is no entry point, no unit and no timer. This document describes
one component — the thing that decides, at the destination, whether an artifact
that arrived is real — and states precisely what it does and does not
establish.

Backing plan: `~/.claude/plans/model-opus-5-effort-modular-fountain.md`
(revision 2), Part 2.4 and Part 2.5. Immediate source of requirements:
`docs/operations/backup-producer.md` §7 items 1–7.

**This session implemented that and nothing else.** In particular it implemented
no transport, no pruning, no freshness evaluator, no restore runner, no systemd
units, no keys and no activation. See §7 for what is still missing from
Phase 1B.

---

## 1. What the component is

| File                                          | Role                                                                                          |
| --------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `ops/backup/lib/backup-acceptance-config.mjs` | The destination's configuration contract. No defaults; every rejection is fail-closed.        |
| `ops/backup/lib/backup-acceptance.mjs`        | The sweep, and every decision it makes. Every boundary injected.                              |
| `ops/backup/lib/backup-acceptance.test.mjs`   | 56 tests over a real temporary filesystem: real files, real hashes, real renames, no network. |
| `ops/backup/eanhl-backup-accept.example.json` | **Proposed** destination configuration. Not read by anything.                                 |

Two small additive changes elsewhere:

- `backup-config.mjs` now **exports** its validation primitives (`fail`,
  `requireString`, `requireAbsolutePath`, `requirePositiveInt`,
  `requireObject`, `requireBackingVolume`) so the acceptance contract is
  fail-closed in exactly the same way rather than in a second, drifting copy.
  No producer behaviour changed.
- `makeRealDeps` now supplies `fs.lstatSync` and `fs.realpathSync`, which the
  acceptor needs in order to describe an inbox entry **without following it**,
  and `fs.readSync`, `fs.fstatSync` and `fs.constants`, which it needs in order
  to decide an entry's type, identity and size from a descriptor it opened
  `O_NOFOLLOW` rather than from a path a writer can re-point (§2.2). No producer
  behaviour changed.

The acceptor spawns nothing, opens no socket, holds no key and touches no
database. Everything it does is a filesystem operation, so it is written
**synchronously** — which also means it has no interleaving points of its own,
and the only concurrency it has to survive is another process.

---

## 2. The contract

### 2.1 Four directories, three owners

```
inbox/          written by the transport key. NOTHING here is trusted.
work/<sweepId>/ destination-owned, private, one sweep's lifetime
archive/<YYYY>/ accepted artifacts. No transport key can write here.
receipts/       what the destination attests to; the producer reads it read-only
quarantine/     evidence of a refusal. Kept. Never deleted by this component.
```

Configuration **refuses to validate** if `work`, `archive`, `receipts`,
`quarantine` or the lock file lies inside the inbox, or if the inbox lies inside
any of them, or if any two of them are the same path, or if `archive`,
`receipts` or `quarantine` lives under `work` (which is swept for debris).

This deviates from plan §2.4 step 4 in one place, deliberately: the plan put
rejected material in `inbox/rejected/`. Quarantine is **outside** the inbox
here, because the record of why something was refused must not be writable by
the party whose delivery was refused.

### 2.2 Acceptance is decided on a copy the destination owns

The inbox is writable by the producer's transport key, and it stays writable
while the sweep runs. So the sweep never decides anything about the bytes in the
inbox. It:

1. checks names, file types and sizes **structurally**, reading no bytes;
2. **copies** the triple into `work/<sweepId>/<base>/`;
3. recomputes `sha256(ciphertext)` from the copy and checks it against **both**
   the copy's sidecar and the copy's manifest;
4. publishes the copy into the archive, then verifies again what actually
   landed;
5. writes a receipt bound to the hash it computed itself.

A mutation of the inbox after step 2 can no longer change what is accepted. A
mutation before step 2 fails step 3. Both are tested; the first by overwriting
each inbox file the instant it has been copied out, and asserting the archive,
the receipt hash and the reported hash are all the original bytes.

The completion definition is `verifyArtifactCompletion()` from
`backup-producer.mjs`, reused verbatim, so "complete" means the same thing at
both ends of the pipe (`docs/operations/backup-producer.md` §2.5). Presence of
three files is never completion.

**The work copy is deliberately not compared against the inbox afterwards.** An
earlier version did, and it was wrong twice over: a mismatch says only that the
inbox moved on, which is not a fact about the artifact — and it hands the writer
a way to fail every acceptance by touching the file after the copy. What proves
the copy is good is the hash check in step 3.

#### The copy is what makes step 1 safe, not the other way round

Step 1's checks describe **whatever was at that path when they ran**. The inbox
stays writable for the whole sweep, so between the last check and the copy the
entry can be unlinked and replaced. An earlier version copied with
`copyFileSync`, which resolves its source by path at the moment it runs: an
entry swapped for a symlink in that window was followed out of the inbox, and
the external file's bytes were accepted. No amount of `lstat` or `realpath`
before the copy can close that, because the object they checked is not the
object the copy opens.

So the copy opens each source **once** and reads every payload byte only from
that held descriptor. The path is deliberately re-resolved once after the open,
to re-prove containment and bind the descriptor to it by device+inode; what no
longer happens is reading payload bytes by name:

| Step                                                                             | What it rules out                                                                                                                                                        |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `open(O_RDONLY\|O_NOFOLLOW\|O_NONBLOCK\|O_CLOEXEC)`                              | A symlink at the final component — the kernel refuses atomically (`ELOOP`), so there is no window. `O_NONBLOCK` stops a swapped-in FIFO or device from hanging `open()`. |
| `fstat` on the descriptor: must be a regular file, `size ≤` ceiling              | Type and size decided on the **opened object**, not on a name.                                                                                                           |
| `realpath` again, then `lstat(realpath)` device+inode `===` `fstat` device+inode | A symlinked **parent**, or an entry swapped underneath a resolved parent: the descriptor would be holding a different inode from the one the path now names.             |
| Every byte read from that descriptor, counted                                    | A source replaced after this point cannot change what is copied, and a source that **grows** is seen, because the loop counts what it actually reads.                    |

The per-role ceiling is enforced by that counter, and the loop stops **before
writing** the byte that would breach it — so at most `ceiling` bytes of a
refused source ever reach the work volume, and the partial copy is removed
immediately. A ceiling checked only after copying is not a bound on disk
consumption. Every work copy is then re-checked against its ceiling **before**
`verifyArtifactCompletion` parses the manifest or hashes the ciphertext.

Both substitutions are refusals, not retries, and both quarantine the triple as
evidence: `quarantined_unsafe` for a source that became a symlink or a different
inode, `quarantined_oversize` for one that breached its ceiling. Neither is
subject to the arrival grace period — a symlink in the inbox is never a transfer
in progress.

Platform note: if `fs.constants.O_NOFOLLOW` is absent the copy **refuses**
rather than falling back to a path-resolving open, because a silent fallback
would be exactly the defect above.

Scope of the atomicity claim: `O_NOFOLLOW` refuses a **final-component** symlink
atomically, in the kernel. The post-open re-resolution that covers a symlinked
**ancestor** is a check with a small window, not an atomic operation — Node
exposes no `openat`/`O_PATH`. That remains a documented limitation, bounded by
deployment rather than by this code; see §6.7 and §6.1.

### 2.3 Completion and crash recovery — the definition

Acceptance of one artifact is complete **iff** the archive triple verifies
complete **and** a binding-valid receipt names it. Neither a rename nor a file's
presence is ever taken as evidence: the destination filesystems in play offer no
assertable rename atomicity, so every publish is followed by a fresh
verification of what landed, and a publish that does not verify is withdrawn.

That definition makes every crash point recoverable by sweeping again:

| crash after…               | the next sweep sees                       | and does                     |
| -------------------------- | ----------------------------------------- | ---------------------------- |
| copying into `work/`       | inbox triple intact, nothing archived     | redoes the whole artifact    |
| a partial archive publish  | archive triple **incomplete**, no receipt | republishes over it (resume) |
| a complete archive publish | archive complete, receipt missing         | writes the missing receipt   |
| writing the receipt        | archive complete, receipt valid           | removes the inbox copy       |

The resume rule has exactly one form, and it is **the only circumstance in which
anything under `archive/` is ever overwritten**:

> An archived triple may be republished only while it does **not** verify
> complete **and** no binding-valid receipt names it.

An artifact that was ever accepted is immutable here. An archived triple that
does not verify but **does** have a receipt is `rejected_archive_damaged`: that
is damage to an accepted artifact, not a delivery problem, and it is reported
rather than quietly overwritten.

**A receipt is inspected before anything under `archive/` is touched, and the
rule is not conditioned on an archive file being present.** "Every archive file
is missing" is the _worst_ version of a damaged accepted state, not an exemption
from it. An earlier version read it as "nothing was ever accepted here": it
published the incoming triple — including a _conflicting_ one, whose bytes then
stayed archived — and only afterwards noticed the receipt and returned
`rejected_receipt_conflict`. Now the receipt is read first, and the archive, the
receipt and the incoming inbox triple are all left exactly as found.

That refusal covers the identical re-delivery too. Republishing the very bytes
the receipt names would make the receipt true again and hide the fact that an
accepted artifact was destroyed on the destination. Repair is an operator's
decision, taken with the evidence intact; the sweep will not make it silently.

| Archive verifies complete? | Receipt present? | What happens                                 |
| -------------------------- | ---------------- | -------------------------------------------- |
| yes                        | yes, bound       | `duplicate` — nothing written                |
| yes                        | yes, not bound   | `rejected_receipt_conflict`                  |
| yes                        | no               | `receipt_completed` — the receipt is written |
| no (some files present)    | no               | resume: republish over the debris            |
| no (some files present)    | yes              | `rejected_archive_damaged` — nothing touched |
| no (**no** files present)  | no               | ordinary first publish                       |
| no (**no** files present)  | yes              | `rejected_archive_damaged` — nothing touched |

`work/` debris from a sweep that died mid-copy is removed at the start of the
next sweep, but only for directories older than `work.orphanGraceMs` and never
the current sweep's own.

### 2.4 Incomplete arrivals are not failures

An incomplete triple — a missing file, or three files that do not hash together
— is **indistinguishable from a transfer in progress**. So:

- Below `inbox.incompleteGraceMs`, measured from the **newest** mtime among the
  parts present, it is left exactly as found: not read, not moved, **not
  deleted**. A transfer that is still landing files keeps resetting that clock.
- Past that age it is moved into quarantine and reported.

Nothing is ever deleted for being young, and nothing is deleted at all except
an inbox triple that has been accepted.

Two failure classes are **not** given the grace period, because no additional
bytes could ever resolve them:

| Class                                                            | Why it is definitive                                                                                                           |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| unsafe entry type (symlink, directory, special file) or oversize | Structural. It is not an artifact arriving; it is not an artifact.                                                             |
| a manifest that does not describe its own artifact               | The three files already hash together, so the bytes are exactly what the producer wrote. A wrong manifest is a wrong manifest. |

### 2.5 Names and paths

Every value that becomes a path component is validated. `readdir` cannot return
a name containing `/`, but a **manifest can**: `manifest.artifact` and the year
derived from `manifest.snapshot_ts` are both attacker-supplied in the threat
model, and both are used to build paths. `assertSafeComponent()` rejects `.`,
`..`, anything containing `/`, `\` or NUL, anything starting with a dot, and
anything that is not a non-empty string.

Inbox entries are matched against
`^<prefix>-<YYYYMMDDTHHMMSSZ>(\.dump\.age|\.dump\.age\.sha256|\.manifest\.json)$`
and nothing else. Anything unmatched — an rsync temporary, `latest.json`, a file
a human left — is **reported and left completely alone**. Tidying the inbox is
not this component's job.

Entries are described with `lstat`, never `stat`, so a symlink is seen as a
symlink rather than as whatever it points at; a symlink named like an artifact
is quarantined **as a link**, its target never read. Behind that, every path is
resolved with `realpath` and required to still live directly inside the
directory it was listed in, which also catches a symlinked ancestor. A path that
vanishes between being listed and being resolved is deferred, not refused — that
is the transport moving.

The inbox itself must be a real directory. A symlink there stops the whole
sweep (`inbox_unsafe`); a missing one is `inbox_unreadable`, because deployment
creates the transport-writable directory and the acceptor never does.

### 2.6 Identity, conflicts, and idempotent re-delivery

Artifact identity is the base name, `<prefix>-<snapshotTs>`, at second
granularity — the same identity the producer refuses to overwrite locally. The
destination decides independently:

| Situation                                                    | Outcome                      |
| ------------------------------------------------------------ | ---------------------------- |
| Identity archived, **different** ciphertext hash             | `rejected_identity_conflict` |
| Identity archived, same hash, **different** `snapshot_ts`    | `rejected_identity_conflict` |
| Identity archived, same hash, same `snapshot_ts`, receipt ok | `duplicate`                  |
| …same, but the receipt is missing                            | `receipt_completed`          |
| …same, but the receipt is not bound to it                    | `rejected_receipt_conflict`  |

A conflict is a hard refusal and an alert: the archived copy is not touched, and
the incoming triple is quarantined. The two hosts' clocks are not a coordination
mechanism, and one second is enough resolution to collide.

The second row is reachable in practice: `2026-09-04T18:00:07Z` and
`2026-09-04T18:00:07.500Z` compact to the same stamp, so two different recovery
points can arrive under one name.

**An identical re-delivery is idempotent.** It consumes the inbox copy, leaves
the archive untouched and leaves the existing receipt **byte-identical** — it is
not rewritten, so `accepted_at` does not move and no second receipt appears.
That is what stops a replayed delivery from advancing freshness: the metric is
`max(source_snapshot_ts)` over binding-valid receipts, and a re-delivery neither
adds a receipt nor changes one. The result carries `freshnessAdvanced: false`
explicitly, so a consumer asserts on it rather than inferring it.

### 2.7 Receipts

`receipts/<base>.receipt.json`, written through a per-sweep temporary and read
back before it is considered written:

```json
{
  "schema_version": 1,
  "artifact": "<base>.dump.age",
  "base": "<base>",
  "ciphertext_sha256": "<recomputed by the DESTINATION, not copied from the manifest>",
  "ciphertext_bytes": 0,
  "source_snapshot_ts": "<manifest.snapshot_ts>",
  "source_run_id": "…",
  "source_host": "…",
  "manifest_schema_version": 1,
  "destination_host": "…",
  "archive_path": "…",
  "accepted_at": "…"
}
```

`validateReceiptBinding(receipt, manifest)` is the binding contract, exported and
tested: a receipt is valid only if its `artifact`, `ciphertext_sha256` and
`source_snapshot_ts` all match the manifest, and its schema version is
recognised. It is one contract with two users — this component uses it to decide
whether an existing receipt may be left alone, and the producer-side freshness
evaluator (not implemented) will use it to decide whether a receipt may advance
the metric.

`source_snapshot_ts` is the recovery point and the only field a freshness metric
may read. `accepted_at` is pipeline liveness only.

### 2.8 Bounds, all configured, none defaulted

| Key                                                | Bounds                                                                                                                                                                                                                                    |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `acceptance.maxCiphertextBytes`                    | Three times: `lstat` **before any read**, `fstat` on the opened descriptor, and a running count during the copy that stops before writing the breaching byte. An oversized artifact is never hashed and never fully written.              |
| `acceptance.maxManifestBytes`                      | Same three, for the manifest — and the manifest is never parsed before the copy has been re-checked against it.                                                                                                                           |
| `acceptance.maxSidecarBytes`                       | Same three, for the sidecar.                                                                                                                                                                                                              |
| `acceptance.maxArtifactsPerSweep`                  | A backlog is drained over several sweeps rather than one unbounded run.                                                                                                                                                                   |
| `acceptance.sweepDeadlineMs`                       | No new artifact is **started** past it. A publish in flight always finishes or is withdrawn.                                                                                                                                              |
| `capacity.minFreeBytes` / `capacity.backingVolume` | Twice per artifact — once for the work volume before any copy, once for the archive volume before any publish — on both filesystem layers each time. `backingVolume` is required-but-nullable, for the WSL reason in the producer's §2.7. |
| `inbox.incompleteGraceMs`                          | How long an incomplete arrival is left alone.                                                                                                                                                                                             |
| `work.orphanGraceMs`                               | How old debris must be before it is swept.                                                                                                                                                                                                |

#### What capacity is measured, and when

An artifact is written twice, onto two directories that may or may not share a
filesystem. Each write is measured against the volume it lands on, immediately
before it happens, with a bound the transport cannot move afterwards.

| Write                        | Measured on   | Reserved bytes                                                                                          | Measured when                                                                                           |
| ---------------------------- | ------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| inbox → `work/<sweep>/<id>/` | `work.dir`    | `maxCiphertextBytes + maxSidecarBytes + maxManifestBytes` — the sum of the **configured role ceilings** | before the first source descriptor is opened                                                            |
| `work/…` → `archive/YYYY/`   | `archive.dir` | the **actual sizes of the three work copies**, re-`stat`ed                                              | after the copies exist and have been re-checked, immediately before the first mutation under `archive/` |

The work reservation is deliberately **not** derived from the `lstat` sizes read
off the inbox in step 1. The inbox stays writable for the whole sweep, so a
source can be replaced or grown after that `lstat` and still be copied in full
as long as it stays under its role ceiling — which is precisely what the copy
loop permits. A reservation taken from those sizes therefore bounds nothing: the
accepted work copy can be far larger than the space that was reserved for it.
The role ceilings are the only bound the copy actually enforces, they come from
configuration rather than from the inbox, and nothing the transport does can
move them. Ceilings set far above real artifact sizes make this refuse early;
that is the operator's dial, and early refusal is the safe direction.

The archive reservation is the opposite case: by then the bytes are
destination-owned and bounded (`copyIntoWork` stopped before the ceiling-breaching
byte; `assertWorkCopiesBounded` re-checked the result), so the exact sizes are
known and are what gets reserved.

**Neither check assumes anything about the relationship between the two
volumes.** If they share a filesystem, the archive measurement has already lost
the work copies — and every earlier artifact this sweep archived — so the floor
is preserved across both writes without that sharing ever being probed. If they
are separate filesystems, each has been asked for its own room. The component
does not, and does not need to, know which it is.

One layer below that, `capacity.backingVolume` is a **single declared volume**
applied to both checks. That is honest as an _additional_ constraint — it can
only refuse, never permit — but if `df` on a target directory does not tell the
truth (the WSL/thin-provisioning case the field exists for) and work and archive
sit on different backing volumes, one declaration can only describe one of them.
This is a deployment assumption, recorded in §6.1, not something the component
verifies.

Receipt writes are not capacity-checked. A receipt is a few hundred bytes
written by the destination itself; on a shared filesystem the archive floor
covers it, and on a separate `receipts.dir` volume it does not. This is stated
rather than assumed away — see §6.1.

The ciphertext is only ever hashed by streaming (`deps.sha256File`); no artifact
is held in memory in one piece.

### 2.9 Exclusion and interruption

The acceptance lock is `O_CREAT|O_EXCL` and **nothing ever unlinks a lock it did
not create** — the same rule, for the same check-then-unlink race, as the
producer's run lock (`docs/operations/backup-producer.md` §2.6).

| Situation                 | Code                             | What happens                                           |
| ------------------------- | -------------------------------- | ------------------------------------------------------ |
| Holder is running         | `acceptance_concurrent_run`      | Refuse. The lock is untouched.                         |
| Holder is running and old | `acceptance_concurrent_run_hung` | Refuse, and say it is probably hung.                   |
| Holder is gone            | `acceptance_lock_stale`          | Refuse, print the exact `rm`, leave it byte-identical. |
| Lock names another host   | `acceptance_lock_foreign_host`   | Refuse.                                                |
| Lock is not readable JSON | `acceptance_lock_unreadable`     | Refuse; the file is left exactly as found.             |

Unlike the producer there is **no retained-lock path and no uncertainty to
record**: this component spawns nothing, so when a sweep returns — normally, by
refusal, or by abort — everything it started has demonstrably stopped, and
releasing the lock is justified. Only a process that dies outright leaves a
stale lock, and that needs an operator. Until the freshness evaluator and an
alerting channel exist, **nothing will tell you that has happened.**

Every temporary file carries the sweep id (`<name>.<sweepId>.part`). This is not
cosmetic: a shared `.part` name let one sweeper's rename carry off another's
half-written file, which was reproduced by running a second sweep from inside
the first one's publish. Under that same interleaving the archive still ends up
complete, with the correct bytes and exactly one binding-valid receipt.

Interruption is an injected `signal` checked before each artifact is started and
before the archive publish; it never interrupts a publish half-way. An aborted
sweep leaves the artifacts it did not reach exactly where they were, removes its
work directory, releases the lock, and leaves every previously accepted artifact
and receipt byte-identical.

### 2.10 Outcomes

Artifact-level problems never stop the sweep; they are reported per artifact,
with `alert: true` on the ones a human must see.

| Outcome                                                      | Meaning                                                                                                                             |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `accepted`                                                   | Archived, verified, receipted.                                                                                                      |
| `duplicate`                                                  | Identical re-delivery. Receipt untouched, freshness not advanced.                                                                   |
| `receipt_completed`                                          | Archive was already complete; the missing receipt was written.                                                                      |
| `pending_incomplete`                                         | Arrival in progress, or a copy that could not be made. Left alone.                                                                  |
| `deferred_budget` / `deferred_deadline` / `deferred_aborted` | Not started this sweep. Untouched.                                                                                                  |
| `quarantined_stalled`                                        | Still incomplete past the grace period.                                                                                             |
| `quarantined_corrupt`                                        | Never hashed together, past the grace period.                                                                                       |
| `quarantined_unsafe`                                         | Symlink, directory, special file, a path resolving out of the inbox, or a source substituted between the checks and the copy.       |
| `quarantined_oversize`                                       | Above a configured ceiling, whether at `lstat`, at `open`, or while being copied. Never hashed.                                     |
| `quarantined_manifest_invalid`                               | Hashes together, but the manifest does not describe this artifact.                                                                  |
| `rejected_identity_conflict`                                 | The identity is archived with different content or a different recovery point.                                                      |
| `rejected_archive_damaged`                                   | A receipt exists but the archived copy does not verify complete — including when every archive file is missing. Nothing is touched. |
| `rejected_receipt_conflict`                                  | An existing receipt is not bound to the artifact.                                                                                   |
| `publish_withdrawn`                                          | What landed in the archive did not verify; it was removed.                                                                          |

Sweep-level refusals throw: `inbox_unreadable`, `inbox_unsafe`,
`insufficient_capacity`, `archive_publish_failed`, `acceptance_lock_*`,
`acceptance_concurrent_run*`, plus the configuration codes shared with the
producer.

---

## 3. Running it

```bash
# The acceptance suite alone.
node ops/backup/run-suite.mjs ops/backup/lib/backup-acceptance.test.mjs

# The whole backup suite, one file at a time under a per-file deadline.
pnpm test:backup-producer
```

There is **no CLI, no unit and no timer**, deliberately (§7). Nothing invokes
`acceptInboxArtifacts()` outside the tests.

---

## 4. Validation evidence (2026-09-05, corrected 2026-09-05)

### 4.1 Acceptance suite — 56/56 pass

Real temporary filesystems, real files, real sha256, real renames, real
symlinks. Only the clock, the hostname/pid, `realpath` (in two deliberate
fault-injection tests) and the free-space probe are injected.

Twelve of the 56 were added across the two review correction passes in §4.4:
five for the descriptor/ceiling/receipt pass, and seven for the capacity pass.
Each was watched failing against the implementation as it stood, for the defect
it names and not for a setup error.

They interleave through the ordinary `deps.fs` primitives — `mkdirSync` on the
artifact's work directory (which is the point after every check and immediately
before the first byte is copied), `readSync` (mid-copy), `closeSync` on a source
descriptor (the instant a file has been copied out in full). The acceptor
carries no test-only hook.

### 4.2 Whole suite — 165/165 pass

`node ops/backup/run-suite.mjs --keep-logs`:

| File                         |   Tests |
| ---------------------------- | ------: |
| `backup-config.test.mjs`     |      15 |
| `backup-producer.test.mjs`   |      54 |
| `backup-boundaries.test.mjs` |       9 |
| `backup-acceptance.test.mjs` |      56 |
| `backup-lifecycle.test.mjs`  |      31 |
| **total**                    | **165** |

Wall-clock timings are deliberately not recorded: they vary with the host and
are not evidence of anything the suite asserts. `backup-lifecycle` dominates.

The 109 producer tests are unchanged by this work, in count and in content. The
`105/105` figure in earlier revisions of `docs/operations/backup-producer.md`
was a miscount and has been corrected there.

### 4.3 Failure cases exercised

| Failure                                                                                               | Result                                                                                                                                                                              |
| ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Valid triple                                                                                          | archived, receipt binding-valid, inbox drained, work empty, lock released                                                                                                           |
| Every inbox file overwritten the instant it was copied out                                            | accepted; archive, receipt hash and report are the ORIGINAL bytes; nothing in the inbox was ever read                                                                               |
| Ciphertext altered before the sweep                                                                   | `pending_incomplete`; nothing archived, no receipt                                                                                                                                  |
| Sidecar hash wrong, past the grace period                                                             | `quarantined_corrupt`; all three files moved, `REASON.txt` written, archive empty                                                                                                   |
| `snapshot_ts` disagreeing with the filename                                                           | `quarantined_manifest_invalid` immediately — no grace                                                                                                                               |
| Manifest missing / young                                                                              | `pending_incomplete`; the inbox listing and bytes are unchanged and unread                                                                                                          |
| Sidecar missing, past the grace period                                                                | `quarantined_stalled`; moved, not deleted                                                                                                                                           |
| Two old parts and one that just landed                                                                | `pending_incomplete` — the newest mtime governs                                                                                                                                     |
| Symlink to a private file, named as the ciphertext                                                    | `quarantined_unsafe`; the target is never read and is unchanged; the link is quarantined **as a link**                                                                              |
| Source replaced by a symlink to identical bytes **after** every check, immediately before the copy    | `quarantined_unsafe` (`ELOOP`); the outside file is never opened, never read and unchanged; the link is quarantined as a link                                                       |
| Whole triple replaced, after the checks, by a larger but consistently hashed one (512 B, ceiling 128) | `quarantined_oversize` at `fstat` on the opened descriptor; nothing hashed, nothing archived, no copy left in `work/`                                                               |
| Source **grown** past its ceiling while it is being copied                                            | `quarantined_oversize` mid-copy; the partial copy is removed; nothing hashed, nothing archived                                                                                      |
| A directory wearing the manifest's name                                                               | `quarantined_unsafe`; not descended into                                                                                                                                            |
| An entry resolving outside the inbox                                                                  | `quarantined_unsafe`; the outside file never read                                                                                                                                   |
| An entry that vanishes mid-sweep                                                                      | `pending_incomplete` — not a refusal                                                                                                                                                |
| Inbox replaced by a symlink / absent                                                                  | `inbox_unsafe` / `inbox_unreadable`; whole sweep refuses                                                                                                                            |
| Ciphertext above `maxCiphertextBytes`                                                                 | `quarantined_oversize`; never hashed, never read                                                                                                                                    |
| Three artifacts, `maxArtifactsPerSweep: 2`                                                            | 2 accepted, 1 `deferred_budget` and untouched; next sweep accepts it                                                                                                                |
| Elapsed time past `sweepDeadlineMs`                                                                   | `deferred_deadline`                                                                                                                                                                 |
| Backing volume below its floor                                                                        | `insufficient_capacity` before any copy; work empty, lock released, inbox intact                                                                                                    |
| Work volume holding room for twice the inbox sizes but not for the configured ceilings                | `insufficient_capacity`; no inbox source is opened, nothing hashed, inbox intact                                                                                                    |
| Work volume one byte below floor + ceilings / exactly at it                                           | refused before any read / accepted                                                                                                                                                  |
| Archive volume below floor + the bytes about to be published                                          | `insufficient_capacity`; no year directory, no receipt, no quarantine entry, inbox intact                                                                                           |
| One shared pool behind work and archive, two artifacts, room for one reservation                      | first accepted, second `insufficient_capacity`; the floor is still free at the end                                                                                                  |
| A capacity refusal after an earlier acceptance                                                        | the earlier archive file and receipt are byte-identical; the refused triple stays whole in the inbox                                                                                |
| Same identity, different bytes                                                                        | `rejected_identity_conflict`; archive and receipt byte-identical; incoming quarantined                                                                                              |
| Same identity, same bytes, `…07Z` vs `…07.500Z`                                                       | `rejected_identity_conflict`                                                                                                                                                        |
| Identical re-delivery an hour later                                                                   | `duplicate`, `freshnessAdvanced: false`, receipt **byte-identical**, one receipt file                                                                                               |
| Receipt deleted (crash after publish)                                                                 | `receipt_completed`; archived bytes not rewritten                                                                                                                                   |
| Archive left holding half a ciphertext, no receipt                                                    | resumed and `accepted`                                                                                                                                                              |
| Archived copy corrupted after acceptance                                                              | `rejected_archive_damaged`; the damage is left for a human                                                                                                                          |
| All three archive files deleted, receipt kept, **conflicting** triple redelivered                     | `rejected_archive_damaged`; the archive directory stays empty, the receipt is byte-identical, the incoming triple stays in the inbox as evidence                                    |
| All three archive files deleted, receipt kept, **identical** triple redelivered                       | `rejected_archive_damaged`; not silently repaired                                                                                                                                   |
| Receipt forged with a different hash                                                                  | `rejected_receipt_conflict`; nothing overwritten                                                                                                                                    |
| Lock held by a live pid / dead pid / another host / unreadable                                        | `acceptance_concurrent_run` / `acceptance_lock_stale` / `acceptance_lock_foreign_host` / `acceptance_lock_unreadable`; the lock file is left byte-identical                         |
| A second sweep run from inside the first one's archive publish                                        | one complete archive, correct bytes, exactly one binding-valid receipt                                                                                                              |
| Abort fired the moment the first artifact is archived                                                 | first accepted; second `deferred_aborted` and untouched; work empty; lock released; next sweep accepts it                                                                           |
| `EIO` thrown mid-publish                                                                              | `archive_publish_failed`; no published file and no `.part` debris survive; the earlier artifact and its receipt are byte-identical; the inbox copy is intact and the retry succeeds |
| rsync temporary, `latest.json`, a stray `README` in the inbox                                         | reported as unexpected, never touched                                                                                                                                               |
| Work debris older / younger than `work.orphanGraceMs`                                                 | removed / kept                                                                                                                                                                      |
| Empty inbox                                                                                           | successful, silent, no lock left behind                                                                                                                                             |

### 4.4 Defects this work found and corrected

Three, all found by the tests, all in code written in this session:

| Defect                                                                                                                                                | Correction                                                                                                                                                                             |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The work copy was validated by comparing its size to the **inbox source** after copying.                                                              | Removed. It made the verdict depend on mutable input — the exact trust this component exists to remove — and let a writer fail every acceptance by touching the file afterwards. §2.2. |
| Two sweeps shared `<name>.part`, so one's rename carried off the other's half-written file (`ENOENT` on rename, reproduced by the interleaving test). | Every temporary now carries the sweep id.                                                                                                                                              |
| A path that vanished between `lstat` and `realpath` was quarantined.                                                                                  | Treated as `pending_incomplete`. A moving inbox is transport activity, not an unsafe path.                                                                                             |

#### Correction pass, 2026-09-05

Three more, reproduced independently in review against real temporary
filesystems, none of them findable by the suite as it stood. All three shared
one root cause pattern: **a check made about a path, or about a moment, was
being relied on as a fact about the object that was later used.**

| Defect                                                                                                                                                                                                 | Root cause                                                                                                                                                          | Correction                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A checked inbox ciphertext replaced by a **symlink** immediately before the copy was followed, and the external target's bytes were read and accepted.                                                 | `copyFileSync` resolves its source by path when it runs. `lstat` and `realpath` had described a different object, earlier. The gap between them was the whole hole. | The source is opened once with `O_NOFOLLOW` and every payload byte is read only from that descriptor; type and size come from `fstat`. The path is re-resolved after the open to re-prove containment and bind the descriptor to it by device+inode. `O_NOFOLLOW` refuses a final-component symlink atomically; ancestor resolution stays non-atomic (§6.7). §2.2. |
| A checked triple replaced by a **larger, consistently hashed** one accepted 512 ciphertext bytes under `maxCiphertextBytes: 128`.                                                                      | The ceiling was read from the pre-copy `lstat` and never again. The copy itself was unbounded, and the replacement verified complete, so nothing later objected.    | The ceiling is re-checked at `open`, enforced by a running count during the copy that stops **before** writing the breaching byte, and re-checked on the copy before any parse or hash.                                                                                                                                                                            |
| An accepted artifact whose three archive files were all deleted, receipt retained, **published a conflicting triple** and only then returned `rejected_receipt_conflict`. Those bytes stayed archived. | "No archive file present" was treated as "nothing was ever accepted here", so the receipt was not consulted until after the publish had already happened.           | Any existing receipt is inspected **before** archive mutation. A receipt with an archive that does not verify is `rejected_archive_damaged` regardless of how many files remain. §2.3.                                                                                                                                                                             |

The first two are the reason `deps.fs` grew `readSync`, `fstatSync` and
`constants`: the acceptor needs to decide things about a descriptor, and the
boundary bundle could only express decisions about paths.

#### Capacity correction pass, 2026-09-05

A fourth boundary, found after the pass above and corrected separately. Same
root-cause pattern, applied to bytes rather than to objects: a size established
about a _path_, at a _moment_, was relied on as a bound on what would actually
be written.

| Defect                                                                                                                                                                                                                                                 | Correction                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Work capacity was reserved from the **pre-copy inbox `lstat` sizes**. Those describe a mutable source and are stale the instant they are read, so a triple grown after the probe could overrun the work volume the probe had just declared sufficient. | Work capacity now reserves the sum of the **configured role ceilings** before any inbox byte is read. The ceilings are the real upper bound on what the copy can write, and they do not depend on the inbox at all. |
| Archive capacity was **never measured**. Publication could therefore fill the archive volume even though the work-space probe had passed.                                                                                                              | Archive capacity now reserves the **actual trusted work-copy sizes** — bytes the destination already owns and has verified — immediately before publication.                                                        |

Seven regression tests were added for this pass: work refused when the volume
holds twice the inbox sizes but not the configured ceilings, the one-byte-below
and exactly-at boundaries, archive refused below floor-plus-publication-bytes, a
shared pool admitting only the first of two artifacts, and the proof that a
capacity refusal leaves an earlier acceptance byte-identical and the refused
triple whole in the inbox.

### 4.5 What the tests establish, and what they do not

They establish what an operator would find on disk: which files exist
afterwards, what the receipt says, which outcome came back, whether the archive
changed, whether the lock was released, and whether anything in the inbox was
read at all.

They do **not** establish anything about a real deployment. No inbox exists, no
transport writes into one, the filesystem is a Linux `tmpdir` rather than the
destination's real volume, and every ownership and permission property in §6 is
unproven.

---

## 5. Deviations from the plan, and why

| Plan                                              | Here                                                                     | Reason                                                                                                                                                 |
| ------------------------------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| §2.4 step 2: **move** the triple into the archive | **Copy** into a private work space, verify, then publish                 | A move from a directory the transport can still write is a decision about mutable bytes. The verdict must be computed on bytes the destination owns.   |
| §2.4 step 4: failures go to `inbox/rejected/`     | Quarantine is a directory **outside** the inbox                          | The record of a refusal must not be writable by the party whose delivery was refused.                                                                  |
| §2.4: acceptance moves and then reports           | Acceptance is complete only with archive **and** a binding-valid receipt | Rename atomicity is not assertable on these filesystems, so the state after a crash has to be defined in terms of what verifies, not what was renamed. |

---

## 6. Limitations — read before relying on any of this

### 6.1 Every ownership protection here still needs deployment proof

This component enforces the separation **in configuration**: it refuses to run
with an archive, receipts directory, work space, quarantine or lock file inside
the transport-writable inbox. That is the only part a repository can check.

Everything that actually makes the separation real is a deployment property, and
**none of it has been verified, because none of it exists yet**:

| Assumption                                                                                                              | How it must be proved, later                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The transport key can write **only** the inbox                                                                          | Install the `restrict,command="rrsync -wo -no-del …inbox"` entry and demonstrate the refusals: a write outside the inbox, a delete inside it, and a shell.                                                                                                                                                                                                                                          |
| The archive, receipts, work and quarantine directories are not writable by the transport identity                       | Real uid/gid and mode on the destination host, checked after creation — not asserted here.                                                                                                                                                                                                                                                                                                          |
| The producer can only **read** receipts                                                                                 | The `rrsync -ro …receipts` entry, likewise demonstrated.                                                                                                                                                                                                                                                                                                                                            |
| The destination filesystem preserves the permissions the acceptor sets (`0700` dirs, `0600`/`0644` files)               | Untested. Directories are created `0700` and receipts `0644`; on a mount without permission enforcement those numbers mean nothing.                                                                                                                                                                                                                                                                 |
| `rename()` within the archive directory                                                                                 | **Not assumed atomic anywhere.** Every publish is verified afterwards, which is what makes a torn rename harmless — but that also means the archive can transiently hold a half-copied file under its final name.                                                                                                                                                                                   |
| `lstat`/`realpath`/`fstat` describe the destination filesystem faithfully, and `st_dev`/`st_ino` identify a file stably | True on ext4; unverified on whatever the destination volume turns out to be. See §6.7 — the inode comparison is a **check**, so a filesystem that reports these inconsistently fails loudly rather than silently.                                                                                                                                                                                   |
| Nothing else writes into the archive                                                                                    | Not enforceable by this component. It detects the result (`rejected_archive_damaged`) and refuses; it cannot prevent it.                                                                                                                                                                                                                                                                            |
| A single declared `capacity.backingVolume` describes the volume beneath **both** `work.dir` and `archive.dir`           | Unverified. The per-directory `df` probes stand on their own and are made separately for each target; the backing-volume probe is an extra constraint applied to both. Where `df` on a target lies **and** the two targets sit on different backing volumes, one declaration cannot cover both — split the directories onto one volume, or accept that only one of them is truly bounded. See §2.8. |
| `receipts.dir` has room for a receipt                                                                                   | Not measured. Receipts are a few hundred bytes and are covered by the archive floor when they share its filesystem; on a separate receipts volume nothing checks it. A receipt that cannot be written surfaces as a write failure, not as an acceptance.                                                                                                                                            |
| The inbox is created by deployment                                                                                      | The acceptor refuses rather than creating it, so a misconfigured path fails loudly instead of quietly accepting into a new empty directory.                                                                                                                                                                                                                                                         |

**Until those are installed and demonstrated on a real host, the phrase
"destination-owned" describes an intent, not an enforced property.**

### 6.2 Nothing here verifies anything cryptographic

The acceptor never decrypts, never holds an identity, and does not know whether
the ciphertext is really an `age` file beyond what the producer's manifest
claims. It verifies **integrity and binding**, not decryptability. `age` is
still not installed and no artifact has ever been decrypted
(`docs/operations/backup-producer.md` §6.1).

An accepted artifact is therefore an artifact that arrived intact — not one that
is known to restore. Only the Phase 2 restore drill establishes that.

### 6.3 A stale lock silently stops acceptance

Same trade as the producer's: a sweep that dies outright leaves a lock no
successor will reclaim, and every subsequent sweep refuses. Nothing alerts on
that, because the freshness evaluator and the notification channel do not exist.
This is the second strong argument for prioritising the freshness metric.

### 6.4 Exclusion depends on the lock, and the lock is advisory

The interleaving test shows the worst realistic race ending safely, but that is
one interleaving, not a proof. Two sweepers that both defeated the lock could in
principle both pass the conflict check before either publishes, and the second
publish would land different bytes under the same identity — after which the
receipt no longer binds and every later sweep reports
`rejected_archive_damaged`. Loud, detected, and not silent corruption — but the
lock is what is supposed to prevent it, and one process per host on a timer is
what makes the lock sufficient.

### 6.5 Quarantine grows without bound

Nothing prunes it, deliberately: pruning is a separate Phase 1B component that
must run on the host that owns the directory. Quarantined material is evidence.

### 6.6 The `sweepDeadlineMs` bound is on starts, not on work

A publish already in flight always finishes or is withdrawn. A single very large
artifact can therefore exceed the deadline. The per-file size ceilings, not the
deadline, are what bound one artifact's cost.

### 6.7 What is still assumed about path resolution

The copy in §2.2 closes the final component completely: `O_NOFOLLOW` is a kernel
guarantee, not a check with a window. Four assumptions remain, and they are
assumptions, not proofs.

| Assumption                                                                                                                                                                                                         | Why it is not closed here                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **No ancestor of the inbox is swapped for a symlink mid-sweep.** The guard is `realpath` + a device/inode comparison against the open descriptor, which is a check with a (small) window, not an atomic operation. | Node exposes no `openat`/`O_PATH`, so there is no way to resolve a name **relative to a directory descriptor** held open for the sweep. Closing this properly needs a native binding. What makes the residual risk small is deployment, not code: the inbox's _parent_ must not be writable by the transport identity — §6.1, still unproven.          |
| **`st_dev`/`st_ino` are stable and truthful.** The comparison assumes `fstat` and `lstat` agree on the identity of one file.                                                                                       | True on ext4. A filesystem that reports zero or unstable inodes makes the check vacuous (if consistently zero) or produces a spurious `quarantined_unsafe` (if inconsistent). The second is loud and investigable; the first is silent, and is the reason this is listed here rather than treated as settled.                                          |
| **Hard links are not an escape.** A hard link inside the inbox to a file elsewhere on the same device would open, `fstat` as a regular file, and pass containment.                                                 | It would still have to hash to what its own sidecar and manifest say, so it cannot smuggle _arbitrary_ content into the archive — but it can cause an out-of-inbox file to be read. Hard links require the transport identity to already hold a writable reference to the target, so this is bounded by §6.1's key restriction, not by this component. |
| **The work and archive trees are not writable by the transport identity.** Everything after the copy trusts them without re-opening `O_NOFOLLOW`.                                                                  | Deployment property, §6.1. The work-copy bounds re-check exists as defence in depth against a short write, not as a trust boundary.                                                                                                                                                                                                                    |

None of these is reachable by the transport key alone under the deployment
described in §6.1. All of them become real if that deployment is not what
actually gets installed.

---

## 7. What is still missing from Phase 1B

This session implemented one component. Everything below is **not started**:

| Missing                               | Notes                                                                                                                                                                 |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Transport**                         | The push side, the restricted `authorized_keys` entries, and the queue sweep. Nothing writes into an inbox today.                                                     |
| **An entry point for this component** | No CLI, no `--config`, no `--dry-run`, no signal handling, no systemd unit or timer. Only the tests call the sweep. Deliberately deferred to keep this slice bounded. |
| **Producer-side receipt consumption** | Reading receipts through the read-only key and validating the binding against the producer's own manifest.                                                            |
| **Freshness evaluator**               | `max(source_snapshot_ts)` over binding-valid receipts, plus `last_receipt_at`. `validateReceiptBinding()` is the half of it that exists.                              |
| **Alerting**                          | Operator decision D1. These backups must not be described as monitored until a human has received a test notification.                                                |
| **Pruning**                           | Producer §7.8: on the owning host, on its own timer, never remotely, never on an artifact not accepted elsewhere.                                                     |
| **Weekly re-hash sweep**              | Plan §2.7 step 5 — the only defence against silent corruption at rest.                                                                                                |
| **Restore-drill runner**              | Plan §2.8.                                                                                                                                                            |
| **Deployment of any of it**           | Phase 2, and it requires explicit operator authorization.                                                                                                             |

**Nothing in this slice authorizes Phase 2.** No key custody decision, no
production activation, no recovery target and no cutover is approved by this
work.
