# Proton Drive cloud transport and attestation architecture — E3J1

**Stage:** E3J1 · **Date:** 2026-09-12 · **Corrected by:** E3J1A (2026-09-12,
same day) — see the U12-U15 classification (§10.4), the test-suite
mutation-semantics wording (§14), and the E3J2 extraction scope (§1.3);
further corrected by **E3J1B** (2026-09-12, same day) — see the U12 per-role
readback ceilings (§3.3, §10.2, §10.4), the U13 timeout/cancellation/retry
split (§10.4), and the E3J11/E3J12 session-sequence correction (§12); further
corrected by **E3J2** (2026-09-13) — the extraction described in §1.3 is now
implemented, and the dependency-graph claim in §1.3's "Dependency
implications" paragraph is narrowed: it overstated that no edge would remain
between the consumers, when the acceptor's pre-existing, non-contract
`checkCapacity()` dependency on `backup-producer.mjs` was never in scope to
remove and still exists; further corrected by **E3J3** (2026-09-13, same
day) — `publishedTripleNames()` and `ARTIFACT_PREFIX_PATTERN` (§1.3), the
naming/remote-path module and the cloud config surface (§4, §8.1, §10) are
now implemented; and the T22 test intention (§11.1) is split: E3J3 proves
the pin is required and well-formed and that the pure comparison guard
rejects a mismatch, while the integration assertion that hash verification
runs before provider-command construction is deferred to E3J4, because no
provider-command constructor exists yet; further corrected by **E3J3B**
(2026-09-13, same day, independent review) — four boundary defects found in
the E3J3 implementation are fixed: (1) cloud-config local paths were
accepted, then containment-compared, WITHOUT first requiring them to be
canonical, so a dot-segment or repeated-separator alias
(`/data/x/../artifacts/readback`) bypassed the textual separation check —
every local path field, including `capacity.backingVolume.mountPoint`, is
now REQUIRED to already be canonical POSIX form before use or comparison
(§1.3, §10.2, this correction is LEXICAL only — see the caveat added there);
(2) `buildPublishedObjectPaths()` accepted any safe-looking string as an
`artifactBase` and `formatAttemptId()` could return a malformed attemptId if
the injected `randomToken` boundary misbehaved — both now validate the
constructed identity's exact shape before use (§4, new
`assertValidArtifactBase()`); (3) the secret-shaped-key rejection message
echoed the untrusted key name itself — it is now fully generic; (4) a
non-null `capacity.backingVolume` result was nested inside a frozen object
without itself being frozen — it is now frozen too. All four are covered by
new regression tests; the corrected session total is **235/235 passing** (56
new tests over the 179-test E3J2 baseline: 5 artifact-contract + 19 naming +
32 config); further corrected by **E3J4** (2026-09-14) — the Proton Drive CLI
subprocess boundary now exists: new `ops/backup/lib/backup-cloud-cli.mjs`
implements argv construction for exactly the four operations of §8.3
(`filesystem info/create-folder/upload/download`, each single-file/single-path,
`--json` always present — evidenced verbatim for `info`/`upload`/`download` in
`proton-drive-scratch-experiment.md` §5/§7; `create-folder`'s `--json` is this
session's own inference, disclosed in the module's docblock, made because
`folderUid` is otherwise unobtainable), the local SHA-512 hash-gate integration
(closing the T22 split E3J3 opened: `assertCliIdentity()` runs strictly before
any argv builder or spawn — as originally proved with injected
`buildArgv`/`spawn` spies, an arrangement **superseded by E3J4B and E3J4C**;
see §11.1's T22 entry for the ordering and the proof as they stand now), strict parse/validate/project-or-drop for each operation's response
against the exact allowlisted shape of §2.3, and a closed, machine-readable
`CLOUD_CLI_ERROR_CODES` enum with no provider-authored text ever attached to a
returned or thrown value. New `ops/backup/lib/testdoubles/fake-proton-drive.mjs`
(a disposable local test double, not the real CLI) and new
`ops/backup/lib/backup-cloud-cli.test.mjs` cover T3-T9 and the T22 remainder —
**44 new tests, corrected session total 279/279 passing, 0 fail, no existing
assertion weakened.** Two implementation defects found and fixed during this
same session's self-review, before being considered complete: a
temporal-dead-zone reference to an uninitialized timer that crashed the
spawn-failure path, and a listener-registration-order race in which a plain
`close` handler could win over the intended timeout/overflow/cancellation
outcome and misreport it as an ordinary (and misclassified) exit — both fixed
and covered by the lifecycle tests that caught them. **T8 scope correction:**
because no attestation writer exists until E3J6, E3J4 proves only the
subprocess-boundary half of T8 — that no injected secret-shaped marker
appears in this module's returned results, thrown errors, or logs (it writes
none). The full T8 assertion that a *written attestation* contains no such
marker remains E3J6's, once an attestation writer exists to test against; this
memo previously left that split implicit and now states it explicitly (§11.1,
§12). No provider-command surface, orchestration (attempt workflow, collision
preflight, ordered triple upload, retry, lock ownership — E3J5), or readback
containment/attestation (E3J6) was implemented or is claimed. Session detail:
`docs/journal/2026-09.md`; further corrected by **E3J4A** (2026-09-14, same
day, independent security review) — independent review reproduced the E3J4
session's own claimed 44/44 as **41/44**, with an intermittent failure traced
to `fake-proton-drive.mjs` calling `process.exit()` immediately after writing
to piped stdout/stderr, before the write was guaranteed to have reached the
OS; fixed by awaiting each write's own completion callback and, on the
expected exit path, setting `process.exitCode` and returning naturally
instead of calling `process.exit()`. The same review found and fixed eleven
boundary defects in `backup-cloud-cli.mjs` itself: (1) `credential_unavailable`
and info's not-found classification used `String.includes()` — a substring
match, not an anchor — now an exact match of the fully evidenced shape on the
expected stream with the other stream empty; (2) a zero exit with nonempty,
unrecognised stderr was treated as success for all four operations — now
`provider_stderr_on_success`, checked everywhere before any success; (3)
`runDownload()` ignored stdout entirely and accepted ANY exit-0 invocation as
success if the local file merely existed, including malformed or malicious
JSON — download's terminal summary is now validated against the same
evidenced shape as upload's, and a reported byte count is cross-checked
against the local file size (`download_size_mismatch` on disagreement); (4)
the evidence-boundary disclosure for info/create-folder's raw key spelling,
create-folder's `--json` placement, and now download's terminal-summary
reuse is strengthened throughout the module's docblock as an acknowledged
design hypothesis, not verified real-CLI compatibility — real-schema
compatibility remains activation-blocking, requiring a separately authorized
provider session (E3J10+); (5) argv operands accepted any nonempty string,
so a value could itself be `--conflict-strategy`, `-f`, or `--version` —
every operand is now a validated canonical absolute path (reusing E3J3's
`assertCanonicalAbsolutePath()`/`validateRemoteRoot()` rather than
duplicating them) or a validated safe component, and no component may begin
with `-`; (6) `deps.buildArgv` let any caller of the four production entry
points replace the closed command surface — each was changed to call its fixed
real constructor directly, never sourced from `deps`, with a separately named
`runOperationForTests()` test-only seam for the ordering proof. **Both halves
of that fix were themselves insufficient and are superseded:** E3J4B removed
`runOperationForTests()` entirely (it was still a production-reachable
arbitrary-argv path), and E3J4C removed the remaining `deps` parameter from
the production signatures altogether; (7) `shell` was never passed explicitly and the composed environment
inherited every variable of the parent process, including several that can
turn an unattended run into an interactive prompt — `shell: false` is now
explicit and `GPG_TTY`/`DISPLAY`/`WAYLAND_DISPLAY`/`SSH_ASKPASS`/
`GIT_ASKPASS`/`BROWSER` are stripped before the credentials-backend selector
is added, with `credentials.backend` re-validated at this boundary as
exactly `pass` or `keychain`; (8) result objects were mutable — every
returned result, including array-valued fields, is now frozen, and
`deps.maxStdoutBytes`/`maxStderrBytes` overrides are now validated as
positive safe integers under a hard ceiling so a caller cannot disable
bounding with `Infinity`, `0`, a negative number, or an absurd one; (9) a
missing/unreadable CLI executable let the native `fs` error escape — every
hash/open/read/stat failure and every malformed `cli`/`credentials`/
`timeouts`/capture-limit/`signal`/operand input now maps to one stable,
locally authored `BackupError` with no native text, `cause`, or echoed
value (the post-hash executable-replacement TOCTOU limitation is
unchanged and is explicitly documented as unclosed); (10) an already-aborted
signal was not checked until after hashing and argv construction — every
production entry point now checks `signal.aborted` first, and the
subprocess boundary rechecks immediately before the actual spawn call; (11)
the T8 interpretation is corrected in comments throughout: an allowlisted,
pattern-validated opaque provider identifier surviving in a result is
expected provider metadata, not evidence of "secret sanitization" — T8
proves only that an unexpected key, value shape, or provider-authored free
text cannot escape. **31 tests were added (44 → 75), full corrected suite
310/310 passing, 0 fail, no existing assertion weakened or deleted to
pass.** Session detail: `docs/journal/2026-09.md`; further corrected by
**E3J4B** (2026-09-14, same day, a further independent review pass) — ten
more findings, all fixed: (1) the credential-failure anchor used THIS
memo's own shortened paraphrase rather than the scratch experiment's
authoritative raw text, which actually ends each line with `: No such file
or directory` — corrected to the exact byte-identical two-line text from
`proton-drive-scratch-experiment.md` §8.2/§8.3; (2) not-found
classification accepted `Node not found: <anything>`, so a stale or
unrelated response naming a DIFFERENT node could be misread as "the queried
path is absent" — the sentinel's name is now bound to the queried path's
own basename, and `Trashed node not found` (never templated with a name in
any captured evidence) is accepted only for a query that itself targeted
`/trash`; (3) upload's name-conflict rejection did not require stderr to be
empty and did not bind the failure entry's `name` or the quoted name in its
error text to the file actually being uploaded — both are now required to
match the basename of the caller-supplied `localFilePath`, so identity is
never derived from provider text alone; (4) the E3J4A "test-only"
`runOperationForTests()` seam is REMOVED entirely — it was still a
production-reachable way to construct and spawn arbitrary argv; T22's
ordering proof now uses a deliberately invalid operand paired with a
mismatched hash (the hash error must appear, never the operand error,
because the operand is never inspected until after the hash gate) with no
injectable builder anywhere in the module; (5) the environment was built by
copying the entire parent environment and deleting six prompt-related keys
— still forwarding unrelated credentials/tokens, `LD_PRELOAD` (capable of
injecting code into the very binary the hash gate just verified),
`NODE_OPTIONS`, any inherited `PROTON_DRIVE_*` variable, and other ambient
secrets — replaced with a small POSITIVE allowlist (`PATH`; `HOME` and the
`XDG_*` locations; `GNUPGHOME`/`GPG_AGENT_INFO`/`PASSWORD_STORE_DIR`/
`DBUS_SESSION_BUS_ADDRESS` for an already-running credential agent;
`LANG`/`LC_ALL`/`LC_CTYPE`/`TMPDIR`); (6) operand-validation error messages
echoed the invalid value — every such error is now one fixed, locally
authored message naming only the field identity, never the value, an
imported message, or a `cause`; (7) `signal?.aborted` was checked before
`assertValidSignal()`, so a plain object like `{aborted: true}` was accepted
as a real cancellation without validation — signal validation now runs
first, unconditionally; (8) capture-stream `error` events were silently
swallowed — both streams now route through the same bounded-termination
path as timeout/overflow, yielding a new closed code
`provider_stream_failed` with no native error text; (9) `timeouts` accepted
any finite positive number (including non-integers) and did not enforce
that cancel grace stays below the operation timeout — now requires positive
safe integers and the same coherence rule `backup-cloud-config.mjs` already
enforces for the producer config, and download's local `stat` evidence is
now validated defensively (`isFile` callable and exactly `true`, `size` a
non-negative safe integer) before being trusted; (10) adversarial
re-enumeration of every returned code and thrown preflight code, confirmed
against the closed enum, confirmed frozen, confirmed leak-free, and
confirmed that no provider command beyond the fixed four can be constructed
through any export — proved directly by a closed-export-surface test.
**18 tests were added (75 → 93), full corrected suite 328/328 passing, 0
fail, no existing assertion weakened or deleted to pass.** The exit-before-
drain fake-CLI race E3J4A fixed was independently re-verified stable across
10 consecutive direct runs. Session detail: `docs/journal/2026-09.md`;
further corrected by **E3J4C** (2026-09-14, same day, a third independent
review pass) — seven findings, all fixed:

(1) **The production dependency seam was still open.** Removing E3J4A's
`runOperationForTests()` closed only the arbitrary-ARGV half. All four
production operations still accepted a caller-supplied `deps` object merged
over module defaults, able to replace `sha512File` (bypassing the real
executable hash), `spawn` (substituting the process implementation), `env`
(redirecting credential/environment state), `statSync` (fabricating local
filesystem evidence), and `maxStdoutBytes`/`maxStderrBytes` (disabling
output bounding) — all through the public call signature. The boundary
logic moved to `ops/backup/lib/internal/backup-cloud-cli-core.mjs`, whose
`makeCloudCliOperations(deps)` builds the SAME fixed four operations (no
operation name, argv builder, or command string is accepted anywhere — this
is not a renamed command/spawn seam) against a supplied dependency set.
`ops/backup/lib/backup-cloud-cli.mjs` is now a thin production API that
binds `REAL_CLI_DEPS` once at module load and exposes the same ten exports,
with four operation signatures that name no dependency at all; a `deps`
property handed to one of them is inert. Stated precisely: the production
exports accept and forward no dependency overrides; the wrapper binds only
`REAL_CLI_DEPS`; `makeCloudCliOperations()` is an explicitly internal TEST
SEAM and **not** a cryptographic or runtime access-control boundary; a
static regression fails if any other `ops/**` module imports it; and
malicious local repository code is **outside this boundary's threat
model**, since code able to add an import already has arbitrary execution.
The defended property is that an ordinary production caller cannot, through
the call signature, substitute the hash, the process, the environment, the
local evidence, or the bounds — proved by a regression per operation that
poisons all five at once and observes the real ones being used.

(2) **Upload trusted the provider summary.** This memo said `transferredBytes`
was cross-checked against a locally known file size; `projectUpload()` did no
such comparison. `runUpload()` now REQUIRES `expectedLocalSizeBytes`,
validated as a non-negative safe integer, and an actual one-file transfer
whose reported count differs is `upload_size_mismatch`, never success. That
value is **caller-supplied local evidence**: this boundary validates and
compares it, and proves nothing about whether the caller measured the correct
inode, nothing about its correspondence to `localFilePath`, and nothing about
local-file TOCTOU or filesystem immutability. The artifact contract records
`manifest.ciphertext.bytes` but no authoritative sidecar or manifest size, so
**E3J5 owes safe derivation and validation of that value for all three local
artifacts** before calling this boundary. Separately, an unexplained
`skippedItems: 1` response is no longer promoted to transport success —
without independently proven skip semantics and skipped-object identity it
fails closed as `upload_skipped_unverified`.

(3) **Download evidence was not bound to the requested destination** — see the
itemized correction under §2.3, which also retracts this memo's false claim
that E3J4 obtained the download size from an `fstat` on a descriptor the
uploader opened. `expectedLocalPath` is now the canonical immediate child of
`localDir` named by the queried remote basename, checked before any spawn; the
bound path must be proven ABSENT by a non-symlink-following `lstat` before the
command runs (`download_destination_exists` / `local_preflight_failed`
otherwise, with nothing spawned); and the post-command readback uses `lstat`
and accepts only a regular file (`local_readback_not_regular_file` for a
symlink, directory, or socket) of safe-integer size matching the provider's
count. E3J6's hard byte containment, descriptor ownership, content
verification, and race closure remain explicitly unclosed.

(4) **`Number.isInteger` was used where values can exceed 2^53-1** — a count
above `Number.MAX_SAFE_INTEGER` cannot be represented exactly by `JSON.parse`,
so comparing or echoing one compares a rounded value. `info.claimedSize` and
transfer-summary `transferredBytes` now use `Number.isSafeInteger`, with
boundary tests at `Number.MAX_SAFE_INTEGER` and immediately above it for info,
upload, and download.

(5) **T22's documented ordering was wrong**, and its final proof was described
as using an injected `buildArgv` spy that no longer exists. Both corrected —
see §11.1's restated T22 entry.

(6) **The environment claim was unbounded** — corrected in §7.2: the allowlist
bounds key NAMES, and allowlisted inherited VALUES remain
deployment-controlled inputs awaiting E3J9/E3J10 proof.

(7) **Durable-documentation hygiene** — the three E3J4/E3J4A/E3J4B journal
entries ran to 312 lines against `agent-manager-workflow.md`'s 5-10-bullet
milestone standard, and `HANDOFF.md` retold the same three defect catalogues.
Both condensed; the complete itemized correction history lives here, in this
memo, which is its one authoritative home.

Self-review before checkpointing found one further defect in the same
download-evidence path, fixed in place as part of this stage:
`validateLocalStat()` read `stat.size` three times (twice to validate, once to
return), so an accessor that throws escaped the function with its native
message intact, and a stateful accessor could report a valid size during
validation and a different value on the way out. Both `isFile()` and `size`
are now observed exactly once, each inside its own `try`, with every later
check and the returned value using the captured local.

