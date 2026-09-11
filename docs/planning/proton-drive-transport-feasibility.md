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
| U1 | Whether the CLI can run **unattended across reboots** on Hotel-Echo — which credential backend survives, for how long, what triggers re-auth, and what a headless Linux service sees | Without this there is no 6-hourly automated Proton path at all; every other design choice is downstream | **Only partially informed, not settled, by §10.** The scratch protocol (step 8) can test non-interactive reuse of an already-authenticated session only on the machine used for that experiment, which is not necessarily Hotel-Echo and exercises no Hotel-Echo reboot. Hotel-Echo reboot persistence requires a separate, host-specific session with explicit authorization for Hotel-Echo access, CLI installation/configuration if applicable, credential-store work, reboot/idle observation, and operator-performed Proton authentication. **§17 (2026-09-11) adds read-only main-PC credential-backend feasibility findings** (package/process gaps for both the `keychain` and `pass` backends, and their unlock-persistence behavior as documented, not tested) — this narrows what setup would require but settles nothing: no backend is installed, the permitted metadata-only inspection found no evidence of a usable local GPG key (an empty `pubring.kbx`, no identities listed), and U1 remains open. |
| U2 | Whether a **full triple readback** through the CLI reproduces byte-exact content and both hash bindings (C2) | Cloud acceptance cannot be designed, let alone claimed, without it | §10 steps 4-6 |
| U3 | **Permanent-delete / empty-trash / quota-release** behaviour end to end, including the three-hour lag and its residual (A4, A6) | Retention and pruning are blocked on it (C10); capacity monitoring is unreliable without it | §10 steps 9-11 |
| U4 | **Version-history behaviour** on this account's plan, and whether unique-named artifacts avoid version accumulation entirely (A5) | Determines whether quota grows with rewrites; interacts with C12 | §10 steps 7, 11 |
| U5 | The real production **ciphertext ceiling**, and the resolution of the 5 GiB vs 256 MiB mismatch (§4.4) — *partly settleable without Proton* | Sets the true capacity model and the acceptor's configuration | Producer-contract decision + a measured production dump series **[REPO]** |
| U6 | Whether a **dedicated uploader identity** is workable through the CLI at all, and what its real quota and deletion semantics are in practice (C7) | The main candidate for limiting blast radius; currently promising but unproven | §10 step 12 (only if a second identity exists) |
| U7 | **Large-file upload behaviour**: resumability, interruption handling, partial-object visibility, and whether a reader can distinguish "mid-upload" from "complete" (the cloud analogue of `backup-producer.md` §2.5 completion) | Determines whether partial-arrival handling is even expressible against Proton | §10 steps 4, 6 |
| U8 | **Name-collision semantics** at Proton for an identical remote name with different content (`--conflict-strategy`), against `backup-producer.md` §7 requirements 4-5 | Determines whether the destination collision rule can be honoured remotely | §10 step 7 |
| U9 | Whether **quota reporting is available to the CLI** in a machine-readable form | Continuous capacity monitoring (an explicit E3 requirement) depends on it | §10 steps 3, 9-11 |
| U10 | Main-PC secondary storage: **actual backing-volume capacity and filesystem properties** (C8) — *settleable without Proton* | Decides whether the existing acceptor is reusable there | **Partially resolved by E3D (§15):** capacity and filesystem identity are now measured — `/mnt/k` is a 9p/drvfs mount reporting real physical NTFS free space. Destination-directory selection, ownership separation, Unix permission enforcement, and a production capacity ceiling remain open. **[REPO]** |
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
| The real production `staging.maxPlaintextBytes` / `staging.maxStagingBytes` / `staging.maxCiphertextBytes` / `acceptance.maxCiphertextBytes` numeric values — E3C2 (§14) resolved only the explicit ciphertext field/contract shape; the production numeric staging and artifact envelope remains undecided | U5 |
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

---

## 15. E3D update (2026-09-10, later same-day session, corrected same-day by E3D1): main-PC secondary-storage inspection, U10 partially resolved

A read-only inspection session, separately authorized, executed the U10
protocol this memo asked for (§9). **This update does not reopen or redo the
research above; it records read-only measurements taken on the main PC
afterward, and is intentionally narrow.** Documentation edits were made only
to this memo and to `HANDOFF.md`. No code, configuration, example JSON, test,
or dependency changed; no directory or file was created on any candidate
volume; no sudo, install, mount, permission, or ownership change occurred; no
Proton, Hotel-Echo, or tunnel action occurred.

**E3D1 correction note.** A same-day follow-up session corrected this
section's DrvFS ownership/permission claims against official Microsoft
documentation (source below) and added independent Windows-side capacity
corroboration. All measurements below are unchanged; §15.5 and §15.6 were
rewritten, §15.3 was narrowed to remove an unsourced explanation, and §15.2
gained the Windows-side corroboration. The correction is folded into this
section rather than appended as a new one, per the operator instruction that
authorized it.

