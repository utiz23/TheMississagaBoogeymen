# Proton Drive §10 bounded scratch experiment — E3I1 execution record

**Sessions:** E3I1, 2026-09-11 (mutating, Proton-contacting); E3I2,
2026-09-11 (+3 h, read-only); E3I3, 2026-09-12 (+24 h, read-only)
**Host:** `Sierra-November` (main PC)
**Status:** experiment executed and cleaned up; post-cleanup observation window
**CLOSED by E3I3 on 2026-09-12** (§8.3). E3I is **protocol completed to the
extent supported by Proton Drive CLI 0.8.0, with quota/account-residual work
blocked** — not a successful quota experiment, and not E3 activation.

This memo records the execution of the protocol defined in
[`proton-drive-transport-feasibility.md`](proton-drive-transport-feasibility.md)
§10, under a separate explicit operator authorization. It is an evidence
record, not an approval. **It does not activate E3, claim production
readiness, Hotel-Echo persistence, retention correctness, or recoverability.**

---

## 1. Authorization and exact boundaries

The operator explicitly authorized the complete §10 scratch experiment on
`Sierra-November` against the **primary Proton account** (plan: **Proton
Unlimited**, unchanged throughout and for the observation window).

**Authorized and performed:** operator-performed browser authentication and
passphrase entry; one isolated scratch folder; six synthetic files totalling
≤ 512 MiB; upload/download/hash verification; one collision test; targeted
trash and permanent deletion; complete scratch cleanup; quota observations
through +24 h.

**Excluded by the authorization, and confirmed not done:** Hotel-Echo access;
production data or real backup artifacts; age-key generation or handling;
listing, reading, downloading, renaming, sharing, trashing or deleting any
pre-existing Drive **child** object (but see §1.3 — one pre-existing **parent**
node was read); a second uploader identity or §10 step 12; account,
sharing, retention, version-history or plan-setting changes; global
empty-trash; deployment, scheduling, production backup activation or tunnel
reopening; exposure of credentials, tokens, session material, account
identifiers, passwords, passphrases or recovery codes.

### 1.1 Deviation from the written step order, and why

§10 step 10 / the session brief ask to "permanently delete one scratch item
using a targeted operation". The installed CLI's `filesystem delete`
**permanently deletes trashed items only**. Permanent deletion is therefore
necessarily `trash` → `delete` on the same object, not an independent act.
This is a property of the tool, not a scope change; it is recorded as a U3
finding (§7.3) rather than treated as a protocol violation.

### 1.2 Secret-handling incident (disclosed, contained)

While reporting a successful login, the operator pasted the CLI's browser
login URL into the session transcript. That URL carries a **one-time
authentication handshake payload** — session material that this authorization
forbids placing in chat. It was already consumed by the completed login and
contains **no account identifier**. **Replayability was not tested and must not
be tested**, so no claim of non-replayability is made: the URL is to be treated
as **sensitive session material** regardless. It was **not** copied into this
memo, the repository, or the final report. Recorded here because suppressing it
would misrepresent the session's secret-handling record; the operator **should
clear that terminal's transcript/scrollback**. Logout/revocation and credential
removal remain separately authorized decisions after the +24 h observation. No
other secret was exposed at any point.

### 1.3 Pre-existing-node deviation (disclosed, read-only)

**Corrected by E3I2.** Earlier revisions of this memo stated without
qualification that no pre-existing Drive object was touched or addressed. That
claim was too broad and is withdrawn.

At 19:26:23Z the session ran `filesystem info /my-files --json` as the U9 quota
probe (§7.6). `/my-files` is a **pre-existing parent node**, not an object this
session created. Precisely what happened, and what did not:

- one pre-existing node, `/my-files`, received a **metadata-only `info` read**;
- **its children were never listed or inspected** — no `filesystem list
  /my-files` was ever run;
- **no pre-existing child or trash object** was listed, read, downloaded,
  renamed, shared, trashed or deleted;
- **`/trash` was never enumerated**;
- **no pre-existing object was mutated** in any way.

This is a **narrow read-only deviation from the literal authorization
boundary**. It is disclosed here as a deviation; it is **not** described as
compliant with the boundary as written. Every other statement about
pre-existing objects in this memo is to be read subject to this disclosure.

---

## 2. Artefact, backend and account facts

| Fact               | Value                                                                          |
| ------------------ | ------------------------------------------------------------------------------ |
| CLI path           | `/home/michal/.local/bin/proton-drive`                                         |
| CLI version        | `cli-drive@0.8.0+06e8c605`, SDK `js@0.21.0+06e8c605`                           |
| CLI size           | 117,946,496 bytes                                                              |
| CLI SHA-512        | `cf61c268…ccaa28` — **matched the recorded baseline exactly**                  |
| Credential backend | `PROTON_DRIVE_CREDENTIALS_STORE=pass` (env only, never persisted to a profile) |
| `pass` version     | 1.7.4                                                                          |
| GPG fingerprint    | `6FE53745252DE62F3306F5A297CF8A451B68AEED` (sole `.gpg-id` entry)              |
| Account            | primary Proton account (identifier deliberately not recorded)                  |
| Plan               | Proton Unlimited — unchanged, and not to be changed before +24 h               |
| Cache isolation    | `PROTON_DRIVE_CACHE_DIR` per phase; sets `cacheDir`=`appDir`=`logDir`          |

Repository baseline at session start and end: branch `main`,
`HEAD`=`origin/main`=`5c2c7e36af4cedd48b62f9fa891f3ffe6957907f`, clean tree
and empty index.

---

## 3. Preflight (before any Proton contact)