**26 tests were added (93 → 119), full corrected suite 354/354 passing, 0
fail, no existing assertion weakened or deleted to pass.** Session detail:
`docs/journal/2026-09.md`; further corrected by **E3J5** (2026-09-16) — the
single-attempt upload orchestration now exists as a local library
(`ops/backup/lib/backup-cloud-upload.mjs` over
`internal/backup-cloud-upload-core.mjs`), and four design points are corrected
here rather than papered over in code:

(1) **Remote layout flattened** to `<remoteRoot>/<artifactBase>.<attemptId>/`
(§4.2, §8.1). The E3J3 nesting needed a shared `<artifactBase>` folder that
some attempt must create and later attempts must reuse — unretirable after an
indeterminate create, racing on unevidenced duplicate-create semantics, and
forcing absence queries under a parent that might not exist. Each attempt now
creates exactly one folder beneath a pre-provisioned root. `remote.root`
itself remains **U14**, and this layout still needs operator ratification
under U14.

(2) **§8.2's preflight order was wrong** and is rewritten in place: the three
object paths cannot be meaningfully checked before the attempt folder exists,
because the not-found sentinel was only ever captured for a path whose parent
existed. The namespace collision check still precedes the namespace-folder
write, and all three object collision checks still precede any artifact
upload — but folder creation and confirmation now come between them.

(3) **T11 and T18 are split / deferred** (§11.1, §12): E3J5 proves the
non-verified in-memory outcome; E3J6 proves the attestation is actually
written. Bounded automatic retry (§4.5, T18) is deferred until the attestation
writer exists, because every attempt must have its own attestation.

(4) **Lock and retry configuration are RESERVED** (§10.2): `run.lockFile` and
`retry.*` are validated but consumed by no code. E3J5 has no entrypoint and
takes no lock; the lock belongs to the first entrypoint session and must span
upload, readback, and attestation write.

