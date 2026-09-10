# Proton Drive transport feasibility — E3B provider research, corrected (E3B2)

**Stage:** E3B, reconciled and corrected by E3B2 · **Date:** 2026-09-10 ·
**Status:** **PROVIDER FEASIBILITY RESEARCH ONLY — NOT AN ARCHITECTURE
APPROVAL.**

This memo records what public, official Proton documentation says about using
Proton Drive as the primary off-host backup destination decided in E1A, what
this repository's existing producer/acceptor contract actually requires, and
where the two do not yet meet. **It selects no architecture, approves no
design, authorizes no experiment, and closes no E3 item.** E3 remains
unactivated.

---

## 1. What this session did and did not do

**Did:** read `HANDOFF.md` (E1A, E1D, E1E, the isolated backup checkpoint, the
E3 roadmap section), `docs/operations/backup-producer.md`,
`docs/operations/backup-acceptance.md`, and the whole of `ops/backup/`
(producer, acceptor, config validators, example configs); read current public
Proton documentation and the public Proton Drive SDK/CLI repository; wrote this
memo and one summary entry in `HANDOFF.md`.

**Did not, and was not authorized to:**

- access, authenticate to, or create any Proton account;
- install, download, or build the Proton Drive CLI or the Proton Drive SDK;
- upload, download, list, share, trash, or delete any Proton Drive object;
- read or change any Proton account, storage, sharing, or version-history
  setting;
- access Hotel-Echo or the main PC;
- install `age`, generate, escrow, or touch any key material;
- change any code, configuration, example JSON, test, dependency, provider
  setting, or checklist box;
- deploy, schedule, activate, stage, commit, push, or reopen the tunnel
  (tunnel reopening remains separately unauthorized).

**No Proton action, host action, key action, or deployment action occurred
during E3B2.**

---

## 2. Provenance and a repository-state correction

Two provenance facts must be recorded before the findings, because they change
how much weight the findings can carry:

- **The E3B report is not in this repository and was not supplied to this
  session as a document.** It exists only as the correction list handed to
  E3B2. Every "E3B claimed…" statement below is therefore reconstructed from
  that correction list, not quoted from a source document. Where a claim is
  reconstructed rather than quoted, it is marked *(reconstructed)*.
- **Neither E3A nor E3B has an `HANDOFF.md` Active State entry.** The most
  recent entry before E3B2 is E2I (2026-09-10). The repository therefore has no
  independent record of E3A's read-only scope review or of E3B's research
  beyond this memo. E3B2 does not reconstruct E3A.

**Consequence:** this memo is the repository's *first and only* record of E3B.
It is corrected research, not a validated report, and nothing in it has been
tested against a live Proton account.

---

## 3. Evidence classification

Every finding below is tagged. The tags are load-bearing — do not promote a
finding from one tier to another without new evidence.

| Tag | Meaning |
| --- | --- |
| **[OFFICIAL]** | Stated in current official Proton documentation or the official Proton Drive SDK/CLI repository, retrieved 2026-09-10. Links in §12. |
| **[REPO]** | Verifiable in this repository at `d5b3561`, with a file/line reference. |
| **[INFER]** | A conclusion drawn from the above. Reasoning is given; the conclusion itself is not documented anywhere. |
| **[UNKNOWN-AUTH]** | Cannot be settled without an authenticated, mutating Proton experiment that has not been authorized or run. |

---

## 4. Repository baseline the transport must satisfy

These are the facts a Proton transport design has to be measured against. All
are **[REPO]**.