| #   | Check                                                                  | Result                                   |
| --- | ---------------------------------------------------------------------- | ---------------------------------------- |
| 1   | Repository baseline and clean state                                    | PASS                                     |
| 2   | Hostname `Sierra-November`                                             | PASS                                     |
| 3   | CLI path, version, size, SHA-512                                       | PASS — exact SHA-512 match               |
| 4   | `pass` 1.7.4 and expected `.gpg-id`                                    | PASS — single line, expected fingerprint |
| 5   | Password store has **zero** `.gpg` entries                             | PASS — 0 entries                         |
| 6   | CLI local help inspected for syntax/JSON/conflict/quota/deletion/cache | PASS — see §4                            |
| 7   | Producer/acceptor contract read; valid synthetic triple constructed    | PASS — see §5                            |
| 8   | Stop conditions evaluated                                              | **None triggered**                       |

Stop-condition evaluation: baseline evidence matched; the CLI **does** provide
targeted operations that avoid pre-existing objects (`trash <path>`,
`delete <path>`, `info <path>`, `list <folder>`); cleanup **can** be performed
without a global destructive operation, so `empty-trash` was never run; the
proposed upload total (373.0 MiB) was below 512 MiB; no command exposed
credentials or account identifiers.

The one negative preflight finding — the CLI exposes **no quota operation** —
is an explicitly handled case under §10's contingency wording ("record U9 as
unresolved"), not a stop condition. That wording is the **protocol's**
pre-execution phrasing; the **final disposition** is U9 **RESOLVED NEGATIVE for
CLI 0.8.0** (§7.6, §9), because the question U9 asks was in fact answered.

---

## 4. CLI capability surface relevant to E3

Established from the installed binary's own help, before authentication.

- **Commands:** `auth login|logout`; `filesystem list|info|create-folder|
upload|download|rename|copy|move|trash|restore|delete|empty-trash`;
  `sharing …`; `invitation …`; `album …`; `photo …`.
- **JSON:** global `-j|--json`.
- **Upload file-conflict strategies:** `create-new-revision`, `rename`,
  `replace`, `skip`. Without a strategy the CLI _prompts_. Documented
  behaviour: "Files with the same content are automatically skipped."
- **`filesystem delete`:** "Permanently deletes trashed items only."
  Path-targeted.
- **`filesystem empty-trash`:** global over `/trash`, asynchronous. **Not run.**
- **No quota/storage/usage/account/volume command exists** — every such probe
  fell through to the top-level usage text.
- **Cache:** `PROTON_DRIVE_CACHE_DIR` overrides cache/app/log dirs together;
  otherwise XDG paths under `proton-drive-cli`. `PROTON_DRIVE_UNSAFE_CACHE`
  exists and was **not** used.

---

## 5. Local isolation and the synthetic upload set

One `mktemp -d` directory, mode 0700, path validated against the expected
`/tmp/eanhl-e3i1-*` shape before any later removal. All synthetic content was
random bytes generated inside it. Raw CLI JSON existed only there.

**Four logical items, six physical files.** Base identity
`eanhl-synthetic-20260911T191442Z`.

| #   | File                       |       Bytes | SHA-256                                                            |
| --- | -------------------------- | ----------: | ------------------------------------------------------------------ |
| 1   | `probe-1MiB.bin`           |   1,048,576 | `a102f595481971878430321d10f2ca9be9be7ca2adcb77de8314bba9cdd0b960` |
| 2   | `probe-64MiB.bin`          |  67,108,864 | `505405e63e3645be52c92088eec2bff895a1f270f14f8c7f52637f9e69b2c1f8` |
| 3   | `probe-300MiB.bin`         | 314,572,800 | `923001908c1b5bfa07a8b511ca66b6ce83dbb0e4c6b45abd747824816d94dcbb` |
| 4a  | `…191442Z.dump.age`        |   8,388,608 | `5723e7bf2fdf29573496fa21d97253a762489e23ccb849f7f4405f974b506f92` |
| 4b  | `…191442Z.dump.age.sha256` |         108 | `9bfa698dacfbaeec3b5b9337bc774cef515e78a30c07dcf60bad0773b30ac0de` |
| 4c  | `…191442Z.manifest.json`   |       1,151 | `dff7b34b840718a3a77c774681e33c88e030330d6aa7f4994087e0a1af0105e7` |

Initial six-file total: **391,120,107 bytes = 373.0 MiB**.

The manifest was fabricated against the repository contract
(`ops/backup/lib/backup-producer.mjs`, `MANIFEST_SCHEMA_VERSION = 1`) with
entirely synthetic `source`, `encryption` and `validation` values — no real
host, database, git commit, recipient or production-derived field. No age key
was generated, referenced or handled; the `.dump.age` file is random bytes,
not ciphertext.

**Pre-upload binding verification** used the repository's own acceptance
predicate `verifyArtifactCompletion()` — not a reimplementation — which
enforces all seven completeness rules. Result: `complete: true, failures: []`.

---

## 6. Execution log (sanitized)

All commands ran with `PROTON_DRIVE_CREDENTIALS_STORE=pass` and an isolated
`PROTON_DRIVE_CACHE_DIR`. All output was passed through a redaction filter
before leaving the temporary directory; it replaced account e-mail addresses
and any `token`/`secret`/`session`/`password`/`credential`/`passphrase` field
value, and was self-tested to leave SHA-256 values intact.