E3J5's outcome is **evidence, not a verdict**: `verification:
'not_performed'`, no `verdict` field, `transferState` only
`definitely_zero | unknown` (a boundary-reported upload success is still
`unknown` until readback), and call-evidence fields
(`providerBoundaryCallMade`, `writeBoundaryCallMade`, `boundaryCalls`) that
record which public E3J4 operations were called — never that a child was
spawned, a provider was contacted, or a remote write was attempted. E3J6
consumes that evidence, performs readback, and derives its verdict
independently. **56 new tests plus 3 new naming tests (three existing naming
path-shape assertions deliberately updated to the new layout), full suite
413/413 passing.** Session detail: `docs/journal/2026-09.md`; further corrected
by **E3J6A** (2026-09-16, the first of three E3J6 substeps A/B/C; working
tree, unstaged) — boundary extensions only, with no readback workflow,
attestation, lock, or retry:

(1) **Contained download; uncontained route removed.** `runDownload` is gone
from `backup-cloud-cli.mjs` and from the core factory (11 public exports). The
only download is `runContainedDownload`: CLI hash gate, then a hash gate for
the pinned `readback.rlimitWrapper`, then
`<wrapper> --fsize=C:C -- <cli> filesystem download --json …` with **C the exact
configured per-role ceiling** (never C + 1). A SIGXFSZ close is
`download_containment_tripped` (supporting evidence only — a Node child under
`prlimit` exits with EFBIG and no signal); a clean report of a file larger
than C is `download_containment_violated`; a clean report of exactly C is still
success. **Ceilings are inclusive** — see (4).

(2) **Termination evidence — confirmed only by `close`.** When this boundary
kills a child (timeout, cancellation, overflow, stream failure, or a started
child that emitted `error`), only a `close` event inside the bounded grace
period confirms the end; otherwise every operation returns
`provider_termination_unconfirmed`. **[Corrected in place during E3J6A
review]** The first version delegated to the shared producer helper
`cancelChild()`, which returns `exited` at once when `exitCode`/`signalCode`
is already set — even though `close` (stdio closure) may not have happened
and a descendant may still hold and write to the pipe. The cloud boundary now
uses its own `terminateAwaitingClose()` (same SIGTERM, SIGKILL at half the
grace, same bounded wait) that resolves confirmed only on an observed
`close`; `cancelChild()` and the producer are unchanged. A never-started
child (no pid) is still an immediate spawn failure. Descendants are not
killed as a group.

(3) **Fixed-purpose containment canary** (`backup-cloud-containment.mjs` over
`makeContainmentCanary()` in the CLI core, beside the private bounded spawn —
no generic runner exists). `proveReadbackContainment({config, runId, signal})`
itself establishes that `readback.dir` is an existing, non-symlink directory
owned by the effective uid with no group/world bits and a canonical real
path, re-checking its `{dev, ino}` before every create/remove. It creates
exactly `<readback.dir>/<runId>.containment-canary/probe.bin` (EEXIST refuses),
runs `<wrapper> --fsize=L:L -- <node> --input-type=commonjs -e <module
script> <probe> <L+65536>` with an **empty environment**, capped output, and
the run timeouts (L = the smallest ceiling), and passes only if termination is
confirmed, the writer did not report a clean complete write, the probe is
**exactly** L bytes, and both canary paths were then removed after identity
checks. Unconfirmed termination touches nothing. `quota_mount` is refused
(`containment_unsupported`). **[Corrected in place during E3J6A review]** A
validator-accepted configuration whose smallest ceiling makes `L + 65536` an
unsafe integer, or whose paths the argv operand rules refuse (a segment
beginning with `-`), no longer throws `cloud_cli_argv_invalid` through the
public API: both are decided before anything is created and return
`containment_unproven` with `cleanup: 'not_started'`, spawning nothing. The
exact `--fsize=L:L` and the representable write beyond L are never relaxed. A proof is a frozen object registered in a
factory-private WeakMap and bound to run id, directory identity, mechanism,
wrapper path and pin, all three ceilings, and L; `verifyContainmentProof()`
(E3J6B's validation route) accepts only that object while the binding still
matches the configuration and the directory's current identity. The local
`/usr/bin/prlimit` enforced L on disposable Node probes in the suite — **not**
evidence about the Proton CLI, larger limits, CLI descendants, or Hotel-Echo.

(4) **One-shot prepare/execute and pre-upload source evidence.**
`prepareUploadAttempt()` is local-only: after the E3J5 checks it enforces
inclusive ceilings (`bytes <= ceiling`, else `local_exceeds_readback_ceiling`,
before any content read), then re-opens each role `O_RDONLY|O_NOFOLLOW|O_NONBLOCK`
(`internal/backup-cloud-source-evidence.mjs`), brackets the read with `fstat`
identity checks, and records SHA-256 and exact bytes for all three roles.
The captured manifest/sidecar bytes are validated with closed outcomes only
(`local_manifest_identity_invalid`: schema, artifact name, `snapshot_ts`
compacting to the stamp, `run_id` shape, ciphertext hash/size, and the sidecar
being exactly the producer's line). No completion-failure or JSON-parse text is
read. It returns a frozen `ready` object (with `sourceEvidence`) or `refused`
object (identity and paths kept, `sourceEvidence: null` — partial evidence
never escapes). `executeUploadAttempt()` consumes a genuine object
synchronously before its first `await`; reuse, concurrency, forgery, or a
foreign runner fails locally with no boundary call. The outcome is **v2**
(adds `sourceEvidence`). This does **not** close the CLI's path-based upload
TOCTOU: an in-place same-size rewrite within timestamp granularity is
invisible to identity checks and is left to E3J6B's readback comparison.

(5) **Recorded for E3J6B, not implemented:** every attempt that has an
identity — including a local refusal — must eventually have an intent record,
so partial or failed attestations reconcile uniformly; and an attestation may
record cleanup *policy/disposition* but can never claim cleanup succeeded,
because cleanup happens only after the attestation is durable.

**82 new tests (73 plus 9 from the in-place review corrections); full suite
495/495, 0 skipped** (cli 141, containment 37, upload 73, config 36, naming
24; the real-`prlimit` cases ran). Every correction regression was shown to
fail against the pre-correction code (6 failures) before the fix. Deliberately updated assertions: the CLI export
set (10 → 11), download tests moved to the contained route, the E3J5 outcome
key set and version (v1 → v2), `REAL_UPLOAD_DEPS` gaining `evidence`, the
upload export set, config fixtures gaining `rlimitWrapper`, and the CLI core's
importer allowlist. Session detail: `docs/journal/2026-09.md`; further
corrected by **E3J6B** (2026-09-17, the second of three E3J6 substeps) — the
readback, the independent verdict, and the durable intent/attestation records
now exist, split across four audit boundaries with no lock, retry, or
entrypoint (all E3J6C):

(1) **§9 is REPLACED IN PLACE** with the schemas the code actually writes
(`schema_version: 1` for both records — the prior §9 was an E3J1 illustration
that was never implemented). Seven of its fields are gone, each for a stated
reason (§9.4): `source_host`, the provider-claimed observations, an observed
CLI hash the boundary never exposes, the `--version`-derived fields,
`completion_failures`, `timings_ms`, and `written_at`.

(2) **Two opaque, factory-scoped session capabilities.** A `RecordSession`
binds `attestation.dir`'s `dev`/`ino`/`uid`/`mode` AND the exact
`artifactBase`/`attemptId` once, and authorizes BOTH record writes, revalidating
the directory before every creation, before the directory fsync (by `fstat` on
the descriptor, before the fsync, not after), before every readback, and as
each operation's final step. A `ReadbackSession` binds `readback.dir` once and
carries capacity, workspace/role identities, the expected filenames, the
downloaded files' identities, and the termination flag as PRIVATE state:
`cleanupAttemptWorkspace({session})` takes nothing else, so no caller can
forge an inode or claim termination was confirmed.

(3) **Every attempt identity is consumed exactly once.** A locally refused
preparation is consumed through `executeUploadAttempt()` (zero provider calls
by construction); a ready one blocked by a trust, intent, proof, capacity, or
workspace failure is released by the new
`discardPreparedUploadAttempt()` — synchronous, no clock dependency, mutually
exclusive with execute through the same registry-entry flip.

(4) **`intent_record` is a cryptographic binding.** The attestation's
`intent_record.sha256`/`bytes` come from re-opening and revalidating the exact
intent bytes under the same session immediately before the payload is built;
a lost, changed, or never-confirmed intent forces `indeterminate` and lock
retention, and can never be supplied by a caller.

(5) **Readback is manifest → checksum → ciphertext**, one contained download
per role into its own authenticated directory, each role independently
re-hashed through a no-follow descriptor and compared against `sourceEvidence`
BEFORE its bytes are parsed. `verifyArtifactCompletion()` runs only after all
three match, through a bounded in-memory adapter with zero extra filesystem
I/O; because the bytes are by then proven identical to an already-complete
source, a completion failure is an internal contradiction
(`completion_adapter_internal_contradiction`, indeterminate), never a
conclusive artifact rejection. `credential_unavailable` and
`download_size_mismatch` at readback are indeterminate;
`remote_object_absent` and an independently measured role hash/size mismatch
are rejections.

(6) **Capacity fails closed with BigInt arithmetic** over
available-to-unprivileged blocks, distinguishing `capacity_unprovable` from
`capacity_insufficient`; a configured `backingVolume` must lexically contain
`readback.dir` AND share its device, or the whole check is unprovable — it is
never silently ignored.

**101 new tests (naming 4, upload 6, records 23, readback 27, verdict 19,
attempt 22); full suite 596/596, 0 fail, 0 skipped** — [corrected
2026-09-18: first recorded as "98 new … 593/593", an addition slip; the
listed parts sum to 101 and 495 + 101 = 596.] Eleven of twelve
targeted mutations were caught; the twelfth is an equivalent mutant (three
overlapping symlink guards on the reader — removing all three IS caught).
Deliberately updated assertion: the upload module's closed export set gains
`discardPreparedUploadAttempt` (no pre-existing behavioural assertion was
removed or weakened). E3J6C still owes the lock, retry (T18), signal
ownership, and the executable entrypoint. Session detail:
`docs/journal/2026-09.md`.

(7) **E3J6B review corrections (2026-09-18, still uncommitted).** An
independent review reported 9/4/1 failures in the CLI/upload/attempt files.
Root cause: that run executed inside the Codex bubblewrap/seccomp sandbox,
where a Node child writing to a Node-created stdio pipe loses its
`process.stdout` output; committed `70abb63` (no E3J6B code) fails the SAME
9 CLI and 4 upload tests there, and 23/31 lifecycle tests. It is an
environment limitation, not a regression; no existing test or fake was
changed for it, and outside that sandbox every file passes. The review's
design findings were corrected in place: (a) both session registries are
created INSIDE their factory — a session from another instance, however
identical, is `record_session_invalid`; (b) the readback session SEALS its
operational authority at `establishReadbackSession({config, artifactBase,
attemptId, sourceEvidence})` — CLI and hash pin, credential backend,
timeouts, the three canonical remote paths (derived via
`buildPublishedObjectPaths()`), and a validated private copy of the source
evidence within the role ceilings; `readBackAttemptTriple({session, signal})`
reads nothing else (this does not close E3J4's executable TOCTOU or add
containment beyond E3J6A); (c) `runAttestedAttempt()` is total after
`prepare`: classified errors keep their stage's closed code, anything else is
`internal`/`internal_invariant_violated` with no message, stack, or path, an
exception while a child may be alive records termination `unconfirmed`, and
the prepared object is consumed exactly once on every path; (d) workspace and
role directories are tracked the moment each is authenticated, so a partial
setup failure is attested first and then cleaned exactly — an object created
but not authenticated, or a replacement, is never deleted; (e) the report is
copied from the EFFECTIVE attestation `writeAttemptAttestation()` returns and
never claims `verified` without one; (f) intent failures keep their closed
codes (`cloud_intent_create_failed`, `…_durability_unconfirmed`,
`…_schema_invalid`, `attestation_dir_untrusted`; a later loss is
`intent_record_lost`); (g) §9.3's closed vocabularies and cross-field
invariants are now enforced by membership, and `future_lock_advice` is
derived; (h) an intent re-read whose close fails or whose directory changes
is not confirmed, readers sanitize every descriptor failure and re-verify the
directory after reading, and cleanup re-observes a downloaded file's complete
identity (regular, non-symlink, dev/ino, owner, mode, size) before unlinking;
(i) an upload child with unconfirmed termination now stops the attempt before
readback. The report gains `role` and `termination`; `CLOUD_ATTEMPT_STAGES`
gains the report-only `attestation` stage. **142 E3J6B tests; full suite
637/637, 0 fail, 0 skipped**, stable over five runs of the subprocess files.
**Status:**
**DESIGN AND ANALYSIS FOR CLOUD TRANSPORT AND ATTESTATION — NOT ACTIVATED.**
The **E3J2** shared artifact-contract extraction (§1.3, §12, §13), the
**E3J3** naming/remote-path/cloud-config surface (§1.3, §4, §8.1, §10, §12,
as corrected by **E3J3B**), the **E3J4** subprocess boundary (§2, §6-8,
§10-12, as corrected by **E3J4A**, **E3J4B**, and **E3J4C** after three
independent security review passes), and the **E3J5** single-attempt upload
orchestration (§4, §8, §11-12, with the layout change above), and the
**E3J6A** boundary extensions (contained download, termination evidence,
containment canary, one-shot preparation with source evidence) are implemented
locally and are either behaviour-preserving, additive-only, or a narrowly
scoped new local boundary; all four are local repository code with no
provider, host, or credential access of their own — pure naming/path helpers,
a fail-closed configuration validator, a subprocess boundary, and an
orchestration library, exercised only against disposable local fakes, never
the real Proton Drive binary, and called by no executable entrypoint. The raw provider-response shapes it validates against
(info/create-folder success, download's terminal summary) remain
acknowledged design hypotheses, not verified real-CLI compatibility — see
E3J4A's correction 4, restated in E3J4B's own correction list. The
post-hash executable-replacement TOCTOU gap remains explicitly unclosed, as
do local-file TOCTOU around upload's local source files (E3J5 now derives
`expectedLocalSizeBytes` safely and re-observes file identity, which DETECTS
some replacements but does not close the window — a same-size replacement is
only caught by E3J6 readback) and the gap between download's pre-spawn
absence check and its readback (E3J6).
Everything else this memo
designs — retry, lock ownership, an entrypoint, readback, attestation,
monitoring, credential handling, deployment, scheduling, retention, and
restore work — remains unimplemented and unactivated.
**NOTHING BEYOND THOSE LOCAL SESSIONS IS APPROVED FOR ACTIVATION.**

This memo defines the proposed architecture for the component that pushes
producer-generated backup artifacts from Hotel-Echo to Proton Drive through the
official Proton Drive CLI, and for the **cloud attestation** record that
source-side freshness monitoring would later consume. The E3J1 design session
that authored this memo wrote no code, changed no configuration, contacted no
provider, touched no host, and closed no E3 item. Its prerequisite extraction,
**E3J2**, the naming/config session that followed it, **E3J3** (corrected
same-day by **E3J3B** after independent review), and the subprocess-boundary
session that followed that, **E3J4** (corrected same-day by **E3J4A**,
**E3J4B**, and **E3J4C**), and the orchestration session after it, **E3J5**,
were all carried out afterward in separate local sessions (§12, §13). Their combined footprint is
local repository code and documentation only: `ops/backup/lib/` (including
`ops/backup/lib/*.test.mjs`, `ops/backup/lib/internal/`, and
`ops/backup/lib/testdoubles/`),
`ops/backup/*.example.json`,
`ops/backup/run-suite.mjs` (registering the new test files), and this memo,
`HANDOFF.md`, and the dated journal — no provider, host, credential, or
activation action. **E3 remains unactivated.**

---

## 0. Provenance, scope, and what this memo is not

**Provenance.** An earlier, informal architecture pass on this subject exists
only as a conversation. **It was never committed to this repository, is not a
repository document, and is not cited anywhere below.** This memo is a fresh
analysis performed against the repository at
`b9197f19dea443b3a0ffa7a2227f8ed1bccb0632`, with every load-bearing claim
verified by reading the cited file. Where the brief that commissioned this work
named a symbol or a threshold imprecisely, the correction is stated inline and
marked **[CORRECTION]** rather than silently matched.

**Did:** read `ops/backup/lib/backup-producer.mjs`,
`ops/backup/lib/backup-acceptance.mjs`,
`ops/backup/lib/backup-acceptance-config.mjs`,
`ops/backup/lib/backup-config.mjs`, `ops/backup/lib/backup-boundaries.mjs`,
`ops/backup/eanhl-backup.mjs`, `ops/backup/eanhl-backup.example.json`,
`ops/backup/eanhl-backup-accept.example.json`, the five test files under
`ops/backup/lib/`, `docs/operations/backup-producer.md`,
`docs/operations/backup-acceptance.md`,
`docs/planning/proton-drive-transport-feasibility.md`,
`docs/planning/proton-drive-scratch-experiment.md`, and the E1/E3 lineage in
`HANDOFF.md`; ran the repository's own local unit suite
(`node ops/backup/run-suite.mjs`, wired as `pnpm test:backup-producer`) to
confirm current behaviour — **179/179 pass, 0 fail** (config 17, producer 66,
boundaries 9, acceptance 56, lifecycle 31).

**Did not, and was not authorized to:** run any Proton Drive CLI command,
authenticate, contact Proton, read or change any Proton account or plan state,
touch Hotel-Echo or the main PC's Proton/credential state, run `pass`, `gpg`,
`apt`, Docker, or any database command, generate or handle key material,
deploy, schedule, prune, delete, reopen the tunnel, or change any code, test,
configuration, example JSON, dependency, or Gate checkbox.

**This memo does not:** select production numeric values; claim that monitoring,
alerting, or the shared-contract extraction exists; claim any Proton behaviour
beyond what `proton-drive-scratch-experiment.md` records; or authorize the
implementation sessions it proposes.

**Evidence tags** follow the convention already used in
`proton-drive-transport-feasibility.md` §3: **[REPO]** verifiable in this
repository at `b9197f1`; **[E3I]** observed in the recorded scratch experiment;
**[OFFICIAL]** Proton documentation as recorded by E3B2/E3E; **[INFER]** a
conclusion drawn here; **[UNKNOWN]** not settled by any of the above.

---

## 1. The shared artifact contract — a third consumer, and where the contract should live

### 1.1 The duplication that already exists

The uploader would be the **third** component that has to know how an artifact
is named, how its sidecar is spelled, and what "complete" means. That is not a
hypothetical: the knowledge is already spread across three places today.
**[REPO]**

| Fact | Producer | Acceptor | Uploader (proposed) |
| --- | --- | --- | --- |
| `MANIFEST_SCHEMA_VERSION = 1` | imported from `backup-config.mjs:37` (`backup-producer.mjs:50`) | imported from `backup-config.mjs` (`backup-acceptance.mjs:69`) | would import it too |
| the three suffixes `.dump.age` / `.dump.age.sha256` / `.manifest.json` | spelled in `buildArtifactNames()` (`backup-producer.mjs:90-99`) **and again** in `verifyArtifactCompletion()` (`backup-producer.mjs:227-231`) | spelled a third time in `ROLE_SUFFIX` (`backup-acceptance.mjs:83-87`) and consumed by `artifactFileNames()` / `parseArtifactEntryName()` | would need a fourth |
| stamp format `YYYYMMDDTHHMMSSZ` | produced by `formatSnapshotStamp()` (`backup-producer.mjs:78-87`) | re-validated by the `STAMP` regex (`backup-acceptance.mjs:90`) **and** by calling the producer's `formatSnapshotStamp()` (`backup-acceptance.mjs:214`) | would validate remote path components |
| sidecar text | `formatChecksumSidecar()` / `parseChecksumSidecar()` (`backup-producer.mjs:145-162`) | reached only indirectly, through `verifyArtifactCompletion()` | would parse a readback sidecar |
| completion | `verifyArtifactCompletion()` (`backup-producer.mjs:226-288`) | **imports it verbatim** (`backup-acceptance.mjs:70`) | would import it too |

**[CORRECTION]** The brief suggested `MANIFEST_SCHEMA_VERSION` lives with the
producer. It does not: it is exported from `ops/backup/lib/backup-config.mjs:37`
and imported by both the producer and the acceptor. The brief also hedged on
the name `verifyArtifactCompletion()`; that name is exact
(`backup-producer.mjs:226`).

Note what the acceptor's import line actually implies: **the destination-side
component already depends on a module named "producer"**
(`import { checkCapacity, formatSnapshotStamp, verifyArtifactCompletion } from './backup-producer.mjs'`,
`backup-acceptance.mjs:70`). That is deliberate — `backup-acceptance.mjs:36`
says the reuse is what makes "complete" mean the same thing at both ends — but
the module *name* has already stopped describing the module's *audience*.

### 1.2 Option (a): the uploader imports from `backup-producer.mjs`

**In favour.** Zero refactor risk. It matches what the acceptor already does, so
it introduces no new pattern. It keeps E3J2 out of the diff entirely.

**Against.** Four concrete costs, all **[INFER]** from the code above:

1. The uploader would import a module whose top-level docblock describes a
   component that "turns the live PostgreSQL database into exactly one artifact
   triple" (`backup-producer.mjs:5-13`). The uploader does none of that, and a
   reader tracing an import would have to discover by hand that only four pure
   functions were wanted.
2. `backup-producer.mjs` is 1,701 lines and owns process spawning through
   injected `deps`, a run lock, a snapshot transaction, and a teardown protocol.
   Importing it drags that whole module into the uploader's dependency graph for
   the sake of five helpers.
3. The suffix strings would be spelled a **fourth** time unless the uploader
   also derives its remote object names from `buildArtifactNames()` — and
   `buildArtifactNames()` returns a `plaintext` name (`backup-producer.mjs:97`)
   that must *never* appear in a remote path. A shared module can expose a
   published-triple accessor that structurally cannot hand back the plaintext
   name; an import of the producer's helper cannot.
4. The existing duplication would be locked in at three sites rather than
   reduced, so the next component (the freshness evaluator, the pruner, the
   re-hash sweep — all still unbuilt, `backup-acceptance.md` §7) pays the same
   cost again.

### 1.3 Option (b): a separately-scoped, behaviour-preserving extraction first

Move the shared artifact-contract surface into a new neutral module —
**proposed name `ops/backup/lib/backup-artifact-contract.mjs`** — with
`backup-producer.mjs` and `backup-acceptance.mjs` re-exporting or importing from
it, in a session that adds **no new behaviour at all**.

Proposed contents of the extracted module (E3J2 scope — behaviour-preserving
only; no new exported function):

- **`BackupError`** — moved from `backup-producer.mjs`. **[REPO]** Resolution,
  not an open choice: `backup-producer.mjs` currently defines the class and
  throws it from 39 call sites (`grep -c 'new BackupError('`); exactly two of
  those are the contract functions moved here (`formatSnapshotStamp()`,
  `parseChecksumSidecar()`), and the remaining 37 are producer-internal
  (process spawning, the run lock, the encryption boundary, the snapshot
  transaction) and stay in `backup-producer.mjs`. Because line 1154's call to
  `formatSnapshotStamp()` sits inside the producer's own run flow and a
  resulting `BackupError` propagates to `eanhl-backup.mjs`'s
  `err instanceof BackupError` checks (`eanhl-backup.mjs:199,201`), class
  identity must be exactly preserved — a same-named class defined twice would
  fail that check. The fix: `backup-artifact-contract.mjs` defines the class;
  `backup-producer.mjs` adds `import { BackupError } from
  './backup-artifact-contract.mjs'` for its own 37 call sites and separately
  `export { BackupError }` so `eanhl-backup.mjs`'s existing
  `import { BackupError } from './lib/backup-producer.mjs'` keeps resolving to
  the same class object. No error code, message, or `instanceof` behaviour
  changes anywhere.
- `MANIFEST_SCHEMA_VERSION` (moved from `backup-config.mjs`, re-exported there
  for compatibility with any existing importer);
- `ARTIFACT_SUFFIXES` — the single spelling of the three published suffixes,
  consumed by `buildArtifactNames()`, `verifyArtifactCompletion()` and the
  acceptor's `ROLE_SUFFIX`. Centralizing `ROLE_SUFFIX`'s and
  `verifyArtifactCompletion()`'s hardcoded suffix literals onto this one
  constant is in scope for E3J2 only because the values are byte-identical to
  what each hardcodes today (`.dump.age` / `.dump.age.sha256` /
  `.manifest.json`), so no accepted or rejected input and no output changes;
- `buildArtifactNames()`, moved unchanged — still returns the `plaintext` key;
  no new function is added in E3J2;
- `formatSnapshotStamp()` and the acceptor's `STAMP` regex (`backup-acceptance.mjs:90`,
  currently module-private), moved as an exported constant the acceptor then
  imports instead of redefining — same regex, same behaviour;
- `formatChecksumSidecar()` / `parseChecksumSidecar()`;
- `verifyArtifactCompletion()`.

**Explicitly deferred to E3J3, not part of E3J2:** `publishedTripleNames(base)`
(the plaintext-excluding accessor floated in §1.2 point 3 and §1.4 point 2) and
any other new uploader-oriented helper or API. E3J2 introduces zero new
exported functions — every symbol above already exists today in one of the
three current modules; only its module of residence changes, plus, for the
suffix and stamp literals, the collapse of an identical duplicate definition
onto one constant.

**[IMPLEMENTED BY E3J3, 2026-09-13].** `publishedTripleNames(base)` now
exists in `backup-artifact-contract.mjs`, returning exactly the three
published roles (`ciphertext`, `checksum`, `manifest`) with no key that could
carry the plaintext name — the structural guarantee §1.4 point 2 asked for.
`ARTIFACT_PREFIX_PATTERN` was additionally centralized onto this module from
the identical literal `backup-config.mjs` and `backup-acceptance-config.mjs`
each carried separately, with no accepted or rejected input change at either
site. Neither addition touches a provider, a host, or a credential; both are
pure functions/constants covered by
`backup-artifact-contract.test.mjs`.

**[CORRECTED BY E3J3B, 2026-09-13].** The first E3J3 implementation let
`backup-cloud-naming.mjs`'s `buildPublishedObjectPaths()` accept any
ordinary-safe-looking string as an `artifactBase` — `"not-a-stamped-artifact"`
passed, because ordinary-component safety (no `..`, no separator) is a
weaker property than "this is actually a `<prefix>-<stamp>` identity." New
`assertValidArtifactBase()` in `backup-cloud-naming.mjs` closes that gap: it
requires the exact shape `<artifactPrefix>-<YYYYMMDDTHHMMSSZ>`, the prefix
checked against `ARTIFACT_PREFIX_PATTERN` and the stamp against
`SNAPSHOT_STAMP_PATTERN` (both from this module), correctly handling a
prefix that itself ends in a hyphen (permitted by `ARTIFACT_PREFIX_PATTERN`,
which produces a base like `eanhl--20260904T180007Z`). `buildAttemptNamespace()`,
`buildPublishedObjectPaths()`, and `buildAttestationFileName()` all now call
it, in addition to (not instead of) the existing ordinary-component check.
Separately, `formatAttemptId()` now validates its own constructed result
before returning it, so an injected `randomToken` double that returns
anything other than exactly eight lowercase hex characters — a path-
traversal shape, uppercase, wrong length — is rejected rather than silently
producing a malformed `attemptId`. Neither change touches
`backup-producer.mjs`'s own `runId` construction, which this correction does
not import from, export to, or modify.

**Dependency implications.** `backup-artifact-contract.mjs` would import
nothing from `backup-producer.mjs`, `backup-acceptance.mjs` or
`backup-boundaries.mjs`; it would take its filesystem and hashing access through
the same injected `deps` bundle those modules already use
(`makeRealDeps()`, `backup-boundaries.mjs:997-1049`). The dependency graph
becomes producer → contract, acceptor → contract, uploader → contract for the
artifact-contract surface specifically. Today that surface's edge is
acceptor → producer.

**[CORRECTED BY E3J2]** The paragraph above, as originally written, claimed
this would leave "no edge between the three consumers." That is too broad.
`backup-acceptance.mjs` also imports `checkCapacity()` from
`backup-producer.mjs` (`backup-acceptance.mjs:1179,1442`), and `checkCapacity()`
is not part of the artifact contract — it was never proposed for extraction in
the list above, and E3J2 does not move it (§12, §13). So after E3J2 the
acceptor → producer edge is narrowed, not eliminated: the artifact-contract
dependency it carried is gone, but the pre-existing, unrelated
`checkCapacity()` dependency remains. The corrected graph is producer →
contract, acceptor → contract, acceptor → producer (`checkCapacity()` only),
uploader → contract (once E3J3 exists).

**Regression-test implications.** The extraction is covered by the suite that
exists, and that is the reason to do it *before* the uploader rather than
alongside it:

- `backup-producer.test.mjs` already pins the exact behaviours being moved —
  `'the snapshot stamp is the UTC snapshot instant, compacted'` (line 281),
  `'artifact names all derive from one identity'` (line 290), and
  `'checksum sidecars round-trip and reject anything else'` (line 326);
- `backup-acceptance.test.mjs` pins the acceptor's side — `'a path component is
  rejected unless it is one ordinary name'` (line 328), `'inbox entry names are
  classified only when they are exactly an artifact file'` (line 340), `'the
  archive year comes from a validated stamp, never from free text'` (line 430);
- the whole-pipeline behaviour is pinned by `backup-lifecycle.test.mjs`
  (31 tests) and by the acceptance tests that drive a full sweep;
- the acceptance criterion for the extraction session is therefore mechanical:
  **179/179 still pass, with no test file edited except to change import paths,
  and no assertion text changed.** If any assertion has to be weakened, the
  extraction is not behaviour-preserving and must be reverted.

### 1.4 Recommendation

**Recommend option (b): perform the extraction as its own session, before any
uploader code is written.** Three reasons, in order of weight:

1. It is the only variant whose correctness is provable by a test suite that
   already exists and already passes. Doing it *with* the uploader means a diff
   in which a moved function and a new caller cannot be distinguished by the
   suite, so a subtle change to `verifyArtifactCompletion()` would be masked by
   new uploader tests written against the changed behaviour.
2. It removes the fourth spelling of the suffixes before it is created, and it
   lets the uploader be handed a published-triple accessor that cannot name the
   plaintext dump — a structural guarantee that the plaintext can never reach a
   remote path construction. Given `backup-producer.md` §6.3's record that the
   plaintext exists on disk at all, that guarantee is worth having in the type
   of the function rather than in a reviewer's attention.
3. It keeps two later components (freshness evaluator, pruner) from repeating
   this analysis.

**This memo does not perform the extraction.** It is proposed as session
**E3J2** in §12.

---

## 2. Raw and parsed CLI output must both stay inside the subprocess boundary

### 2.1 The failure being designed against

Redacting stdout and stderr while returning the parsed JSON object is not
containment — it is containment of the *rendering* of the data while the data
itself is handed to the caller. The parsed object carries exactly the fields
redaction exists to suppress, and any later `JSON.stringify` of a result, an
error, a log line, or an attestation re-emits them. E3I1 already had to build an
ad-hoc redaction filter for this reason and record it as a control
(`proton-drive-scratch-experiment.md` §6), and E3I1 §1.2 records a real
secret-handling incident in the same session. **[E3I]**

### 2.2 The rule

Five invariants, all enforced at one module boundary:

1. **Raw stdout and stderr never leave the subprocess module.** They are held in
   local variables, consumed by the parser, and dropped. No accessor exposes
   them — unlike `makeSnapshotSession()`'s `get stderr()`
   (`backup-boundaries.mjs:317-319`), which is acceptable for a local
   psql session and is not acceptable for a provider client.
2. **The raw parsed JSON object never leaves either.** Parsing produces a
   candidate; the candidate is validated and projected; the candidate is
   dropped. There is no code path on which the candidate is returned, thrown,
   logged, or stored.
3. **Every operation validates its expected response shape before projecting.**
   A response that does not match is not "mostly fine" — see invariant 5.
4. **Only an explicit allowlist of required fields is returned**, each with a
   declared type and a declared trust level.
5. **Anything unexpected yields `indeterminate`, never success.** Missing field,
   wrong type, extra unknown top-level key, unparseable output, non-zero exit
   with unrecognised text: all are `indeterminate` unless a narrowly anchored
   pattern proves the transfer was definitely zero-byte (§8.6).

**Error-text sanitisation.** Provider stderr is never interpolated into a
message, an exception, a log line, or an attestation. It is matched against a
small closed set of anchored patterns and mapped to a **closed enum of codes**,
in the spirit of the producer's existing `BackupError.code` discipline
(`backup-producer.mjs:53-60`, `docs/operations/backup-producer.md` §2.9). Text
that matches nothing maps to `provider_error_unrecognised` **with no text
attached at all**. The uploader's own locally-authored message may name the
code, the operation, and the locally-constructed path — nothing else.

**What must not escape, through strings or through structured JSON:** account
identifiers, e-mail addresses, tokens, session material, credentials,
passwords, passphrases, cookies, recovery material, and authentication URLs.
E3I1 §1.2 is the reason authentication URLs are named explicitly: the one-time
login handshake URL is session material and is the exact thing a helpful error
message would quote. **[E3I]**

### 2.3 Allowlisted result types, field by field

Types below are the **complete** returned surface. `trusted` marks whether the
value may influence a decision; `untrusted` values are recordable observations
only (§9) and may never affect a verdict.

**`info` (exact path, `filesystem info <path> --json`)**

| Field | Type | Trust | Source |
| --- | --- | --- | --- |
| `present` | `true \| false` | trusted | `false` only from the anchored not-found sentinel (§8.6); anything else → indeterminate |
| `nodeKind` | `'file' \| 'folder'` | trusted | provider, validated against the closed enum |
| `nodeUid` | `string`, `^[A-Za-z0-9_~-]{1,256}$` | trusted as an **opaque handle only** | provider |
| `state` | `'active' \| 'trashed'` | trusted | provider, closed enum; any other value → indeterminate |
| `activeRevisionUid` | `string \| null`, same charset | trusted as an opaque handle | provider |
| `claimedSizeBytes` | `number \| null` | **untrusted** | provider `claimedSize` |
| `claimedSha1` | `string \| null`, `^[0-9a-f]{40}$` | **untrusted** | provider `claimedDigests.sha1` |
| `sha1Verified` | `boolean \| null` | **untrusted** | provider; observed `false` in E3I1 §7.1 **[E3I]** |

**`create-folder`**

| Field | Type | Trust |
| --- | --- | --- |
| `created` | `true` | trusted |
| `folderUid` | `string`, opaque-handle charset | trusted as an opaque handle |

There is no `false` for `created`: a create that did not clearly succeed is
indeterminate.

**`upload` (one local file, one remote parent, one invocation)**

| Field | Type | Trust |
| --- | --- | --- |
| `transferredItems` | `0 \| 1` | trusted |
| `transferredBytes` | non-negative **safe** integer | **untrusted** — on a one-file transfer it must equal the caller-supplied `expectedLocalSizeBytes`, else `upload_size_mismatch` **[E3J4C]** |
| `skippedItems` | `0 \| 1` | **untrusted** — `skippedItems: 1` is never promoted to transport success; it is `upload_skipped_unverified` **[E3J4C]** |
| `failedItems` | `0 \| 1` | trusted |
| `failureCodes` | `string[]` drawn from the closed enum | trusted |

The terminal summary shape `{transferredItems, transferredBytes, skippedItems,
failedItems, failures[]}` is what E3I1 §7.2 recorded. **[E3I]** `failures[]`
carries provider text and is therefore **consumed and discarded**; only the
mapped codes survive.

**`download` (one remote path, one local destination, one invocation)**

| Field | Type | Trust |
| --- | --- | --- |
| `localPath` | `string` | trusted — it is the BOUND destination (see below), never parsed from provider output |
| `bytesWritten` | non-negative **safe** integer | trusted only as far as a local `lstat` of that bound path goes — see the correction below |
| `completed` | `true` | trusted |

**The `download` result deliberately carries no provider-derived field.** Its
only job is to say that a local file now exists; everything that matters about
that file is computed locally afterwards.

**[CORRECTION, E3J4C, 2026-09-14]** An earlier revision of the row above
claimed `bytesWritten` is "obtained from a local `fstat` on the descriptor the
uploader opened". **That was false.** E3J4 opened no descriptor and performed
no `fstat`; it called `fs.statSync()` on a caller-supplied `expectedLocalPath`
that could be any canonical local path at all. The guarantee actually
implemented, as of E3J4C, is weaker and is stated here exactly:

1. `expectedLocalPath` must be the canonical **immediate child** of `localDir`
   whose basename equals the queried remote path's basename. A mismatched
   basename, a sibling, a deeper descendant, or any path outside `localDir` is
   refused before argv is built or a child is spawned.
2. That bound path is `lstat`ed **before** the provider command runs. Only a
   definite `ENOENT` permits the spawn; an existing node of any kind —
   including a directory or a dangling symlink — is `download_destination_exists`
   with nothing spawned, and any other inability to establish absence is
   `local_preflight_failed` with nothing spawned. This is what rejects a
   pre-existing unrelated file sitting at the bound path, which binding alone
   cannot do.
3. After a clean response the same bound path is `lstat`ed again — never
   `stat`, so a symlink is reported as a symlink and refused
   (`local_readback_not_regular_file`) rather than silently resolved. It must
   be a regular file whose size is a non-negative safe integer, and the
   provider's own reported count must equal that size, else
   `download_size_mismatch`.

Only an error's `code` property is ever consulted; no native message, path, or
errno text is surfaced.

**What this still does NOT establish (E3J6, unchanged):** the absence check and
the readback are two separate observations, so the race between them is **not**
closed; nothing is contained by a byte ceiling during the transfer; no file
descriptor is owned across the operation; and the downloaded file's **content**
is not verified.

**[E3J6A, 2026-09-16]** The uncontained `download` operation was removed. The
only route is `runContainedDownload` (the pinned wrapper with the exact
per-role limit; see the E3J6A correction entry at the top). Its success result
keeps exactly the three fields above. It adds three indeterminate codes:
`download_containment_tripped`, `download_containment_violated`, and (for every
operation) `provider_termination_unconfirmed`. The byte-ceiling sentence above
is now: the kernel limit is **requested**; whether it is enforced is the
canary's and E3J10's question, and content is still unverified here. This is identity/evidence binding plus destination-cleanliness
preflight, and must never be described as hard containment or acceptance.

---

## 3. Bounded readback — what can actually be guaranteed, and what cannot

### 3.1 Why the acceptor's guarantee does not transfer

This repository has a real "stop before the crossing byte" bound in two places,
and both work for the same reason: **the repository owns the output file
descriptor.**

- `spawnCapturingToFile()` (`backup-boundaries.mjs:350-586`) spawns the tool
  with `stdio: ['ignore','pipe','pipe']`, counts bytes in its own `data`
  handler, and **drops the chunk that would cross the ceiling rather than
  writing it** (lines 564-578). The docblock at lines 328-348 records that the
  rejected alternative — sampling the tool's own output file on a timer — was
  measured and found to be "detection, not a bound", with an 8 MB burst landing
  32× over a 256 KB limit before the first tick. **[REPO]**
- `copyIntoWork()` (`backup-acceptance.mjs:594-716`) reads from a descriptor it
  opened `O_NOFOLLOW` and never asks for more than one byte past the ceiling
  (lines 660-683), so "the loop stops BEFORE writing the byte that would breach
  it" (lines 578-581). **[REPO]**

`proton-drive filesystem download` does not expose a stdout-streaming mode
anywhere in the capability surface E3I1 recorded (`proton-drive-scratch-experiment.md`
§4). It is handed a remote path and a local destination, and **it owns the
output file**. **[E3I]** The producer's mechanism therefore cannot be
reproduced: there is no descriptor to interpose.

**[CORRECTION] Stated plainly: no pure-userspace, repository-only mechanism
reproduces the acceptor's exact property for a CLI-owned download.** Any design
that claims otherwise is wrong. What follows is an honest ranking of what is
achievable and what it costs.

### 3.2 Mechanisms, ranked by what they actually guarantee

**M1 — one remote file per process (prerequisite, not a bound).** Each download
is a separate CLI invocation writing exactly one file into an empty,
uploader-created directory. This bounds *blast radius* and makes every other
mechanism expressible per-object. It bounds nothing by itself. **Adopt
unconditionally.**

**M2 — `RLIMIT_FSIZE` on the child (a real kernel bound, unverified here).**
A process-level file-size limit causes the kernel to fail the write (and deliver
`SIGXFSZ`) at the limit, so the file cannot exceed it. This is the only
candidate that is a genuine hard bound and does not need privileged setup.
Caveats that must be settled before it can be relied on: Node's `child_process`
has no `setrlimit` option, so the child must be launched through a wrapper
(`prlimit --fsize=N -- <cli> …`) or a small helper that sets the limit between
fork and exec; the Proton CLI is a Bun-embedded standalone executable
(`proton-drive-transport-feasibility.md` §C5, §16.3) and **its behaviour under
`SIGXFSZ` / `EFBIG` is untested** — it may leave a truncated file, exit
non-zero, or misreport. **Promising, and unverified. [INFER]**

**M3 — a dedicated quota-backed filesystem for the readback directory (a real
bound, needs deployment).** A small loopback filesystem, an XFS project quota,
or a separate volume sized for exactly one artifact's readback makes
over-consumption impossible at the filesystem layer regardless of what the CLI
does. This is a **deployment** property, not a repository property — and it is
exactly the kind of deployment assumption `backup-acceptance.md` §6.1 already
records as "still needs deployment proof". **Strongest guarantee; costs a
provisioning step.**

**M4 — active observation plus termination (detection, not a bound).** Watching
the output file's size and killing the child on breach is the mechanism
`backup-boundaries.mjs:328-348` already recorded as measured-and-rejected. It is
inherently TOCTOU: between the `stat` that observes the breach and the signal
taking effect, the child may write an unbounded amount, and **termination cannot
guarantee zero bytes written past the limit.** It also cannot bound a single
large write. **Useful as an additional tripwire; must never be described as a
bound.**

**M5 — capacity precheck and post-write check (defence in depth only).**
`checkCapacity()` (`backup-producer.mjs:496-523`) before the download, and a
post-download `fstat` before a single byte is parsed or hashed — the same
pattern as `assertWorkCopiesBounded()` (`backup-acceptance.mjs:728-747`). The
precheck reduces the chance of starting a doomed download; the post-check
catches an already-consumed overrun. **Neither bounds anything during the
download.** Both are cheap and both should exist.

### 3.3 The design, and the deployment prerequisite

Adopt **M1 + M5 always**, **M4 as a tripwire that produces `indeterminate`**,
and require **M2 or M3, proven, before production activation.**

**[E3J6A, 2026-09-16] M2 now exists as code plus a runtime canary; M3 is
refused in code.** The limit applied is the configured role ceiling itself
(inclusive: a legitimate object of exactly C bytes is acceptable, and C + 1 is
never used). The canary proves, per run, only that the pinned wrapper and the
kernel enforced the smallest ceiling on the readback filesystem for a Node
child. Three consequences of RLIMIT_FSIZE are recorded here: it limits **each
file** the process writes, not total bytes or the number of files; it also
applies to the CLI's **own** cache/session writes, so whether the real CLI can
run at all under the smallest role ceiling is part of the E3J10 host proof;
and SIGXFSZ cannot be relied on (Node ignores it and sees EFBIG). `quota_mount`
stays valid configuration shape and is refused at runtime until a
verification for it is designed.

> **DEPLOYMENT PREREQUISITE (blocking).** The uploader may not be activated in
> production until one hard-containment mechanism is demonstrated on the host
> that will run it: either a verified `RLIMIT_FSIZE` enforcement against the
> actual Proton Drive CLI binary (write attempt past the limit fails, file does
> not exceed the limit, CLI exit is observable), or a quota-backed mount or
> filesystem quota whose enforcement is demonstrated by an over-limit write.
> Until one of those is proven on the real host, the readback path has
> **detection only, not containment**, and must be described that way.

**The byte values are not chosen here.** Three separate, required, no-default
ceilings are needed — one per readback role (`readback.maxCiphertextBytes`,
`readback.maxManifestBytes`, `readback.maxSidecarBytes`) — and hard containment
must enforce the applicable one for each one-file-per-process download (§3.2
M1). The ciphertext ceiling depends on the production ciphertext ceiling,
which is U5's still-open half (`proton-drive-transport-feasibility.md` §14)
and requires a measured production dump series; it must ultimately align with
the approved producer/acceptor production envelope. The manifest and sidecar
ceilings are much smaller but are not settled by that same measurement and
still require their own explicit production configuration. All three, and the
deployment proof of the containment mechanism itself, are registered as
**U12** in §10.4.

---

## 4. Attempt identity and the retry lifecycle

### 4.1 The inconsistency

A single immutable `<base>.cloud-attestation.json` per artifact cannot represent
what actually happens: an artifact may be attempted several times, some attempts
rejected, some indeterminate, at most one verified. An immutable file has room
for one of those. Overwriting it destroys the evidence of the others; appending
to it makes it mutable; and a `latest` record re-introduces exactly the mutable
pointer that C12 rejected for remote objects
(`proton-drive-transport-feasibility.md` §6, C12). **No mutable `latest` record
is introduced by this design, locally or remotely.**

### 4.2 The model

**Attempt identifier.** `attemptId = <UTC compact>-<8 hex>`, the same shape the
producer already uses for `runId` (`backup-producer.mjs:757-760`) and the
acceptor for `sweepId` (`backup-acceptance.mjs:797-800`). Reusing the shape
means one parser and one review rule.

**Remote namespace per attempt.** Every attempt uploads into its own remote
folder, requested by that attempt directly beneath the pre-provisioned root
(**[CORRECTED BY E3J5]** — flattened from the E3J3
`<remoteRoot>/<artifactBase>/<attemptId>/` nesting; see the E3J5 correction
entry at the top of this memo and §8.2):

```
<remoteRoot>/<artifactBase>.<attemptId>/<base>.dump.age
<remoteRoot>/<artifactBase>.<attemptId>/<base>.dump.age.sha256
<remoteRoot>/<artifactBase>.<attemptId>/<base>.manifest.json
```

`<artifactBase>` and every name inside it come from the shared contract module
(§1) and are validated before use — the same single-component rule
`assertSafeComponent()` enforces (`backup-acceptance.mjs:104-127`) plus the
artifact-identity shape. The folder name `<artifactBase>.<attemptId>`
(`buildAttemptFolderName()`) is one safe component that can never begin with
`.` or `-`, mirroring the attestation filename below. The `<attemptId>` part is
what makes each remote write target a path that should never have existed,
which is what makes the collision checks in §8.2 meaningful. It is **not** a
guarantee of uniqueness: real cryptographic randomness makes an accidental
same-second 32-bit-token collision unlikely, not impossible, and a defective or
injected random source can make one deterministic. An observed collision fails
closed at the §8.2 checks.

**Attestation filenames, append-only and attempt-scoped.**

```
<attestationDir>/<base>.<attemptId>.cloud-attestation.json
```

One file per attempt, written once with `O_CREAT|O_EXCL`, never rewritten,
never deleted by the uploader. This is the same write-once discipline the
producer's lock uses (`backup-producer.mjs:333`) and the same "an accepted
artifact is immutable here" rule the acceptor states
(`backup-acceptance.mjs:57-59`).

**[CORRECTION]** The name deliberately does **not** reuse the acceptor's
`<base>.receipt.json` shape (`backup-acceptance.mjs:166-168`). Per C11, a cloud
attestation is a different object produced by a different party and must not
borrow the receipt's name, binding rules, or freshness semantics. **[REPO]**

### 4.3 Which attempt is authoritative

**Exactly one verified attempt is authoritative for a source artifact, and it is
the first one that verified.** The rule is mechanical:

- an attestation is *eligible* if it parses, its `schema_version` is recognised,
  its `verdict` is `verified`, and its binding fields match the producer's own
  manifest for that `base` (§5.3);
- if more than one eligible attestation exists for the same `base`, the one with
  the lexicographically smallest `attemptId` is authoritative — `attemptId`
  begins with a compact UTC stamp, so that is the earliest;
- **the presence of extra eligible attestations for the same `base` is a
  reportable anomaly**, because a clean run should stop attempting once one
  attempt verifies. It does not change the authoritative record and it does not
  block freshness; it is surfaced.

Rejected and indeterminate attestations are kept forever and are simply not
eligible. They do not block a later clean attempt, because eligibility is a
property of an individual attestation, not of the artifact.

### 4.4 Why an indeterminate remote namespace is never reused

If an attempt ends `indeterminate`, the uploader does not know what is in
`<remoteRoot>/<base>.<attemptId>/`. It may be empty; it may hold a truncated
object; it may hold a complete object the CLI failed to report. Re-uploading
into that namespace means either a name collision (which E3I1 §7.4 proved fails
closed, **[E3I]**) or — worse, if a conflict strategy were ever passed — a
silent revision or replacement of an object of unknown content.

**An indeterminate namespace is therefore retired permanently and automatically
by construction:** the next attempt gets a new `attemptId`, so it targets a
different path. No code ever computes "the previous attempt's path" for a
write. Cleaning the retired namespace is a **manual** operator action (§4.6).
**[E3J5]** Under the flat layout exactly one folder, `<root>/<base>.<attemptId>`,
and whatever is beneath it is retired by a non-success outcome; the
pre-provisioned root is never retired, and an attempt that stopped before any
write boundary call retires nothing remote.

### 4.5 Bounded retry

Automatic retry is permitted **only** for failures that are *definitely
zero-transfer* — the narrow, anchored class described in §8.6 (chiefly the
`ValidationError: Name conflict …`, exit 1, zero bytes shape E3I1 §7.4 recorded,
and a pre-flight refusal that never spawned the CLI). Everything else is
`indeterminate` and is **not retried inside the same run**; the next scheduled
cycle may try again, with a fresh `attemptId`, because a cycle boundary is where
an operator or a monitor can see the accumulated attestations.

Bounds:

- at most `retry.maxAttemptsPerArtifactPerRun` attempts per artifact per run —
  **value unresolved, U13**;
- a fixed backoff between them — **value unresolved, U13**;
- a run-level ceiling on total attempts across all artifacts — **value
  unresolved, U13**;
- **every attempt, including a refused one, writes its own attestation.** That
  is what keeps retries from being silent: debris on the provider is always
  matched one-to-one by a local record naming the exact remote paths that
  attempt used.

**[E3J5] Retry is not implemented yet, deliberately.** Because the attestation
writer is E3J6's, an automatic retry loop in E3J5 would create attempts with no
attestation. E3J5 therefore performs exactly one attempt per call, and bounded
retry (T18) is deferred until the attestation writer is integrated. The U13
retry values are not consumed; `retry.*` is validated configuration only
(§10.2).

### 4.6 Cleanup is manual, and that is deliberate

Remote deletion is **out of scope for the uploader** — E1A's "a transport must
never delete the last accepted copy", `backup-producer.md` §7 requirement 8's
"pruning runs on the host that owns the directory … never remotely", and C10's
record that permanent-delete/empty-trash/quota behaviour is unproven all point
the same way. **[REPO] [OFFICIAL]** Consequently:

- the uploader never calls `trash`, `delete`, `empty-trash`, `rename`, `move`
  or `copy`;
- retired indeterminate namespaces accumulate on the provider until an operator
  removes them;
- the attestation set is the operator's worklist: every attestation with
  `verdict != "verified"` names the exact remote paths that may hold debris;
- the uploader must **report** the count and total of non-verified attempts, so
  accumulation is visible rather than discovered by a quota alarm — which, given
  U9's resolved-negative finding that CLI 0.8.0 exposes no quota surface
  (`proton-drive-scratch-experiment.md` §7.6), would not fire at all. **[E3I]**

---

## 5. Freshness evidence versus independent monitoring — five separate things

### 5.1 The failure being designed against

A durable attestation written on Hotel-Echo is evidence that a backup reached
Proton. A freshness check that also runs on Hotel-Echo cannot report anything
when Hotel-Echo is down — which is precisely the scenario the backup exists for.
Calling that combination "monitoring" would be false.

### 5.2 The five pieces, deliberately not one component

| # | Piece | Where it runs | Status |
| --- | --- | --- | --- |
| 1 | **Attestation creation** — write an attempt-scoped attestation for every attempt | Hotel-Echo, inside the uploader | designed here (§4, §9); not built |
| 2 | **Freshness calculation** — derive one number from eligible attestations only | Hotel-Echo, a separate read-only evaluator | designed here (§5.3); not built |
| 3 | **Health-signal export** — publish a minimal signal somewhere off Hotel-Echo | Hotel-Echo emits; destination is not Hotel-Echo | not designed; **U15** |
| 4 | **Independent watcher** — decide warning/critical and act when the signal is stale *or absent* | **must not be Hotel-Echo** | not designed; **U15** |
| 5 | **Notification channel + human receipt test** | operator decision D1 | not decided; **U15** |

### 5.3 Freshness calculation

**Freshness = `max(source_snapshot_ts)` over attestations that are eligible per
§4.3.** This mirrors the destination-receipt rule
(`backup-acceptance.mjs:305-308`, `backup-producer.md` §7 requirement 6) without
reusing its objects, and it inherits the same replay resistance: re-delivering
an old artifact produces a new attestation with an *old* `source_snapshot_ts`,
which cannot raise a maximum.

Binding validation for a cloud attestation is its **own** function — proposed
`validateCloudAttestationBinding(attestation, manifest)` — checking that
`artifact`, `ciphertext_sha256` and `source_snapshot_ts` match the producer's
own manifest for that base, by analogy with `validateReceiptBinding()`
(`backup-acceptance.mjs:335-362`) but **never by reusing it**: the schemas
differ, the authors differ, and C11 forbids letting one satisfy the other's
rules by analogy. **[REPO]**

An attestation whose `verdict` is `rejected` or `indeterminate` can never
advance freshness, regardless of binding.

### 5.4 Thresholds

**Warning when no verified Proton copy is newer than 8 hours; critical when none
is newer than 24 hours.** Verified in `HANDOFF.md`'s E1A entry
("Recovery and retention targets — approved") and restated in the roadmap's
`### E3. Backup and restore` section and in
`proton-drive-transport-feasibility.md` §8 constraint 6. **[REPO]**

**[CORRECTION] — a live discrepancy that E3J must resolve, not silently
inherit.** `docs/operations/backup-producer.md` §8 still carries an older,
**PROPOSED** pair: `WARN > 7 h 30 min` / `ALARM > 9 h 0 min`, alongside
`RTO onto a healthy provisioned host ≤ 1 h` and `RTO after total host loss
≤ 4 h`. E1A (2026-09-07) approved 8 h / 24 h on *verified Proton copies* and
`RTO 8 hours`. The §8 table predates E1A and is marked PROPOSED throughout, so
E1A governs — but the table has not been annotated as superseded, and a reader
arriving at the ops doc first would take the wrong numbers. **Correcting that
table is a documentation task for a later session; this memo does not edit it.**

### 5.5 The main PC cannot gate freshness

Per E1A and C9, the main PC is a **secondary, opportunistic** destination whose
"availability must never determine whether the daily independent-backup gate
passes". **[REPO]** Therefore:

- the main PC's presence or absence contributes nothing to the freshness number;
- a main-PC copy is not evidence of a Proton copy;
- the independent watcher (piece 4) **may** run on the main PC as a matter of
  convenience, since being opportunistic about *where the alarm lives* is a
  different question from being opportunistic about *whether the backup
  counts* — but if it does, the design must record that a powered-off main PC
  means no alarm, which is itself a monitoring gap that needs its own answer.
  **U15.**

### 5.6 What must not be claimed

**Monitoring does not exist.** No watcher is built, no channel is chosen, and no
human has received a test notification. `backup-producer.md` §8 already states
the rule — "These backups must not be described as monitored until a human has
received a test notification" — and this memo does not weaken it. Until pieces
3, 4 and 5 exist and a test notification has been received, the correct
description is "attestations are written; nobody is watching them".

---

## 6. CLI identity and version preflight

### 6.1 The corrected finding

E3I3 (`proton-drive-scratch-experiment.md` §8.3;
`HANDOFF.md` E3I entry, `+24 h` bullet) records the following, and the wording
matters: **[E3I]**

- an earlier `proton-drive --version` run, executed **outside** an isolated
  network namespace, additionally printed `You are running the latest version.`;
- that line was **absent** when the same command ran **inside** an isolated
  network namespace (`unshare -rn`, no network reachable);
- this **proves the extra output is network-dependent** and is **consistent
  with** an attempted update/version check;
- **no packet capture, destination/endpoint evidence, or payload evidence was
  collected**, so **the exact endpoint, whether any request completed, and what
  (if anything) was exchanged were not established**;
- E3I3 disclosed the outside-namespace invocation as *unintended possible
  provider-adjacent network access*, not as a proven operation.

### 6.2 Design consequence

**A version preflight that invokes `--version` unrestricted must not be
described as network-free, and must not be the primary identity evidence.** The
design is therefore:

1. **Primary evidence: a pinned binary hash.** Before any invocation, the
   uploader computes SHA-512 of the configured executable and compares it to
   `cli.expectedSha512`. A mismatch is a hard refusal with no fallback, exactly
   as `preflightEncryption()` refuses a missing encryption executable rather
   than "falling back to writing an unencrypted artifact"
   (`backup-producer.mjs:540-548`). **[REPO]** This is a pure local file read —
   genuinely network-free, and provably so.
2. **Secondary evidence: a deployment record.** The installed artifact's origin
   (URL, published checksum, install date) is recorded once at deployment, in
   the manner §16.2-§16.6 of the feasibility memo already documents, and is
   referenced by the attestation rather than re-derived per run.
3. **`--version` is not invoked on the hot path at all.** The version string
   recorded in an attestation comes from the deployment record, and the
   attestation states **how** it was obtained (`from_deployment_record`). If a
   session ever needs the binary's self-reported banner, it obtains it under
   network isolation and records that fact
   (`obtained: 'isolated_network_namespace'`). Any banner obtained without
   isolation is recorded as `obtained: 'unisolated'` and is explicitly **not**
   treated as network-free evidence.

**Justification for preferring the hash.** The hash answers the question that
actually matters — "is this the exact binary that was reviewed and installed?" —
with a local, deterministic, offline check. `--version` answers a weaker
question (what the binary says about itself), does so through a code path E3I3
proved reaches the network under some conditions, and would make every uploader
run carry an unbounded, unobserved provider-adjacent call whose failure mode is
unknown. Given that a forced CLI upgrade is an anticipated event inside this
project's horizon (constraint 11 / U11,
`proton-drive-transport-feasibility.md` §8), a *pinned* hash is also the control
that makes an unexpected binary swap loud instead of silent.

### 6.3 `cli.expectedSha512` must be REQUIRED, not optional

**Required.** Three reasons:

1. **The configuration contract already works this way and says why.**
   `backup-config.mjs:4-13` states the rule: "There are **no defaults**: a
   missing key is a validation error, never a silently-chosen value … a
   defaulted container/database name is how a 'test' job ends up pointed at
   production." The precise analogue for the encryption boundary is
   `encryption.expectedHeader`, which is a required non-empty string
   (`backup-config.mjs:223`) — and the field name `expectedSha512` is
   deliberately chosen to sit beside it in the same camelCase style
   (`maxCiphertextBytes`, `recipientFile`, `expectedHeader`,
   `containerProbeTimeoutMs`). **[REPO]**
2. **Optional means unset, and unset means unverified.** An optional pin is
   absent exactly on the hosts where nobody thought about it, which are the
   hosts where a silently swapped or auto-updated binary matters most.
3. **It is the only identity control that survives the E3I3 finding.** If the
   pin is optional and the `--version` check is the fallback, the fallback is
   the network-touching path this design exists to avoid.

---

## 7. Current credential evidence, and why the uploader must not own credentials

### 7.1 The FINAL state (E3I3 / E3I4), not any earlier state

**[E3I]**, from `proton-drive-scratch-experiment.md` §8.2, §8.3, §9 and the
`HANDOFF.md` E3I entry:

- **Unaided non-interactive access failed at two separated times.** At
  T+3 h 54 m (E3I2, actual 2026-09-11T23:38:38Z) and again at T+25 h 11 m
  (E3I3, actual 2026-09-12T20:55:52Z), the same no-TTY command — stdin
  `/dev/null`, `DISPLAY`/`WAYLAND_DISPLAY`/`GPG_TTY` unset, fresh empty
  mode-0700 cache — **failed closed, exit 1**, with **byte-identical** output:
  `Failed to load session in pass: gpg: public key decryption failed` /
  `gpg: decryption failed`.
- **The local GPG key was not cached.** A read-only
  `gpg-connect-agent 'keyinfo --list'` showed, at +3 h 54 m, no cached key
  state; at +25 h, the secret keys present and passphrase-protected but with the
  `cached` field unset. There is no custom `~/.gnupg/gpg-agent.conf`.
- **Once the operator made the key available, the pre-existing Proton session
  was still accepted after ~25 hours** — no browser login, no reauthentication,
  no session renewal, no `auth login`.
- **Therefore the demonstrated blocker on the main PC is local key
  availability, not Proton session expiry over the tested interval.**
- **Untested:** Hotel-Echo entirely; reboot; logout; terminal closure as a
  controlled variable; the exact time and cause of cache loss; and any
  service-compatible credential-access mechanism.
- **U1 remains only partially informed and open.** U1 is
  `proton-drive-transport-feasibility.md` §9's first ranked unknown: *whether the
  CLI can run unattended across reboots on Hotel-Echo — which credential backend
  survives, for how long, what triggers re-auth, and what a headless Linux
  service sees.* **[REPO]**

Housekeeping fact worth carrying into any deployment review: E3I1 §7.5 observed
that **the CLI writes its cache files mode 0644**; the enclosing directory was
0700 in the experiment, so exposure was contained, but a production deployment
must not rely on the CLI to restrict them. **[E3I]**

### 7.2 The scope rule

**Credential unlocking and storage mechanics are entirely outside the uploader's
scope.** The uploader:

- **consumes an already-unlocked credential context** — it inherits an
  environment in which the configured credential backend can already answer, and
  it does not know or care how that happened;
- **names only a backend selector** in configuration (§10), never a secret, a
  path to a secret, a passphrase, or an unlock command;
- **never invokes `pass`, `gpg`, `gpg-agent`, `secret-tool`, `auth login` or
  `auth logout`**, and never prompts;
- **treats a credential-loading failure as `indeterminate` with the code
  `credential_unavailable`**, does not retry it, and **does not include the
  provider's or GPG's text** in the attestation (§2.2) — the two observed
  failures are a well-defined anchored shape and map to that one code;
- runs with no controlling TTY as a *design assumption*, so that a build which
  accidentally depends on an interactive prompt fails closed in testing rather
  than in production.

**[E3J4C] What the environment allowlist bounds, and what it does not.**
`backup-cloud-cli-core.mjs`'s `ENV_ALLOWLIST` is a POSITIVE allowlist of
environment variable **key names**: `PATH`; `HOME` and the `XDG_*` locations;
`GNUPGHOME`, `GPG_AGENT_INFO`, `PASSWORD_STORE_DIR`, and
`DBUS_SESSION_BUS_ADDRESS`; `LANG`, `LC_ALL`, `LC_CTYPE`, and `TMPDIR`. Its
entire guarantee is that a variable whose name is **not** on that list is
excluded from the child environment. E3J4 proves that exclusion and nothing
more.

An allowlisted variable's **inherited value is not trusted merely because its
name is allowed.** Every one of them is a deployment-controlled input: `PATH`
decides what a bare-name helper binary resolves to; `HOME`/`XDG_*`,
`GNUPGHOME`, and `PASSWORD_STORE_DIR` decide which credential store is opened;
`GPG_AGENT_INFO` and `DBUS_SESSION_BUS_ADDRESS` name agent sockets; `TMPDIR`
decides where intermediate files land; the locale variables can change parsed
text. **Who owns those paths and sockets, what their canonical values must be,
and how they behave under a service-mode (non-login, non-interactive, possibly
near-empty-environment) run are E3J9/E3J10 questions with no proof in this
repository yet.** Until that proof exists, the allowlist must be described as
ambient-variable exclusion, never as a trusted-environment guarantee.

The consequence is that the credential mechanism is its **own** session (§12,
E3J9) and its own unknown (U1), and that the uploader can be designed, built and
tested against a fake CLI without it.

---

## 8. Transport protocol

### 8.1 Remote layout

```
<remoteRoot>/<artifactBase>.<attemptId>/{ciphertext, sidecar, manifest}
```

`<remoteRoot>` is configuration (§10) and is **unresolved, U14**. It must
already exist as an **active folder**: the uploader never creates, modifies, or
lists it, and a root at or beneath `/trash` is refused as invalid input. The one
segment below it is derived from the artifact identity and the attempt id,
validated as a single safe path component before use (**[CORRECTED BY E3J5]** —
formerly two nested segments; the flat layout is subject to operator
ratification under U14).

**No mutable remote pointer of any kind is uploaded** — no `latest.json`, no
fixed artifact name, no rewriting of any remote name. C12 rejects it on identity
grounds, and E3I1 §7.4 gives the mechanical reason: a same-name re-upload with
`create-new-revision` kept one node but **doubled that node's reported
`totalStorageSize`** (1,048,723 → 2,097,446), with the superseded revision still
represented in the node's storage metadata. **[E3I] [REPO]** Note the producer's
local `latest.json` (`backup-producer.mjs:1576-1593`) stays local; it is not
part of the triple and is never uploaded.

### 8.2 Preflight collision checks

**[REWRITTEN BY E3J5, 2026-09-16].** An earlier revision said that before any
write, all four paths — the attempt folder and the three object paths — are
checked. That order is not achievable with the evidence available: the
`Node not found: <name>` sentinel was captured verbatim only for a path whose
**parent existed** (`proton-drive-scratch-experiment.md` §8.3), and E3J4B binds
the sentinel to the queried basename, so an absence report for a child of a
possibly-missing parent is not evidence of anything. The protocol is therefore,
in this order, stopping at the first non-success:

1. `info(<remoteRoot>)` — must be an **active folder**. Absent →
   `remote_root_absent`; a file or a trashed node →
   `remote_root_not_active_folder`; both are definite refusals with no write.
2. `info(<namespace>)` — must report **absent**. This is the namespace
   collision check, and it runs **before the namespace-folder write**. Any
   present node (folder, file, or trashed) → `remote_path_occupied`.
3. `create-folder(<remoteRoot>, <artifactBase>.<attemptId>)` — the only
   root-level write an attempt ever requests; no ancestor is ever created.
4. `info(<namespace>)` — must be an active folder whose `nodeUid` equals the
   create result's `folderUid`; anything else → `created_folder_unconfirmed`
   (indeterminate). This establishes only that the exact path was observed as
   an active folder with matching opaque handles after the create call —
   **not who created it** (an idempotent real create-folder, or a concurrent
   actor, cannot be excluded). Both handle fields are unverified design
   hypotheses about the real CLI; a mismatch fails safe.
5. `info()` on **each of the three object paths**, under the now-confirmed
   parent — all three must report absent (`remote_path_occupied` otherwise)
   **before any artifact upload** is requested.
6. Only then the ordered uploads of §8.4.

So: the namespace collision check precedes the namespace-folder write; all
three object collision checks precede every artifact upload; and folder
creation necessarily sits between them. Every refusal is a refusal, never an
overwrite, mirroring the producer's local identity-collision refusal
(`backup-producer.mjs:1167-1174`) and the acceptor's archive-conflict rule
(`backup-acceptance.mjs:1305-1328`).

**Races, disclosed.** A path may still be created by someone else after its
check. Between steps 2 and 3, the create may then be reported indeterminate
(namespace evidence `unknown`, attempt stops) or step 4 may fail. After step 5,
an object may still appear before its upload; the upload boundary passes no
conflict strategy (§8.7), so that case fails closed there (`name_conflict`, or
indeterminate). Nothing is overwritten, renamed, revised, deleted, or listed on
any path.

**Concurrency, disclosed.** E3J5 takes no run lock (§10.2). Two direct calls
for the same artifact would normally use different namespaces and could both
receive boundary-reported upload success — the §4.3 anomaly. No executable
entrypoint exists in E3J5, and the lock the entrypoint session adds must cover
upload, readback, and attestation, so this library state must never be
presented as an activated concurrent workflow.

This remains the access pattern E3I3 demonstrated: **exact paths queried one at
a time with `filesystem info --json`, with `/my-files`, `/trash` and every
parent's children never enumerated.** **[E3I]**

### 8.3 Is a `filesystem list` enumeration required at all?

**No, and it is therefore excluded from the design.** Every operation the
uploader needs is expressible against an exact path:

| Need | Operation | Enumeration? |
| --- | --- | --- |
| does this path exist? | `filesystem info <exact path>` | no |
| create the attempt folder | `filesystem create-folder <parent> <name>` | no |
| put one file there | `filesystem upload <local file> <exact parent>` | no |
| get one file back | `filesystem download <exact path> <local dir>` | no |

Excluding `filesystem list` has three benefits: it removes any code path that
could read the names of unrelated objects; it removes any temptation to treat a
listing as evidence of completion (E3I1 §7.2 only sampled listings during one
upload and explicitly refused to generalise, **[E3I]**); and it keeps the
uploader's provider-command surface to the four operations above plus nothing
else. If a future need for enumeration appears, it is a separate design
decision, not an implementation detail.

### 8.4 Ordering, and what the manifest does not prove

**Upload order is ciphertext → sidecar → manifest last**, the same order the
producer (`backup-producer.mjs:1536-1552`) and the acceptor
(`backup-acceptance.mjs:1465-1475`) use, and for the same stated reason: it
shortens the window in which a naive reader sees a manifest without its
artifact. **[REPO]**

**The presence of the manifest is a hint, never proof.** Both existing
components say so explicitly (`backup-producer.md` §2.5: "Presence of three
files is **not** completion"; `backup-acceptance.mjs:41-45`). For a remote
destination it is weaker still, because nothing about Proton's write ordering or
partial-object visibility is established: E3I1 §7.2's three in-flight listings
are "encouraging evidence for this one tested upload only", and U7 is only
**partially informed**. **[E3I]**

### 8.5 Acceptance is the full three-file readback, verified locally

The **only** acceptance proof is:

1. download all three objects, **one file per CLI invocation** (§8.7), into a
   fresh uploader-owned directory under the readback containment of §3;
2. recompute SHA-256 and byte counts locally for all three;
3. run the shared contract's `verifyArtifactCompletion()` against the downloaded
   directory — which enforces all seven rules, including both hash bindings
   (`backup-producer.mjs:226-288`);
4. additionally check that the downloaded ciphertext hash equals the hash the
   producer recorded for the source artifact, so a verified-but-different triple
   is caught;
5. only then may the verdict be `verified`.

E3I1 §7.1 executed steps 1-3 against synthetic data and got
`complete: true, failures: []` on the downloaded copy. **[E3I]** That is
evidence the approach is expressible; it is not evidence about production
artifacts, sizes, or failure conditions.

Provider-reported `claimedSize`, `claimedDigests.sha1` and `sha1Verified` play
**no part in the verdict**. E3I1 §7.1 records `sha1Verified: false` as directly
observed, and explicitly refuses to conclude anything about how (or whether)
Proton validates `claimedSize`. **[E3I]**

### 8.6 Definite rejection versus indeterminate

| Class | Examples | Retry? | Verdict |
| --- | --- | --- | --- |
| **Definite rejection, zero transfer** | preflight refusal before any spawn; the anchored `ValidationError: Name conflict …` with exit 1 and `transferredBytes: 0` (E3I1 §7.4) **[E3I]**; `credential_unavailable` before any provider request | only the bounded retry of §4.5, and never for `credential_unavailable` | `rejected` |
| **Definite rejection, transfer happened** | readback succeeded but hashes or bindings do not match | no | `rejected` |
| **Indeterminate** | timeout; cancellation; unparseable output; unexpected field or type; unrecognised error text; non-zero exit without an anchored pattern; a download that hit a containment tripwire | no automatic retry in-run | `indeterminate` |

The classification is deliberately asymmetric: a claim of "definitely zero
bytes" requires positive, anchored evidence; everything else defaults to
`indeterminate`. This is the same discipline
`establishContainerSideEnded()` uses — a probe that cannot answer produces
"cannot confirm", never "gone" (`backup-producer.mjs:895-947`,
`backup-boundaries.mjs:823-866`). **[REPO]**

### 8.7 One file per invocation, no conflict strategy, no deletion

- **One file per CLI invocation.** No batch upload, no multi-path download, even
  though E3I1 used both. Batching makes partial success ambiguous (which file?
  how many bytes of it?) and defeats per-object containment (§3, M1).
- **No conflict-strategy flag is ever constructed.** `create-new-revision`,
  `rename`, `replace` and `skip` are all forbidden in the argv. Passing none is
  the behaviour E3I1 §7.4 proved fails closed non-interactively. **[E3I]** This
  is asserted by a test (§11).
- **No trash, delete, empty-trash, rename, move, copy, sharing, invitation,
  album or photo operation is ever constructed.** The uploader's entire provider
  surface is `info`, `create-folder`, `upload`, `download`.
- **No `auth login` / `auth logout`.**

### 8.8 Cancellation semantics

Cancellation stops the **local process**. It says nothing about the remote
effect. This is the identical distinction `backup-boundaries.mjs:27-34` already
draws for `docker exec`: killing the local client "does NOT establish that the
process inside the container has ended", so handles report
`containerSideEnded: null`. For a network client the gap is wider — a request
may already be complete server-side. **[REPO] [INFER]**

Therefore: a cancelled or timed-out operation yields `indeterminate` with
`transfer_state: "unknown"`, its attestation is still written, and its remote
namespace is retired per §4.4. **No message, log line, or attestation field may
state or imply that the remote write was stopped.**

### 8.9 Folder created, transfer then failed

A very likely shape, and it needs no special case: the attempt folder exists,
one or more objects do not.

- the attempt's verdict is `rejected` or `indeterminate` per §8.6;
- the attestation is written and names the folder and the three intended paths;
- **the folder is not deleted** (§4.6) and **is never reused** (§4.4);
- the next attempt creates a different folder;
- the orphaned folder appears on the operator worklist derived from
  non-verified attestations.

---

## 9. The intent and attestation schemas — AS IMPLEMENTED (E3J6B)

**[REPLACED IN PLACE BY E3J6B, 2026-09-17.]** Everything this section said
before was an ILLUSTRATION drafted at E3J1, when no writer existed; it was
never implemented, and several of its fields turned out to be unsafe or
unobtainable (see the corrections listed below). The schemas below are the
ones the code actually writes and validates, in
`ops/backup/lib/internal/backup-cloud-attestation-records-core.mjs`. There is
no other authoritative copy.

Two records per attempt, both under the operator-configured
`attestation.dir`, both written once with `O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW`
mode `0600`, never rewritten, never deleted by the uploader:

```
<base>.<attemptId>.cloud-attempt-intent.json     written BEFORE any provider call
<base>.<attemptId>.cloud-attestation.json        written AFTER the verdict is derived
```

Both filenames come from `backup-cloud-naming.mjs`
(`buildCloudAttemptIntentFileName()`, `buildAttestationFileName()`), never
from ad-hoc string construction. Each record's serialized form is bounded at
**16 KiB** — a security/resource ceiling chosen by E3J6B, **not** a U12/U13
production measurement.

### 9.1 Intent — `kind: "eanhl.cloud-attempt-intent"`, `schema_version: 1`

Every attempt that has an identity gets one, including a local refusal, and it
is durable before the first provider boundary call.

```jsonc
{
  "kind": "eanhl.cloud-attempt-intent",
  "schema_version": 1,
  "attempt_id": "<YYYYMMDDTHHMMSSZ>-<8 hex>",
  "cloud_run_id": "<YYYYMMDDTHHMMSSZ>-<8 hex>",
  "sequence": 0,
  "started_at": "<ISO-8601 UTC>",          // REQUIRED, never null
  "artifact": { "base": "...", "ciphertext": "...", "checksum": "...", "manifest": "..." },
  "source": {
    "evidence": "captured" | "unavailable",
    "snapshot_ts": "<ISO-8601 UTC>" | null,
    "run_id": "<producer run_id>" | null,
    "ciphertext": { "sha256": "<64 hex>", "bytes": 0 } | null,
    "checksum":   { "sha256": "<64 hex>", "bytes": 0 } | null,
    "manifest":   { "sha256": "<64 hex>", "bytes": 0 } | null
  },
  "remote": { "root", "namespace", "ciphertext_path", "checksum_path", "manifest_path" },
  "local":  { "source_dir", "ciphertext_path", "checksum_path", "manifest_path" },
  "cli": { "executable": "...", "expected_sha512": "<128 hex>" },
  "containment": {
    "mechanism": "rlimit_fsize" | "quota_mount",
    "wrapper_executable": "..." | null,
    "wrapper_expected_sha512": "<128 hex>" | null,
    "ceilings": { "ciphertext": 0, "checksum": 0, "manifest": 0 }
  },
  "workspace": { "planned_path": "<readback.dir>/<base>.<attempt_id>" },
  "refusal": { "step": "...", "code": "..." } | null
}
```

Invariants the validator enforces: `source.evidence === "captured"` **iff**
`refusal === null` **iff** all five `source.*` fields are non-null (and the
reverse for `"unavailable"`); `containment.mechanism === "rlimit_fsize"`
**iff** both wrapper fields are non-null; exact key sets at every level.
`refusal` reflects only a PREPARATION-local refusal — a ready attempt that is
later discarded (proof, capacity, or workspace failure) leaves it `null`, and
that failure is recorded only in the attestation. The intent is never
retrofitted.

### 9.2 Attestation — `kind: "eanhl.cloud-attestation"`, `schema_version: 1`

```jsonc
{
  "kind": "eanhl.cloud-attestation",
  "schema_version": 1,
  "attempt_id": "...", "cloud_run_id": "...", "sequence": 0,
  "started_at": "<ISO-8601 UTC>",                       // REQUIRED
  "finished_at": "<ISO-8601 UTC>" | null,
  "finish_time_state": "captured" | "unavailable",      // null finished_at IFF "unavailable"
  "artifact": { "base", "ciphertext", "checksum", "manifest" },
  "source_snapshot_ts": "<ISO-8601 UTC>" | null,
  "source_run_id": "..." | null,
  "remote": { "root", "namespace", "ciphertext_path", "checksum_path", "manifest_path" },

  "verdict": "verified" | "rejected" | "indeterminate",
  "stage": "local_refusal" | "intent" | "containment_proof" | "capacity" | "workspace"
          | "upload" | "readback" | "completion" | "internal" | null,
  "code": "<closed code>" | null,
  "role": "manifest" | "checksum" | "ciphertext" | null,

  "containment": "not_checked" | "valid" | "invalid",
  "upload_transfer_state": "definitely_zero" | "unknown",
  "upload_outcome": {
    "code": "<CLOUD_UPLOAD_OUTCOME_CODES value>" | null,
    "failed_step": "<CLOUD_UPLOAD_STEPS value>" | null,
    "boundary_code": "<CLOUD_CLI_ERROR_CODES value>" | null
  },
  "termination": "confirmed" | "unconfirmed" | "not_applicable",

  "intent_record": {
    "state": "confirmed" | "not_confirmed",
    "filename": "..." | null, "sha256": "<64 hex>" | null, "bytes": 0 | null
  },

  "readback": {
    "performed": true | false,
    "ciphertext": {
      "attempted": true | false,
      "observed": "not_observed" | "absent" | "active_file" | "other",
      "boundary_code": "<closed code>" | null,
      "termination": "confirmed" | "unconfirmed" | "not_applicable",
      "bytes": 0 | null, "sha256": "<64 hex>" | null, "matches_source": true | false | null
    },
    "checksum": { …same shape… },
    "manifest": { …same shape… }
  },

  "completion": { "checked": true | false, "ok": true | false | null },
  "cli": { "executable": "...", "expected_sha512": "<128 hex>" },
  "cleanup_policy": {
    "disposition": "after_attestation" | "withheld_termination_unconfirmed" | "not_applicable",
    "workspace_path": "..." | null
  },
  "future_lock_advice": "release" | "retain_attestation_unconfirmed"
                      | "retain_termination_unconfirmed" | "retain_internal_error"
}
```

### 9.3 What the fields mean, and the invariants the validator enforces

- **`verdict` has exactly three values.** `verified` requires ALL of: a
  confirmed `intent_record`; `containment: "valid"`; `termination:
  "confirmed"`; `readback.performed`; every role `observed: "active_file"`
  with non-null `bytes`/`sha256` and `matches_source: true`; and
  `completion.ok === true`. It is derived independently — never by copying
  the upload outcome's own `status` (`backup-cloud-attempt-verdict.mjs`
  re-derives the classification from `code` and cross-checks it against
  `status`; a disagreement is `internal_invariant_violated`/indeterminate).
- **`intent_record` is a cryptographic binding, not a pointer.** Its
  `sha256`/`bytes` are the hash and length of the intent file's own serialized
  bytes, measured by the record session that wrote them and REVALIDATED —
  identity and bytes re-read under the same session — immediately before the
  attestation payload is built. A caller cannot supply it. If the intent is
  gone, changed, or was never confirmed, the state is `not_confirmed`, a
  `verified` verdict is forced to `indeterminate`
  (`code: "intent_record_lost"`), and the lock advice retains.
- **`upload_outcome` records both layers.** `code` is the upload attempt's own
  outcome code; `boundary_code` is the last boundary call's
  `CLOUD_CLI_ERROR_CODES` value, which is the ONLY place a specific reason
  such as `name_conflict`, `credential_unavailable`, or
  `provider_termination_unconfirmed` survives — `codeForNonSuccess()` collapses
  every boundary rejection into four generic buckets before it reaches
  `outcome.code`. Both are closed vocabularies.
- **`termination` is conservative**: `unconfirmed` if ANY invoked child
  (upload boundary call or readback download) reported
  `provider_termination_unconfirmed`, scanned from `boundaryCalls` rather than
  inferred from a status.
- **`containment` is a closed state, not a boolean.** `not_checked` for a
  local refusal or an intent failure (the proof is never reached),
  `invalid` for a rejected proof, `valid` from the capacity stage onward.
  `attestation_dir_trust` is deliberately NOT a writable `stage` value: if
  that directory cannot be trusted, no attestation can be written at all, and
  the failure appears only in the in-memory report.
- **`cleanup_policy` is policy, never success.** The attestation is durable
  BEFORE cleanup begins, so it can only say what will be attempted. The actual
  cleanup result is in the returned report.
- **`future_lock_advice` is derived, never supplied.** The record session
  computes it from the written fields, most conservative first: intent not
  confirmed → `retain_attestation_unconfirmed`; else termination
  `unconfirmed` → `retain_termination_unconfirmed`; else
  `internal_invariant_violated` → `retain_internal_error`; else `release`.
  The returned report's `lockAction` is authoritative for E3J6C and equals
  this advice, except that it may only ESCALATE: to
  `retain_attestation_unconfirmed` when no attestation could be written, or
  to `retain_internal_error` when post-attestation cleanup failed
  unexpectedly.
- **The report is the durable record.** `writeAttemptAttestation()` returns
  the effective record exactly as written; the report's verdict, stage,
  code, role, and termination are copied from it. With no durable
  attestation a `verified` proposal is reported as `indeterminate`, stage
  `attestation` (report-only, like `attestation_dir_trust`), with the closed
  attestation-failure code.
- **Every finite field is a closed vocabulary, checked by membership.**
  `code` must be in its stage's set (`CLOUD_ATTEMPT_CODES_BY_STAGE`, exported
  from `backup-cloud-attestation-records.mjs`), and the code decides the
  verdict: only `CLOUD_ATTEMPT_REJECTED_CODES` may be `rejected`, so a
  cancellation, timeout, or ambiguous transfer is never a definite rejection.
  `upload_outcome.code`/`failed_step`, every `boundary_code`, and every enum
  are membership-checked too.
- **Cross-field invariants.** `finish_time_state: "unavailable"` iff
  `code: "clock_unusable"`; a rejection at the upload/local-refusal stage
  requires `upload_transfer_state: "definitely_zero"`, and no rejection may
  carry termination `unconfirmed`; `cleanup_policy.disposition` is
  `withheld_termination_unconfirmed` iff termination is `unconfirmed`, its
  `workspace_path` is null iff `not_applicable`, and a workspace-or-later
  stage may not be `not_applicable`; `role` is set iff stage is `readback`
  and equals the role the readback stopped at; readback roles run in order,
  nothing after the stop is attempted, `completion.checked` iff every role
  matched, and bytes/sha256/matches_source are set together; stage
  `local_refusal`/`upload` codes equal `upload_outcome.code`, and pre-upload
  stages carry no upload evidence; `remote` must be the canonical attempt
  paths and `artifact` names must derive from `artifact.base`.

### 9.4 Fields the E3J1 illustration had, and why they are gone

- ~~`source_host`~~ — the uploader has no trustworthy source for it.
- ~~`provider_observations` (`node_uid`, `active_revision_uid`,
  `claimed_size_bytes`, `claimed_sha1`, `sha1_verified`)~~ — provider-claimed
  metadata is never persisted; only closed LOCAL classifications
  (`not_observed`/`absent`/`active_file`/`other`) are.
- ~~`cli.observed_sha512`~~ — the boundary does not expose the hash it
  computed, so nothing could honestly fill it.
- ~~`cli.version` / `cli.version_evidence`~~ — obtaining a version means
  invoking `--version`, which §6 forbids on the hot path.
- ~~`binding.completion_failures`~~ — corrected at E3J6A: that array carries
  interpolated manifest/parser text. Only the `complete` boolean is read.
- ~~`timings_ms`~~ — dropped as unused surface; `started_at`/`finished_at`
  bound the attempt.
- ~~`written_at`~~ — dropped at E3J6B: an attestation written to record a
  clock failure must not itself require another successful clock read.

**What must NEVER appear, in any field, at any nesting depth:** secrets,
tokens, session material, credentials, passwords, passphrases, cookies,
recovery material, account identifiers or e-mail addresses, authentication
URLs, raw CLI stdout or stderr, raw provider JSON, and any provider-authored
free text. A recursive assertion enforcing this is a required test (§11, T8) —
closed by E3J6B for the written records.


---

## 10. Configuration boundary

### 10.1 A separate config surface, not an extension of `backup-config.mjs`

**Recommend a separate file and a separate validator** — proposed
`ops/backup/lib/backup-cloud-config.mjs` with
`ops/backup/eanhl-backup-cloud.example.json` — importing the shared validation
primitives already exported for exactly this purpose.

The precedent is explicit and in the repository:
`backup-acceptance-config.mjs:36-44` imports `fail`, `requireAbsolutePath`,
`requireBackingVolume`, `requireObject`, `requirePositiveInt` and
`requireString` from `backup-config.mjs`, and `backup-config.mjs:46-55` states
why they are exported — "the destination-side acceptance contract … has to be
fail-closed in exactly the same way … and two copies of these rules would be two
places for them to drift apart", followed by "They are validators, not general
utilities; nothing outside the backup configuration contracts should use them."
A cloud-transport contract is a backup configuration contract, so it is inside
that permission. **[REPO]**

Reasons for a separate surface rather than new keys under the producer's config:

1. **Different owner and different lifetime.** The producer config names a
   database, a container, and staging ceilings — it is read by a component that
   never touches the network. `backup-acceptance-config.mjs:4-11` already makes
   the same argument for the acceptor ("This file describes the configuration of
   the destination host, not the producer's … and never reads the producer's
   config").
2. **Different failure domain.** A malformed cloud config must not be able to
   stop the producer from making an artifact. Keeping them separate means the
   producer keeps running — and keeps producing local artifacts — while the
   cloud path is misconfigured.
3. **Different deployment host in the target topology.** The two may diverge
   further as Hotel-Echo cutover proceeds.

### 10.2 The four categories

**(a) Repository-controlled, non-secret, checked in as an example.** Schema
version constants; the closed enum of provider error codes; the allowlist field
sets; the artifact-prefix pattern; the "no conflict strategy" invariant. These
are code, not config, precisely so they cannot be relaxed by editing a JSON file
on a host.

**(b) Host-local, non-secret, operator-authored (mode 0600).**

| Key | Meaning |
| --- | --- |
| `cli.executable` | absolute path to the Proton Drive CLI |
| `cli.expectedSha512` | **REQUIRED** (§6.3) |
| `credentials.backend` | **selector only**: `'pass' \| 'keychain'`; `'unsafe_file'` is rejected by the validator |
| `remote.root` | absolute remote root path — **U14** |
| `artifact.sourceDir` | the producer's `destination.dir`, read-only to the uploader |
| `attestation.dir` | where attempt-scoped attestations are written; must not be inside `artifact.sourceDir` |
| `readback.dir` | uploader-owned, one attempt's lifetime; must not be inside either of the above |
| `readback.maxCiphertextBytes` | **U12** — required positive integer, no default; must ultimately align with the approved producer/acceptor production ciphertext envelope |
| `readback.maxManifestBytes` | **U12** — required positive integer, no default; much smaller than the ciphertext ceiling but still requires its own explicit production configuration |
| `readback.maxSidecarBytes` | **U12** — required positive integer, no default; much smaller than the ciphertext ceiling but still requires its own explicit production configuration |
| `readback.containment` | `'rlimit_fsize' \| 'quota_mount'` — declares which proven mechanism is deployed (§3.3); required, no default; enforces the applicable per-role ceiling above for each one-file-per-process download. **[E3J6A]** `quota_mount` is refused at runtime |
| `readback.rlimitWrapper` | **[E3J6A]** required-but-nullable: `{executable, expectedSha512}` for `rlimit_fsize` (canonical path, not the CLI, not in a data directory), exactly `null` for `quota_mount`; hash-gated like the CLI |
| `run.lockFile`, `run.operationTimeoutMs`, `run.cancelGraceMs` | same discipline as `backup-config.mjs` `run.*`. **[E3J5]** the two timeouts are consumed by the upload attempt; `run.lockFile` is validated but **RESERVED** — no code takes the lock until the entrypoint session, whose lock must span upload, readback, and attestation |
| `retry.*` | **U13**. **[E3J5]** validated but **RESERVED** — no code retries until the attestation writer exists |
| `capacity.minFreeBytes`, `capacity.backingVolume` | reused wholesale, including the required-but-nullable `backingVolume` rule (`backup-config.mjs:99-123`) |

Path-separation rules are validated the way
`backup-acceptance-config.mjs:150-206` validates its own: no directory inside
another, all distinct, all absolute.

**[CORRECTED BY E3J3B, 2026-09-13] — absolute is not enough; canonical is
required, and the guarantee is lexical only.** The first E3J3 implementation
required every local path to be absolute and then compared containment
textually, but never required the path to already be in canonical form. That
let a dot-segment or repeated-separator alias — `readback.dir =
"/data/x/../artifacts/readback"` with `artifact.sourceDir = "/data/artifacts"`
— pass the separation check while textually resolving inside the directory it
was supposed to be kept out of. Every local path field in this table,
including `capacity.backingVolume.mountPoint` when non-null, is now REQUIRED
to already be canonical POSIX form (no repeated separators, no trailing
separator, no `.`/`..` segment) before it is used or compared; a
non-canonical value is a hard configuration-validation failure, never
silently normalized. **This is a LEXICAL guarantee only.** It proves the
configured string, as written, does not resolve elsewhere via `.`/`..`/
repeated separators. It proves nothing about symlinks, bind mounts, hard
links, filesystem ownership, or any other runtime aliasing — that remains
exactly the deployment-time proof §3.3 already requires for hard readback
containment, and this configuration-time lexical check does not substitute
for it.

**(c) Secret/session material — never in configuration at all.** No passphrase,
no token, no session file path, no account identifier, no e-mail, no unlock
command, no `PROTON_DRIVE_CREDENTIALS_STORE` *value beyond the backend
selector*. The uploader consumes an already-unlocked context (§7.2). The
validator should refuse any key whose name matches a secret-shaped pattern, so a
well-meaning operator cannot add one.

**[CORRECTED BY E3J3B, 2026-09-13]** The first E3J3 implementation refused
such a key but then included the offending key name — untrusted, operator-
supplied text — in the thrown `ConfigError` message. The key name itself may
BE the sensitive material (an operator who accidentally pastes a real token
as a key name, say), so echoing it back defeated the point of rejecting it.
The rejection message is now fully generic: a stable error code
(`config_secret_shaped_key`) plus a locally authored diagnostic, with no key
name, value, or accumulated path built from untrusted key names anywhere in
the thrown error's properties.

**(d) Production values and pending decisions — unresolved.** See §10.4.

### 10.3 What the uploader may read from the producer's side

Only the published artifact triple and the producer's own manifest, read-only,
from `artifact.sourceDir`. The uploader never reads the producer's staging
directory — `backup-producer.md` §7 requirement 7 forbids it — never reads the
producer's config file, and never writes anything into the producer's
destination directory.

### 10.4 Unresolved production values and decisions

U12-U15 are four additional implementation/deployment unknowns raised by this
memo — not all "numeric values": U14 is a namespace/layout decision and U15 is
a set of transport, location and channel decisions with no numeric content at
all. They extend the `U#` scheme defined in
`proton-drive-transport-feasibility.md` §9. **They are registered there** —
added to that canonical table by the E3J1A correction pass, alongside U1-U11,
which are unchanged — and the table below restates them for local context
only. `proton-drive-transport-feasibility.md` §9 is the single canonical
unknown registry; this memo does not maintain a second one.

| # | Unresolved value or decision | Blocked on |
| --- | --- | --- |
| **U12** | Three required, positive-integer, no-default readback ceilings — `readback.maxCiphertextBytes`, `readback.maxManifestBytes`, `readback.maxSidecarBytes` — and **which** hard-containment mechanism (`rlimit_fsize` or `quota_mount`) is deployed and proven to enforce the applicable per-role ceiling for each one-file-per-process download | The ciphertext value is blocked on U5's open half (the real production ciphertext ceiling) and must ultimately align with the approved producer/acceptor production envelope. The manifest and sidecar values are much smaller but still require their own explicit production configuration. All three, plus the containment mechanism, are also blocked on a demonstrated per-role enforcement test on the real host (§3.3) |
| **U13** | Uploader upload/download/metadata timeouts, cancellation grace, retry counts, and retry backoff | Size-dependent timeout calibration is blocked on measured production upload/download behaviour on the intended host/link/provider path — a production dump/ciphertext-size series does not settle it; E3I1's 300 MiB-in-104 s figure is one synthetic sample on a different host **[E3I]**. Cancellation grace can be established initially through local boundary tests and later validated on the real host. Retry counts and backoff are operator reliability and debris-accumulation policy decisions, informed but not mechanically determined by transfer measurements |
| **U14** | `remote.root` and the remote folder layout beneath it | an operator decision about the Proton account's namespace; interacts with U6 (dedicated uploader identity) |
| **U15** | The independent watcher's host, the exported health-signal format and transport, the notification channel, and the human receipt test | operator decision D1 (`backup-producer.md` §8) and §5.2 pieces 3-5 |

---

## 11. Local test plan — intentions, and the boundary of what they prove

All of the following are exercisable with a **fake CLI**: a test double invoked
in place of the real binary, scripted per test to emit chosen stdout/stderr/exit
codes and to write chosen bytes. This is the same shape the existing suite
already uses — `backup-producer.test.mjs`'s `'the real spawn boundary hands the
double exactly the argv the producer built'` (line 1049) and `'a real double
drives a complete run end to end through the spawn boundary'` (line 1103) prove
the pattern works against the actual `spawn()` boundary, not only against
injected fakes. **[REPO]**

### 11.1 Test intentions

| # | Intention |
| --- | --- |
| T1 | Every remote path component is rejected unless it is one ordinary safe name — `..`, `/`, `\`, NUL, leading dot, empty — matching `assertSafeComponent()`'s rules |
| T2 | Artifact names, stamps and sidecar text come from the shared contract module and round-trip; a stamp that does not match `YYYYMMDDTHHMMSSZ` is refused |
| T3 | Exact argv is constructed as an array and handed to `spawn` with no shell; no argument is ever interpolated into a shell string; no glob character is expanded; a path containing spaces, quotes or `*` arrives at the child verbatim |
| T4 | **No conflict-strategy flag appears in any constructed argv** — assert the absence of `-f`, `--conflict-strategy`, `create-new-revision`, `rename`, `replace`, `skip` across every operation |
| T5 | **No destructive or out-of-surface operation appears in any constructed argv** — assert absence of `trash`, `delete`, `empty-trash`, `move`, `copy`, `rename`, `sharing`, `invitation`, `list`, `auth` |
| T6 | Each operation's result is exactly the allowlisted field set of §2.3 — assert the returned object's key set equals the expected set, not merely that it contains it |
| T7 | Extra, renamed, or wrongly-typed provider fields produce `indeterminate`, never a success with a defaulted value |
| T8 | **Recursive secret containment (property/fuzz style):** inject secret-shaped keys and values (`token`, `session`, `password`, `passphrase`, `cookie`, `recovery`, `email`, `@`-bearing strings, `https://…auth…` URLs) at every nesting depth of a synthetic provider response, and assert that no allowlisted result, no error message, no log line and no written attestation contains any injected marker |
| T9 | Malformed JSON, truncated JSON, empty stdout, and stdout that is valid JSON of the wrong shape each produce `indeterminate` |
| T10 | Upload order is strictly ciphertext → sidecar → manifest; a recorded invocation log asserts the sequence, and a failure at step *n* means steps *n+1…* never ran |
| T11 | Partial success — ciphertext uploaded, sidecar failed — produces a non-`verified` verdict, writes an attestation naming all three intended paths, and issues no deletion (**split, see below**: E3J5 proves the in-memory half, E3J6 the written attestation) |
| T12 | A timeout and an explicit cancellation each produce `indeterminate` with `transfer_state: "unknown"`, and no produced text claims the remote write was stopped (E3J5 proves this for the in-memory outcome; E3J6 for the written attestation) |
| T13 | A valid readback of a correct triple produces `verified`, with `local_recompute` values computed from the downloaded bytes |
| T14 | An oversized readback is contained: with the tripwire configured, the download is stopped and the verdict is `indeterminate`; the test asserts the *mechanism invoked*, and explicitly documents that it does **not** prove a kernel-level bound (§3) |
| T15 | A corrupt triple (any one of the seven completion rules broken) produces `rejected`, never `verified` |
| T16 | A valid-but-different triple — internally consistent, correct-looking, but not the artifact the producer made — produces `rejected` via the source-hash check of §8.5 step 4 |
| T17 | Attestations are attempt-scoped and immutable: a second write to the same attempt path fails `EEXIST` and does not modify the existing file; two attempts for one base produce two files |
| T18 | After a definite zero-transfer rejection the bounded retry runs and uses a **new** `attemptId` and a **new** remote namespace; after an indeterminate failure no automatic retry occurs in-run (**deferred until the attestation writer is integrated** — §4.5) |
| T19 | No automatic deletion occurs on any path, including every failure path — assert across the whole invocation log of a run that exercised every failure mode |
| T20 | No write is ever directed at a remote path outside `<remoteRoot>/<base>.<attemptId>/`, and the only root-level write is the single `create-folder(<remoteRoot>, <base>.<attemptId>)` — assert the full set of paths passed to `create-folder` and `upload` across a run |
| T21 | Freshness advances only from attestations that are `verdict: "verified"` **and** binding-valid; a rejected, indeterminate, schema-mismatched, or non-binding attestation never moves the number, and a re-delivered older artifact never raises it |
| T22 | `cli.expectedSha512` is required by the validator; a missing, malformed, or mismatched value refuses before any provider command is constructed |
| T23 | The config validator rejects `credentials.backend: "unsafe_file"`, rejects any secret-shaped key, and enforces the path-separation rules of §10.2 |

**[CORRECTED BY E3J3, 2026-09-13] — T22 is split across two sessions, not one.**
As originally written, T22's second half ("refuses before any provider command
is constructed") implies an integration test against a provider-command
constructor. No such constructor exists yet — building one is E3J4's job
(§12), not E3J3's. What E3J3 actually implements and tests is:

- `validateCloudConfig()` requires `cli.expectedSha512` and rejects it if
  missing, empty, wrong length, containing uppercase or non-hex characters —
  covered by `backup-cloud-config.test.mjs`;
- `verifyCliHashPin({expectedSha512, observedSha512})`, a **pure local
  comparison** with no CLI, subprocess, or provider access of any kind: it
  accepts an exact match, and fails closed with a distinct machine-readable
  code (`cli_hash_pin_malformed`, `cli_hash_observed_malformed`,
  `cli_hash_mismatch`) on a malformed pin, a malformed observed value, or a
  mismatch — also covered by `backup-cloud-config.test.mjs`.

The assertion that this comparison actually **runs before** a provider
command is constructed is an integration property of a boundary that does
not exist in this repository yet. It is **E3J4's** test to write, once the
subprocess boundary and its provider-command constructor exist — not
something E3J3 can prove or claims to prove.

**[CLOSED BY E3J4, 2026-09-14; ORDERING AND PROOF RESTATED BY E3J4C]** The
subprocess boundary and its four provider-command constructors now exist
(`ops/backup/lib/backup-cloud-cli.mjs`, over
`ops/backup/lib/internal/backup-cloud-cli-core.mjs`). Each of the four
exported operations (`runInfo`, `runCreateFolder`, `runUpload`, `runDownload`)
performs, in this order and no other:

1. **validate the local call inputs and the cancellation state** — `signal`
   first, before anything reads `.aborted`, then `credentials`, `timeouts`,
   the capture limits, and any operation-specific local input such as upload's
   `expectedLocalSizeBytes`;
2. **compute the executable's real SHA-512 and verify the configured pin** via
   `verifyCliHashPin()`;
3. **only then** validate the operation's own operands, build the fixed argv,
   and spawn.

Hashing is therefore **not** the literal first action — step 1 precedes it, and
any earlier wording in this memo saying otherwise is superseded. What the
ordering guarantees, and what T22 actually asserts, is that **no operand is
inspected, no argv is constructed, and no child is spawned until the hash gate
has passed.**

The proof in `backup-cloud-cli.test.mjs` uses **no injected `buildArgv` spy and
no injectable builder of any kind** — E3J4A's `runOperationForTests()` seam was
removed in E3J4B, and E3J4C removed the remaining `deps` seam from the
production signatures entirely. The final proof is: the SAME deliberately
invalid operand yields the **hash** error under a mismatched (or malformed) pin
and the **operand** error under a matching one, with spawn observed not to be
reached in the mismatch case. Any earlier wording in this memo describing an
injected-`buildArgv`-spy proof is historical provenance only.

T22 is fully closed across E3J3 and E3J4; no further session owns any part of
it. **Hashing still proves only that the file read at hash time had the pinned
content** — the post-hash executable-replacement TOCTOU window remains open and
is not closed by any control in that module.

**[CORRECTION, E3J4, 2026-09-14] — the T8 assertion is also split, not one
piece.** §9's schema note and §11.1's T8 row read as though one test could
assert secret non-leakage end to end, but no attestation writer exists until
E3J6 — there is nothing yet to write a marker INTO an attestation file. E3J4's
T8 tests therefore assert the half that is actually buildable now: no injected
secret-shaped marker survives into this subprocess boundary's own returned
results, thrown errors, or logs (it writes none). The remaining half — that a
WRITTEN attestation file contains no such marker — is E3J6's to prove, once an
attestation writer exists to test against. Until then, "T8 is covered" means
the subprocess-boundary half only.

**[E3J5, 2026-09-16] — T10-T12, T18-T20 ownership.** E3J5
(`backup-cloud-upload.test.mjs`) proves, against an in-memory fake of the three
operations and, for the production route, the real E3J4 boundary spawning the
local fake CLI:

- **T10** in full: strict ciphertext → checksum → manifest order; after a
  failure at upload step _n_ no later upload is requested — a ciphertext or
  checksum failure means no manifest upload, and a manifest failure means the
  manifest upload was requested and nothing follows it.
- **T11, E3J5 half:** partial success yields a non-verified in-memory outcome
  (`transferState: 'unknown'`, the furthest boundary-reported role) naming all
  intended paths, with no deletion. **E3J6 owes the other half: that an
  immutable attestation carrying this is actually written.**
- **T12, E3J5 half:** timeout and cancellation are `indeterminate` with
  `transferState: 'unknown'` whenever an upload call was made, and the outcome
  carries no free text at all. E3J6 owes the same property for the written
  attestation.
- **T19** in full for this module: only `info`, `create-folder`, and `upload`
  are ever called, on every failure path; the bound dependency set has no
  deletion, write, download, or process capability; local source files are
  byte-identical afterwards.
- **T20** in full under the corrected layout.
- **T18 is not started** — deferred until the attestation writer exists.

**[E3J6A, 2026-09-16] — the containment and source-evidence portions of
T8/T13-T17.** `backup-cloud-cli.test.mjs`, `backup-cloud-containment.test.mjs`
and `backup-cloud-upload.test.mjs` prove: the exact contained argv and the
CLI-then-wrapper hash-gate order; removal of the uncontained download; T14's
mechanism half (a canary refused under a non-enforcing wrapper, a wrong
wrapper pin, `quota_mount`, an untrusted directory, a collision, an
unrepresentable overshoot or refused path, or an unconfirmed child — including
one that has an exit status but no `close`); a real-`prlimit` cap at exactly C on disposable local
probes; exact-C clean success; conservative exact-C non-clean handling);
unforgeable proofs; one-shot preparation under concurrency; source evidence
captured before any boundary call; inclusive ceilings; closed identity
outcomes; and no leakage of injected markers, native text, or provider text
from those boundaries.

**[E3J6B, 2026-09-17]** T13, T15, T16, T17, the readback half of T14, and the
written-attestation halves of T8, T11, and T12 are now CLOSED
(`backup-cloud-attestation-records.test.mjs`, `backup-cloud-readback.test.mjs`,
`backup-cloud-attempt-verdict.test.mjs`, `backup-cloud-attempt.test.mjs`).
T15's premise is corrected in passing: once every downloaded role must
hash-match a source that already passed `verifyArtifactCompletion()`, a
completion-rule break cannot be driven through a full attempt while also
satisfying source-hash equality, so it is tested where it is actually
reachable — corrupted or substituted bytes stopped by the role comparison
before any parse, the in-memory completion adapter exercised directly with
synthetic inputs, and an injected faulty adapter after matching evidence
producing `completion_adapter_internal_contradiction`. **E3J6C** owes T18 and
the lock.

### 11.2 What a fake CLI proves, and what it cannot

**Can prove:** argv construction and the absence of forbidden flags; ordering;
allowlisting and secret containment (of this module's own returned/thrown
values — see the T8 split above); error classification; verdict logic;
attestation immutability and content; retry behaviour; freshness arithmetic;
configuration fail-closure. In short, **everything that is this repository's own
logic.**

**Cannot prove, and must never be described as proven:**

- **real provider behaviour** — how Proton actually responds to a partial
  upload, a mid-transfer interruption, a duplicate folder creation, or an
  object larger than anything tested; U7 remains only partially informed and
  resumability is untested **[E3I]**;
- **real network conditions** — timeouts, retries, throughput, or an upload that
  succeeds server-side after the local client dies;
- **real credential lifecycle** — U1 is open, Hotel-Echo is entirely untested,
  and reboot and logout behaviour are unknown **[E3I]**;
- **real containment** — T14 asserts the mechanism fires, not that the kernel or
  filesystem enforces a bound (§3.3);
- **that anything is monitored** — no watcher exists and no human has received a
  test notification (§5.6).

---

## 12. Proposed session sequence

Each session is independently completable, independently reviewable, and leaves
the repository in a state that still passes `pnpm test:backup-producer`. Local
sessions need no provider, no host, and no credential.

| Session | Scope | Touches a provider or host? |
| --- | --- | --- |
| **E3J2** | **Shared artifact-contract extraction** (§1.3, §1.4). **DONE (2026-09-13).** Behaviour-preserving move into `backup-artifact-contract.mjs` — including `BackupError`, re-exported from `backup-producer.mjs` for import-path compatibility; producer and acceptor import from it; no new exported function (`publishedTripleNames()` deferred to E3J3); acceptance criterion is 179/179 with no assertion text changed — met exactly. See the §1.3 dependency-graph correction: the acceptor's non-contract `checkCapacity()` dependency on the producer was out of scope and remains | no |
| **E3J3** | **Naming, remote paths, and the cloud config surface.** **DONE (2026-09-13), corrected same-day by E3J3B after independent review.** `publishedTripleNames()`/`ARTIFACT_PREFIX_PATTERN` (§1.3); new `backup-cloud-naming.mjs` (safe remote-component validation, canonical-remote-root validation, `assertValidArtifactBase()` identity-shape validation, self-validating `attemptId` construction, the attempt namespace, the three published object paths, the attestation filename — §4, §8.1); new `backup-cloud-config.mjs` (fail-closed cloud config validator/loader with LEXICAL canonical-path enforcement before containment comparison, a generic secret-key rejection message, a frozen `backingVolume` result, `verifyCliHashPin()`) and `eanhl-backup-cloud.example.json` (§10); T1, T2, the E3J3 portion of T22 (corrected above), and T23 — **56 new tests over the 179-test baseline (5 artifact-contract + 19 naming + 32 config), full suite 235/235, 0 fail.** No Proton CLI argv, subprocess, upload, download, or attestation writer — those remain E3J4 onward | no |
| **E3J4** | **Subprocess boundary and the fake CLI.** **DONE (2026-09-14), corrected same-day by E3J4A, then E3J4B, then E3J4C, each after its own independent security review pass.** `backup-cloud-cli.mjs` now: constructs argv for the four operations (§8.3) with option-injection-safe operand validation and generic (non-echoing) rejection errors; runs the hash gate closing T22 (§11.1) strictly before argv/spawn, with no injectable builder anywhere in the module; spawns with `shell:false` explicit and a POSITIVE environment allowlist (not a copy-and-strip); classifies credential-unavailable/not-found/name-conflict text with EXACT anchors bound to the actual queried path or uploaded file identity (never a substring match, never accepted on an unrelated identity); treats a capture-stream failure the same as a timeout/overflow (`provider_stream_failed`); validates timeouts as positive safe integers with the grace-below-timeout coherence rule; validates download's local evidence defensively; and returns only frozen results from a closed `CLOUD_CLI_ERROR_CODES` enum, through a closed ten-name export surface. **E3J4C** then moved the boundary logic to `internal/backup-cloud-cli-core.mjs` so the production operations accept NO dependency override at all (the remaining `deps` seam), made upload cross-check the provider byte count against caller-supplied `expectedLocalSizeBytes` and stop promoting `skippedItems: 1` to success, bound download's local evidence to the exact immediate child of `localDir` named by the queried remote basename with a pre-spawn non-symlink-following absence check and a regular-file-only readback, switched every provider-derived byte count to `Number.isSafeInteger`, and made `validateLocalStat()` observe `isFile()` and `size` exactly once each inside their own `try`. New `testdoubles/fake-proton-drive.mjs` (disposable local double; its own exit-before-drain race, fixed in E3J4A, re-verified stable across 10 consecutive runs in E3J4B; records environment KEY NAMES only, never values) and `backup-cloud-cli.test.mjs` — **119 tests total (44 E3J4 + 31 E3J4A + 18 E3J4B + 26 E3J4C), full suite 354/354**. Independent review first reproduced the E3J4 session's own claimed 44/44 as 41/44, then — after E3J4A's fix — found ten further boundary-logic defects, then seven more in E3J4C (see the correction entries at the top of this memo for the itemized lists). No orchestration (attempt workflow, collision preflight, ordered triple upload, retry, lock ownership — E3J5) or readback containment/attestation (E3J6) | no |
| **E3J5** | **Uploader orchestration.** **DONE (2026-09-16).** New `backup-cloud-upload.mjs` (thin production API, one export `runUploadAttempt({config, artifactBase, signal})` plus five frozen vocabularies) over `internal/backup-cloud-upload-core.mjs` (internal test seam, static importer regression). One explicit artifact base, no scanning; local triple validated (non-empty regular files via `lstat`, safe-integer sizes, `verifyArtifactCompletion()` with its text discarded, identity re-observed around every upload); flat layout (§4.2, §8.1) and the rewritten §8.2 order; uploads stop at the first non-success; a frozen evidence outcome with no verdict. Minimal read-only real dependencies, not `makeRealDeps()`. T10, T19, T20 in full; the E3J5 halves of T11 and T12 (§11.1). `fake-proton-drive.mjs` gained an additive `sequence` / `notFoundForQueriedBasename` mode. **56 new tests + 3 naming tests; full suite 413/413.** No retry (T18 deferred), no lock, no entrypoint, no readback, no attestation | no |
| **E3J6** | **[E3J6A DONE 2026-09-16 (committed, `70abb63`); E3J6B DONE 2026-09-17 — readback, independent verdict, and the durable intent/attestation records, see the correction entry at the top; E3J6C (entrypoint, lock, retry) remains.]** **Readback containment and attestation.** The readback path, the containment tripwire, the attestation schema and writer, plus T13-T17, the E3J6 halves of T8, T11, and T12, and — once the writer exists — bounded retry (T18). Consumes the E3J5 evidence outcome and derives its verdict independently. The first executable entrypoint, wherever it lands, owns `run.lockFile`, with a lock spanning upload, readback, and attestation | no |
| **E3J7** | **Freshness export and evaluation.** The attestation reader, `validateCloudAttestationBinding()`, the freshness number, the minimal exported health signal, plus T21 | no |
| **E3J8** | **Independent alerting.** Watcher host, channel, and a received test notification. Until this closes, nothing is monitored | yes — operator decision D1, **U15** |
| **E3J9** | **Credential mechanism.** A service-compatible credential-access design for Hotel-Echo, closing U1's remainder | yes — separate authorization |
| **E3J10** | **Hotel-Echo deployment.** CLI install and pin, containment mechanism proof (§3.3), directory and permission setup | yes — separate authorization |
| **E3J11** | **Production size measurement.** A measured production dump/ciphertext series, closing U5's numeric production-envelope portion and the byte-value portion of U12. Does **not** set U13 — a size series does not settle transfer timing or retry policy | yes — production database |
| **E3J12** | **Production transfer/timing calibration.** Measured production upload/download behaviour on the intended host/link/provider path, calibrating the timeout portion of U13. Retry counts and backoff remain an operator reliability/debris-accumulation policy decision, informed but not mechanically determined by these measurements | yes — production upload/download on Hotel-Echo's Proton path |
| **E3J13** | **Retention and pruning.** Still blocked by C10 on five unproven provider behaviours, and constrained by `backup-producer.md` §7 requirement 8 | yes |
| **E3J14** | **Restore drill.** Recover into a disposable database and verify critical table counts and representative application reads | yes — separate authorization |

Sessions E3J2-E3J7 are local and can proceed in order without any further
provider or host authorization. E3J8 onward each require their own.

---

## 13. GO / NO-GO for the first local implementation session

**Session: E3J2 — behaviour-preserving extraction of the shared artifact
contract into `ops/backup/lib/backup-artifact-contract.mjs`, exactly as scoped
in §1.3 (as corrected by E3J1A): the symbols listed there move, including the
explicit `BackupError` resolution, and nothing else.**

**Verdict: GO — narrowed to that exact extraction, and to nothing broader.**

**Implementation status: DONE (2026-09-13).** The extraction happened exactly
as scoped: `ops/backup/lib/backup-artifact-contract.mjs` now holds
`BackupError`, `MANIFEST_SCHEMA_VERSION`, `ARTIFACT_SUFFIXES`,
`SNAPSHOT_STAMP_PATTERN`, `formatSnapshotStamp()`, `buildArtifactNames()`,
`formatChecksumSidecar()`, `parseChecksumSidecar()`, and
`verifyArtifactCompletion()`. `backup-producer.mjs` imports and re-exports all
of them (so `eanhl-backup.mjs`'s `import { BackupError } from
'./lib/backup-producer.mjs'` and its `instanceof` checks keep resolving to the
same class); `backup-config.mjs` re-exports `MANIFEST_SCHEMA_VERSION`;
`backup-acceptance.mjs` drops its own `ROLE_SUFFIX`/`STAMP` and imports
`ARTIFACT_SUFFIXES`/`SNAPSHOT_STAMP_PATTERN` directly from the contract module,
keeping only its pre-existing, non-contract `checkCapacity()` import from
`backup-producer.mjs` (§1.3 correction above). `pnpm test:backup-producer`:
**179/179 pass, 0 fail, no assertion text changed.** `checkCapacity()` was not
moved — it was never in scope (§1.3, §12).

Why this specific session, and why now:

- **It is the prerequisite this analysis identified.** §1.4 recommends the
  extraction *before* any uploader code, and every later local session (E3J3-E3J7)
  imports from the module it creates.
- **Its correctness criterion already exists and already passes.** The suite was
  run during this session: **179/179 pass, 0 fail**. The acceptance criterion is
  mechanical — same 179 tests, same assertions, import paths only.
- **It touches nothing outside the repository.** No provider, no host, no
  credential, no key, no database, no Docker, no network, no Gate checkbox.
- **It is bounded to one objective**, which is the session discipline `CLAUDE.md`
  requires.
- **It is reversible.** A behaviour-preserving move is a clean revert if review
  disagrees with the module boundary.

**Explicitly NOT approved by this verdict:** `publishedTripleNames()` or any
other new exported function or uploader-oriented helper (deferred to E3J3, §1.3);
uploader implementation; any provider command; any Hotel-Echo or main-PC
action; credential work; deployment; scheduling; retention or pruning; a
restore drill; any production numeric value; and E3 activation.

---

## 14. Closing statement

**No Proton account was accessed, authenticated, or contacted. No Proton Drive
CLI command was run. No Drive object was uploaded, downloaded, listed, created,
trashed, deleted, shared, or inspected. No credential, token, session,
passphrase, account identifier, or recovery material was requested, received,
printed, stored, or handled. No key was generated or touched. Neither
Hotel-Echo nor the main PC's Proton, credential, or GPG state was accessed or
changed. No database, Docker, migration, deployment, scheduling, retention,
pruning, restore, or tunnel action occurred. No code, test, configuration,
example JSON, or dependency was modified; the aggregate E3J1/E3J1A/E3J1B change
set is exactly three repository files: this memo, one `HANDOFF.md` Active State
entry, and `proton-drive-transport-feasibility.md` §9 (limited to adding
U12-U15; U1-U11 unchanged). The local backup unit suite
(`node ops/backup/run-suite.mjs`) ran as a local repository test against
disposable temporary filesystem and process-double state; it contacted no
provider, host, database, or credential store, and left tracked repository
content unchanged (179/179 pass, 0 fail). No Gate checkbox changed. Nothing was
staged, committed, or pushed.**

**E3 remains unactivated. This memo is a design; the uploader, the attestation
writer, the freshness evaluator, the watcher, and the alert channel do not
exist.**