**4.1 The artifact is a triple, not a file.** The producer publishes four names
per run and three published files
([`backup-producer.mjs:89-99`](../../ops/backup/lib/backup-producer.mjs#L89-L99)):

```
<prefix>-<snapshotTs>.dump.age            ciphertext
<prefix>-<snapshotTs>.dump.age.sha256     checksum sidecar
<prefix>-<snapshotTs>.manifest.json       plaintext metadata, no secrets
```

`<snapshotTs>` is second-granularity UTC (`20260904T180007Z`,
[`backup-producer.mjs:70-87`](../../ops/backup/lib/backup-producer.mjs#L70-L87)).
The base name is the artifact identity.

**4.2 Acceptance is defined on the triple.** The destination acceptor
recomputes `sha256(ciphertext)` and checks it against *both* the sidecar and
`manifest.ciphertext.sha256`, and validates that the manifest names the
ciphertext it claims
([`backup-acceptance.mjs:196-245`](../../ops/backup/lib/backup-acceptance.mjs#L196-L245);
`docs/operations/backup-producer.md` §7 requirement 1). Presence of files is
explicitly *not* completion (`backup-producer.md:157`).

**4.3 There is no ciphertext ceiling in the producer contract.** _(as of this
memo's writing, 2026-09-10 — see the RESOLVED note under §4.4)_ The producer
enforced `staging.maxPlaintextBytes` on the dump — still true today, just at a
shifted line after E3C2's helper insertion
([`backup-producer.mjs:1299`](../../ops/backup/lib/backup-producer.mjs#L1299))
— and derived the ciphertext allowance as
`staging.maxStagingBytes - plaintextBytes`, a formula E3C2 removed and
replaced (see below); that removed formula no longer exists at any current
line, so it is cited at the pre-E3C2 baseline commit instead
([`backup-producer.mjs:1292-1301` at baseline `da337335`](https://github.com/utiz23/TheMississagaBoogeymen/blob/da337335bb321c981c57643cdf85a2c275aabc7d/ops/backup/lib/backup-producer.mjs#L1292-L1301)).
With the then-current example values (`maxPlaintextBytes` 2 GiB,
`maxStagingBytes` 5 GiB, `ops/backup/eanhl-backup.example.json`), a published
ciphertext was bounded only by _just under 5 GiB_ — the config validator
merely required `maxStagingBytes > maxPlaintextBytes`, unchanged in content
and still present today, just at a shifted line
([`backup-config.mjs:251-256`](../../ops/backup/lib/backup-config.mjs#L251-L256)).
**E3C2 added the missing explicit `staging.maxCiphertextBytes` ceiling; see the
RESOLVED note under §4.4.**

**4.4 The acceptor's ciphertext ceiling is 256 MiB.** _(as of this memo's
writing, 2026-09-10 — see the RESOLVED note below)_
`acceptance.maxCiphertextBytes` was `268435456` in
`ops/backup/eanhl-backup-accept.example.json`, with `maxManifestBytes`
1 MiB and `maxSidecarBytes` 4096. **The proposed producer and the proposed
acceptor configurations disagreed by roughly a factor of 20.** Neither was a
finalized production value; both were examples.

**RESOLVED (E3C2, same day, later session): the contract-shape mismatch is
closed.** The producer gained an explicit, required `staging.maxCiphertextBytes`
(`docs/operations/backup-producer.md` §2.7, §6.6a); both example configs are
now aligned at `5368709120` (5 GiB) — still explicitly non-production examples,
not an approved ceiling. **What remains open is the real production numeric
value**, which is unrelated to the contract shape and is tracked at U5 below.

**4.5 The existing acceptor is a POSIX-filesystem component, not a cloud
client.** It opens inbox sources once with `O_NOFOLLOW`, reads payload bytes
only from the held descriptor, takes type and size from `fstat`, and re-resolves
the path afterwards to re-prove containment by device+inode
(`backup-acceptance.md` §2.2, §6.7). Its unproven deployment assumptions are
filesystem and key-restriction properties: a transport identity that can write
*only* the inbox (`restrict,command="rrsync -wo -no-del …inbox"`), a
non-writable inbox parent, and truthful stable `st_dev`/`st_ino`
(`backup-acceptance.md` §6.1, §6.7).

**4.6 No transport exists, and no Proton code exists.** `grep` over `ops/` and
`docs/operations/` finds **zero** occurrences of `proton`, `Proton` or `rclone`.
There is no transport, no timer, no systemd unit, no acceptor CLI entry point,
no inbox on any host, and no artifact has ever been produced or accepted
(`HANDOFF.md`, isolated-backup checkpoint). The producer has a CLI
(`ops/backup/eanhl-backup.mjs`); the acceptor does not.

**4.7 Pruning is a requirement, not an implementation.** `backup-producer.md`
§7 requirement 8: pruning "runs on the host that owns the directory, on its own
timer, never remotely, and never on an artifact that has not been accepted
elsewhere." Requirement 8 is recorded there as **not implemented**.

---

## 5. Accepted E3B findings

These E3B conclusions survive review and are recorded as findings.

**A1 — An official Proton Drive CLI exists and is positioned for automation.**
**[OFFICIAL]** Proton documents a CLI for macOS, Windows and Linux covering
"sign in and out, browse and manage files and folders (including trash), and
handle sharing and invitations," with `--json` output for downstream tooling,
and explicitly names "deployment scripts, backup jobs, cron, or internal
runbooks" as intended contexts. Commands documented include
`proton-drive auth login`, `filesystem list`, `filesystem upload`,
`filesystem download`, and `sharing invite`.

**A2 — Authentication is browser-based.** **[OFFICIAL]**
`./proton-drive auth login` "authenticate[s] via your browser." There is no
documented command-line password entry.

**A3 — A persistent credential store exists, with three backends.**
**[OFFICIAL]** The SDK repository's CLI README documents
`PROTON_DRIVE_CREDENTIALS_STORE` with `keychain` (default; OS secret store
under service `ch.proton.drive/drive-sdk-cli`), `pass` (a GPG-encrypted entry
in password-store), and `unsafe_file` (plaintext, testing only).
`PROTON_DRIVE_CACHE_DIR` can consolidate cache, app data and logs.

**A4 — Trash is not deletion, and trashed objects still consume quota.**
**[OFFICIAL]** "Trashed files and folders are sent to the Trash tab. They are
not permanently [deleted] and still count toward your Proton Drive storage."
This is directly material to E1D's capacity model and to any retention design.

**A5 — Version history exists, is plan-dependent, and consumes quota.**
**[OFFICIAL]** Free: up to 10 versions per file for up to 7 days, not
configurable. Paid: up to 200 versions for up to 10 years, with retention
selectable (7/30/180/356 days, 10 years). Proton's version-history material
states these versions count toward the storage limit.

**A6 — Quota release after deletion is not immediate.** **[OFFICIAL]** "When
you delete files in Proton Drive, it can take up to three hours to completely
clear the storage space." Any pruning or capacity-monitoring design must
tolerate a lagging quota reading rather than treating it as authoritative
immediately after a delete.

**A7 — Exceeding quota blocks uploads.** **[OFFICIAL]** When storage limits are
exceeded, for Drive: "Your devices won't sync with Proton Drive. You can't
upload new files." A full quota is therefore a *backup-stopping* condition, not
a degraded one.

**A8 — The provider decision itself is unchanged.** **[REPO]** E1A's topology
(Hotel-Echo as source, Proton Drive as primary off-host destination, main PC as
secondary opportunistic destination, ciphertext-only upload, cloud acceptance
verified by a design established in E3) stands. Nothing in this research
contradicts it.

---

## 6. Corrected findings

Each item states the E3B claim *(reconstructed)*, the correction, and the
evidence.

**C1 — "Read-only authenticated experiment."** *(reconstructed)* E3B framed a
Proton experiment as read-only.
**Correction:** any authenticated experiment that involves **upload, conflict
resolution, trash, deletion, or quota change is mutating, not read-only.** It
requires (a) explicit, separate operator authorization naming the mutation
scope, and (b) **operator-assisted Proton authentication** — consistent with
A2, sign-in is browser-based and the operator performs it. An agent must not
hold or acquire Proton credentials. **[INFER + OFFICIAL]** The bounded protocol
in §10 is written on this basis.

**C2 — "Cloud acceptance = ciphertext readback."** *(reconstructed)*
**Correction:** **cloud acceptance must read back and verify the complete
triple** — ciphertext, `.dump.age.sha256` sidecar, and `.manifest.json` — and
re-establish exactly the bindings §4.2 requires: recomputed `sha256(ciphertext)`
equal to *both* the sidecar value and `manifest.ciphertext.sha256`, and a
manifest that names the ciphertext it claims. Ciphertext-only readback proves
neither integrity binding nor identity, and would silently accept a triple whose
metadata never arrived. **[REPO]**

**C3 — "Worst case is 140 GiB."** *(reconstructed)* E3B appears to have derived
≈70 retained points × 2 GiB (`maxPlaintextBytes`) = 140 GiB.
**Correction: reject 140 GiB and preserve E1D's conservative 5 GiB-per-point
upper bound (≈350 GiB against ~475 GiB usable).** `maxPlaintextBytes` bounds
the *dump*, not the uploaded artifact; the ciphertext allowance is
`maxStagingBytes - plaintextBytes`, so a published ciphertext is bounded only
by just under `maxStagingBytes` = 5 GiB (§4.3). The 5 GiB figure may be relaxed
only when **the producer contract gains an explicit ciphertext ceiling** and a
production value is set. **[REPO]** Additionally record the live mismatch: the
proposed producer permits ~5 GiB ciphertext while the proposed acceptor refuses
anything over 256 MiB (§4.4) — unresolved, E3's to settle.

**C4 — "`pass` backend solves unattended credential storage."**
*(reconstructed)*
**Correction: treat unattended use of the `pass` backend as UNVERIFIED.**
Proton documents *that* `pass` (and `keychain`) storage exists (A3); it does
**not** document reboot unlocking, session TTL, non-interactive expiry
behaviour, re-authentication triggers, or whether any backend satisfies E1E's
requirement that "Proton CLI authentication must use a protected
operating-system credential store" for a service-compatible, unattended path.
**[OFFICIAL absence + UNKNOWN-AUTH]** Also reject the framing that the design
space is only "passphrase-less GPG key versus manual unlock at every boot."
Other candidates exist and are untested — an operator-unlocked agent that
persists across a boot window, a systemd credential/`gpg-agent` arrangement,
`keychain` under a headless session, a short-lived operator-initiated
re-auth cadence matched to the 6-hour cycle, or an architecture in which the
Proton step is not the unattended step at all. **None of these is selected
here.**

**C5 — "The CLI requires Bun ≥ 1.3.14."** *(reconstructed)*
**Correction:** the official prebuilt CLI is **a standalone executable with Bun
embedded**; end users do not install Bun. **Bun 1.3.14 or newer is a
source-build/development requirement** for building from the SDK repository.
**[OFFICIAL]** Which artefact this project would use — official prebuilt binary
versus locally built — is an open decision, not a finding.

**C6 — "Proton provides no scoped credential." (as official fact)**
*(reconstructed)*
**Correction — narrow it:** the accurate statement is that **no append-only,
folder-scoped, or service-account credential is documented** in Proton's
current public sharing, CLI, or SDK documentation. That is an absence of
documentation, not a documented absence of capability. **[OFFICIAL absence]**

**C7 — "A dedicated uploader account gives immutable, quota-isolated
uploads."** *(reconstructed)*
**Correction:** Proton officially documents that **an Editor's uploads count
toward the *owner's* storage quota**, and that **Editors may delete and rename
only the files they uploaded**. Proton also documents that an Editor "can
manage access on your behalf: share the file or folder with others, change
permissions for existing recipients, or remove access," while "Editors cannot
modify or remove access for the owner." **[OFFICIAL]**
**Therefore:** a dedicated uploader identity **remains promising but unproven
through the CLI, and is explicitly not immutable** — an uploader can delete
exactly the artifacts this project cares about (its own), it consumes the
owner's quota rather than isolating it, and its documented ability to re-share
and change permissions is an additional exposure to weigh, not a footnote.

**C8 — "Use ext4 inside WSL on the main PC."** *(reconstructed)*
**Correction: do not choose a filesystem without capacity and backing-storage
evidence.** The repository already records why this is a trap: `df` inside WSL
is not the truth for anything on the ext4 root — measured 2026-09-05, `/`
reported **945 GB** free while `/mnt/c`, the NTFS volume actually backing that
sparse VHDX, had **21.08 GB**; `/mnt/k` (drvfs over NTFS, 1512 GB) reports real
free space but offers no assertable rename atomicity, fsync semantics, or Unix
modes (`backup-producer.md` §2.7 and the destination comment in
`eanhl-backup.example.json`). Meanwhile the acceptor's device/inode identity
check is documented as "true on ext4; unverified" elsewhere
(`backup-acceptance.md` §6.7). **The candidate storage design for the main-PC
secondary path is recorded here as UNRESOLVED.** **[REPO]**

**C9 — "Main-PC verification provides independent backup verification."**
*(reconstructed)*
**Correction:** under E1A the main PC is a **secondary, opportunistic**
destination whose "availability must never determine whether the daily
independent-backup gate passes." Independent main-PC verification is therefore
**opportunistic and cannot gate Proton freshness** — the 8-hour warning and
24-hour critical thresholds are defined on *verified Proton copies*. **[REPO]**

**C10 — "Retention/pruning can be designed now."** *(reconstructed)*
**Correction: remote retention and pruning remain BLOCKED** until five
behaviours are proven, none of which is proven today: permanent delete,
empty-trash, version-history interaction with repeatedly written names, quota
reporting, and delayed quota release (A4, A5, A6). `backup-producer.md` §7
requirement 8 additionally constrains *where* pruning may run (the host that
owns the directory, on its own timer, never remotely) — a constraint a cloud
destination does not obviously satisfy, and which E3 must resolve rather than
assume. **[OFFICIAL + REPO]**

**C11 — Terminology: "receipt."** *(reconstructed)*
**Correction: use "cloud attestation" for source-side Proton readback
evidence.** "Receipt" is already a defined artifact in this system with a
specific meaning and binding rules: `<base>.receipt.json`, written by the
**destination acceptor**, valid only if its `artifact`, `ciphertext_sha256` and
`source_snapshot_ts` all match the producer's manifest, and used to compute
freshness as `max(source_snapshot_ts)` over binding-valid receipts
([`backup-acceptance.mjs:165-167`](../../ops/backup/lib/backup-acceptance.mjs#L165-L167);
`backup-producer.md` §7 requirement 6). Source-side evidence that Proton
accepted and retains an artifact is a *different object produced by a different
party* and must not borrow the name. **[REPO]**

**C12 — "Upload a `latest.json` pointer."** *(reconstructed)*
**Correction: remote artifacts must use unique, immutable names; do not upload
a mutable `latest.json`.** Two independent reasons: (a) the producer's identity
model is `<prefix>-<snapshotTs>`, the destination collision rule treats "same
name, different hash" as a hard rejection and an alert rather than an overwrite,
and "same name, same hash" is a benign re-delivery that must not advance
freshness (`backup-producer.md` §7 requirements 4-5) — a mutable pointer has no
place in that model; (b) repeatedly overwriting one remote name is exactly the
input that drives Proton's version history (A5), which consumes quota and whose
interaction with pruning is unproven (C10). **[REPO + OFFICIAL]**

**C13 — "The existing acceptor is Proton-specific / must be rewritten."**
*(reconstructed)*
**Correction:** the existing destination acceptor **remains potentially
reusable for the main-PC secondary path**, subject to real filesystem and
permission proof — the unverified deployment assumptions in §4.5 and
`backup-acceptance.md` §6.1/§6.7 (transport key writes only the inbox, inbox
parent not writable, truthful `st_dev`/`st_ino`, preserved modes) must be
demonstrated on the actual volume before reuse is claimed. It is **not**
reusable as-is against Proton Drive, because it is a filesystem component that
reads a local inbox by descriptor (§4.5). **[REPO]**

**C14 — Undifferentiated evidence.** *(reconstructed)*
**Correction:** every finding in this memo carries an explicit
**[OFFICIAL] / [REPO] / [INFER] / [UNKNOWN-AUTH]** tag (§3), and the E3B
provenance gap is recorded in §2. Do not cite an **[INFER]** or
**[UNKNOWN-AUTH]** line as though it were documented behaviour.

---

## 7. Rejected claims

| # | Claim *(reconstructed from the E3B correction list)* | Disposition |
| --- | --- | --- |
| R1 | A Proton experiment involving upload/trash/delete/quota is "read-only" | **Rejected.** Mutating; needs separate authorization + operator-assisted auth (C1). |
| R2 | Reading back the ciphertext is sufficient cloud acceptance | **Rejected.** Full triple + both hash bindings required (C2). |
| R3 | The correct worst-case retained capacity is 140 GiB | **Rejected.** E1D's ~5 GiB/point (≈350 GiB) stands (C3). |
| R4 | The `pass` backend is a verified unattended credential solution | **Rejected as verified.** Storage documented; unattended behaviour is not (C4). |
| R5 | The design space is only "passphrase-less GPG vs. manual unlock" | **Rejected.** False dichotomy; other untested candidates exist (C4). |
| R6 | Bun ≥ 1.3.14 is a runtime prerequisite for the CLI | **Rejected.** Prebuilt binaries embed Bun; Bun is a source-build requirement (C5). |
| R7 | "Proton provides no scoped credential" as an official fact | **Rejected as stated.** Narrowed to an absence of documentation (C6). |
| R8 | A dedicated uploader gives immutable, quota-isolated uploads | **Rejected.** Editor uploads consume the owner's quota; Editors can delete/rename their own uploads and manage access (C7). |
| R9 | ext4 inside main-PC WSL is the chosen secondary storage | **Rejected as a choice.** Recorded as unresolved pending capacity/backing evidence (C8). |
| R10 | Main-PC verification can serve as the freshness gate | **Rejected.** Opportunistic only; cannot gate Proton freshness (C9). |
| R11 | Retention/pruning can be designed and settled now | **Rejected.** Blocked on five unproven behaviours (C10). |
| R12 | Source-side Proton readback evidence is a "receipt" | **Rejected.** Name is taken; use "cloud attestation" (C11). |
| R13 | A mutable `latest.json` pointer should be uploaded | **Rejected.** Unique immutable names only (C12). |
| R14 | The existing acceptor is obsolete | **Rejected.** Potentially reusable for the main-PC path, subject to proof (C13). |

---

## 8. Architecture constraints

**No architecture is selected by this memo.** These are the boundaries any
later candidate must satisfy; they narrow the space without choosing inside it.

1. **Ciphertext only.** Only age ciphertext plus the integrity/binding metadata
   the artifact contract requires may leave Hotel-Echo. Proton's own encryption
   is additional, never a substitute (E1A). **[REPO]**
2. **The unit of transfer is the triple.** Ciphertext, sidecar and manifest
   travel and are verified together (§4.1-4.2, C2). **[REPO]**
3. **Cloud acceptance is a readback verification, not an exit code.** "A
   successful upload command alone does not prove acceptance" (E1A). The
   verification design belongs to E3 and does not exist. **[REPO]**
4. **Unique immutable remote names.** No mutable pointers, no overwrite-in-place
   (C12). **[REPO]**
5. **"Cloud attestation" is a distinct object from a destination receipt**, and
   must not be allowed to satisfy the receipt-binding or freshness rules by
   analogy (C11). **[REPO]**
6. **Freshness is defined on verified Proton copies** — 8-hour warning, 24-hour
   critical. The main PC cannot substitute (C9, E1A). **[REPO]**
7. **A transport must never delete the last accepted copy**, and failed
   transfers queue locally and retry (E1A). **[REPO]**
8. **Capacity planning holds at ~5 GiB per retained point** until the producer
   contract gains an explicit ciphertext ceiling, and the 5 GiB-vs-256 MiB
   producer/acceptor mismatch must be resolved deliberately, not by adopting
   whichever number is convenient (C3, §4.4). **[REPO]**
9. **Quota is a hard stop, trash and versions consume it, and its reading
   lags** — a capacity monitor must treat a post-delete quota reading as
   provisional for at least the documented three-hour window (A4-A7).
   **[OFFICIAL]**
10. **Key custody is untouched by any transport choice:** Hotel-Echo holds only
    the public age recipient; Proton must never be sole custodian of both the
    archive and every usable key copy (E1A). No key exists yet. **[REPO]**
11. **The SDK's third-party-integration warning does not extend to the
    official CLI.** The official Proton Drive SDK — which a third-party
    application would embed directly — states it is "not yet ready for
    third-party production use" and that "the architecture and public
    interface may still change." **[OFFICIAL]** The official Proton Drive CLI
    is a separate, released first-party client that Proton explicitly
    positions for "deployment scripts, backup jobs, cron, or internal
    runbooks" (A1); this memo does not characterize the CLI, or the Proton
    client stack as a whole, as pre-release. The preserved risk is narrower
    and real: Proton documents a cryptographic-model migration planned for
    **end of 2026 / early 2027**, after which older clients implementing only
    the previous cryptography will require an upgrade. **[OFFICIAL]** Any
    design must therefore assume a possible forced CLI upgrade inside the
    project's operating horizon, must not couple artifact correctness to a
    specific client version, and must include mandatory ongoing monitoring of
    Proton's CLI release notes/changelog for that migration (U11).
12. **The existing filesystem acceptor is the candidate for the main-PC
    secondary path only**, and only after §4.5's deployment properties are
    demonstrated (C13). **[REPO]**

---

## 9. Ranked unknowns

Ranked by how much each blocks a defensible E3 transport design. All are
**[UNKNOWN-AUTH]** unless noted.

| # | Unknown | Why it blocks | Settled by |
| --- | --- | --- | --- |
| U1 | Whether the CLI can run **unattended across reboots** on Hotel-Echo — which credential backend survives, for how long, what triggers re-auth, and what a headless Linux service sees | Without this there is no 6-hourly automated Proton path at all; every other design choice is downstream | **Only partially informed, not settled, by §10** — the scratch protocol (step 8) can test non-interactive reuse of an already-authenticated session only on the machine used for that experiment, which is not necessarily Hotel-Echo and exercises no Hotel-Echo reboot. Hotel-Echo reboot persistence requires a separate, host-specific session with explicit authorization for Hotel-Echo access, CLI installation/configuration if applicable, credential-store work, reboot/idle observation, and operator-performed Proton authentication. |
| U2 | Whether a **full triple readback** through the CLI reproduces byte-exact content and both hash bindings (C2) | Cloud acceptance cannot be designed, let alone claimed, without it | §10 steps 4-6 |
| U3 | **Permanent-delete / empty-trash / quota-release** behaviour end to end, including the three-hour lag and its residual (A4, A6) | Retention and pruning are blocked on it (C10); capacity monitoring is unreliable without it | §10 steps 9-11 |
| U4 | **Version-history behaviour** on this account's plan, and whether unique-named artifacts avoid version accumulation entirely (A5) | Determines whether quota grows with rewrites; interacts with C12 | §10 steps 7, 11 |
| U5 | The real production **ciphertext ceiling**, and the resolution of the 5 GiB vs 256 MiB mismatch (§4.4) — *partly settleable without Proton* | Sets the true capacity model and the acceptor's configuration | Producer-contract decision + a measured production dump series **[REPO]** |
| U6 | Whether a **dedicated uploader identity** is workable through the CLI at all, and what its real quota and deletion semantics are in practice (C7) | The main candidate for limiting blast radius; currently promising but unproven | §10 step 12 (only if a second identity exists) |
| U7 | **Large-file upload behaviour**: resumability, interruption handling, partial-object visibility, and whether a reader can distinguish "mid-upload" from "complete" (the cloud analogue of `backup-producer.md` §2.5 completion) | Determines whether partial-arrival handling is even expressible against Proton | §10 steps 4, 6 |
| U8 | **Name-collision semantics** at Proton for an identical remote name with different content (`--conflict-strategy`), against `backup-producer.md` §7 requirements 4-5 | Determines whether the destination collision rule can be honoured remotely | §10 step 7 |
| U9 | Whether **quota reporting is available to the CLI** in a machine-readable form | Continuous capacity monitoring (an explicit E3 requirement) depends on it | §10 steps 3, 9-11 |
| U10 | Main-PC secondary storage: **actual backing-volume capacity and filesystem properties** (C8) — *settleable without Proton* | Decides whether the existing acceptor is reusable there | A read-only main-PC inspection session, separately authorized **[REPO]** |
| U11 | Official-CLI maturity and change risk: how the CLI tracks Proton's announced end-2026/early-2027 cryptographic-model migration, and what a forced-upgrade window looks like in practice (constraint 11) | A client left on the previous cryptography stops interoperating after the migration; the CLI itself is not pre-release, but this trajectory is unproven | Mandatory ongoing monitoring of Proton's CLI release notes/changelog **[OFFICIAL]** |

---

## 10. Minimal bounded Proton scratch-experiment protocol

**This protocol is NOT authorized by this memo.** It is written so that a later
session has an exact, pre-agreed, bounded scope to be authorized against. It
mutates a Proton account and therefore requires explicit separate operator
authorization plus operator-assisted authentication (C1). **This protocol runs
on whatever machine the later session executes it from; its authorization
grants no access to Hotel-Echo, the main PC, or any other host, and it does
not by itself settle Hotel-Echo reboot persistence (U1) — that requires a
separate, host-specific session (see U1).**

**10.1 Preconditions**

- Explicit operator authorization naming this protocol and its mutation scope.
- The operator performs `proton-drive auth login` in a browser (A2). The agent
  never receives, records, or transcribes credentials, session material, tokens
  or recovery codes.
- The account used is stated in advance, and its plan tier is recorded (it
  changes A5's version limits).
- Current used/total storage is recorded **before** anything is created.
- The CLI artefact is recorded exactly: official prebuilt binary or local
  source build, plus version string (C5).

**10.2 Exact mutation scope — nothing outside this is permitted**

- **One** new folder, created at a path agreed in advance and named with a
  timestamp, e.g. `/my-files/eanhl-e3-scratch-<UTCstamp>/`.
- **Synthetic data only.** Random-byte files with fabricated triple-shaped
  names. **Never** a real backup artifact, real ciphertext, a real manifest,
  real database content, or anything derived from production.
- **The proposed upload set is four logical test items but six physical
  files**: three standalone size probes — 1 × 1 MiB, 1 × 64 MiB, 1 × ~300 MiB
  (chosen to sit above the acceptor's 256 MiB example ceiling purely to
  measure behaviour) — plus the three files that make up one synthetic
  triple. **Total uploaded ≤ 512 MiB.** Downloads and verification (step 6)
  must cover all six files, not four.
- Permitted mutations, and no others: create the scratch folder; upload the
  files above; one deliberate same-name re-upload to observe conflict/version
  behaviour; trash one scratch file; permanently delete one scratch file; empty
  trash **of scratch items only**; delete the scratch folder.
- **Explicitly forbidden:** touching any pre-existing Drive object; changing
  account settings, plan, version-history retention, or sharing defaults;
  deleting or trashing anything outside the scratch folder; using "empty trash"
  if it cannot be limited to scratch items (in that case, permanently delete
  scratch items individually and record that empty-trash was not exercised);
  generating or handling any age key; uploading production data.

**10.3 Steps**

1. Record CLI artefact, version, and `PROTON_DRIVE_CREDENTIALS_STORE` value.
2. Operator authenticates in the browser; record only *that* auth succeeded.
3. Record quota before (`--json`), with a UTC timestamp. → U9
4. Create the scratch folder; upload the four logical items (six physical
   files); capture every command and its `--json` output. Note any
   resumability, chunking, or progress semantics. → U7
5. `filesystem list` the scratch folder; compare names and sizes. → U2
6. `filesystem download` all six files to a scratch directory; recompute
   `sha256` locally; verify byte-exactness, and verify that the synthetic
   triple still satisfies both bindings (sidecar ↔ recomputed hash ↔
   manifest field). → U2, U7
7. Re-upload one file under the same name with different content; record the
   conflict outcome, any `--conflict-strategy` behaviour, and whether a prior
   version is now retained. → U4, U8
8. Without re-authenticating, exercise a non-interactive invocation (no TTY, no
   browser available) **on the machine used for this experiment** and record
   whether it succeeds. This tests non-interactive session reuse only on that
   machine; it is **not** a Hotel-Echo reboot test, settles no claim about
   Hotel-Echo, and grants no Hotel-Echo or other host access. **Do not**
   attempt to bypass or automate authentication. → U1 (partial)
9. Record quota again. Trash one file; record quota. → U3, U9
10. Permanently delete one file; record quota immediately. → U3
11. **Cleanup (mandatory).** Permanently delete every remaining scratch object
    and the scratch folder. Record quota at **+0, +1 h, +3 h and +24 h** after
    the final delete and report the residual against the pre-experiment
    baseline (A6). → U3, U4
12. *(Optional, only if a second Proton identity already exists and the operator
    authorizes it separately.)* Invite that identity as Editor to the scratch
    folder, upload one 1 MiB file as that identity, and observe whose quota
    moves and what that identity can delete or rename. Remove access and clean
    up. → U6

**10.4 Cleanup expectations**

- The account must end in the state it started: no scratch folder, no scratch
  object, no scratch item in trash, no share invitation outstanding, no changed
  setting.
- Residual quota delta must be reported honestly, including "still not
  returned at +24 h" if that is what happened.
- If cleanup cannot complete, that is reported as an open item with the exact
  objects left behind — never quietly.
- The session writes a memo recording commands, `--json` outputs, quota
  timestamps, and per-unknown findings. **No credentials, tokens, session
  material or recovery codes go into any file, commit, command output, or
  chat.**

---

## 11. Operator decisions deferred until experiment evidence exists

None of these should be decided now; each depends on an unknown above.

| Decision | Blocked on |
| --- | --- |
| The Proton credential-storage mechanism and the unattended-operation model | U1 |
| Whether the 6-hourly Proton step is unattended at all, or operator-gated with a compensating freshness rule | U1 |
| The cloud-acceptance ("cloud attestation") design and what evidence satisfies it | U2 |
| The remote retention/pruning design, and where pruning runs given `backup-producer.md` §7 requirement 8 | U3, U4 |
| Whether a dedicated uploader identity is adopted, and the blast-radius model if not | U6 |
| The remote naming scheme and folder layout | U4, U7, U8 |
| The real production `maxPlaintextBytes` / `maxStagingBytes`, whether to add an explicit ciphertext ceiling, and the acceptor's `maxCiphertextBytes` | U5 |
| The main-PC secondary storage location and filesystem, and whether the existing acceptor is reused there | U10 |
| The capacity-monitoring design and its alert thresholds | U3, U9 |
| The CLI artefact and upgrade policy given the announced crypto change | U11 |
| Whether Proton remains the primary destination if U1 or U2 fails | U1, U2 |

---

## 12. Official sources

Retrieved 2026-09-10. Proton documentation changes; re-verify before relying on
any line above.

- Using Proton Drive CLI — https://proton.me/support/drive-cli
- Introducing Proton Drive CLI (blog) — https://proton.me/blog/proton-drive-cli
- Proton Drive CLI for business — https://proton.me/business/drive/cli
- Proton Drive SDK (official repository) — https://github.com/ProtonDriveApps/sdk
- Proton Drive SDK — CLI README — https://github.com/ProtonDriveApps/sdk/blob/main/cli/README.md
- Managing access to shared files and folders — https://proton.me/support/drive-manage-access-shared-files
- Sharing files and folders via email — https://proton.me/support/drive-how-to-share-files-via-email
- Managing file version history — https://proton.me/support/version-history
- Introducing version history for Proton Drive — https://proton.me/blog/drive-version-history
- Deleting and restoring synced files (trash counts toward storage) — https://proton.me/support/proton-drive-delete-restore-synced-files
- Proton Drive support hub (three-hour quota-clearing statement) — https://proton.me/support/drive
- What happens if usage exceeds plan limits — https://proton.me/support/free-plan-limits
- Proton Drive for web guide — https://proton.me/support/drive-web-guide

---

## 13. Closing statement

**No Proton account was accessed, created, or authenticated. No Proton object
was uploaded, downloaded, listed, shared, trashed, or deleted. No Proton
setting was read or changed. Neither Hotel-Echo nor the main PC was accessed.
No software was installed or downloaded. No key was generated, escrowed, or
touched. Nothing was deployed, scheduled, or activated. The tunnel was not
reopened and remains separately unauthorized. E3 is in progress: producer and
destination acceptance are verified in isolation only, and production
transport/integration, key custody, scheduling, monitoring, retention,
deployment, and restore drilling have not started or completed. E3 remains
incomplete and unactivated; no Gate checkbox changed.**

---

## 14. E3C2 update (2026-09-10, later same-day session): contract shape resolved

A later implementation session (E3C2, following the contract-shape decision in
E3C1B) closed the **contract-shape** half of U5 and the §4.3/§4.4 mismatch this
memo recorded. **This update does not reopen or redo the research above; it
records what changed in the repository afterward, and is intentionally
narrow.**

**What E3C2 did:**

- Added a required `staging.maxCiphertextBytes` to the producer's configuration
  contract (`ops/backup/lib/backup-config.mjs`), validated as a positive safe
  integer with `staging.maxCiphertextBytes <= staging.maxStagingBytes`
  (equality valid — it preserves the producer's own pre-E3C2 effective
  ciphertext envelope; it is not the least-exposure default, see below).
- Changed the producer's runtime ciphertext budget from
  `staging.maxStagingBytes - plaintextBytes` alone to
  `Math.min(stagingRemainder, staging.maxCiphertextBytes)`, still enforced on
  the encryption output stream (the crossing chunk is dropped, never written),
  with the aggregate `maxStagingBytes` check retained and a new,
  cap-specific post-write defence-in-depth assertion added
  (`docs/operations/backup-producer.md` §2.7, §6.6, §6.6a).
- Aligned both example configurations at `staging.maxCiphertextBytes` /
  `acceptance.maxCiphertextBytes` = `5368709120` (5 GiB) — explicitly
  **non-production** examples. `acceptance.maxCiphertextBytes ==
  staging.maxCiphertextBytes` is the actual least-exposure default (any larger
  acceptor value accepts ciphertexts the producer cannot currently publish).
  `staging.maxCiphertextBytes == staging.maxStagingBytes` is a separate,
  independently valid equality chosen to preserve the producer's pre-E3C2
  effective envelope and E1D's conservative example arithmetic — it is not the
  smallest possible producer exposure, just the value already implied by the
  aggregate staging ceiling. Neither alignment reflects 5 GiB having been
  evaluated as a real production figure. E1D's ≈350 GiB conservative retention
  arithmetic (§ above) is unchanged by this — it was already keyed to a 5
  GiB-per-point example.
- Added focused test coverage in `ops/backup/lib/backup-config.test.mjs` and
  `ops/backup/lib/backup-producer.test.mjs` for the new field's validation and
  for both ceilings' binding behaviour (which one is tighter, which one is
  reported, and the new post-write assertion), verified locally against the
  full `pnpm test:backup-producer` suite (179/179 pass, up from 165/165). The
  final two producer additions came from the E3C3/E3C4 diagnostic-correction
  pass: the post-write defence-in-depth remediation text was corrected to
  stop recommending a ceiling increase for what is, by construction, an
  unreachable bounded-writer/invariant defect, and the injected-boundary
  regression tests were tightened to assert that correction.

**What is still open, unchanged by E3C2 — this is precisely U5's remaining
half:** the *real* production `staging.maxCiphertextBytes` and
`acceptance.maxCiphertextBytes` values. Settling that requires a measured
production dump/ciphertext series, a growth allowance, Proton-side provider
headroom, and an accounting for competing quota usage — none of which E3C2
performed or was authorized to perform. **E3 remains verified in isolation
only and unactivated.** No Proton, Hotel-Echo, or main-PC action occurred; no
authentication, key generation, deployment, scheduling, retention/pruning,
restore drill, or tunnel action occurred; nothing was committed or pushed; no
Gate checkbox changed. See `HANDOFF.md`'s E3C2 Active State entry for the full
verification record.