| UTC               | Step     | Command (sanitized)                                                    | Result                                        |
| ----------------- | -------- | ---------------------------------------------------------------------- | --------------------------------------------- |
| 19:23:39          | auth     | `auth login` (operator's terminal)                                     | **succeeded**, operator interaction required  |
| 19:26:23          | U9       | `filesystem info /my-files --json`                                     | ok; **no storage/quota fields**               |
| 19:26:51          | precheck | `filesystem info /my-files/eanhl-e3-scratch-20260911T192651Z`          | `Node not found` (as required)                |
| 19:26:54          | create   | `filesystem create-folder /my-files eanhl-e3-scratch-20260911T192651Z` | created                                       |
| 19:27:24          | upload   | `filesystem upload --json <5 files> <scratch>`                         | 5 items, 76,547,307 B, 0 skipped, 0 failed    |
| 19:31:05–19:32:49 | upload   | `filesystem upload --json probe-300MiB.bin <scratch>`                  | 1 item, 314,572,800 B, **104 s** (~3.0 MiB/s) |
| 19:31:38–19:32:46 | U7       | `filesystem list <scratch>` ×3 _during_ the 300 MiB upload             | in-flight object **never listed**             |
| 19:33:32          | list     | `filesystem list <scratch> --json`                                     | 6 items, all `active`                         |
| 19:33:48          | sizes    | `filesystem info` ×6                                                   | all `claimedSize` == local size               |
| 19:34:35–19:37:19 | download | `filesystem download --json <6 paths> <local>`                         | 6 items, 391,120,107 B, **164 s**             |
| 19:38:57          | U2       | local `sha256sum` ×6                                                   | **all six byte-exact**                        |
| 19:39:14          | U8       | `filesystem upload --json probe-1MiB.bin` (no strategy, no TTY)        | **failed closed**, exit 1, 0 bytes            |
| 19:39:32          | U4       | `filesystem upload --json -f create-new-revision probe-1MiB.bin`       | 1 item, 1,048,576 B                           |
| 19:40:10          | U1       | `filesystem list <scratch>` from fresh cache, no TTY/DISPLAY           | **succeeded**                                 |
| 19:41:03          | U3       | `filesystem trash <scratch>/probe-1MiB.bin`                            | `ok: true`                                    |
| 19:41:50          | U3       | `filesystem delete /trash/probe-1MiB.bin`                              | `ok: true`                                    |
| 19:42:28          | cleanup  | `filesystem trash` ×5                                                  | all `ok: true`                                |
| 19:43:11          | cleanup  | `filesystem delete /trash/<5 names>`                                   | all `ok: true`                                |
| 19:43:17          | cleanup  | `filesystem trash` + `delete` on the scratch folder                    | `ok: true`                                    |
| 19:43:40          | verify   | `filesystem info` ×14 on scratch paths only                            | all not found                                 |
| 19:44:25          | +0       | post-cleanup observation                                               | see §8                                        |

**Cumulative uploaded bytes: 392,168,683 = 374.0 MiB**, below the 512 MiB
ceiling (536,870,912).

Remote scratch folder: `/my-files/eanhl-e3-scratch-20260911T192651Z`
(node UID `sSJMCqlrUzr4LDaYtT9f_A~L2FnBYCbCxdyuQjZGnu2GA`).

---

## 7. Findings

### 7.1 Upload, readback and both hash bindings (U2, U7)

All six remote `claimedSize` values equalled their local sizes:

| File               |     claimedSize |           local |     storageSize |
| ------------------ | --------------: | --------------: | --------------: |
| `probe-1MiB.bin`   |       1,048,576 |       1,048,576 |       1,048,723 |
| `probe-64MiB.bin`  |      67,108,864 |      67,108,864 |      67,114,304 |
| `probe-300MiB.bin` |     314,572,800 |     314,572,800 |     314,598,300 |
| `…dump.age`        |       8,388,608 |       8,388,608 |       8,389,288 |
| `…dump.age.sha256` |             108 |             108 |             186 |
| `…manifest.json`   |           1,151 |           1,151 |           1,232 |
| **total**          | **391,120,107** | **391,120,107** | **391,152,033** |

Server-side storage overhead: **31,926 bytes (~0.008 %)** over plaintext.

After download, every one of the six SHA-256 values was identical to the
pre-upload value. `verifyArtifactCompletion()` run against the **downloaded**
directory returned `complete: true, failures: []`, and both bindings were
re-established explicitly: recomputed ciphertext hash == sidecar hash ==
`manifest.ciphertext.sha256`, sidecar and `manifest.artifact` both naming
`…191442Z.dump.age`, and `manifest.ciphertext.bytes` == actual 8,388,608.

**Important caveat (corrected by E3I2).** Proton stores a
`claimedDigests.sha1` alongside each revision, and in the captured output its
companion flag was **`sha1Verified: false`** — the SHA-1 claim is explicitly
marked unverified by Proton itself. `claimedSize` is likewise exposed as a
*claimed* metadata value.

What the captured evidence does **not** support is the stronger inference an
earlier revision of this memo drew. Specifically:

- the SHA-1 claim was **explicitly marked unverified** — that is directly
  observed;
- `claimedSize` is exposed as a claimed metadata value, but **this experiment
  did not establish whether or how Proton validates it**. No size-validation
  test was performed, and no official schema or help text captured here states
  the verification semantics of `claimedSize`;
- `sha1Verified: false` pertains to the **digest only** and must **not** be
  read as independent proof that Proton never validates `claimedSize`.

Neither field is sufficient cloud-acceptance evidence either way. **Byte-exact
download and local recomputation remain mandatory**, and the integrity
conclusion in this section rests solely on the local SHA-256 recomputation
performed here — not on any remote metadata. Should a directly captured
official schema or help statement later establish size-verification semantics,
it must be cited distinctly and not inferred from the SHA-1 flag.

### 7.2 Large-file behaviour (U7)

- 300 MiB uploaded in 104 s and downloaded as part of a 373 MiB batch in 164 s.
  No chunk, part or progress structure was exposed in `--json` output; with
  stdout redirected, **nothing at all** was emitted until completion.
- **The in-flight node was absent from three sampled listings.** Three listings
  taken while the 300 MiB upload was in flight showed only the five
  already-complete files; the in-flight node did not appear under any name or
  placeholder, and it appeared complete afterwards, already `active` at full
  size. This is **encouraging evidence for this one tested upload only**.
  Atomic visibility across failures, interruptions, other file sizes and other
  CLI versions remains **unproven**, and nothing here may be generalized into a
  guarantee that in-flight uploads are never visible.
- Result semantics are a single terminal summary:
  `{transferredItems, transferredBytes, skippedItems, failedItems, failures[]}`.
- **No resumability or interruption/resume capability is claimed anywhere in
  the CLI's help or output.** No interruption was deliberately induced,
  because the bounded protocol could not demonstrate that cleanup of a
  partially-uploaded object would be safe and targeted. Resume behaviour is
  therefore **untested and unknown**.

The favourable part — in the single upload tested, the in-flight node was never
externally visible as a partial object — suggests a reader would not observe a
torn artifact for that single file **in that tested case**. It is not a general
atomicity guarantee, and it says nothing about a _multi-file_ triple, where the
three files complete at different times; the repository's existing completeness
predicate remains necessary for that.

### 7.3 Trash, permanent deletion and quota release (U3)

- `filesystem trash <path>` is targeted, accepts several paths, returns
  `{uid, ok}` per item. Trashed nodes **leave the parent listing** and become
  **unaddressable by their original path**.
- A trashed node is addressed as `/trash/<name>`. Addressing it as
  `/trash/<node-uid>` **does not work** (`Trashed node not found`), so trash
  addressing is name-based. Before each permanent deletion, `filesystem info`
  on the trash path was used to confirm the resolved UID equalled the UID
  recorded when _this session_ created the object. Every one matched. No
  pre-existing trash item was listed, resolved or touched, and `/trash` was
  never enumerated.
- `filesystem delete` is targeted and returns `{uid, ok}` per item, but
  **only operates on already-trashed items**, so permanent deletion is
  inherently two-step.
- **The trashed node retained its reported per-node storage metadata:**
  `probe-1MiB.bin` still reported `totalStorageSize` 2,097,446 while in trash.
  After targeted permanent deletion the node became **unresolvable**, and the
  scratch per-node total fell from 392,200,756 to 390,103,310 — exactly the
  2,097,446 removed. These are **per-node storage-metadata observations only**:
  **account-level quota charging and release were not measured and cannot be
  inferred from them.**
- `empty-trash` is global over `/trash` and could not be limited to scratch
  items, so per §10.2 it was **not exercised**. Its behaviour, and the A4/A6
  three-hour lag hypothesis, remain untested at the account level.

The per-node storage-metadata change above is **not** evidence of account quota
release, which was never measured (§7.6).

### 7.4 Collision and version behaviour (U4, U8)

The local 1 MiB probe's content was replaced in place with different random
bytes and re-uploaded under the identical remote name.

- prior content: `a102f595…b960`
- collision content: `c25c2ece…0f9b`

**Without a strategy, from a non-interactive shell, the CLI failed closed:**

```
{"transferredItems":0,"transferredBytes":0,"skippedItems":0,"failedItems":1,
 "failures":[{"name":"probe-1MiB.bin",
              "error":"ValidationError: Name conflict on \"probe-1MiB.bin\" (file) already exists"}]}
```

exit 1, **zero bytes transferred**. It did not hang waiting for a prompt, did
not silently overwrite, and did not silently rename. For an unattended backup
uploader this is the desirable failure mode, and it directly satisfies
`backup-producer.md` §7 requirements 4–5 in spirit: a same-name, different-content
write is refused rather than resolved by guesswork.

**With `-f create-new-revision`:**

- the **node UID was unchanged** (`…K5yLs6_knBQxN5dTJNPLaQ`);
- the **active revision UID changed** (`…ejD8-tYu0zKYwMGvxYv-LQ` →
  `…8kLAQbIZWVxQLECTA7FFqw`);
- the folder still listed **6 items — no duplicate name was created**;
- `totalStorageSize` went **1,048,723 → 2,097,446**, i.e. exactly double.

**The superseded revision remained represented in the node's storage
metadata.** `create-new-revision` **doubled that node's reported
`totalStorageSize`**: after rewriting a 1 MiB object under the same name, the
node reported 2 MiB. **Whether that consumed account quota was not measured** —
no account-level quota figure was obtainable through the CLI (§7.6) — so no
claim of quota growth is made here. What is observed is **revision accumulation
in per-node storage metadata**. Avoiding that accumulation remains a concrete
argument for keeping unique per-run artifact names in any Proton layout — which
is what the producer's `<prefix>-<snapshotTs>` identity already does — and
against any "latest.dump.age" style fixed name; **the account-quota effect of
that recommendation is unmeasured**.

Version _limits_ per plan tier (A5) were **not** probed: only one extra
revision was created, so the retention ceiling and any automatic pruning
remain unmeasured.

### 7.5 Non-interactive session reuse (U1, partial)

Two contrasting observations, both from the agent's shell with **no
controlling TTY**:

1. **Before** the operator unlocked the key, a Proton command failed:
   `Failed to load session in pass: gpg: public key decryption failed: No such
file or directory` — `pinentry-curses` could not open a terminal. The
   backend **fails closed**; it does not fall back to an unprotected path.
2. **After** the operator ran one `pass show … > /dev/null` in their own TTY to
   populate `gpg-agent`, the same class of command succeeded — including the
   formal test, run with `DISPLAY`, `GPG_TTY` and `WAYLAND_DISPLAY` unset and a
   **brand-new empty cache directory** (0 entries before, 9 after). Success is
   therefore attributable to the credential in `pass`, **not** to the login
   command's cache.

**What this settles:** the `pass`-stored Proton session _is_ reusable by a
non-interactive, no-TTY, no-browser process on this machine, without
re-authentication, and with no CLI cache to lean on.

**What this does not settle, and must not be read as settled:** the success
depended entirely on `gpg-agent` already holding the passphrase, unlocked by a
human minutes earlier in an interactive terminal. Nothing here shows that
state surviving terminal closure, idle expiry, logout or reboot — the default
agent TTL is short and was **not** tuned (tuning it would have been an
unauthorized configuration change). **U1 remains open.** This was the main PC,
not Hotel-Echo; no Hotel-Echo host was contacted and no reboot was exercised.
An unattended 6-hourly service would still need a service-compatible
credential-access mechanism that does not depend on a human unlock; this
experiment neither designed nor tested one, and does not establish which
mechanism or backend production should use.

Observed side note: the CLI writes its cache files mode 0644. The enclosing
directory was 0700 here, so exposure was contained, but a production
deployment must not rely on the CLI to restrict them.

### 7.6 Quota reporting (U9)

**The CLI exposes no quota operation.** `quota`, `storage`, `usage`,
`account`, `volume`, `device` and `user` all fall through to the top-level
usage text, and `filesystem info /my-files --json` returned no
storage/quota/usage field of any kind.

Per the authorization, **no browser or dashboard was used as a substitute**.
The only storage signal reachable through the CLI is per-node
`totalStorageSize`, which is an object-level attribute, not an account balance.

**U9 disposition: RESOLVED NEGATIVE for CLI 0.8.0** (corrected by E3I2). U9
asks whether machine-readable quota reporting is *available through the CLI*.
That question has been **answered**, in the negative, by direct evidence: CLI
0.8.0 has no quota/storage/usage/account operation, and
`filesystem info /my-files --json` exposes no account quota fields. The
capability is absent, and its absence is the finding. This is **not** an
open question awaiting further work against 0.8.0, and it should not be
described as "unresolved negatively".

**Distinct downstream matters, which remain genuinely unresolved** and are not
settled by the U9 answer:

- **account-level quota monitoring has no CLI-based design** — the E3
  requirement for continuous capacity monitoring has no implementation path
  through 0.8.0;
- **no pre-experiment quota baseline exists**, and none can now be
  reconstructed;
- **account-level quota release and the three-hour residual cannot be
  measured** under the authorized CLI-only protocol, so the §10 quota-residual
  measurement cannot be performed as written;
- **A6 remains unanswered**, together with the three-hour-lag hypothesis;
- **an alternative provider/API/dashboard monitoring source requires separate
  research and separate authorization** before it could close any of the
  above.

---

## 8. Cleanup state and observation schedule

All six physical files, both revisions of the re-uploaded probe, and the
scratch folder were permanently deleted by targeted operations. `empty-trash`
was never run. Verification queried **only** the 14 exact paths this session
created: all returned `Node not found` or `Trashed node not found`.

**At +0, no synthetic object remained addressable through the exact tested
active/trash CLI paths** — every tested exact path returned not found. That
scope does **not** establish physical server erasure, hidden-revision erasure,
account-quota release, or absence from any provider-internal retention layer.
On pre-existing objects, see the disclosure in §1.3: one pre-existing parent node, `/my-files`, received a
metadata-only `info` read; its children were never listed or inspected, no
pre-existing child or trash object was listed, read or otherwise accessed,
`/trash` was never enumerated, and no pre-existing object was mutated.

| Observation | Exact UTC due time       | Status                                                                                                       |
| ----------- | ------------------------ | ------------------------------------------------------------------------------------------------------------ |
| +0          | 2026-09-11T19:44:25Z     | **done** — all scratch nodes unresolvable; no account-level figure obtainable (§7.6)                         |
| +1 h        | **2026-09-11T20:44:25Z** | **MISSED — no evidence exists.** Not run, not reconstructed, not backfilled. Permanently unavailable.        |
| +3 h        | **2026-09-11T22:44:25Z** | **attempted late, at 2026-09-11T23:38:38Z — BLOCKED, no residual evidence obtained.** See §8.2.              |
| +24 h       | **2026-09-12T19:44:25Z** | **observed late, at 2026-09-12T20:55:52Z — COMPLETED.** All 14 exact paths not-found; see §8.3.              |

The +1 h observation was **missed**. No evidence for it exists, and none may be
reconstructed or backfilled after the fact; the row above is the complete and
final record of that slot.

The +24 h observation was run as its own separate session (§8.3) and is now
complete; **no observation slot remains open**. No timer, cron, systemd or `at` job was
created at any point. Because CLI 0.8.0 exposes **no account quota operation** (§7.6), this
is a **post-cleanup observation window**, not a quota observation window: the
+24 h check can test **exact-path addressability and credential usability
only**. It **cannot complete A6 or measure quota release** unless the operator
separately authorizes a non-CLI quota source. After it, E3I may close only as
*protocol completed to the extent supported by CLI 0.8.0, with quota/account-residual
work blocked* — **not** as a successful quota experiment.

**The plan-freeze window has now passed** (it ran to 2026-09-12T19:44:25Z and
the +24 h observation completed at 2026-09-12T20:55:52Z). The plan was
**Proton Unlimited and unchanged throughout**.

### 8.1 Local state deliberately left in place

Per the authorization, the following were **not** removed and require a later
explicit operator decision:

- the **encrypted Proton credential** `ch.proton.drive/drive-sdk-cli/auth-session`
  (one `pass` entry, 388 bytes, mode 0600) — the Proton session was **not**
  logged out or revoked;
- the dedicated GPG key `6FE5…AEED`, its revocation certificate, the password
  store, the CLI binary and the installed packages.

The account therefore remains authenticated on this host. Logging out and
removing the credential is **not** part of §10 and is left as an open decision.

### 8.2 E3I2: the +3 h observation (2026-09-11, read-only session)

Separate read-only session, same host, **no provider mutation of any kind**.
The authorized start gate was 2026-09-11T22:44:25Z; the session ran later, so
the observation is recorded at its **actual** time, not its nominal slot.

| Fact                        | Value                                                                |
| --------------------------- | -------------------------------------------------------------------- |
| Nominal +3 h slot           | 2026-09-11T22:44:25Z                                                 |
| **Actual observation time** | **2026-09-11T23:38:38Z** (T+3 h 54 m 13 s from the 19:44:25Z anchor) |
| CLI                         | `cli-drive@0.8.0+06e8c605`, 117,946,496 bytes (baseline match)       |
| Credential backend          | `PROTON_DRIVE_CREDENTIALS_STORE=pass`                                |
| Cache                       | fresh, empty, mode-0700, 0 entries before the run                    |
| Environment                 | no controlling TTY (`tty` → `not a tty`), `DISPLAY`/`WAYLAND_DISPLAY`/`GPG_TTY` unset, stdin `/dev/null` |
| Command attempted           | `filesystem info /my-files/eanhl-e3-scratch-20260911T192651Z --json` |

**Result: the encrypted session was NOT usable non-interactively at +3 h.** The
command failed closed, exit 1, with:

```
Failed to load session in pass: gpg: public key decryption failed: No such file or directory
gpg: decryption failed: No such file or directory
```

This is the **same failure mode §7.5 observed before the operator's unlock** —
`pinentry` cannot open a terminal, and the backend refuses rather than falling
back to an unprotected path. A read-only `gpg-connect-agent 'keyinfo --list'` —
a **credential-agent/key-cache metadata query** — then showed **no cached key
state**, and there is no `~/.gnupg/gpg-agent.conf`.

**Exactly what that proves, and what it does not.** Directly proven: at
T+3 h 54 m the no-TTY Proton command failed locally; `keyinfo --list` then
showed no cached key; no custom `gpg-agent.conf` existed. So **the cached key
state was absent by the T+3:54 observation**, which is **consistent with the
documented default TTL and/or agent lifecycle**. **Not proven, and not
measured:** the exact time the cached state disappeared; whether its
disappearance was caused specifically by idle TTL, agent restart, WSL
lifecycle, or another process-lifecycle event; and whether the state survived
continuously or not throughout the interval. No `pass show` was run, and the
GPG cache was **not** primed.

**Consequence: the exact-path residual check could not be performed.** §7.5's
caveat is now supported by a single time-separated observation, not by
continuous monitoring: cached `gpg-agent` key state was absent at the T+3 h
54 m check on this host, but the exact disappearance time, whether behavior
was continuous throughout the interval, and the cause were not measured.
The residual check remains available to the operator, from their own TTY, with
the same single narrowly targeted read-only command shown above.

**Recorded for U1:** this is a materially stronger negative result than E3I1
could establish. Non-interactive reuse of the `pass`-stored Proton session
works **only while `gpg-agent` already holds the passphrase**, and that cached
state was **absent well inside the backup cadence** an unattended 6-hourly
service would need. What follows is bounded: **the current main-PC `pass`
configuration cannot provide a six-hour non-interactive run unless the key is
made available again**, so production requires a **separately designed
service-compatible credential-access mechanism, or a different backend**. This
does **not** prove that `pass` will be the Hotel-Echo backend, that Hotel-Echo
specifically requires an "unlock-at-boot/idle" implementation, or that one
particular remediation is mandatory. **Hotel-Echo remains completely untested
and U1 remains open.**

**Credential-agent operation actually performed (corrected within E3I2):** the
session ran `gpg-connect-agent 'keyinfo --list'`, which is a **read-only
credential-agent / key-cache metadata query**. Any blanket claim that no
credential or key operation of any kind occurred is therefore withdrawn. What
remains true and is preserved: **no key or credential was created, changed,
exported, decrypted for display, deleted, or otherwise mutated**; **no `pass
show` was run**; **no passphrase or session material was exposed**.

**Not done in E3I2:** no upload, create, rename, restore, trash, delete,
empty-trash, share, logout, reauthentication, credential deletion, key mutation
or plan change; no `/my-files` or `/trash` listing; no unrelated path or node
addressed; no quota observation attempted (§7.6 already resolved that
negatively for 0.8.0, and no dashboard/API substitute is authorized). The only
side effect was a `proton-drive.log` file inside the temporary cache directory,
which was validated by path shape and removed.

### 8.3 E3I3: the +24 h observation (2026-09-12, read-only session)

Separate read-only session, same host, **no provider mutation of any kind**.
The authorized start gate was 2026-09-12T19:44:25Z; the session ran later, so
the observation is recorded at its **actual** time, not its nominal slot.

| Fact                        | Value                                                                     |
| --------------------------- | ------------------------------------------------------------------------- |
| Nominal +24 h slot          | 2026-09-12T19:44:25Z                                                      |
| **Actual observation time** | **2026-09-12T20:55:52Z** (T+25 h 11 m 27 s from the 19:44:25Z anchor; 1 h 11 m 27 s after the nominal slot) |
| Exact-path sweep completed  | 2026-09-12T21:11:40Z                                                      |
| CLI                         | `cli-drive@0.8.0+06e8c605`, 117,946,496 bytes, SHA-512 **exact baseline match** |
| Credential backend          | `PROTON_DRIVE_CREDENTIALS_STORE=pass`                                     |
| Cache                       | one isolated mode-0700 `/tmp` directory, path-validated, 0 entries before the run |
| Environment                 | no controlling TTY (`tty` → `not a tty`), `DISPLAY`/`WAYLAND_DISPLAY`/`GPG_TTY` unset, stdin `/dev/null` |

**CLI identity was confirmed without contacting Proton.** The SHA-512 of
`/home/michal/.local/bin/proton-drive` matched the recorded baseline exactly,
and the version banner was read in an **isolated network namespace**
(`unshare -rn`), which cannot reach any network.

**Disclosed network deviation (unauthenticated, non-Drive).** An earlier
`proton-drive --version` run — executed *outside* the isolated network
namespace — additionally printed `You are running the latest version.`; that
line was **absent** when the same command ran *inside* the isolated network
namespace (no network reachable). This proves the extra output is
**network-dependent** and is **consistent with** an attempted update/version
check on `--version`. **No packet capture, destination/endpoint evidence, or
payload evidence was collected** for that invocation, so **the exact
endpoint, whether any request completed, and what — if anything — was
exchanged were not established**. Treat the outside-namespace invocation as
**unintended possible provider-adjacent network access**, disclosed as such —
**not** as a proven authenticated operation or Drive-object access. The
authoritative local CLI identity evidence remains the matching SHA-512 plus
the version banner obtained *inside* the isolated network namespace.

#### Step 1 — unaided non-interactive credential usability: NEGATIVE

With no TTY, stdin `/dev/null`, `DISPLAY`/`WAYLAND_DISPLAY`/`GPG_TTY` unset and
a fresh empty mode-0700 cache, the single command

```
filesystem info /my-files/eanhl-e3-scratch-20260911T192651Z --json
```

**failed closed, exit 1**, with output **byte-identical** to the E3I2 failure
recorded in §8.2 (`Failed to load session in pass: gpg: public key decryption
failed` / `gpg: decryption failed`). A read-only `gpg-connect-agent
'keyinfo --list'` — again a **credential-agent / key-cache metadata query**, not
a credential mutation — showed the on-disk secret keys present and
passphrase-protected but with the **`cached` field unset**, i.e. **no cached
passphrase**; there is still no custom `~/.gnupg/gpg-agent.conf`. The
observed terminal failure was a local GPG credential-decryption failure
(`gpg: public key decryption failed`, byte-identical to the §8.2 output); the
command's own log contained **no HTTP/API/request indicator**, and **no
provider request was observed**. This **supports** that the attempt stopped
during local credential loading; because **no packet capture or equivalent
network trace was taken** for this attempt, **absolute absence of network
contact was not independently proven**.

**This reproduces the §8.2 result at T+25 h**: unaided, the `pass`-stored
session is **not** usable by a non-interactive process.

#### Step 2 — operator-assisted unlock (recorded separately): POSITIVE

Recorded separately from the unaided result above, which stands unchanged.

The operator, **in their own terminal**, made the key available and then ran
the same exact-path command themselves. It returned
`Node not found: eanhl-e3-scratch-20260911T192651Z`, exit 1.

**Disclosed deviation in the unlock method.** The protocol anticipated the
operator entering the passphrase at a `pinentry` prompt raised by the
`proton-drive` command itself. What actually happened is that the operator
ran `pass show <entry> > /dev/null` in their own shell first — a deviation
from that prescribed pinentry-triggered method — priming `gpg-agent`, and the
`proton-drive` command then found the agent already warm. `pass` necessarily
**decrypted the stored entry** and **emitted it into a pipe directed to
`/dev/null`**. The **agent never ran `pass show`** and never received its
output; the plaintext was **not** displayed, transcribed, logged or recorded
in the repository or report. This is disclosed as a **method deviation**, not
described as matching the written step.

**No browser authentication, no reauthentication, no session renewal and no
`auth login` occurred.** The pre-existing authenticated Proton session was
accepted as-is.

#### Step 3 — the 14 exact paths: all not-found

With the agent warm, all 14 exact paths were queried **one at a time** with
`filesystem info --json`. **`/my-files`, `/trash` and every parent's children
were never enumerated**, and **no pre-existing node was addressed at all** —
so, unlike E3I1 (§1.3), this session has **no pre-existing-node deviation**.

| #     | Path                                                      | Exit | Result                   |
| ----- | --------------------------------------------------------- | ---- | ------------------------ |
| 1     | `/my-files/<scratch>`                                      | 1    | `Node not found`         |
| 2–4   | `/my-files/<scratch>/probe-{1,64,300}MiB.bin`              | 1    | `Node not found`         |
| 5–7   | `/my-files/<scratch>/<synthetic>.{dump.age,dump.age.sha256,manifest.json}` | 1 | `Node not found` |
| 8     | `/trash/eanhl-e3-scratch-20260911T192651Z`                 | 1    | `Trashed node not found` |
| 9–11  | `/trash/probe-{1,64,300}MiB.bin`                           | 1    | `Trashed node not found` |
| 12–14 | `/trash/<synthetic>.{dump.age,dump.age.sha256,manifest.json}` | 1 | `Trashed node not found` |

`<scratch>` = `eanhl-e3-scratch-20260911T192651Z`; `<synthetic>` =
`eanhl-synthetic-20260911T191442Z`. **7 `Node not found` + 7 `Trashed node not
found` = 14/14. No path resolved**, so no discrepancy-handling branch was
entered and nothing was read, mutated, trashed or deleted.

#### What this does and does not establish

**Establishes:** at 2026-09-12T20:55:52Z–21:11:40Z, roughly 25 hours after
cleanup, **none of the 14 exact paths this experiment created was addressable
through the tested CLI paths**, and the pre-existing authenticated session was
still accepted once the local key was made available.

**Does not establish — and must not be claimed:** physical server erasure;
hidden-revision erasure; account-level quota release; or absence from any
provider-internal retention layer. It proves **exact-path non-addressability
through the tested CLI paths at the actual observation time**, and nothing
more. Because CLI 0.8.0 exposes **no account-quota operation** (§7.6), **A6
remains unanswered** and the §10 quota-residual measurement **remains blocked**;
no browser, dashboard or undocumented API substitute was used or authorized.

**Provider command categories used:** exactly one — read-only
`filesystem info` (15 invocations: 14 by the agent, 1 by the operator, the
first path being covered by both), plus the unauthenticated `--version`
update check disclosed above. **Not done:** upload, create-folder, rename,
copy, move, restore, trash, delete, empty-trash, share, list/enumerate,
download, `auth login`, `auth logout`, reauthentication, credential removal,
key mutation, plan change. **Operator interaction occurred** and is recorded
separately in step 2.

**Cleanup of this session:** the one validated mode-0700 `/tmp` cache created
here was path-validated again and removed; its absence was confirmed. The
installed CLI, the encrypted Proton credential, the password store, the GPG key
and its revocation certificate, the packages and the authenticated session were
all **preserved** — logout, revocation, credential removal, key removal and
package removal remain **separate operator decisions**. One further temporary
cache created by the operator in their own shell during step 2
(`/tmp/e3i3-op-…`) was **left in place** for the operator to remove, since it
was not created by, or path-validated by, this session. A subsequent,
explicitly authorized closure-hygiene session (**E3I4**, 2026-09-12) validated
that path **by metadata only**, **did not inspect its contents**, removed
exactly that directory, and confirmed it no longer exists.

---

## 9. U1–U9 disposition after this session

| #   | Before | After                     | Disposition                                                                                                                                                                                                                                                                                                    |
| --- | ------ | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U1  | open   | **partially informed**    | `pass`-stored session proven reusable non-interactively with no TTY, no browser and a fresh cache — but only while `gpg-agent` was already unlocked by a human. **E3I2 (§8.2) bounded that directly:** at T+3 h 54 m the same command failed closed (`gpg: decryption failed`), and a read-only `keyinfo --list` then showed **no cached key state** — consistent with the documented default TTL and/or agent lifecycle, though **the exact loss time and cause were not measured**. What this proves is that **the current main-PC `pass` configuration cannot provide a six-hour non-interactive run unless the key is made available again**; production therefore needs a **separately designed service-compatible credential-access mechanism or a different backend**. It does **not** prove that `pass` will be the Hotel-Echo backend, nor that any one remediation is mandatory. **Directly observed:** the cached key state was absent at the single T+3 h 54 m main-PC observation. **Not measured:** the exact disappearance time, continuous behavior during the interval, and whether the cause was idle TTL, agent restart, WSL lifecycle or another process event. **E3I3 (§8.3) reproduced this at T+25 h:** unaided, the same command failed closed again with byte-identical output, and the key-cache metadata query showed the secret keys present but **not cached** — so the negative result is now observed at **two separated times**, not one. E3I3 also re-confirmed the positive half: once a human made the key available, the **same pre-existing session was still accepted** with no browser login, reauthentication or session renewal, ~25 h after it was created. **Untested:** terminal-closure behavior as a controlled variable, logout, reboot and Hotel-Echo. **U1 remains only partially informed and open; Hotel-Echo remains completely untested.** |
| U2  | open   | **SETTLED (positive)**    | All six files byte-exact on readback; both triple bindings re-established; repository predicate `complete: true`. Caveat (corrected by E3I2, §7.1): Proton's SHA-1 claim is explicitly flagged `sha1Verified: false`, and `claimedSize` is a claimed value whose validation semantics this experiment did **not** establish. Neither is sufficient acceptance evidence — acceptance must recompute locally.                                                                                                   |
| U3  | open   | **partially informed**    | Targeted trash and targeted permanent delete both work and are per-object. Observed **in per-node storage metadata only**: the trashed node **retained** its reported per-node storage metadata; targeted permanent deletion made the node **unresolvable**, and the scratch per-node total fell by exactly that amount. **Account-level quota charging and release were not measured and cannot be inferred from those observations**; the A4/A6 lag and residual are **unmeasurable** under the CLI-only protocol (§7.6). `empty-trash` deliberately not exercised. **Extended by E3I3 (§8.3):** at ~25 h after cleanup all 14 exact paths were still not-found, so **exact-path non-addressability persisted across the full observation window** — but that is the *only* thing it adds. **Account-level quota release, physical erasure, hidden revisions and provider-internal retention all remain unmeasured**, so **U3 remains partially informed** and A4/A6 remain blocked under the CLI-only protocol. |
| U4  | open   | **partially informed**    | Same-name re-upload with `create-new-revision` keeps one node, adds a revision, creates no duplicate name, and **doubles that node's reported `totalStorageSize`** — the superseded revision remains represented in the node's storage metadata. **Account-level quota charging was not measured.** Unique per-run names remain justified as avoiding this observed revision accumulation, but **their account-quota effect is unmeasured**. Per-plan version _limits_ still unprobed.                                                     |
| U5  | open   | unchanged                 | Not in scope; no production dump series measured.                                                                                                                                                                                                                                                              |
| U6  | open   | unchanged                 | Step 12 excluded by authorization; no second identity involved.                                                                                                                                                                                                                                                |
| U7  | open   | **PARTIALLY INFORMED**    | In **three listings sampled during one 300 MiB upload** the in-flight node was **absent**, and it appeared complete afterwards, `active` at full size — **encouraging evidence for the tested case only**. **Atomic visibility across failures, interruptions, other sizes and other versions remains unproven**, and this must not be generalized to "in-flight uploads are never visible". 300 MiB in 104 s up / 373 MiB in 164 s down. No progress stream when redirected. **Resumability remains unknown — not claimed by the CLI and not tested.**                                    |
| U8  | open   | **SETTLED (positive)**    | Same-name different-content upload with no strategy **fails closed** (`ValidationError`, exit 1, 0 bytes) — no hang, no silent overwrite or rename. Explicit strategies available and effective.                                                                                                               |
| U9  | open   | **RESOLVED NEGATIVE for CLI 0.8.0** | The question U9 asks — is machine-readable quota reporting available through the CLI — is **answered**: CLI 0.8.0 has no quota/storage/usage/account operation, and `filesystem info /my-files --json` exposes no account quota fields. The capability is absent; that absence is the finding. **Separate and still unresolved downstream:** account-level quota monitoring has no CLI-based design; no pre-experiment baseline exists; account-level quota release and the three-hour residual are unmeasurable under the authorized CLI-only protocol; **A6 remains unanswered**; any alternative provider/API/dashboard source needs separate research and authorization. See §7.6. |

**Settled:** U2, U8. **Partially informed:** U1, U3, U4, U7 (U7 is
**partially** informed, not "largely" — see the row above).
**Resolved negative (for CLI 0.8.0):** U9 — the capability is absent, and that
absence answers the question asked. The **downstream** monitoring design it
blocks is a separate, still-open matter (§7.6), as is **A6**.
**Unchanged:** U5, U6.

---

## 10. What this session does not establish

E3 activation; production readiness; Hotel-Echo reboot or unattended
persistence; retention or pruning correctness; recoverability or any restore
property; real production ciphertext ceilings; dedicated-uploader-identity
viability; account-level quota accounting of any kind.

No database, backup, encryption, deployment, scheduling, retention, restore or
tunnel action occurred. No Gate checkbox changed.

**E3I closure statement (after E3I3).** E3I is **protocol completed to the
extent supported by Proton Drive CLI 0.8.0, with quota/account-residual work
blocked**. It is **not** a successful quota experiment, and it does **not**
activate or complete E3. The observation record is final: **+1 h MISSED**
(no evidence, never reconstructed); **+3 h late and credential-blocked**
(§8.2); **+24 h observed late and completed** (§8.3). **U9 RESOLVED NEGATIVE
for CLI 0.8.0**; **A6 unanswered**; **U1 partially informed with Hotel-Echo
untested**; **U3 partially informed with account quota, physical erasure,
hidden revisions and provider retention unmeasured**.