**Official source for this section.** [Microsoft Learn — "File Permissions
for WSL"](https://learn.microsoft.com/en-us/windows/wsl/file-permissions),
retrieved 2026-09-10. This is a separate citation from §12, which lists only
the Proton sources E3B/E3B2 used; it is not retroactively added to that list
or claimed as part of E3B's original source set.

**Host identity.** Confirmed on the main PC (`hostname`: `Sierra-November`),
not Hotel-Echo. `uname`: `Linux Sierra-November 6.6.87.2-microsoft-standard-WSL2
... x86_64`.

**15.1 Mount facts, measured 2026-09-10 (all read-only: `findmnt`, `df -B1`,
`stat -f`, `/proc/mounts`).**

| Path | Mount point | Source | fstype | Key options |
| --- | --- | --- | --- | --- |
| `/` | `/` | `/dev/sdd` | `ext4` | `rw,relatime,discard,errors=remount-ro,data=ordered` |
| `/var/tmp` | `/` (same mount as above — no separate mount point) | `/dev/sdd` | `ext4` | same as `/` |
| `/mnt/c` | `/mnt/c` | `C:\` | `9p` | `rw,noatime,aname=drvfs;path=C:\;uid=1000;gid=1000;...` |
| `/mnt/k` | `/mnt/k` | `K:\` | `9p` | `rw,noatime,aname=drvfs;path=K:\;uid=1000;gid=1000;...` |

`/proc/mounts` corroborates all four rows verbatim. `/mnt` itself (device
`8,48`) is on the same ext4 root as `/` — `/mnt/k` (device `0,75`) is a
distinct mount starting exactly at `/mnt/k`. **Neither mount carries the
`metadata` option** — significant for §15.5/§15.6 below.

**15.2 Capacity, `df -B1` (byte-exact), independently corroborated from
Windows:**

| Path | Total | Used | Available |
| --- | --- | --- | --- |
| `/` and `/var/tmp` | 1,081,101,176,832 B (~1.08 TB) | 80,890,929,152 B | 945,217,892,352 B (~945 GB) |
| `/mnt/c` | 998,610,300,928 B | 973,909,393,408 B | 24,700,907,520 B (~24.7 GB) |
| `/mnt/k` | 8,001,545,039,872 B (~8.00 TB) | 6,395,760,930,816 B | 1,605,784,109,056 B (~1,495.7 GiB / ~1.46 TiB) |

This reproduces the known WSL trap: `/` reports ~945 GB free on the ext4 root,
while `/mnt/c` independently reports only ~24.7 GB free. **The claim that the
ext4 root is backed by a sparse VHDX located on the `/mnt/c` NTFS volume is
prior repository-derived evidence** (`backup-producer.md` §2.7, measured
2026-09-05 at 21.08 GB free on `/mnt/c`), **not independently re-verified by
this E3D session** — this session did not inspect the VHDX file itself or its
location. The two `/mnt/c` free-space readings (21.08 GB then, 24.7 GB now)
are consistent with ordinary disk-usage fluctuation over five days, not a
re-proof of the VHDX claim.

**`/mnt/k` capacity was independently corroborated from the Windows side.**
A single read-only PowerShell query, authorized for this correction pass —
`Get-Volume -DriveLetter K | Select-Object DriveLetter,FileSystemType,Size,SizeRemaining`
— returned `FileSystemType: NTFS`, `Size: 8001545039872`,
`SizeRemaining: 1605784109056`. **These figures are byte-for-byte identical**
to the Linux `df -B1` total and available figures above. No Windows setting,
mount, file, or configuration was read, changed, or created beyond this one
query. This upgrades the capacity claim for `/mnt/k` from "consistent with a
prior documented finding" to **independently corroborated by two separate
subsystems (Linux 9p/drvfs client and Windows Storage Management)
agreeing exactly** — still not proof of anything about ownership,
permissions, or long-term stability, which are separate questions addressed
below.

**15.3 `stat -f` (filesystem-level).** `/` and `/var/tmp` report `Type:
ext2/ext3` (ext4's family) with the same filesystem ID
(`f301562d842a3e8b`), confirming they are the same backing filesystem. `/mnt/c`
and `/mnt/k` both report `Type: v9fs` with **`Inodes: Total: 999  Free:
1000000`** (`files=999`, `ffree=1000000` in `statvfs` terms) — free exceeds
total, which is internally incoherent and not usable for any capacity or
inode-exhaustion decision. **This is the full factual observation.** The
prior E3D draft additionally asserted that these are "protocol placeholder"
values returned because 9p/drvfs "does not expose genuine POSIX `statvfs`
inode semantics" — that explanation is not supported by the Microsoft source
consulted for this correction pass (§15's citation covers file permissions,
not `statvfs` inode reporting) and is **removed** rather than kept as an
unsourced inference. The only claim this memo now makes is that the reported
figures are incoherent and must not be used for capacity decisions; §15.2's
byte-level `df`/`Get-Volume` figures are the capacity evidence, not this
table.

**15.4 Candidate path metadata — `/mnt/k/eanhl-backups/prod` and ancestors.**
Only `/mnt/k` exists; `/mnt/k/eanhl-backups` and
`/mnt/k/eanhl-backups/prod` do not exist (consistent with the example
config's `destination.dir` being proposed, not deployed). No directory or
file was created to check this. Two read-only `stat` observations of
`/mnt/k`, 3 seconds apart, returned identical `Device: 0,75`,
`Inode: 1407374883553287`, and mode `0777 (drwxrwxrwx)`, `Uid/Gid: 1000/1000
(michal)`. **This is a limited point-in-time indication that `st_dev`/`st_ino`
did not change across one short interval — it does not demonstrate stability
across a reboot, a remount, drvfs cache eviction, or a Windows-side change to
`K:\`, and is not claimed as such.**

**15.5 Whether `/mnt/k` enforces the Unix permission semantics
`backup-acceptance.md` §6.1/§6.7 requires: UNPROVEN for the current
configuration, corrected against Microsoft's documented DrvFS behavior.**
The prior draft claimed the `uid=1000;gid=1000` mount option "pins every
path" on `/mnt/k` unconditionally. **That overstates it.** Per Microsoft's
"File Permissions for WSL": DrvFS determines a file's UID/GID/mode from one
of two sources — (a) if the file carries no WSL metadata, DrvFS translates
the mounting Windows user's *effective* access into identical `r/w/x` bits
for user, group and other, and sets UID/GID to the mount's default (here,
1000/1000, from the `uid=`/`gid=` mount options), or (b) if the file *does*
carry WSL metadata (four NTFS extended attributes: `$LXUID`, `$LXGID`,
`$LXMOD`, `$LXDEV`), DrvFS reads the stored UID/GID/mode from that metadata
instead. Metadata storage and interpretation require the `metadata` mount
option, which §15.1 shows **is absent from the current `/mnt/k` mount**.

Applied to this specific candidate: `/mnt/k/eanhl-backups` and
`/mnt/k/eanhl-backups/prod` **do not exist yet** (§15.4), so there is no
existing metadata to inherit either way. Because the current mount lacks
`metadata`, any path created under the **current configuration** — right now,
without a remount — would receive the no-metadata/default-ownership
behavior: uniform effective-permission bits and the mount's default uid/gid,
not a distinguishable per-file owner. **The current configuration therefore
does not demonstrate the distinct Linux transport/acceptor ownership model
`backup-acceptance.md` §6.1 requires** — not because the mount option
"pins" ownership in some absolute sense, but because nothing in the present
mount configuration would produce differentiated ownership for newly created
paths. Whether enabling `metadata` and deploying distinct Linux identities
would produce that differentiation is addressed in §15.6 as an unproven
candidate, not settled here.

**Mode-bit language, corrected.** Per the same source, for a no-metadata
file: displayed permissions are *derived from* the Windows user's effective
access (not stored per-file), and `chmod` has only one documented effect —
removing all write bits sets the Windows "read only" attribute; it does not
otherwise grant or restrict access, and does not create per-UID separation.
(With metadata enabled, `chmod` can change stored metadata, but Microsoft
documents that actual access is still bounded by the real Windows user's
permissions underneath — "you cannot give yourself more access than what you
have on Windows, even if the metadata says that is the case.") **The current
mount therefore provides no evidence, in either direction, of the per-UID
POSIX write separation §6.1 requires for newly created no-metadata paths.**
This is a documented-behavior conclusion, not a write test, and it does not
by itself prove or disprove what a *metadata-enabled, redeployed* mount would
do — that remains a separately authorized, actually-performed cross-identity
write/permission test (§15.6), consistent with this session's prohibition on
performing one.

**15.6 Acceptor reusability on `/mnt/k`, per §8 constraint 12 / C13,
corrected.** The prior draft concluded a native Linux filesystem was the only
remedy. **At least two candidates exist, neither approved here, both
requiring separate authorization and empirical deployment proof:**

a. **Remount/reconfigure DrvFS with the `metadata` mount option, deploy
   distinct Linux transport/acceptor identities with differentiated
   permissions on the resulting paths, and run an actual cross-identity
   write/permission enforcement test.** Per §15.5, metadata storage would let
   DrvFS report distinguishable per-path UID/GID/mode, but Microsoft's
   documented interoperability constraint (metadata cannot grant more access
   than the underlying Windows user actually has) means this candidate's
   real enforcement behavior is unproven until deployed and tested — it is
   not automatically equivalent to native Linux permission enforcement.
b. **Use a native Linux filesystem/private ownership layout** (e.g., an
   ext4-formatted disk or partition exposed directly to WSL, not a
   `drvfs`/9p mount of the Windows `K:` drive) — the candidate the prior
   draft named.

Neither candidate is approved, chosen, or deployed by this memo. What is
established is narrower: **the `/mnt/k` mount *as currently configured* (no
`metadata` option, nothing deployed) does not demonstrate the ownership
separation §6.1 requires**, independent of which remedy is eventually chosen.
This is a statement about the current mount, not about the acceptor's own
code — `backup-acceptance.md`'s destination acceptor component itself
remains, per C13, potentially reusable once *some* deployment (either
candidate above) demonstrates the required filesystem and permission
properties. No such deployment has been selected or proven yet.

**15.7 Capacity arithmetic — comparison only, no production ceiling
approved.** `/mnt/k` available (~1,495.7 GiB, independently corroborated by
§15.2) is:

- **~299×** the explicitly non-production 5 GiB (`5368709120`) example
  ceiling recorded in E3C2/§14.
- **~4.3×** E1D's conservative ~350 GiB retained-capacity estimate.

This is an arithmetic comparison of measured free space against two existing
figures. **It does not approve a production `staging.maxCiphertextBytes` /
`acceptance.maxCiphertextBytes` value** — that remains U5's open half (§14),
unrelated to main-PC capacity and requiring a measured production dump
series, a growth allowance, Proton-side headroom, and competing-quota
accounting.

**15.8 Evidence classification for this section, corrected.**

- **Factual measurements (E3D, 2026-09-10):** every `findmnt`, `df -B1`,
  `stat -f`, `/proc/mounts`, and `stat` result in §15.1/§15.3/§15.4.
- **Independently corroborated (E3D1, 2026-09-10):** `/mnt/k`'s capacity —
  the Windows-side `Get-Volume -DriveLetter K` result matches the Linux
  `df -B1` result byte-for-byte (§15.2).
- **Repository-derived facts, not re-verified this session:** the WSL
  ext4-root/VHDX `df` trap and the claim that the VHDX backing it lives on
  `/mnt/c` (`backup-producer.md` §2.7, measured 2026-09-05); the §6.1/§6.7
  deployment-assumption tables (`backup-acceptance.md`); the proposed
  `destination.dir` path (`eanhl-backup.example.json`).
- **Official documentation (E3D1):** DrvFS's no-metadata-vs-metadata
  ownership/mode model and `chmod`'s documented limited effect without
  metadata (Microsoft Learn, "File Permissions for WSL," cited above).
- **Reasonable inferences:** that the current `/mnt/k` mount configuration
  (no `metadata` option, nothing deployed) would not produce differentiated
  per-path ownership for newly created files, applying the documented
  no-metadata behavior to this specific, still-nonexistent candidate path.
- **Properties still requiring a mutating deployment/permission test:**
  whether a `metadata`-enabled remount plus deployed distinct Linux
  identities actually enforces cross-identity write separation in practice;
  rename atomicity and fsync semantics on `/mnt/k` (already flagged
  unassertable in `backup-producer.md` §2.7); `st_dev`/`st_ino` stability
  across a reboot, remount, or drvfs cache eviction; whether a native
  Linux-filesystem deployment resolves the ownership-separation problem more
  simply than a `metadata` remount would.

**U10 status: PARTIALLY RESOLVED — unchanged by this correction.** The
unknown as literally worded — "actual backing-volume capacity and filesystem
properties" — is measured and, for capacity specifically, now independently
corroborated from two subsystems (§15.2): `/mnt/k` is an 8 TB 9p/drvfs mount
with ~1.46 TiB free. What the unknown's "why it blocks" column actually
asks — **whether the existing acceptor is reusable there** — is **not**
resolved: destination-directory selection, an ownership-separation deployment
(either candidate in §15.6), Unix permission enforcement (unproven for both
candidates without an authorized write test), and a production capacity
ceiling all remain open. The acceptor's own code remains potentially
reusable per C13; no acceptable main-PC destination deployment has been
selected or proven.

**Remaining decisions and tests, not performed here:** choose and create the
actual candidate directory (mutating; not done); decide between the two
§15.6 candidates — a `metadata`-enabled DrvFS remount with distinct Linux
identities, or a native Linux filesystem/private ownership layout — or
select a different main-PC volume entirely; perform the prohibited
cross-identity write/permission test needed to settle enforcement, once a
deployment target is chosen; a production ciphertext ceiling decision (U5,
unrelated to this session); and, separately, Hotel-Echo-side transport work,
which this session did not touch.

**No Proton, Hotel-Echo, or tunnel action occurred. No database query, dump,
restore, ciphertext, encryption, or key work occurred. No Docker/container
mutation occurred. No directory or test file was created on any candidate
volume. No permission, ownership, mount, filesystem, or WSL setting changed.
No sudo, install, deployment, scheduling, retention, pruning, or activation
occurred. The one authorized read-only Windows-side query (`Get-Volume`) made
no change. Nothing was staged, committed, or pushed. `E3 remains verified in
isolation only and unactivated.` No Gate checkbox changed. See `HANDOFF.md`'s
E3D Active State entry for a pointer to this section.**

---

## 16. E3E update (2026-09-10, later same-day session): official Proton Drive CLI installed and verified, no authentication

A narrowly scoped host-change session, separately authorized, installed the
official Proton Drive CLI standalone executable on the main PC and ran two
local, non-authenticating smoke commands against it. **This update does not
reopen or redo the research above; it records an install/verification action
and is intentionally narrow.** Documentation edits were made only to this
memo and to `HANDOFF.md`. No Proton account was contacted, authenticated, or
accessed; no browser was opened; no credential, token, session, or account
identifier was requested, received, printed, stored, or handled; no
credential-store backend was configured; no key was generated; no Drive
object was uploaded, downloaded, listed, created, trashed, deleted, shared,
or inspected; the §10 scratch experiment was not started and remains
separately unauthorized.

**Host identity.** Main PC (`Sierra-November`, WSL2, `x86_64`), same host as
§15. CPU: AMD Ryzen 5 3600X (`/proc/cpuinfo` reports `avx2`), so the official
`linux/x64` artifact was selected over `linux/x64-baseline` per Proton's own
selection guidance (baseline is only for AVX2-absent or `Illegal instruction`
cases).

**16.1 Official sources read this session, retrieved 2026-09-10** (in
addition to §12's list, which this does not retroactively join):

- https://proton.me/support/drive-cli — general usage documentation; does not
  itself list version/artifact/checksum data.
- https://proton.me/download/drive/cli/index.html — the authoritative
  machine-readable release index. Fetched **twice**: once via an
  intermediate summarization model (for a first orientation pass) and once
  as **raw HTML via direct HTTPS** (`curl`), because a 128-hex-character
  SHA-512 string is exactly the kind of value a summarization pass could
  silently transcribe wrong, and only the raw fetch is treated as evidence
  for the checksum used in verification. The two agreed byte-for-byte on the
  `linux/x64` row.
- https://github.com/ProtonDriveApps/sdk/tree/main/cli — read via the
  summarization path only (no checksum-bearing content there); reports the
  CLI is built with Bun from the Drive SDK, official releases are published
  at `proton.me/download/drive/cli`, and documents the credential-related
  environment variables in §16.5 below. **This paraphrase, unlike the raw
  index fetch, is not independently re-verified byte-for-byte and should be
  confirmed directly before being relied on.**

**16.2 Published release, from the raw index fetch.** Version **0.8.0**,
release date **2026-08-13** (`<title>Proton Drive CLI 0.8.0</title>`,
`Last-Modified: Thu, 13 Aug 2026 05:43:40 GMT` on the index page itself).
Selected artifact:

| Platform | URL | SHA-512 |
| --- | --- | --- |
| `linux/x64` | `https://proton.me/download/drive/cli/0.8.0/linux-x64/proton-drive` | `cf61c2688c45e1055d8add6221d9471a5a5b64bf3bcdb86460f5cb18414596cc4df3cdb6627c9097c94bec32a3c9915ada3211ef2ae5be33c46ebbc996ccaa28` |

(`linux/x64-baseline`, `linux/arm64`, `linux/arm64-musl`, `linux/x64-musl`,
`macos/arm64`, `macos/x64`, `windows/arm64`, and `windows/x64` rows were also
present on the index and read, but not selected or downloaded.)

**16.3 Download and verification, in a single-use temp directory
(`/tmp/proton-drive-e3e.<random>`, created this session, removed after
successful install).** `curl -fSL` to the exact URL above returned a single
direct `HTTP/2 200` from `proton.me` — no redirect hop, so provenance is the
first-party host itself. Downloaded size: **117,946,496 bytes**
(`Content-Length` matched actual bytes received). `sha512sum` of the
downloaded file matched the table above **exactly**. `file` reported: `ELF
64-bit LSB executable, x86-64, version 1 (SYSV), dynamically linked,
interpreter /lib64/ld-linux-x86-64.so.2, for GNU/Linux 3.2.0, ... not
stripped` — consistent with a genuine native Linux x64 executable, not a
script, archive, or foreign-architecture binary. Only after this exact match
was the temp copy marked executable.

**16.4 Isolated smoke test, before install.** With `PROTON_DRIVE_CACHE_DIR`
pointed at a fresh subdirectory of the same temp directory (so no state could
land in the operator's home directories), the temp binary ran:

- `proton-drive version` → `Proton Drive CLI cli-drive@0.8.0+06e8c605` /
  `Proton Drive SDK js@0.21.0+06e8c605` / `You are running the latest
  version.` — exit 0.
- `proton-drive help` → printed the full command usage table (`auth`,
  `filesystem`, `sharing`, `invitation`, `album`, `photo` subcommands) — exit
  0.

Neither command requested authentication, opened a browser, or contacted
account state. The isolated cache directory was empty both before and after
running both commands.

**16.5 Install.** The verified temp binary was copied to a same-directory
staging path, `chmod 0755`'d, and `mv`'d into place with a non-clobbering
move (`mv -n`) — installed atomically to
`/home/michal/.local/bin/proton-drive`, owner `michal:michal`, mode `0755`.
No `sudo` was used; no package manager, shell profile, PATH, environment
variable, mount, WSL setting, or repository code/config/test was touched.

**16.6 Post-install reconfirmation.**

- `command -v proton-drive` resolves to `/home/michal/.local/bin/proton-drive`
  exactly (`~/.local/bin` was already on this shell's `PATH` beforehand — no
  profile edit was made to achieve this).
- `sha512sum` of the installed file equals the temp-binary hash and the
  published checksum, all three identical.
- With a second, separately created isolated `PROTON_DRIVE_CACHE_DIR`, the
  **installed** binary's `version` and `help` output matched §16.4 exactly.
- `find` over `~/.cache`, `~/.local/share`, `~/.local/state`, and `~/.config`
  for any Proton/drive-SDK-named path returned nothing in all four locations
  — no authentication or session state exists anywhere outside the isolated
  temp cache directories used above.

**16.7 Credential-store prerequisites — presence/version only, nothing
configured or selected.** Per the GitHub SDK page's paraphrased description
(§16.1), the default credential store is the OS keychain/secret-store
(service id `ch.proton.drive/drive-sdk-cli`), with `pass` as a documented
alternative and an explicitly unsafe plaintext-file mode this session was
told never to use. Read-only findings on this host:

| Tool | Result |
| --- | --- |
| `secret-tool` / libsecret | not found on `PATH`; no matching `dpkg` package |
| `pass` | not found on `PATH` |
| `gpg` | found, `gpg (GnuPG) 2.4.4` |

No credential backend was initialized, configured, or selected as a result
of this observation.

**16.8 Cleanup.** The exact temp directory created in §16.3 was validated as
a path matching `/tmp/proton-drive-e3e.*` before removal, then removed. No
other path was deleted.

**16.9 Evidence classification for this section.**

- **Directly verified this session (byte-exact):** the `linux/x64` download
  URL, size, and SHA-512, matched independently against a raw (non-summarized)
  fetch of Proton's own release index; the installed file's hash against
  both of those.
- **Directly observed this session (command output):** `version`/`help`
  output, `file` type, `command -v` resolution, absence of Proton state in
  home cache/data/state/config directories, presence/version of
  `secret-tool`/`pass`/`gpg`.
- **Paraphrased secondary source, not independently re-verified byte-for-byte:**
  the GitHub SDK page's description of Bun-based builds and the default
  credential-store mechanism (§16.1, §16.7) — treat as orientation, confirm
  directly (e.g. against the CLI's own `--help` output for the relevant
  subcommand, or the SDK README) before depending on it.
- **Explicitly unresolved, out of scope for this session:** authentication
  behavior of any kind, session persistence, credential-store selection or
  configuration, and every §10/§11 scratch-experiment unknown. Installing and
  smoke-testing the CLI answers none of those; they remain exactly as open as
  §10/§11 left them.

**No Proton account was accessed, authenticated, or contacted. No Drive
object was uploaded, downloaded, listed, created, trashed, deleted, shared,
or inspected. No credential, token, session, or account identifier was
requested, received, printed, stored, or handled. No credential-store
backend was configured. No key was generated. No database, backup artifact,
ciphertext, deployment, timer, retention, restore, or tunnel action occurred.
No Hotel-Echo access occurred. No sudo, package-manager install, Bun install,
or source build occurred. No shell profile, environment variable, mount, WSL
setting, service, or repository code/config/test was modified. Nothing was
staged, committed, or pushed. `E3 remains unactivated; the §10 scratch
experiment remains separately unauthorized and has not started.` No Gate
checkbox changed. See `HANDOFF.md`'s E3E Active State entry for a pointer to
this section.**

---

## 17. E3F update (2026-09-11, read-only session): main-PC credential-store feasibility for the §10 scratch experiment

A narrowly scoped, **read-only** session, separately authorized, evaluated
which Proton Drive CLI credential-store backend (`keychain` or `pass`; not
`unsafe_file`, which stays rejected) is more defensible for the still-
unauthorized §10 scratch experiment, on this host only. **This session did
not install, configure, initialize, authenticate, generate keys, or modify
any host state.** No Proton command was executed, including `version`,
`help`, `auth`, or `filesystem` — this update does not repeat or extend §16's
smoke test. No existing personal GPG key was inspected, listed, or selected;
`gpg --list-secret-keys` was never run; no password-store entry, key
identity, fingerprint, UID, or recipient was listed. This is not the
production Hotel-Echo credential-backend decision, and it claims no
unattended-reboot persistence for either candidate.

**Host identity.** Main PC (`Sierra-November`), same host as §15-§16, now
confirmed as **Ubuntu 24.04.4 LTS** under WSL2, `x86_64`, with **`systemd=true`**
in `/etc/wsl.conf` and `systemctl is-system-running` reporting `degraded`
(some pre-existing unit failure, not investigated — out of scope) rather than
`offline`, i.e. this WSL instance genuinely runs systemd as PID 1, not just
the bare WSL2 kernel. Repository baseline unchanged at `e655c13`
(`HEAD` = `origin/main`); the working tree and index were clean at session
start, `HEAD` and `origin/main` remained unchanged throughout, and the index
remained empty. After documentation, the working tree contained only
`HANDOFF.md` and this memo.

**17.1 Sources read this session** (in addition to §12 and §16.1, neither of
which this retroactively joins):

- https://proton.me/support/drive-cli — re-read for credential-store content;
  confirms the browser-based `auth login` flow but does not itself enumerate
  `PROTON_DRIVE_CREDENTIALS_STORE` values. **[OFFICIAL]**
- https://raw.githubusercontent.com/ProtonDriveApps/sdk/main/cli/README.md —
  fetched **raw** via direct HTTPS (not only through a summarizing pass) and
  read in full (114 lines); this is the authoritative source for the table in
  §17.2 below and is quoted verbatim where load-bearing. **[OFFICIAL]**
- https://www.passwordstore.org/ — `pass` requires GnuPG and a GPG key;
  `pass init "<Key ID>"` creates `~/.password-store`; entries are individual
  GPG-encrypted files. Says nothing about non-interactive/headless decryption.
  **[OFFICIAL]**
- https://www.gnupg.org/documentation/manuals/gnupg/Invoking-GPG_002dAGENT.html
  and .../Agent-Options.html — `gpg-agent` is started on demand by `gpg`/
  `gpgconf`/etc., not manually; a proper `pinentry` program must be installed
  or configured via `pinentry-program`; `GPG_TTY` must be exported and kept
  current for terminal-based `pinentry` to work; default passphrase-cache
  `--default-cache-ttl` is **600s** (resets on each access), default
  `--max-cache-ttl` is **7200s / 2h** (hard ceiling regardless of activity).
  Neither page documents cache behavior across terminal closure, logout, or
  reboot. **[OFFICIAL]**
- https://specifications.freedesktop.org/secret-service/latest/ — the Secret
  Service is a D-Bus API (`org.freedesktop.Secret.Service`) implemented by a
  provider such as GNOME Keyring or KWallet; the spec's own text says nothing
  about headless/WSL-style sessions without a full desktop login. **[OFFICIAL]**
- A web search surfaced (not officially authoritative, community reports,
  **[INFER]**-adjacent, cited for the specific claim only):
  https://github.com/microsoft/WSL/issues/10205 — reports that with
  `guiApplications=true` (WSLg) enabled, some WSL2/Ubuntu configurations wipe
  `/run/user/<uid>` (destroying systemd/D-Bus user-session sockets) on login;
  workaround reported is `guiApplications=false`. This host has WSLg active
  (see §17.2); this report was **not reproduced or tested** here — read-only
  scope forbids it — and is recorded as an unresolved risk, not a confirmed
  fact about this host.

**17.2 Host findings, read-only, this session:**

| Item | Finding |
| --- | --- |
| `secret-tool` / libsecret | Not on `PATH`; no `libsecret*` package installed (`dpkg -l`). Candidate `libsecret-tools` **0.21.4-1build3** is available from the existing local apt index (`noble/universe`) — install not attempted, index not updated. |
| Secret Service provider | No `gnome-keyring`, `kwallet`, `keepassxc`, or `seahorse` package installed; `gnome-keyring-daemon` not on `PATH`. Candidate `gnome-keyring` **46.1-2ubuntu0.2** available from the existing local index (`noble-updates/main`). |
| Session D-Bus | **Usable.** `DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus`; `systemd --user` reports `State: running`, 202 units, 0 failed, up 3 days; `dbus-user-session` **1.14.10-4ubuntu4.1** already installed. A read-only `dbus-send … ListNames` against the session bus succeeded and returned only `org.freedesktop.DBus` and `org.freedesktop.systemd1` — **no Secret Service name (`org.freedesktop.secrets`) is currently registered**, consistent with no provider being installed. Nothing was started, unlocked, or modified to obtain this. |
| System D-Bus | `/var/run/dbus/system_bus_socket` present; `dbus`/`dbus-user-session`/`systemd` **255.4-1ubuntu8.17** installed. |
| WSLg (graphical layer) | Active on this host — `/run/user/1000/wayland-0` is a live symlink into `/mnt/wslg/runtime-dir/`. WSLg is one potentially relevant condition described by the WSL#10205 community report (§17.1); the report's other triggering conditions were not matched, and the report was not reproduced on this host. |
| `pass` | Not on `PATH`; no `pass` package installed. Candidate **1.7.4-6** available from the existing local index (`noble/universe`). |
| `gpg` | Present, unchanged from §16: **2.4.4** (`libgcrypt 1.10.3`). |
| `gpg-agent` | Binary present (`/usr/bin/gpg-agent`); **no `gpg-agent` process currently running** (`pgrep` empty). Its systemd-socket-activation files already exist under `/run/user/1000/gnupg/` (`S.gpg-agent`, `S.gpg-agent.ssh`, `S.gpg-agent.extra`, `S.gpg-agent.browser`, `S.dirmngr`, `S.keyboxd`) — a first connection would auto-spawn it; nothing was connected to these sockets this session. |
| pinentry | Only implementation registered via `update-alternatives` is **`pinentry-curses`** (`1.2.1-3ubuntu5`, TTY/curses-based). No GUI pinentry (`pinentry-gnome3`, `pinentry-qt`) is installed; both are available from the existing local index if ever wanted. |
| `~/.gnupg` | Exists, mode `0700`, owner `michal:michal`, created 2026-09-03. Top-level listing only: `pubring.kbx` (32 bytes — an empty keybox header) and `trustdb.gpg`. **No key material was read, and no `gpg --list-secret-keys` or equivalent was run**; this listing is directory metadata, per scope. |
| `~/.password-store` | Does not exist (`stat`: No such file or directory). |

**17.3 Candidate A — `keychain` (libsecret / Secret Service).**

- **Missing packages/components:** no Secret Service provider is installed
  or registered on this host (§17.2). `gnome-keyring` is one available
  provider candidate (the natural Ubuntu choice, not the only possible one —
  `kwallet` and `keepassxc` are also viable Secret Service implementations
  and were not ruled out, merely not installed either). `libsecret-tools` is
  optional diagnostic/client tooling for the agent's own use (`secret-tool`
  CLI); it is not itself the provider required by Proton's `keychain`
  backend and is not a substitute for one. The session-bus prerequisite
  (`dbus-user-session`, a running `systemd --user`) is **already satisfied**
  — only the provider daemon itself is the gap.
- **Required persistent process/session service:** a Secret Service provider
  process registered on the session D-Bus as `org.freedesktop.secrets`, for
  as long as the CLI needs to read the stored session. Nothing currently
  provides that name (§17.2).
- **Unlock behavior — UNKNOWN on this host, not tested.** GNOME Keyring's
  usual "auto-unlock on login" path is driven by PAM integration with a
  display-manager graphical login, which WSL2 does not provide by default
  even with WSLg active; whether an equivalent unlock trigger exists or must
  be arranged separately on this host is undemonstrated. Behavior across
  terminal closure, idle, logout, and reboot is therefore unknown here, not
  merely undocumented — it depends on a component (the provider daemon) that
  isn't installed. The WSL#10205 `/run/user` wipe report (§17.1) is an
  unreproduced community-reported risk, potentially relevant because WSLg is
  enabled on this host, but it is not evidence that this host suffers the
  defect.
- **Browser auth without exposing the session to the agent:** yes,
  structurally, and backend-independent — per the CLI README, `auth login`
  opens a browser and "the CLI stores the session in the OS secret store"
  itself; the agent driving the CLI process never receives the credential.
  This is unverified end-to-end (no login has occurred) but is a property of
  the CLI's own design, not of which Secret Service provider is installed.
- **Headless/non-interactive limitations:** `secret-tool`/libsecret calls
  need no TTY themselves, but they do need a *running, unlocked* collection
  reachable over the session bus — achieving that without an interactive
  unlock step, with no display-manager login on this host, is exactly the
  open part above.
- **Security risks:** standard Secret Service exposure (any process running
  as the same Linux user with access to the session bus can query the
  collection while unlocked) — no different in kind from any other Secret
  Service consumer; the WSLg `/run/user` wipe report is a reliability risk
  more than a confidentiality one, but an unexpectedly-recreated runtime
  directory could also change which session bus a later process attaches to.
- **Exact separately authorized mutations needed for setup:** `apt install
  gnome-keyring` (and `libsecret-tools` if not pulled in transitively) via
  `sudo`; then deciding and configuring how the provider daemon actually
  starts and reaches "unlocked" state on this headless-login host (e.g. a
  `systemd --user` autostart unit) — not scoped or approved here.
- **Rollback/removal (implication, not executable authorization):** package
  removal (`gnome-keyring` and, if installed, `libsecret-tools`) requires a
  dependency-impact review — other installed software may share either
  package — and separate authorization; it is not a bare `apt remove`. Any
  keyring-file cleanup must target only a project-specific entry or keyring
  provably created exclusively for this experiment; wholesale deletion of
  `~/.local/share/keyrings/` is not recommended and is not scoped here.
- **Main PC vs Hotel-Echo:** the main PC can prove the packages install and
  an isolated `secret-tool store`/`lookup` round-trip works interactively
  once a provider is running. It cannot prove unattended reboot/idle
  persistence, and it cannot speak to Hotel-Echo's own systemd/D-Bus/WSLg
  characteristics (unknown, out of scope, a distinct host per the task
  framing).

**17.4 Candidate B — `pass` (GnuPG-backed).**

- **Missing packages/components:** only `pass` itself (**1.7.4-6**,
  available, not installed). GnuPG (**2.4.4**) and a pinentry
  (`pinentry-curses`) are already present — no GnuPG-side install gap.
- **Required persistent process/session service:** `gpg-agent`, which is not
  a manually-managed daemon here — its socket-activation files already exist
  (§17.2) so a first `gpg`/`pass` invocation auto-spawns it; `pass` itself is
  not a daemon, it shells out to `gpg` per call.
- **Unlock behavior — documented cache mechanics, cross-boundary behavior
  UNTESTED here.** Per the GnuPG manual (§17.1): `--default-cache-ttl` 600s
  (resets per access), `--max-cache-ttl` 7200s/2h (hard ceiling). Neither
  source documents what happens across terminal closure, logout, or reboot.
  Reasoning from the mechanism (not verified this session): the cache lives
  in the running `gpg-agent` process, so closing one terminal does not
  necessarily stop it — a `gpg-agent` process launched independently of a
  given terminal need not die with it. Cache entries are held in memory and
  therefore cannot survive a machine reboot, which would require a fresh
  interactive unlock. Whether a *logout* tears down the cache depends on
  whether the user's `systemd --user` manager instance remains alive across
  that logout — behavior that itself depends on factors such as lingering
  configuration, session accounting, and WSL-instance lifecycle, none of
  which this session inspected or tested. This reasoning is **not** the same
  as a tested result, and logout behavior and the need/timing for a fresh
  unlock remain unknown here.
- **Browser auth without exposing the session to the agent:** same
  backend-independent property as §17.3 — `auth login` is unchanged; the
  `pass` backend only changes *where* the CLI writes the resulting session
  (a GPG-encrypted `pass` entry instead of a keyring). Writing that entry
  would itself trigger a `pinentry` passphrase prompt unless the key is
  already cached.
- **Headless/non-interactive limitations:** `pinentry-curses` is TTY-bound —
  it needs `GPG_TTY` set and an attached terminal to prompt. A later
  unattended (no-TTY) invocation can only succeed while `gpg-agent`'s live
  cache still holds the passphrase (bounded by the TTLs above); a
  non-interactive unlock method such as `--pinentry-mode loopback` with a
  supplied passphrase is the standard alternative and is explicitly out of
  scope/forbidden for this session.
- **Security risks:** a real step up from `unsafe_file` — secrets are
  GPG-encrypted at rest under `~/.password-store` — but decrypted material
  still passes through `gpg`'s process memory and the `gpg-agent` cache
  window; a compromised session during that window is the same general
  exposure class as any local secret manager. The permitted metadata-only
  inspection found no evidence of a usable existing key for this purpose:
  `~/.gnupg`'s `pubring.kbx` is a 32-byte empty-keybox header, and no key
  identities, fingerprints, UIDs, recipients, or secret keys were listed
  (none were queried, per scope). A usable existing key was therefore not
  established — this is not a claim that no key exists anywhere. Per the
  task's own framing: a **new, dedicated, passphrase-protected**
  encryption-capable key is preferable to any existing personal key for this
  store; this review does not select or create one.
- **Exact separately authorized mutations needed for setup:** `apt install
  pass` (`sudo`); generation of a new dedicated GPG key (separately
  authorized, operator-performed, passphrase never handled by the agent);
  `pass init <new-key-id>` to create `~/.password-store`.
- **Rollback/removal (implication, not executable authorization):** `apt
  remove pass` requires the same dependency-impact review and separate
  authorization as any package removal. Deleting all of `~/.password-store`
  is not recommended unless it is proven session-created, project-exclusive,
  and free of unrelated entries at deletion time; otherwise only the
  project-specific Proton entry and any `.gpg-id` changes attributable to
  this work should be removed. Deleting a GPG secret or public key
  (`gpg --delete-secret-and-public-key`) requires separate explicit
  authorization and proof that the dedicated key is not used by anything
  else — it is not implied by this memo. `gpg-agent`'s socket-activation
  files are stock GnuPG, not something this setup uniquely introduces, and
  need no separate cleanup.
- **Main PC vs Hotel-Echo:** the main PC can prove the package installs, the
  key-generation UX, `pass init`, and a `PROTON_DRIVE_CREDENTIALS_STORE=pass`
  round-trip, plus the interactive-unlock/cache-TTL behavior as it actually
  presents (not just as documented). It cannot prove Hotel-Echo's own
  systemd/session characteristics, whether Hotel-Echo will have any TTY/
  pinentry path available for its eventual production role, or true
  unattended-reboot persistence there — a distinct, separately authorized,
  host-specific problem per the task framing and per U1.

**17.5 Candidate C — `unsafe_file`.** Unchanged: remains rejected. The
CLI's own README independently labels it "do not use, for testing only" —
consistent with, not dependent on, the standing project prohibition.

**17.6 Comparison and provisional recommendation.** Neither candidate can be
exercised without an install mutation this session was not authorized to
perform, so nothing here is a working setup. Between the two, for the
**bounded main-PC scratch experiment only** (not Hotel-Echo, not
production, not this session): **`pass` is the more defensible provisional
choice.** Its package gap is narrower (only `pass`; GnuPG/pinentry already
present), its unlock mechanics are at least officially documented (even if
untested across the boundaries above), and it does not depend on a
desktop-oriented keyring daemon whose auto-unlock story is unproven on a
WSL2 host with no display-manager login, plus a secondary, unreproduced
community report (WSL#10205) describing `/run/user` session-state loss in
some WSLg-enabled configurations — potentially relevant since this host has
WSLg enabled, but not evidence that this host suffers the defect, since the
report's other triggering conditions were not matched or reproduced here.
This is a provisional, main-PC-scoped judgment call, not a Hotel-Echo or
production recommendation, and it claims no unattended-reboot persistence
for `pass` either — that remains open per U1.

**17.7 Operator inputs required before any setup:**

1. Approval of the backend (this memo provisionally recommends `pass`, for
   the bounded main-PC scratch experiment only).
2. Whether a **new, dedicated** credential-store GPG key may be generated
   (recommended over reusing any existing personal key; key creation itself
   remains a separately authorized, operator-assisted step not performed
   here).
3. Operator-controlled passphrase entry/unlock — the operator, not the
   agent, types the passphrase at the `pinentry-curses` prompt; the agent
   must never receive, record, or transcribe it.
4. The Proton account label and plan tier for the later §10 scratch
   experiment (§10.1 already requires this and it is still unstated).

**17.8 Evidence classification for this section.**

- **Directly observed this session (command output, read-only):** every row
  of §17.2 — package/binary presence and versions, D-Bus session state and
  `ListNames` result, `gpg-agent` socket files, pinentry alternative,
  `~/.gnupg`/`~/.password-store` metadata, OS/WSL/systemd identity.
- **Official primary source, retrieved this session:** the CLI README's
  environment-variable and credential-storage tables (§17.1, quoted in
  §17.2-17.4); the GnuPG manual's cache-TTL defaults; the Secret Service
  D-Bus spec's provider model; `passwordstore.org`'s `pass`/GnuPG dependency
  description.
- **Community report, not independently reproduced, cited narrowly for one
  claim:** the WSL#10205 `/run/user` wipe behavior under `guiApplications=
  true` — flagged as an open risk, not a confirmed fact about this host.
- **Reasoned inference, not tested:** cache-persistence-across-logout/reboot
  behavior for `gpg-agent` (§17.4) and the PAM/display-manager gap for
  GNOME Keyring auto-unlock on WSL2 (§17.3) — both follow from documented
  mechanisms but were not exercised.
- **Explicitly unresolved, out of scope for this session:** actual
  installation of either backend; actual unlock-persistence testing across
  terminal closure, idle, logout, or reboot on any host; anything
  Hotel-Echo-specific; every §10/§11 scratch-experiment unknown other than
  the narrowing recorded above.

**No package was installed or updated. No key was generated, imported, or
exported. No password store was initialized. No keychain, Secret Service, or
GPG-agent process was started, unlocked, or configured. No passphrase,
credential, token, session, account, or recovery-code was handled. No Proton
command was executed and no Proton account was contacted. No Hotel-Echo
access occurred. No database, backup, encryption, deployment, scheduling,
retention, restore, or tunnel action occurred. Only two files changed:
this memo and the `HANDOFF.md` E3F Active State entry. Nothing was staged,
committed, or pushed. `E3 remains unactivated; the §10 scratch experiment's
authorization status is unchanged and it has not started.` No Gate checkbox
changed. `HEAD`/`origin/main` unchanged at `e655c1301179bec664322664d395be8398635046`.**

## 18. E3H update (2026-09-11, mutating session): main-PC `pass`/GPG credential-store foundation installed and initialized, no Proton contact

A narrowly scoped, separately authorized **mutating** session that built the
minimum `pass`/GnuPG foundation §17.4 identified, on this host only. It acts
on §17.6's provisional recommendation and on §17.7's operator inputs: inputs
1-3 were **implemented and setup-tested** on this host, and input 4 — the
Proton account label and plan tier — was **separately recorded as
operator-supplied** (§18.8). Recording input 4 is a documentation act only: it
did **not** authenticate Proton, contact Proton, or verify the account, and no
Proton credential was created. The §10 scratch experiment remains separately
unauthorized and unstarted, and this is still not the production Hotel-Echo
credential-backend decision.

**Host identity.** Main PC (`Sierra-November`) only, same host as §15-§17.
Repository baseline at session start: `main`, working tree clean, index empty,
`HEAD` = `origin/main` = `6b7b8c7b61fc1b42d031526ba2265b622e3b8dbd`.

**18.1 Preflight, read-only, before any mutation.** All seven checks passed and
no stop condition was triggered.

| # | Check | Result |
| --- | --- | --- |
| 1 | Repository baseline | `main`; `HEAD` = `origin/main` = `6b7b8c7`; `git status --short` empty; index empty. |
| 2 | Host | `hostname` and `/etc/hostname` both `Sierra-November`. |
| 3 | `pass` absent | Not on `PATH`; `dpkg -s pass` → "not installed and no information is available". Confirms §17.2 still held. |
| 4 | `~/.password-store` absent | `ls -ld` → "No such file or directory"; `PASSWORD_STORE_DIR` unset, so the default path applied. |
| 5 | UID collision | The keyring was **completely empty** — `gpg --list-keys` and `gpg --list-secret-keys` both returned nothing, and `gpg --list-keys "EANHL Proton Drive scratch credential store"` returned "error reading key: No public key". A collision was therefore impossible. Only metadata was listed; **no key material was read or exported** (consistent with §17.2's 32-byte empty `pubring.kbx`). |
| 6 | apt simulation | `apt-get install --no-install-recommends -s pass` reviewed in full (§18.2). |
| 7 | Stop conditions | **None present** — no removals, no downgrades, no unrelated upgrades, nothing beyond `pass` and its strict dependency. |

**18.2 Authorized mutation 1 — package installation.** The existing apt
configuration was used unchanged; the package index was **not** updated and no
general upgrade was run. The real transaction matched the simulation exactly:

```
The following NEW packages will be installed:
  pass tree
0 upgraded, 2 newly installed, 0 to remove and 37 not upgraded.
Need to get 81.9 kB of archives.
After this operation, 242 kB of additional disk space will be used.
```

- `pass` **1.7.4-6** (`noble/universe`, `all`) — `dpkg -S /usr/bin/pass` → `pass`;
  `pass --version` reports `v1.7.4`.
- `tree` **2.1.1-2ubuntu3.24.04.2** (`noble-updates/universe`, `amd64`) — pulled
  in as a strict `Depends:` of `pass` (`Depends: gnupg, tree`), **not** a
  recommend. `gnupg` was already satisfied by the existing GnuPG 2.4.4.
- Recommends were correctly excluded by `--no-install-recommends`: `git`,
  `qrencode`, `xclip`, `wl-clipboard`. Suggests were not installed.
- The **37 held-back upgrades were left untouched**; no unrelated package
  changed state.
- A cosmetic `debconf: unable to initialize frontend: Dialog … falling back to
  frontend: Readline` notice appeared (terminal too small); it affected
  presentation only, and both packages report `install ok installed`.

**18.3 Authorized mutation 2 — one dedicated GPG key.** Generated with
`gpg --quick-generate-key "EANHL Proton Drive scratch credential store"
future-default default 1y`. Passing `future-default` for algo **and**
`default` for usage is the documented way to obtain a primary key *and* an
encryption subkey while still specifying an expiry — supplying an algo or
usage in any other combination creates a primary key with no subkey, which
would have failed the encryption-capability requirement. Non-secret metadata
only:

| Item | Value |
| --- | --- |
| UID | `EANHL Proton Drive scratch credential store` — exact, **no email address, no comment** |
| Primary fingerprint | `6FE53745252DE62F3306F5A297CF8A451B68AEED` |
| Primary algorithm | `ed25519` (`future-default` on GnuPG 2.4.4) |
| Primary capabilities | `[SC]` — sign + certify (colon field `scESC`; the uppercase `ESC` is the whole-key rollup including the subkey's `E`) |
| Created | 2026-09-11 18:20:09 UTC |
| **Expires** | **2027-09-11 18:20:09 UTC** (1 year, as authorized) |
| Encryption subkey | `cv25519`, `[E]`, fingerprint `88C2731EAAF3F27F381F0229C6E5FD61DA904A2E`, colon capability field `e` |
| Subkey expiration | **None of its own** — the colon `expires` field is empty. The subkey carries no independent expiration timestamp; the 1-year bound is enforced by the primary key's 2027-09-11 expiry. This is stock `--quick-generate-key` behaviour, recorded as observed rather than "corrected" — no second key was improvised. |
| Keyring totals after generation | exactly **1** primary public key and **1** secret key; no other key exists on this host |
| Owner trust | `[ultimate]` (automatic for a locally generated key); `trustdb` was created/checked by GnuPG itself, next check due 2027-09-11 |

**Encryption capability verified** before `pass init`: the subkey reports
capability `e` in `--with-colons` output and `[E]` in human-readable output.
The stop condition in the authorization ("if it does not, stop; do not
improvise another key") was therefore not reached. No test encryption or
decryption was performed — the capability flags are authoritative.

**Passphrase handling.** The key is passphrase-protected. **The operator typed
the passphrase directly at the interactive `pinentry` prompt.** No batch mode,
no `--pinentry-mode loopback`, no `--passphrase`/`--passphrase-fd`/
`--passphrase-file`, no environment variable, no file, no command argument,
and no passphrase-less key. The agent never requested, received, printed,
recorded, or transcribed it. The same applies to the `sudo` password in §18.2.

**Side effect recorded for completeness:** GnuPG automatically created
`~/.gnupg/openpgp-revocs.d/` and stored a revocation certificate at
`~/.gnupg/openpgp-revocs.d/6FE53745252DE62F3306F5A297CF8A451B68AEED.rev`. This
is stock GnuPG behaviour on key creation, not a deliberate act of this session;
the file was **not read, opened, copied, or exported**. It is secret-adjacent
(it can revoke the key) and belongs to the rollback surface in §18.7.

**18.4 Authorized mutation 3 — password-store initialization.**
`pass init 6FE53745252DE62F3306F5A297CF8A451B68AEED` → `mkdir: created
directory '/home/michal/.password-store/'` and `Password store initialized for
6FE53745252DE62F3306F5A297CF8A451B68AEED` (exit 0). The store was confirmed
absent immediately before the call, so it is provably session-created and
project-exclusive — which is the precondition §17.4's rollback note required.

| Item | Verified state |
| --- | --- |
| Path | `~/.password-store` (default; `PASSWORD_STORE_DIR` unset) |
| Directory mode/owner | `drwx------` (0700), `michal:michal` |
| `.gpg-id` | mode `-rw-------` (0600), **one line**, containing exactly `6FE53745252DE62F3306F5A297CF8A451B68AEED` and nothing else |
| Entries | **Zero.** `pass ls` prints only the `Password Store` header; `find ~/.password-store -name '*.gpg'` returns 0 files. |
| `pass git` | Not initialized — no `.git` directory in the store. |

**No entry of any kind exists, and no Proton credential exists.** No test
secret was inserted, no `pass insert`/`generate` was run, and nothing was
decrypted, exported, or displayed.

**18.5 Deliberately not done.** No shell profile, `.bashrc`, `.profile`,
`gpg.conf`, or `gpg-agent.conf` was written or modified — in particular no
`default-cache-ttl`/`max-cache-ttl` tuning and no `pinentry-program` line (both
files remain absent). `GPG_TTY` was exported inline in the operator's own
interactive shell for the single key-generation command only; it was **not**
persisted anywhere. No systemd unit, no automatic-unlock mechanism, no
persistent Proton environment variable (including
`PROTON_DRIVE_CREDENTIALS_STORE`), and no GPG private-key export or backup.
No `proton-drive` command was executed — not `auth`, not `filesystem`, not
`version`, not `help`.

**18.6 What this does and does not settle.**

- **Settled:** the `pass` backend's *installability and initialization* on this
  host — §17.4's "missing packages/components" gap is now closed, the
  key-generation UX is demonstrated, and `pass init` works against a dedicated
  encryption-capable key. §17.7 operator inputs 1-3 are satisfied by this
  session's implementation and setup test, and input 4 is satisfied by the
  operator-supplied account label and plan tier recorded in §18.8 — so **all
  four §17.7 operator inputs are now satisfied for the current account and
  current plan.** That satisfaction is scoped to the account and plan as
  stated: it rests on the operator's statement, not on any verification
  against Proton.
- **Not settled — unlock persistence remains completely untested.** Nothing in
  this session exercised `gpg-agent` cache behaviour across terminal closure,
  idle, logout, or reboot, on this host or any other. §17.4's cache-TTL
  discussion remains reasoned-from-documentation, not measured. **U1 remains
  open**, and this session does not narrow it beyond §17's narrowing: U1 is
  about *Hotel-Echo* unattended reboot persistence, and no Hotel-Echo access
  occurred here.
- **Not settled:** a `PROTON_DRIVE_CREDENTIALS_STORE=pass` round-trip through
  the CLI, which requires Proton authentication and is unauthorized.
- **Conditional, not permanent:** a future plan change would require
  restating and revalidating the plan-tier and capacity preconditions before
  the §10 experiment could proceed on the new plan — see §18.8. Mail Plus
  remains **only under consideration**, not selected.

**18.7 Rollback implications (stated, not performed).** Nothing was rolled
back and no rollback is authorized by this memo. The surface this session
created is:

1. **Packages.** `apt remove pass` plus, separately, `tree`. `tree` is a
   general-purpose utility that other software or the operator may want
   independently, so it must not be removed reflexively with `pass`; both
   removals need the dependency-impact review and separate authorization
   §17.4 already required.
2. **The password store.** `~/.password-store` is provably session-created,
   project-exclusive, and empty apart from `.gpg-id` (§18.4), so it is the one
   artifact §17.4's caveat clears for wholesale deletion — but only while that
   remains true. Once any entry exists, the narrower rule reapplies.
3. **The GPG key.** Deleting it
   (`gpg --delete-secret-and-public-key 6FE53745252DE62F3306F5A297CF8A451B68AEED`)
   still requires separate explicit authorization. The dedicated UID and the
   provably empty prior keyring (§18.1 check 5) make "not used by anything
   else" straightforward to establish here, which was not the case in §17.4.
4. **The revocation certificate.** `~/.gnupg/openpgp-revocs.d/6FE5…AEED.rev`
   would be orphaned by any key deletion and should be removed with it. It is
   not stock-and-shared like the `gpg-agent` socket files — it is specific to
   this key.
5. **Nothing else.** `gpg-agent` socket-activation files, `~/.gnupg` itself,
   and the trustdb are stock GnuPG and need no cleanup.

**18.8 Proton account and plan — recorded, unchanged, and load-bearing.**

- Account: the **primary Proton account** — the §10.1 / §17.7-input-4 account
  label, now supplied by the operator and recorded here. Recording it
  satisfies input 4 for this account; it **did not authenticate, contact, or
  otherwise verify the Proton account**.
- **Current plan: Proton Unlimited.**
- The operator is **considering Mail Plus**, but **no plan change is authorized
  or decided**, and nothing in this session assumes one. Mail Plus is a
  candidate under evaluation, not a selection.
- **A downgrade is not a neutral billing change for this work.** Any move off
  Proton Unlimited would alter available Drive quota and therefore invalidate
  the capacity arithmetic this transport design rests on. Before any such
  downgrade is approved, the operator must (a) **remeasure the actual
  available quota** on the resulting plan and (b) **recalculate E1D's
  conservative ~350 GiB retained-capacity model** (§6's C3, upheld against the
  rejected 140 GiB figure in R3, and referenced in §15's headroom comparison)
  against that remeasured quota. Plan tier also changes A5's version limits
  per §10.1, so the §10 experiment's own preconditions would need restating.
  None of that has been done, and no plan change is being recommended here.

**18.9 Evidence classification for this section.**

- **Directly observed this session (command output):** every value in §18.1-
  §18.4 — preflight state, the apt simulation and the real transaction,
  `dpkg-query` versions, `pass --version`, `dpkg -S` ownership, all GPG
  metadata via `--list-keys`/`--with-colons`/`--with-subkey-fingerprint`,
  the `pass init` result, and the store's permissions, `.gpg-id` content, and
  zero-entry state.
- **Official primary source, consulted this session:** the local `gpg(1)`
  manual page's `--quick-generate-key` text, which is why `future-default` +
  `default` was used (§18.3).
- **Operator-supplied, recorded not verified:** the Proton account label, the
  current Proton Unlimited plan, and the Mail Plus consideration (§18.8). No
  Proton account was contacted, so none of this was confirmed against Proton.
- **Explicitly untested:** all unlock-persistence behaviour (§18.6); every
  Proton CLI interaction; everything Hotel-Echo-specific.
- **Operational fact worth carrying forward:** the agent's own shell has no
  controlling TTY (`tty` → "not a tty"), and this host has only
  `pinentry-curses` with no GUI pinentry installed. Both the `sudo` step and
  the `pinentry` step therefore had to be run by the operator in their own
  terminal and cannot be agent-driven under the standing passphrase rules.
  Any future session touching this store must plan for that split.

**Three authorized mutation groups occurred: `pass` (and its strict
dependency `tree`) was installed; one dedicated passphrase-protected GPG key
was generated, including GnuPG's documented subordinate side effects (the
encryption subkey, the automatic revocation certificate, and the trustdb,
each recorded in §18.3); and `~/.password-store` was initialized to that
key's fingerprint. The package, keyring, and password-store side effects are
itemized in §18.2-§18.4 and in the §18.7 rollback surface. No entry was
inserted and no Proton credential exists. No passphrase or secret was
requested, received, printed, recorded, transcribed, or placed in a command
argument; nothing was decrypted, exported, or displayed. No Proton
authentication and no Proton Drive operation occurred, and no `proton-drive`
command was executed. No Hotel-Echo access occurred. No database, backup,
encryption, deployment, scheduling, retention, restore, or tunnel action
occurred. Unlock persistence remains untested and U1 remains open. Only two
files changed: this memo and the `HANDOFF.md` E3H Active State entry. Nothing
was staged, committed, or pushed. `E3 remains unactivated; the §10 scratch
experiment remains separately unauthorized and unstarted.` No Gate checkbox
changed. `HEAD`/`origin/main` unchanged at
`6b7b8c7b61fc1b42d031526ba2265b622e3b8dbd`.**
