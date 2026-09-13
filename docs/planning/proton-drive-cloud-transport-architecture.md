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
remove and still exists ·
**Status:**
**DESIGN AND ANALYSIS FOR CLOUD TRANSPORT AND ATTESTATION — NOT ACTIVATED.**
The **E3J2** shared artifact-contract extraction (§1.3, §12, §13) is
implemented locally and behaviour-preserving; it is local repository
refactoring of existing producer/acceptor code, not a Proton Drive uploader or
any other cloud behaviour. Everything else this memo designs — the Proton
Drive uploader, transport, readback, attestation, monitoring, credential
handling, deployment, scheduling, retention, and restore work — remains
unimplemented and unactivated. **NOTHING BEYOND THAT ONE LOCAL EXTRACTION IS
APPROVED FOR ACTIVATION.**

This memo defines the proposed architecture for the component that pushes
producer-generated backup artifacts from Hotel-Echo to Proton Drive through the
official Proton Drive CLI, and for the **cloud attestation** record that
source-side freshness monitoring would later consume. The E3J1 design session
that authored this memo wrote no code, changed no configuration, contacted no
provider, touched no host, and closed no E3 item. Its prerequisite extraction,
**E3J2**, was carried out afterward in a separate local session (§12, §13):
that session touched only `ops/backup/lib/`, moved existing local code
behaviour-preservingly, and involved no provider, host, credential, or
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
| `transferredBytes` | non-negative integer | **untrusted** — cross-checked against the local file size the uploader measured itself |
| `skippedItems` | `0 \| 1` | trusted |
| `failedItems` | `0 \| 1` | trusted |
| `failureCodes` | `string[]` drawn from the closed enum | trusted |

The terminal summary shape `{transferredItems, transferredBytes, skippedItems,
failedItems, failures[]}` is what E3I1 §7.2 recorded. **[E3I]** `failures[]`
carries provider text and is therefore **consumed and discarded**; only the
mapped codes survive.

**`download` (one remote path, one local destination, one invocation)**

| Field | Type | Trust |
| --- | --- | --- |
| `localPath` | `string` | trusted — it is the path the uploader chose, echoed back, never parsed from provider output |
| `bytesWritten` | non-negative integer | trusted — obtained from a local `fstat` on the descriptor the uploader opened, **not** from provider output |
| `completed` | `true` | trusted |

**The `download` result deliberately carries no provider-derived field.** Its
only job is to say that a local file now exists; everything that matters about
that file is computed locally afterwards.

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
folder, created by that attempt:

```
<remoteRoot>/<artifactBase>/<attemptId>/<base>.dump.age
<remoteRoot>/<artifactBase>/<attemptId>/<base>.dump.age.sha256
<remoteRoot>/<artifactBase>/<attemptId>/<base>.manifest.json
```

`<artifactBase>` and every name inside it come from the shared contract module
(§1) and are validated as single path components before use — the same rule
`assertSafeComponent()` enforces today (`backup-acceptance.mjs:104-127`). The
`<attemptId>` segment is what makes every remote write target a path that has
never existed, which is what lets the collision precheck in §8.2 be meaningful.

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
`<remoteRoot>/<base>/<attemptId>/`. It may be empty; it may hold a truncated
object; it may hold a complete object the CLI failed to report. Re-uploading
into that namespace means either a name collision (which E3I1 §7.4 proved fails
closed, **[E3I]**) or — worse, if a conflict strategy were ever passed — a
silent revision or replacement of an object of unknown content.

**An indeterminate namespace is therefore retired permanently and automatically
by construction:** the next attempt gets a new `attemptId`, so it targets a path
that has never existed. No code ever computes "the previous attempt's path" for
a write. Cleaning the retired namespace is a **manual** operator action (§4.6).

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

The consequence is that the credential mechanism is its **own** session (§12,
E3J9) and its own unknown (U1), and that the uploader can be designed, built and
tested against a fake CLI without it.

---

## 8. Transport protocol

### 8.1 Remote layout

```
<remoteRoot>/<artifactBase>/<attemptId>/{ciphertext, sidecar, manifest}
```

`<remoteRoot>` is configuration (§10) and is **unresolved, U14**. Every segment
below it is derived from the artifact identity and the attempt id, validated as
a single safe path component before use.

**No mutable remote pointer of any kind is uploaded** — no `latest.json`, no
fixed artifact name, no rewriting of any remote name. C12 rejects it on identity
grounds, and E3I1 §7.4 gives the mechanical reason: a same-name re-upload with
`create-new-revision` kept one node but **doubled that node's reported
`totalStorageSize`** (1,048,723 → 2,097,446), with the superseded revision still
represented in the node's storage metadata. **[E3I] [REPO]** Note the producer's
local `latest.json` (`backup-producer.mjs:1576-1593`) stays local; it is not
part of the triple and is never uploaded.

### 8.2 Preflight collision checks

Before any write, `filesystem info` is run **on each exact path this attempt
intends to create** — the attempt folder and the three object paths — and each
must report not-found. Any path that resolves is a hard refusal
(`remote_namespace_occupied`), never an overwrite, mirroring the producer's
local identity-collision refusal (`backup-producer.mjs:1167-1174`) and the
acceptor's archive-conflict rule (`backup-acceptance.mjs:1305-1328`).

This is exactly the access pattern E3I3 demonstrated: **14 exact paths queried
one at a time with `filesystem info --json`, with `/my-files`, `/trash` and
every parent's children never enumerated.** **[E3I]**

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

## 9. The cloud-attestation schema

Append-only, one file per attempt (§4.2), written `O_CREAT|O_EXCL` with mode
`0600`, then read back and compared before being treated as written — the
read-back-and-confirm pattern `writeFileVerified()` already uses
(`backup-acceptance.mjs:755-770`). Its schema version is its **own** constant
(proposed `CLOUD_ATTESTATION_SCHEMA_VERSION`), independent of
`MANIFEST_SCHEMA_VERSION` and `RECEIPT_SCHEMA_VERSION`
(`backup-acceptance-config.mjs:47`).

```jsonc
{
  "kind": "eanhl.cloud-attestation",
  "schema_version": 1,

  // ── source artifact identity ────────────────────────────────────────────
  "artifact": {
    "base": "<prefix>-<stamp>",
    "ciphertext": "<base>.dump.age",
    "checksum": "<base>.dump.age.sha256",
    "manifest": "<base>.manifest.json"
  },
  "source_snapshot_ts": "2026-09-04T18:00:07Z",   // from the producer manifest
  "source_run_id": "<producer run_id>",
  "source_host": "<producer manifest source.host>",

  // ── this attempt ────────────────────────────────────────────────────────
  "attempt_id": "<UTC compact>-<8 hex>",
  "attempt_started_at": "<ISO-8601 UTC>",
  "attempt_finished_at": "<ISO-8601 UTC>",

  // ── the verdict: exactly these three values, no others ──────────────────
  "verdict": "verified | rejected | indeterminate",

  // ── the exact remote paths this attempt used (locally constructed) ──────
  "remote": {
    "root": "<configured remoteRoot>",
    "namespace": "<remoteRoot>/<base>/<attempt_id>",
    "ciphertext_path": "<namespace>/<base>.dump.age",
    "checksum_path": "<namespace>/<base>.dump.age.sha256",
    "manifest_path": "<namespace>/<base>.manifest.json"
  },

  // ── what the uploader computed itself, from the readback ────────────────
  "local_recompute": {
    "ciphertext": { "sha256": "<64 hex>", "bytes": 0 },
    "checksum":   { "sha256": "<64 hex>", "bytes": 0 },
    "manifest":   { "sha256": "<64 hex>", "bytes": 0 }
  },

  // ── binding result ──────────────────────────────────────────────────────
  "binding": {
    "completion_ok": true,
    "completion_failures": [],          // repository-authored text only
    "matches_source_ciphertext_sha256": true,
    "manifest_identity_ok": true
  },

  // ── untrusted provider observations — recorded, never decisive ──────────
  "provider_observations": {
    "trusted": false,
    "ciphertext": {
      "node_uid": "…", "active_revision_uid": "…", "state": "active",
      "claimed_size_bytes": 0, "claimed_sha1": null, "sha1_verified": false
    },
    "checksum": { "…same allowlisted shape…" },
    "manifest": { "…same allowlisted shape…" }
  },

  // ── CLI identity evidence ───────────────────────────────────────────────
  "cli": {
    "executable": "/absolute/path",
    "expected_sha512": "<128 hex, from config>",
    "observed_sha512": "<128 hex, computed locally this run>",
    "version": "cli-drive@0.8.0+…",
    "version_evidence": "from_deployment_record | isolated_network_namespace | unisolated"
  },

  // ── timings ─────────────────────────────────────────────────────────────
  "timings_ms": {
    "preflight": 0, "create_folder": 0,
    "upload_ciphertext": 0, "upload_checksum": 0, "upload_manifest": 0,
    "readback": 0, "verify": 0, "total": 0
  },

  // ── sanitized structured failure info ───────────────────────────────────
  "failure": {
    "stage": "preflight | create_folder | upload | readback | verify | null",
    "code": "<closed enum>",
    "transfer_state": "definitely_zero | unknown"
  }
}
```

Notes on specific fields:

- **`verdict` has exactly three values.** No `partial`, no `pending`, no
  `warning`. Anything that is not a proven success or a proven refusal is
  `indeterminate`.
- **`provider_observations` is nested under an explicit `"trusted": false`
  marker** so that a reader — human or program — cannot mistake it for evidence.
  Its fields are precisely the allowlist of §2.3 and nothing else. It exists
  because the observations are useful for later diagnosis (for example, whether
  a revision uid ever changed under a path that should never have been
  rewritten), not because they support the verdict.
- **`completion_failures` carries repository-authored strings** produced by
  `verifyArtifactCompletion()` (`backup-producer.mjs:226-288`), which describe
  local paths and hashes only. It never carries provider text.
- **`cli.version_evidence` is mandatory** and makes §6.2's distinction
  machine-readable.

**What must NEVER appear, in any field, at any nesting depth:** secrets, tokens,
session material, credentials, passwords, passphrases, cookies, recovery
material, account identifiers or e-mail addresses, authentication URLs, raw CLI
stdout or stderr, raw provider JSON, and any provider-authored free text. A
recursive assertion enforcing this is a required test (§11, T8).

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
| `readback.containment` | `'rlimit_fsize' \| 'quota_mount'` — declares which proven mechanism is deployed (§3.3); required, no default; enforces the applicable per-role ceiling above for each one-file-per-process download |
| `run.lockFile`, `run.operationTimeoutMs`, `run.cancelGraceMs` | same discipline as `backup-config.mjs` `run.*` |
| `retry.*` | **U13** |
| `capacity.minFreeBytes`, `capacity.backingVolume` | reused wholesale, including the required-but-nullable `backingVolume` rule (`backup-config.mjs:99-123`) |

Path-separation rules are validated the way
`backup-acceptance-config.mjs:150-206` validates its own: no directory inside
another, all distinct, all absolute.

**(c) Secret/session material — never in configuration at all.** No passphrase,
no token, no session file path, no account identifier, no e-mail, no unlock
command, no `PROTON_DRIVE_CREDENTIALS_STORE` *value beyond the backend
selector*. The uploader consumes an already-unlocked context (§7.2). The
validator should refuse any key whose name matches a secret-shaped pattern, so a
well-meaning operator cannot add one.

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
| T11 | Partial success — ciphertext uploaded, sidecar failed — produces a non-`verified` verdict, writes an attestation naming all three intended paths, and issues no deletion |
| T12 | A timeout and an explicit cancellation each produce `indeterminate` with `transfer_state: "unknown"`, and no produced text claims the remote write was stopped |
| T13 | A valid readback of a correct triple produces `verified`, with `local_recompute` values computed from the downloaded bytes |
| T14 | An oversized readback is contained: with the tripwire configured, the download is stopped and the verdict is `indeterminate`; the test asserts the *mechanism invoked*, and explicitly documents that it does **not** prove a kernel-level bound (§3) |
| T15 | A corrupt triple (any one of the seven completion rules broken) produces `rejected`, never `verified` |
| T16 | A valid-but-different triple — internally consistent, correct-looking, but not the artifact the producer made — produces `rejected` via the source-hash check of §8.5 step 4 |
| T17 | Attestations are attempt-scoped and immutable: a second write to the same attempt path fails `EEXIST` and does not modify the existing file; two attempts for one base produce two files |
| T18 | After a definite zero-transfer rejection the bounded retry runs and uses a **new** `attemptId` and a **new** remote namespace; after an indeterminate failure no automatic retry occurs in-run |
| T19 | No automatic deletion occurs on any path, including every failure path — assert across the whole invocation log of a run that exercised every failure mode |
| T20 | No write is ever directed at a remote path outside `<remoteRoot>/<base>/<attemptId>/` — assert the full set of paths passed to `create-folder` and `upload` across a run |
| T21 | Freshness advances only from attestations that are `verdict: "verified"` **and** binding-valid; a rejected, indeterminate, schema-mismatched, or non-binding attestation never moves the number, and a re-delivered older artifact never raises it |
| T22 | `cli.expectedSha512` is required by the validator; a missing, malformed, or mismatched value refuses before any provider command is constructed |
| T23 | The config validator rejects `credentials.backend: "unsafe_file"`, rejects any secret-shaped key, and enforces the path-separation rules of §10.2 |

### 11.2 What a fake CLI proves, and what it cannot

**Can prove:** argv construction and the absence of forbidden flags; ordering;
allowlisting and secret containment; error classification; verdict logic;
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
| **E3J3** | **Naming, remote paths, and the cloud config surface.** `backup-cloud-config.mjs`, the example JSON, the safe-path/namespace construction, plus T1-T2, T22-T23 | no |
| **E3J4** | **Subprocess boundary and the fake CLI.** argv construction, the allowlisting projector, the error-code enum, the sanitiser, plus T3-T9 | no |
| **E3J5** | **Uploader orchestration.** Preflight, create-folder, ordered uploads, partial-failure handling, cancellation, plus T10-T12, T19-T20 | no |
| **E3J6** | **Readback containment and attestation.** The readback path, the containment tripwire, the attestation schema and writer, plus T13-T18 | no |
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
