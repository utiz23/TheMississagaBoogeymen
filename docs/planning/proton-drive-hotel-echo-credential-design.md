# Proton Drive on Hotel-Echo — option-A credential mechanism design (E3J9B-doc)

**Stage:** E3J9B-doc · **Date:** 2026-09-24 · **Type:** design memo, local
documentation only · **Status:** design approved and recorded. **E3J9C was
authorized and STOPPED at its first host comparison (§17):** only the `pass` package
(M1, with its dependency `tree`) was installed; the repository templates exist;
nothing else is implemented on the host. **E3J9C-R (§18, local only)** corrected the
design and templates: an exact acceptance rule for the installed Ubuntu `pass`, and
the template security review. **2026-09-26 (§19):** M2–M9 were done on the host
(identity, directories, curated `PATH`, wrapper/launcher, pinned CLI — never
executed — validation tools, key and store) after a launcher working-directory
defect was corrected; M10 was rerun after a probe vocabulary defect was
corrected and passed in full (A6 by operator observation). **E3J9C PASSED for
its credential-foundation and local-proof scope only.** **2026-09-28 (§20):**
D1 was accepted; E3J9D stopped before any host access because the reviewed
provider reader did not exist; **E3J9D-R (§20, local only)** supplies the
launcher-owned provider runner and the E4/N4 vehicle, independently reviewed and
checkpointed at `ef32c885` and integrated into `main`. **2026-09-30 (§21):**
E3J9D reinstalled those files and passed every pre-ceremony proof; the operator
ceremony completed (contacting Proton), but the operator then accidentally
pasted its sign-in URL and output to another agent (Codex), so the session
STOPPED before P0 (`p0_attempt_count=0`; no provider contact after the
ceremony). The operator revoked the specific new CLI session; the local
credential state was removed and the service key and store rotated without
running the CLI. **E3J9D did not pass** and needs a newly
authorized ceremony. U1 and E3J9 remain open. E3 remains unactivated and nothing
is monitored.

This memo durably records the approved option-A design for a service-usable Proton
Drive CLI credential on Hotel-Echo, and the separately authorized sessions that
would build and prove it. It is derived from the approved plan (revision 3 with
its same-day review correction, SHA-256
`d35759417f68a66bf767cae6cf824ed79ff75e9fd1a8d8151a7e6c5d932afc9c`, kept outside
the repository; both external copies now carry an identical appended "Revision 4
(E3J9C-R)" section, whose resulting SHA-256 is recorded in §18) and keeps that
plan's section numbering, so the cross-references below (§4, §7, §9, §11 …)
resolve inside this file.

**What documenting the design does and does not do.**

- E3J9A remains complete **only as read-only feasibility evidence**
  ([`proton-drive-hotel-echo-credential-feasibility.md`](proton-drive-hotel-echo-credential-feasibility.md)).
- E3J9B-doc is complete locally once this memo and the narrow pointer edits exist.
- **E3J9C was authorized separately on 2026-09-24 and stopped at the M1 `pass`
  comparison (§17).** E3J9B-doc itself installed or configured none of the
  option-A components on Hotel-Echo.
- **Writing this design down creates nothing on the host:** no GPG key,
  credential store, `eanhl-cloud` system account, CLI installation, lock, wrapper,
  service unit or curated `PATH` comes into existence because of it. Every
  mechanism below is a specification, not a fact about the host.
- U1 and E3J9 remain open; **D1 was accepted on 2026-09-28 (§20); D7 is unresolved**; E3 is unactivated; no Gate
  checkbox changes.

## Context

E3J9A (read-only) established no usable Proton credential mechanism or Proton
session for `utiz` in the inspected default/current-session locations. The Proton
CLI, `pass`, the default `~/.gnupg`, the named Proton state paths and the inspected
common Secret Service packages/providers were absent **only within that documented
inspection scope**; other users, root, system-wide or manual installs, custom
service environments and alternate `XDG_*`/`GNUPGHOME`/`PASSWORD_STORE_DIR`/Proton
locations were not universally searched. No TPM device path and no `crypt` layer
were evidenced by the named checks; universal absence was not established (see
[`proton-drive-hotel-echo-credential-feasibility.md`](proton-drive-hotel-echo-credential-feasibility.md)
§2-§3). The operator chose **option (a)**: a dedicated,
restricted, non-personal service identity holding a credential the service can
read, so the uploader can run unattended after a reboot. This memo designs that
mechanism. It closes nothing. **U1 stays open until E3J9E observes it.**

Revision 3 of the plan (the approved one) made four corrections to the earlier
revision:

- The credential-bearing command is started with `/usr/bin/env -i`, and its
  **initial** environment at that exec boundary is exactly twelve positively
  enumerated literals (§7). Runtime-derived variables such as bash's `PWD`,
  `SHLVL` and `_` may appear later.
- The lock uses command-form `flock --close`, so no descendant ever holds the lock
  descriptor (§4).
- `cat` is added to the curated command directory, and the `pass` command surface
  is split by path. Nonempty-store re-encryption is excluded, so rotation and
  recovery always use a new empty store (§3, §5).
- The `ERROR` log-level code correction (C1) is required before **any** E3J10 action
  that executes the Proton CLI or can contact the provider (§7, §13).

**Same-day review correction (2026-09-24).** This is an in-place correction of
E3J9B-doc, not a new milestone:

- **Descendant environment.** pass 1.7.4 itself runs
  `export GPG_TTY="${GPG_TTY:-$(tty 2>/dev/null)}"` and
  `export GIT_CEILING_DIRECTORIES="$PREFIX/.."`. The permitted descendant union
  therefore includes these two pass-generated exports, each with a fixed provenance
  and expected value (§7). They are not evidence that an ambient parent value
  crossed the boundary.
- **`/proc` observation is supplementary.** Reading `/proc/<pid>/environ` of
  short-lived `pass`/`gpg` processes can miss them. A catch is supplementary
  evidence; `not_observed` is neither a pass nor proof. E3 now rests on
  construction, E1, source review and effect-bearing decoys, and the PASS rule says
  so (§11).
- **Evidence boundary.** E3J9A findings are restated within their documented
  inspection scope (Context, §5, §9).

**Evidence tags:**

| Tag            | Meaning                                                                               |
| -------------- | ------------------------------------------------------------------------------------- |
| **[BIN]**      | Behaviour observed from the released CLI 0.8.0 binary (E3I, main PC)                  |
| **[SRC]**      | Source correspondence at the exact compared tag/commit (§16). Not proof of the binary |
| **[HYP]**      | A hypothesis derived from source or documentation                                     |
| **[VALIDATE]** | Must be validated on Hotel-Echo before it is relied on                                |
| **[DOC]**      | Official documentation                                                                |
| **[REPO]**     | Repository code or memos                                                              |
| **[HE]**       | E3J9A Hotel-Echo observations                                                         |
| **[DESIGN]**   | A decision made in this design                                                        |
| **[OPERATOR]** | Operator decision or risk acceptance                                                  |
| **[AUTH]**     | Needs later explicit authorization                                                    |

---

## 0. Findings that change the picture (read first)

1. **[SRC] The CLI starts `pass` by bare name, with the CLI's own environment.**
   `cli/src/credentials/passCredentialsStore.ts` calls
   `Bun.spawn(['pass', ...args], {stdin, stdout:'pipe', stderr:'pipe'})` with no
   `env` option. The argument vectors are `show <entry>`, `insert -f -m <entry>`
   (JSON on stdin) and `rm -f <entry>`. Whatever environment the CLI holds
   therefore reaches `pass` and `gpg`. The design starts the CLI through
   `/usr/bin/env -i` with the twelve §7 literals as its initial environment.
   No variable from the parent or systemd crosses that boundary (under the §7
   assumptions: a root-authored system unit, no untrusted loader variables), so everything `pass`
   and `gpg` see comes from those literals, from variables that bash derives from
   process state, or from the two variables pass itself exports (`GPG_TTY`,
   `GIT_CEILING_DIRECTORIES`; §7). That `Bun.spawn` resolves `pass` using that environment's `PATH`
   alone is **[HYP]**; the canary and provider probes **[VALIDATE]** it.
2. **[SRC] The CLI writes the pass entry during normal operation, not only at
   login.** `Credentials.persistCredentials()` → `store.save()` →
   `pass insert -f -m`. A token refresh therefore needs non-interactive encryption
   and **write** access to `PASSWORD_STORE_DIR`. pass 1.7.4 overwrites the entry in
   place (`$GPG -e … -o "$passfile"`, [SRC] `password-store.sh@1.7.4`), so
   concurrent writers or an interrupted refresh can corrupt it. That is one reason
   for the shared credential lock (§4). Recovery from corruption uses a new empty
   store and a new login (§5).
3. **[SRC] What the stored snapshot contains.** `persistCredentials()` stores
   `cachePassword`, `userKeyPassword`, a `session` object (`uid`, `accessToken`,
   `refreshToken` and related fields) and `telemetryEnabled`. What those values
   authorize is **not** established by source (§9). E3H recorded the account as the operator's **primary** Proton account
   (Proton Unlimited) [REPO].
4. **[SRC] Log level and location.** `cli/src/config.ts` sets
   `logLevel = LogLevel[PROTON_DRIVE_LOG_LEVEL?.toUpperCase() ?? 'DEBUG'] ?? DEBUG`,
   so an **unrecognised value silently falls back to DEBUG**. `ERROR` is a valid
   member (`client/js/src/telemetry.ts`). The log directory is
   `$XDG_STATE_HOME/proton-drive-cli`, else `$HOME/.local/state/proton-drive-cli`.
   - **Direct runs:** E3J9C–E3J9E CLI runs get `ERROR` from the wrapper's fixed
     initial environment (§7).
   - **Uploader runs:** the uploader's `buildChildEnv()`
     (`ops/backup/lib/internal/backup-cloud-cli-core.mjs:372`) **currently strips
     `PROTON_DRIVE_LOG_LEVEL`** [REPO], so an uploader-run CLI would log at DEBUG.
     §7 makes a Node-boundary correction to a literal `ERROR` (C1) **mandatory
     before any E3J10 action that executes the Proton CLI or can contact the
     provider**.
5. **[SRC] The browser opener.** `cli/src/cli/openBrowserUrl.ts` calls
   `spawn('xdg-open', [url], {detached:true, stdio:'ignore'})` on Linux, with
   `child.on('error', () => {})`. `auth login` prints the URL first. With no opener
   on the only `PATH`, the spawn fails with ENOENT, the error is swallowed, and the
   URL remains only on the operator's PTY **[HYP]**. The A-series proofs (§11) must
   pass before §6 relies on this.
6. **[SRC] An unauthenticated command fails; it does not start a login.**
   `run.ts` `verifyAuthentication()` throws
   `AuthRequiredError('You need to login first')`.
7. **[SRC] `auth logout` is local.** `commandAuthLogout.ts` ("Signs out and clears
   local credentials and caches") → `Auth.logout()`
   (`incubating/account/js/src/auth.ts`) → `Credentials.signOut()`. That clears
   in-memory fields, runs `pass rm -f <entry>` and calls `clearCaches()`. **No
   revocation request appears in the traced path.** Logout is local removal only
   (§12).
8. **[REPO] The uploader's credential anchor probably never matches under option
   A.** `CREDENTIAL_UNAVAILABLE_LINES` ends in `No such file or directory`
   (pinentry-curses on the main PC, [E3I]). Under option A, failures fall through
   to `indeterminate` / `provider_error_unrecognised`. That still fails closed and
   is never retried. A conditional local correction follows once E3J9E has observed
   the real text. It is not a blocker.
9. **[REPO] The uploader, the CLI and the credential run under one uid.**
   Directory-authority checks require the effective uid to own the attestation and
   run-lock directories at 0700, and the CLI is a child of the uploader. The
   producer uses `docker exec` (root-equivalent), so the credential identity must
   **not** be the producer identity.

---

## 1. Identity model [DESIGN]

| Item                   | Decision                                                                                                                                                         | Why                                                                                                                   |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Account (D3, resolved) | New **static, locked system account `eanhl-cloud`** with its own group                                                                                           | Not `utiz` (interactive, `Linger=no` [HE])                                                                            |
| DynamicUser            | **Rejected**                                                                                                                                                     | [DOC] UIDs are recycled and each unit gets its own. One persistent owner of the key, the store and the lock is needed |
| Unit model             | **System services** with `User=eanhl-cloud`, not `systemd --user`                                                                                                | No user manager, no `/run/user/<uid>`, no D-Bus session                                                               |
| Linger                 | **Must not be enabled**; its absence is checked in E3J9C and E3J9E                                                                                               | Only a user manager needs linger; this design has no dependency on it                                                 |
| Home                   | `/var/lib/eanhl-cloud`                                                                                                                                           | Outside `/home`, so `ProtectHome=yes` hides operator homes                                                            |
| Shell / password       | `/usr/sbin/nologin`; no password; no `authorized_keys`; not in sudoers                                                                                           | Humans act only through the root-only launcher (§4)                                                                   |
| Supplementary groups   | **None** (explicitly not `docker`, `sudo`, `adm`, `systemd-journal`)                                                                                             | Producer-artifact access is an E3J10 decision                                                                         |
| Creation (E3J9C)       | `adduser --system --group --home /var/lib/eanhl-cloud --no-create-home --shell /usr/sbin/nologin eanhl-cloud`, then explicit `install -d` for every §2 directory | Auditable                                                                                                             |

## 2. State layout [DESIGN]

| Class                          | Path                                                                                                 | Owner                   | Dir mode      | File mode                                                          | Notes                                                                                                                                                                 |
| ------------------------------ | ---------------------------------------------------------------------------------------------------- | ----------------------- | ------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HOME                           | `/var/lib/eanhl-cloud`                                                                               | eanhl-cloud:eanhl-cloud | 0700          | —                                                                  | Created by M3 only. **No `StateDirectory=`** (E3J9C-R): systemd must not create or recursively re-own it                                                              |
| **Secret**                     | `/var/lib/eanhl-cloud/gnupg` (GNUPGHOME)                                                             | svc                     | 0700          | 0600                                                               | Layout, socket location and agent behaviour are **[VALIDATE]** (§5)                                                                                                   |
| **Secret**                     | `/var/lib/eanhl-cloud/password-store` (PASSWORD_STORE_DIR)                                           | svc                     | 0700          | 0600 (`.gpg-id`, `ch.proton.drive/drive-sdk-cli/auth-session.gpg`) | Always initialised **empty** (§5). No `pass git init`                                                                                                                 |
| **Lock**                       | `/var/lib/eanhl-cloud/locks/credential.lock`                                                         | svc                     | `locks/` 0700 | 0600, pre-created empty                                            | Kernel `flock` only; content never read (§4)                                                                                                                          |
| Sensitive non-secret           | `/var/lib/eanhl-cloud/data` (XDG_DATA_HOME)                                                          | svc                     | 0700          | 0600 (child `UMask=0077`)                                          | [BIN] the CLI otherwise writes 0644                                                                                                                                   |
| **Secret-class logs**          | `/var/lib/eanhl-cloud/.local/state/proton-drive-cli/proton-drive.log*`                               | svc                     | 0700          | 0600                                                               | Level fixed at `ERROR` (§7). Verification reads metadata only                                                                                                         |
| Non-secret                     | `/var/lib/eanhl-cloud/config` (XDG_CONFIG_HOME)                                                      | svc                     | 0700          | 0600                                                               | Set so nothing falls back to other defaults                                                                                                                           |
| Cache                          | `/var/cache/eanhl-cloud` (XDG_CACHE_HOME)                                                            | svc                     | 0700          | 0600                                                               | Created by M3 only; no `CacheDirectory=`. Disposable                                                                                                                  |
| Runtime                        | `/tmp` private per unit (`PrivateTmp=yes`)                                                           | —                       | —             | —                                                                  | No runtime directory is used                                                                                                                                          |
| **Curated PATH**               | `/opt/eanhl-cloud/credential-bin`                                                                    | root:root               | 0755          | root-owned symlinks only                                           | Exact manifest in §3                                                                                                                                                  |
| CLI executable                 | `/opt/eanhl-cloud/bin/proton-drive`                                                                  | root:root               | 0755          | 0755                                                               | SHA-512 pinned; always invoked by absolute path                                                                                                                       |
| **Lock + environment wrapper** | `/usr/local/lib/eanhl-cloud/credential-exec`                                                         | root:root               | 0755          | 0755                                                               | The **single definition** of the credential command's initial environment at the `env -i` boundary (§7) and the only entry point for credential-bearing commands (§4) |
| Launcher                       | `/usr/local/sbin/eanhl-cloud-credential`                                                             | root:root               | 0755          | 0750                                                               | Root-only fixed subcommands; builds every transient unit (§4, §6)                                                                                                     |
| Validation tooling             | `/usr/local/lib/eanhl-cloud/validation/` (probe, env-inspect, lockhold, PTY-marker, owned-inventory) | root:root               | 0755          | 0755                                                               | Also holds `unit-publish` (E3J9D-R, root:root 0755). Removed after E3J9E (D8); for rollback, owned-inventory runs from a root-only temporary path                     |

- **Root never reads inside the `eanhl-cloud`-owned trees directly** (E3J9C-R):
  launcher and helper reads, stats, searches and lock acquisitions there run as
  `eanhl-cloud` through `setpriv`, so a planted symlink or FIFO cannot redirect a
  root operation. Every such `setpriv` call first enters `/` (E3J9C
  §19.5), so the service identity never inherits an operator's working
  directory. Deletions in those trees run the same way (§12).

- **There is no environment file on the host.** An earlier revision's
  `/etc/eanhl-cloud/credential.env` is dropped. The wrapper holds the literal
  values. The repository keeps a non-secret manifest of names and values that tests
  compare against the wrapper (§13).
- The uploader's data directories (`attestation.dir`, `readback.dir`, the parent of
  `run.lockFile`) belong to **E3J10**.
- `credentials.backend` stays `"pass"`. The config validator needs no change, and
  env paths stay out of the cloud config.

## 3. Curated command PATH [DESIGN]

The single `PATH` for every credential-bearing child is
**`/opt/eanhl-cloud/credential-bin`**, set as a literal by the wrapper (§7). That
covers key generation, `pass init` and cleanup, the canary, the PTY-marker proof,
authentication, logout, provider probes, lifecycle tests and the eventual uploader.

- The Proton CLI is always invoked by absolute path,
  `/opt/eanhl-cloud/bin/proton-drive`.
- The wrapper and validation tooling reach their own utilities (`id`, `flock`,
  `env`, `sleep`, `stat`, `pgrep`, `journalctl`) by absolute path. None of those
  are in the curated directory.

**Source-derived command inventory [SRC]** from `password-store.sh@1.7.4` (sha256
`b48d710a8da2473b83491bd3c1971256f4c17c067dab1e9a7a3ac453170bbcd7`), split by path:

| Path                            | Commands needed                | Source                                                                                                                                                                                                                                                                                                                           |
| ------------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Interpreter                     | `bash`                         | `#!/usr/bin/env bash`: `env` is reached by absolute path, `bash` through `PATH`                                                                                                                                                                                                                                                  |
| Every command                   | `getopt`                       | option parsing in `init`, `show`, `insert`, `rm`                                                                                                                                                                                                                                                                                 |
| Empty-store `pass init <fpr>`   | `mkdir`, `gpg`, `grep`, `find` | `mkdir -v -p`; `reencrypt_path` runs `$GPG --list-config --with-colons \| grep` and `find … -print0`. The per-file loop body does not run on an empty store                                                                                                                                                                      |
| `show <entry>`                  | `gpg`, `base64`                | `$GPG -d … \| $BASE64`, then `$BASE64 -d`                                                                                                                                                                                                                                                                                        |
| `insert -f -m <entry>`          | `dirname`, `mkdir`, `gpg`      | `mkdir -p -v "$PREFIX/$(dirname -- "$path")"`, `$GPG -e … -o`                                                                                                                                                                                                                                                                    |
| `rm -f <entry>`                 | `rm`, `rmdir`                  | `rm -f -v`, `rmdir -p … 2>/dev/null`                                                                                                                                                                                                                                                                                             |
| **Usage and error paths**       | **`cat`**                      | line 89 (the missing-`.gpg-id` error in `set_gpg_recipients`, then `cmd_usage`), 261 (`cmd_version`), 278 (`cmd_usage`). Without `cat` these paths lose their text, and the CLI's failure message degrades. `die` uses the `echo` builtin. The CLI's "entry missing" anchor (`is not in the password store`) is emitted by `die` |
| Platform line (**unnecessary**) | —                              | upstream's `PLATFORM_FUNCTION_FILE` `source` line (the only use of `uname`, `cut`, `tr`) is **absent** from the accepted Ubuntu pass (hunk H1 below)                                                                                                                                                                             |

**Curated manifest:** `bash getopt gpg pass mkdir dirname grep find base64 rm rmdir
cat`. The former conditional trio (`uname cut tr`) is never installed.

**Accepted installed `pass` (E3J9C-R; replaces "byte-identical to upstream beyond
the platform line").** Evidence: the full unified diff between upstream 1.7.4
(sha256 `b48d710a…bcd7`) and the installed Ubuntu script (fixed `--label` headers;
raw-diff sha256 `185a3b10…ef3c`, 62 lines). Raw unified-diff context lines carry
whitespace-only lines and space-before-tab by nature, so the repository holds it
as a whitespace-clean **escaped line manifest**,
[`ops/backup/credential/pass-1.7.4-8.accepted-delta.escaped`](../../ops/backup/credential/pass-1.7.4-8.accepted-delta.escaped).
Each raw line is written as `|<escaped>|`, where `\\` is one backslash and `\t` is
one TAB. Its `#` preamble records both full input hashes, the raw-diff hash, the
fixed labels, the source and version, the GPL-2.0-or-later provenance and the
generation command. The local test decodes it and compares it byte-for-byte
(`cmp`) with the regenerated raw diff, and it passes
`git diff --no-index --check` as an untracked file. There is no `.gitattributes`
exemption. The diff has 13 changed lines in **7 change blocks** (plain `diff`),
which unified output shows as 6 hunks because H5 and H6 share one. Outside them
the file is byte-identical, so the table above carries over:

| #      | Upstream → installed line | Change                                                             | Effect on `init` / `show` / `insert` / `rm -f`                                                                                                                                                                                                                                                                                                |
| ------ | ------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1     | 249 → removed             | platform `source` line removed                                     | Narrows startup: `dirname`, `uname`, `cut`, `tr` no longer run at top level; no platform file is sourced; `GETOPT`/`SHRED`/`BASE64` keep their defaults                                                                                                                                                                                       |
| H2     | 297 → 296                 | `${EDITOR:-vi}` → `${EDITOR:-editor}` in the `cmd_usage` heredoc   | **Reachable, text only**: `insert` on a store without `.gpg-id` (A10 `neg-uninit`) → `set_gpg_recipients` → `cat >&2` + `cmd_usage`. A parameter expansion in a heredoc; no command runs; `EDITOR` is unset under `env -i`                                                                                                                    |
| H3, H4 | 405 → 404, 417 → 416      | `tree … 3>&-`                                                      | `cmd_show`'s directory branch and `cmd_find` only. The approved entry names are never directories; `find` is not approved; `tree` is not on the curated `PATH`, so reaching it would print `tree: command not found` and trip `pass_cmd_not_found`                                                                                            |
| H5, H6 | 503 → 502, 509 → 508      | `${EDITOR:-editor}`                                                | `cmd_edit` only (dispatch arm `edit`): unreachable                                                                                                                                                                                                                                                                                            |
| H7     | 679 → 678                 | `SYSTEM_EXTENSION_DIR=""` → `"/usr/lib/password-store/extensions"` | Read only by `cmd_extension`, called only from the dispatch fallback `*)`; `init`, `show`, `insert` and `rm` dispatch explicitly, so unreachable on approved paths. Unlike upstream, a system extension needs only an executable `<dir>/<arg>.bash` (not `PASSWORD_STORE_ENABLE_EXTENSIONS`), so the directory must stay root-owned and empty |

The acceptance rule, exact and fail-closed:

1. package `pass` **1.7.4-8**; `/usr/bin/pass` a regular file, root:root 0755,
   25 821 bytes, SHA-256
   **`b0da432e8d377a67c7a74a9111c6b32889cce62f6e4f506a7bbdba817a268632`**; the
   curated `pass` link resolves to exactly that file;
2. the delta from upstream is exactly H1–H7;
3. `/usr/lib/password-store/extensions` exists, is root-owned, not group/world
   writable and empty;
4. **any other hash, version, extra or changed hunk is a STOP**: re-derive the
   delta and review it again.

The main PC's `pass` 1.7.4-6 `/usr/bin/pass` has the identical SHA-256 (verified
by a full hash and its dpkg md5sum in E3J9C-R). The two `export` lines and the
`PREFIX` line are unchanged (they are outside every hunk). The probe checks
`pass_script_hash_match` and `pass_system_ext_dir_empty`.

**Referenced but tolerated when absent** (the call is redirected or its failure is
non-fatal on the exercised paths [SRC]):

- `tty`: pass runs `export GPG_TTY="${GPG_TTY:-$(tty 2>/dev/null)}"`. No ambient
  `GPG_TTY` crosses `env -i`, and `tty` is not on the curated `PATH`, so pass
  exports an **empty** `GPG_TTY` (§7). `tty` must stay absent (A3).
- `which`, `gpg2`: `GPG=gpg`; `batch` comes from gpg.conf.
- `git`: `set_git` finds no repository. pass separately exports
  `GIT_CEILING_DIRECTORIES="$PREFIX/.."` regardless (§7).

**Not supported: nonempty-store re-encryption.** `pass init` on a store that
already holds entries runs the `reencrypt_path` loop body. That needs `sed`,
`sort`, `head` and `mv` beyond the manifest, plus a decrypt→encrypt pipe per entry.
This design **never** runs `pass init` on a nonempty store. Initial setup, recovery
and key rotation all use a new, proven-empty store (§5). Supporting
in-place re-encryption would require a separately reviewed manifest expansion.
Commands of unused features are also excluded: `edit` (`mktemp`, `shred`, editor),
`generate`, `find`/`grep` subcommands and directory `show` (`tree`, `sed`, `tail`),
`mv`/`cp` subcommands, clipboard and QR.

**Never present:** `xdg-open` or any browser or opener (`sensible-browser`,
`x-www-browser`, `www-browser`, `gio`, `gnome-open`, `kde-open*`, `kioclient*`,
`exo-open`, `w3m`, `lynx`, `links`, `elinks`, `firefox`, `chromium*`,
`google-chrome`), and any command unrelated to the credential mechanism.

- **GnuPG helpers** (`gpg-agent`, `keyboxd`, `pinentry`) are located via GnuPG's
  compiled-in paths, not `PATH` **[HYP]**. L1 **[VALIDATE]**s this.
- If any exercised path fails for want of a command, **stop**. Add a command only
  through a design revision citing the source line that needs it.
- If the installed `/usr/bin/pass` does not meet the acceptance rule above,
  **stop** and re-derive this table.
- **Symlink chains (A1/A2):** several curated targets are themselves symlinks on
  Hotel-Echo (uutils multicall coreutils; `rm` → `gnurm`; `gpg` has a
  `gpg-from-sq` alternative). A1 records each target's final `readlink -f` path,
  its owning package and the ownership and non-writability of every hop; any
  change between sessions (unattended upgrade, alternatives switch) is a STOP.

## 4. Shared credential lock [DESIGN]

- **Lock:** `/var/lib/eanhl-cloud/locks/credential.lock`, a kernel `flock(2)`
  exclusive lock. The directory is 0700 and owned by `eanhl-cloud`. The file is
  pre-created at 0600, persistent and never deleted by tooling. Its content is
  never read.
- **Wrapper (sole entry point):** every credential-bearing unit's `ExecStart=` is
  `/usr/local/lib/eanhl-cloud/credential-exec <lockmode> <command-id> [args…]`. The
  wrapper:
  1. checks via `/usr/bin/id -un` that it runs as `eanhl-cloud` (else exit 64);
  2. maps `<command-id>` to a fixed absolute path (`gpg` →
     `/opt/eanhl-cloud/credential-bin/gpg`, `pass` →
     `/opt/eanhl-cloud/credential-bin/pass`, `proton-drive` →
     `/opt/eanhl-cloud/bin/proton-drive`, and validation ids →
     `/usr/local/lib/eanhl-cloud/validation/*` only while installed; E3J10 adds the
     uploader id by design revision). Unknown ids exit 64;
  3. refuses (exit 64) unless the lock file already exists as a regular,
     non-symlink file (E3J9C-R), so `flock`, which opens with `O_CREAT`, never
     silently creates it;
  4. runs **`exec /usr/bin/flock --exclusive --close <lockmode> --conflict-exit-code
75 /var/lib/eanhl-cloud/locks/credential.lock /usr/bin/env -i <§7
environment> <absolute command> [args…]`**.
- **The operator never types a `systemd-run` line.** The root-only launcher
  `/usr/local/sbin/eanhl-cloud-credential` has fixed subcommands: `keygen`,
  `pass-init`, `probe`, `probe-stop`, `pty-marker`, `env-proof`, `auth-login`,
  `auth-logout`, the validation-only
  `provider-probe run|schedule|collect|discard <closed argument>` (E3J9D-R,
  §20), and the rollback/recovery-only `entry-remove`, `canary-remove` and
  `key-delete` (E3J9C-R: fixed, precondition-checked, each separately authorized
  at use). Every unit they build carries the §8 property set with the wrapper as
  its command.
- **Exit status is the result (E3J9C-R correction).** Every subcommand exits 0
  **only** when every required operation and every stated postcondition
  succeeded. A printed line never stands in for success, and an unknown state
  (a failed metadata check) is never read as success. The postconditions:
  - `keygen`: exactly one primary secret key with certify capability and a
    40-hex fingerprint, exactly one encryption subkey, exactly one user ID equal to
    the fixed UID, both secret parts present, no expiry;
  - `pass-init`: `.gpg-id` is a readable 0600 regular file holding exactly the
    fingerprint, and it is the store's only entry;
  - `auth-logout`: the unit succeeded **and** the entry is proven absent;
  - `entry-remove`/`canary-remove`: the unit succeeded and the entry is proven
    absent;
  - `key-delete`: the unit succeeded, the revocation file is proven absent and
    the secret-key count is 0;
  - `pty-marker`: the unit succeeded and there are exactly 0 journal hits;
  - `env-proof`: three passing steps and exactly 0 nonce hits;
  - `probe`/`probe-stop`: the accepted outcome **and** a successful cleanup
    (§11);
  - `provider-probe` (E3J9D-R): exactly the outcomes, identity and provenance
    checks and postconditions of §11 (stages 1–11) and §20.2, not restated
    here. `run` exits 0 only for its mode's accepted outcome (`n3-busy`:
    `busy`; every other mode: `pass`) together with a successful cleanup and
    true postconditions; `schedule` only once its own fresh pair is attested
    before it can fire (for `boot`: canonical bytes, attested enablement and
    synced directories), otherwise it rolls back only that pair; `collect` only
    for a `pass` read from a proven, fired pair that is then removed with
    provenance, with the boot-id rule and the postconditions true; `discard`
    only once a proven object is removed. An object whose provenance is not
    proven is never touched (`pp_provenance=<reason>`).

  Presence checks distinguish `present`, `absent` and `error`; `error` fails.

- **Presence proof (`svc_exists`, third E3J9C-R correction).** The earlier
  `[ -e ] || [ -L ]` test reported an object under an inaccessible (mode-000)
  parent as `absent`: fail-open. The proof now runs as `eanhl-cloud` through
  `setpriv`, over a fixed relative contract path under the trusted root
  `/var/lib/eanhl-cloud`:
  - the root must be a real directory, and after `cd -P` its `pwd -P` must equal
    it;
  - each component is looked up by listing the current directory with the fixed
    expression `find . -mindepth 1 -maxdepth 1 -print` and comparing whole lines
    with `./<component>`, so no caller text enters the find expression;
  - the final component listed → `present` (a symlink, even dangling, counts);
  - not listed in a listing that **succeeded** → `absent`, which is therefore
    only reported after the containing directory was reached from the root and
    read in full;
  - a failed listing (unreadable directory, mode 100 or 000, I/O), a failed
    `cd`, an intermediate symlink or non-directory, or a physical cwd outside
    the root after a `cd` → `error`.

  Paths are validated in the launcher and again in the script: components of
  `[A-Za-z0-9._-]`; no empty, `.`, `..` or leading-`-` component; no leading or
  trailing `/`. Every caller passes a fixed contract path; `key-delete` adds
  only the validated 40-hex fingerprint. No native error text is read.
  **Not race-free:** a component is listed, checked and entered in separate
  steps. A concurrent change by `eanhl-cloud` itself (outside the protection
  boundary) can race them. An escape out of the tree after a `cd` is detected
  as `error`, but a redirection within the tree, or a change just after the
  final listing, can give an answer that is stale for that instant.

- **Not an access-control boundary.** The wrapper, the launcher and root ownership
  are consistency controls for root-authored units. Code already running as
  `eanhl-cloud` can run gpg, pass or the CLI directly, with any environment and any
  arguments, and is outside the protection boundary (§9).
- **Descriptor lifetime ([DOC] util-linux `flock(1)`):**
  - In command form **without `--no-fork`**, `flock` acquires the lock, forks, and
    the **`flock` parent keeps the locked descriptor while it waits for the
    command**.
  - **`--close`** closes the descriptor in the child before `exec`. The man page
    calls this "useful if command spawns a child process which should not be
    holding the lock". `--no-fork` is incompatible with `--close` and is not used.
  - Therefore:
    - the lock is held for exactly the lifetime of the **foreground command**
      (`env -i` → the credential command), and is released when the `flock` parent
      exits after that command exits;
    - the CLI awaits `pass` (`await proc.exited`), and `pass` waits for its
      foreground `gpg` pipeline, so every pass/GPG operation the CLI starts falls
      inside the held interval;
    - **no descendant ever has the descriptor**, so an on-demand or daemonized
      `gpg-agent` (or any other straggler) cannot keep the lock after the
      foreground command exits;
    - release is by the `flock` parent's exit and **does not depend on
      `KillMode=`** or later cgroup cleanup. `KillMode=control-group` still ends
      stragglers at unit stop, but that is separate hygiene;
    - crash, stop and reboot behaviour is kernel-lock behaviour: a lock dies with
      its holder and never persists across boot, and the file's persistence is
      irrelevant.
- **Stop window (corrected in E3J9C-R; a documented limitation, not an edge
  case):** with `KillMode=control-group`, `systemctl stop` (or a start timeout)
  sends SIGTERM to the `flock` parent **and** the command at the same time.
  `flock(1)` has no SIGTERM handler, so the lock is released at once while pass or
  gpg may still be running their signal cleanup, for example mid-way through
  `gpg -e … -o <entry>`. Another unit could then acquire the lock during that
  window. The local test demonstrates the release-before-exit ordering. E3J9 has
  no concurrent writer, so this is recorded, not eliminated. It is an **E3J10
  design blocker** before the uploader coexists with other credential units (for
  example a supervising wrapper under `KillMode=mixed`). K5 also checks that the
  canary entry is intact or absent after a stop.
- **Lock order (fixed):** (1) the credential lock, taken by the wrapper before the
  uploader process exists; (2) the uploader's internal run lock
  (`backup-cloud-run-lock.mjs`), taken inside Node. No path reverses this. The
  uploader never calls `flock`. Credential-only entry points never take the run
  lock. E3J10 checks both statically.
- **Contention:**
  - `--nonblock` for `keygen`, `pass-init`, `auth-login`, `auth-logout`, probes and
    validation. It fails immediately with exit **75** (probe label
    `credential_lock_busy`).
  - The uploader uses a bounded `--wait=<N>`, with N fixed in E3J10 and less than
    `TimeoutStartSec=`. On expiry it exits 75.
  - Exit 75 is never retried within the same run.
  - Exit 75 is ambiguous on its own (a wrapped command could exit 75 too). "Busy"
    evidence is exit 75 **and** no command output (K1, N3).
  - No launcher operation uses `--wait`: its expiry semantics are proven by the
    local test against the real util-linux `flock`, and on the host only in E3J10
    (the uploader's bounded wait).
- **Limit:** `eanhl-cloud` owns `locks/` and could replace the file. The lock
  prevents accidental concurrency; it is not a control against the identity itself.
- **Tests:** §11 K1–K7.

## 5. GPG / pass mechanism [DESIGN unless tagged]

- **Key:** new and dedicated, created by `eanhl-cloud` in its own GNUPGHOME through
  `keygen` (wrapper: lock + §7 environment). It is **never imported** and never an
  operator key. UID `EANHL cloud uploader credential store (Hotel-Echo)`. The
  command is `gpg --batch --pinentry-mode loopback --passphrase ''
--quick-generate-key '<UID>' future-default default never`. The empty string is
  not a secret.
- **Why no passphrase:** nothing can supply one after a reboot without an operator,
  a TPM or another secret source (none evidenced by E3J9A's named checks).
- **Expiry (D4, resolved): `never`.** Rotation is event-driven.
- **Not yet proven, [VALIDATE] in E3J9C/E3J9E:** actual `future-default` algorithms
  and capabilities; keybox vs. keyboxd layout; agent socket location; agent cgroup
  membership; agent termination on unit stop; cold-start behaviour; expiry
  behaviour. **Recorded:** only public metadata (fingerprints, algorithm
  identifiers, capability letters, creation and expiry fields), closed booleans, and
  a secret-key count.
- **gpg.conf** (0600, svc-owned): `batch`, `no-tty`, `pinentry-mode error`. There is
  no `gpg-agent.conf`. It is installed after `keygen` **as `eanhl-cloud`** (through
  `setpriv`, refusing an existing file), never written by root into the
  service-owned directory.
- **`keygen` preconditions (E3J9C-R):** GNUPGHOME must be the M3 directory
  (a real directory, 0700, owned by `eanhl-cloud`) and empty, checked before any gpg
  run creates files there. The empty-passphrase argument must survive systemd-run →
  bash → flock → env as an empty argv element. Locally this is proven for GNU
  `env`; on the host (uutils `env`) it is **[VALIDATE]**. Its loss fails closed
  (gpg rejects the command line), and L1 under `pinentry-mode error` proves the key
  needs no passphrase.
- **Empty-store rule:** `pass init <primary fingerprint>` runs only through
  `pass-init`, and only after a metadata check proves the store directory is
  **empty and correctly owned at that moment** (no `.gpg-id`, no entries; a scan
  failure refuses, never counts as empty). That it is the directory M3 created is
  established by the session record, not by metadata (E3J9C-R). Anything else
  means **stop**. `.gpg-id` has exactly one line.
- **Canary:** `pass insert -f -m e3j9-canary/probe` from random bytes, then
  `pass show` compared inside the probe (boolean only), then the noninteractive
  **`pass rm -f e3j9-canary/probe`**. Absence is then verified.
- **Recovery (D5, resolved):** no off-host private-key backup and no recovery
  material. Because `keygen` requires an empty keyring and `pass-init` exactly one
  key (E3J9C-R ordering correction), recovery means:
  1. local logout if still possible (`auth-logout`; if that fails, the fixed
     `entry-remove`);
  2. remove the old store contents (metadata-proven) and recreate the store
     directory empty (`install -d`);
  3. **delete the old key** (`key-delete`): after step 2 it protects nothing;
  4. **clear the GNUPGHOME residue** (E3J9D evidence, §21.4): `key-delete`
     removes the key and its revocation file but leaves residue (on Hotel-Echo:
     5 regular files, `gpg.conf` among them, and 2 empty subdirectories),
     while `keygen` refuses unless GNUPGHOME is empty. Before any deletion, a
     metadata-only inventory run as `eanhl-cloud` (types, modes, owners and
     counts; never names or contents) must show only service-owned regular
     files (0600) and empty directories (0700), with no symlink, socket or
     FIFO, and no `eanhl-cloud` process may be running (`pgrep -u` reports
     none). Then clear only the descendants, as
     `eanhl-cloud` through `setpriv` from `/`, with the literal root:
     `find /var/lib/eanhl-cloud/gnupg -xdev -depth -mindepth 1 -type f,d -delete`.
     The GNUPGHOME top directory itself is preserved (it must remain the M3
     directory, 0700, service-owned); prove it holds 0 entries before
     `keygen`. Any unexpected type, owner, mode or running process is a
     **STOP**;
  5. generate a new key (`keygen`, whose own preconditions are unchanged: the
     M3 directory, empty, and an empty keyring), then install `gpg.conf` as
     `eanhl-cloud` with the M8 command (step 4 removed the old copy);
  6. `pass-init` on the proven-empty store;
  7. **a new operator login**.

  There is no in-place re-encryption.

- **Rotation:** triggered by suspected compromise, host rebuild or identity change.
  The sequence is the same as recovery: local logout → old store removed → **new
  empty store** → **old key deleted** → **GNUPGHOME residue cleared (step 4
  above)** → new key + `gpg.conf` → `pass-init` → **new operator login**. (An
  earlier revision deleted the old key last; that order is impossible under the
  `keygen`/`pass-init` guards.) Rotation never runs `pass init` over existing
  entries.
- **Not claimed:** encrypting to a key the same identity can use gives no secrecy
  against that identity or root. It gives the only non-keychain, non-plaintext CLI
  backend, key/store separation, and the standing `unsafe_file` rejection.

## 6. Proton authentication boundary [DESIGN]

- **Only the operator performs the ceremony, in their own SSH terminal (operator-only
  PTY authentication).** The agent never runs it, sees its output or handles the
  URL. Command: `sudo /usr/local/sbin/eanhl-cloud-credential auth-login`. The
  launcher runs `systemd-run --pty --wait --collect --uid=eanhl-cloud
--gid=eanhl-cloud` with the §8 properties and
  `/usr/local/lib/eanhl-cloud/credential-exec --nonblock proton-drive auth login`.
  So the CLI runs under the lock, starting from the §7 initial environment.
- **URL handling is conditional:** PTY-not-journal is proven by A6, and opener
  absence by A1–A4. Until every A-series proof passes in the same session, no claim
  is made that the URL reaches only the PTY, and the ceremony does not start.
- **Immediately before the ceremony (read-only):** A1–A4, A10 and E1 re-run by the
  operator. Then `auth-login` itself runs a **fail-closed preflight** (E3J9C-R) and
  refuses on any failure:
  1. CLI SHA-512 = pin; exactly one secret key; the store holds exactly `.gpg-id`,
     whose single line equals that key's fingerprint; no `auth-session.json` in the
     §2 trees (all store reads as `eanhl-cloud`);
  2. no `eanhl-cloud-*` unit is activating, active, deactivating or reloading (a
     `systemctl` failure refuses);
  3. every process owned by the `eanhl-cloud` uid is checked against a structured
     **resident-agent rule** (corrected in E3J9C-R to match this description). The
     only evidence read is `/proc/<pid>/exe` (readlink), the `Uid:` and `PPid:`
     lines of `status`, and `cgroup`. Each rule is
     `<final executable path>|<exact PPid>|<cgroup v2 path regex>`, and a process
     is permitted only if all of these hold:
     - its executable equals a rule's path;
     - all four `Uid:` fields equal the service uid;
     - its `PPid` equals the rule's;
     - its `cgroup` file is exactly one `0::<path>` line whose path matches the
       rule;
     - it is the only process for that rule.

     Key generation or pass initialisation may leave a `gpg-agent`/`keyboxd`
     resident, and with `--close` it never holds the lock. Anything else refuses:
     the Proton CLI, any other binary, an unreadable or deleted executable, a
     wrong parent, a wrong or multi-line cgroup, a pid that vanishes mid-scan, or a
     `pgrep` failure. **The rule list is empty in the template.** No parent or
     cgroup relationship has been observed on Hotel-Echo, and the rules must come
     from M8/L2 evidence **[VALIDATE]**. With the list empty, any resident process
     refuses;

  4. the lock file is a regular non-symlink file and a nonblocking exclusive
     acquire **as `eanhl-cloud`** succeeds.

  The preflight never reads any process's command line or environment, and it
  prints only `preflight_*` booleans and counts. The ceremony still uses
  `--nonblock`, which covers the gap between the preflight and the start. It has
  its own `TimeoutStartSec=900`; a timeout is a STOP.

- **Operator conduct:** open the URL on another device, never paste it anywhere, and
  clear scrollback afterwards. Type any mailbox-password prompt in the PTY. **No
  credential is copied from the main PC.**
- **Expected state created:** `auth-session.gpg` (0600),
  `data/proton-drive-cli/*.json`, `cache/proton-drive-cli/*.sqlite`, the
  secret-class log. **Never** `auth-session.json`.
- **Verification without exposing contents:** before the ceremony, the sha256 of
  the three files reinstalled for E3J9D (launcher, probe, `unit-publish`) equals
  the reviewed `main` commit's (§20.4); after it, in-tree metadata from a fixed
  expected-path table, plus per-directory counts of other entries; the sanitized
  owned-inventory; then exactly one `/my-files` metadata `info` read (P0), run as
  `eanhl-cloud-credential provider-probe run provider` (E3J9D-R, §20).
- **Stop rules:** `unsafe_file`, keychain or secret-service text,
  `Failed to save session in pass`, any prompt other than the URL or mailbox
  password, a fallback file, `command not found`, or lock busy → Ctrl-C, stop, no
  retry without new authorization.
- **Milestone ownership (D2, resolved):** **E3J9C** owns CLI installation, the
  SHA-512 pin and the deployment record, with no execution; the architecture
  memo's §12 carries a dated correction note. **E3J10** re-verifies the pin and owns
  containment and deployment.

## 7. Credential environment boundary and logging [DESIGN]

**Defined once, in the wrapper.** The wrapper execs `/usr/bin/env -i` followed by
exactly these twelve literals, then the credential command. They are the **exact
initial environment at that exec boundary**. Nothing from the wrapper's own
environment is copied:

```
PATH=/opt/eanhl-cloud/credential-bin
HOME=/var/lib/eanhl-cloud
XDG_CONFIG_HOME=/var/lib/eanhl-cloud/config
XDG_DATA_HOME=/var/lib/eanhl-cloud/data
XDG_CACHE_HOME=/var/cache/eanhl-cloud
GNUPGHOME=/var/lib/eanhl-cloud/gnupg
PASSWORD_STORE_DIR=/var/lib/eanhl-cloud/password-store
LANG=C.UTF-8
LC_ALL=C.UTF-8
TMPDIR=/tmp
PROTON_DRIVE_CREDENTIALS_STORE=pass
PROTON_DRIVE_LOG_LEVEL=ERROR
```

This one set is used for key generation, `pass init` and cleanup, the canary, the
PTY-marker proof, authentication and logout, provider probes, lifecycle tests and
the eventual uploader.

- **The uploader:** it starts from this environment. Its Node boundary
  (`buildChildEnv()`) then rebuilds the CLI child's environment from
  `ENV_ALLOWLIST`, plus its own literals for the two `PROTON_DRIVE_*` names.
- **Adding a variable:** any variable the uploader later needs requires a design
  revision.

**Justification for each included variable:**

- `PATH`: the curated directory (§3).
- `HOME`: the CLI's home fallbacks and pass's `~` fallback; also the log location.
- `XDG_*`: the CLI's config, data and cache directories.
- `GNUPGHOME`, `PASSWORD_STORE_DIR`: the key and the store.
- `LANG`/`LC_ALL`: untranslated gpg/pass text, so failure anchors stay stable.
- `TMPDIR`: the private `/tmp`.
- The two `PROTON_DRIVE_*` constants: backend selection and fixed `ERROR` logging.

**Deliberately omitted:**

- `USER`, `LOGNAME`, `SHELL`: pass reads only `HOME`/`PASSWORD_STORE_*`/`GPG_*`;
  GnuPG uses `GNUPGHOME`; the CLI uses `HOME`/`XDG_*`/`PROTON_DRIVE_*` [SRC]. Their
  absence is **[VALIDATE]**d by L1 and P0.
- `LC_CTYPE` and other `LC_*`: `LC_ALL` overrides them.
- `XDG_RUNTIME_DIR`: no user manager; sockets live in GNUPGHOME.
- `XDG_STATE_HOME`: logs land under `HOME`.
- `DBUS_SESSION_BUS_ADDRESS`: no session bus; keychain is not used.
- `GPG_AGENT_INFO`: ignored since GnuPG 2.1.
- `GPG_TTY`, `TERM`, `DISPLAY`, `WAYLAND_DISPLAY`, `BROWSER`, `SSH_ASKPASS`,
  `GIT_ASKPASS`: interactive and GUI channels. (`GPG_TTY` is absent from the
  initial set; pass then exports its own empty value, below.)
- `GIT_CEILING_DIRECTORIES`: absent from the initial set; pass derives and exports
  it (below).
- `PASSWORD_STORE_KEY`/`_GPG_OPTS`/`_UMASK`/`_SIGNING_KEY`/`_ENABLE_EXTENSIONS`/
  `_EXTENSIONS_DIR`: fixed behaviour.
- `PROTON_DRIVE_CACHE_DIR`/`_BASE_URL`/`_UNSAFE_CACHE`: fixed behaviour.
- systemd-added variables (`INVOCATION_ID`, `SYSTEMD_EXEC_PID`, `JOURNAL_STREAM`,
  `NOTIFY_SOCKET`, `MANAGERPID`, `LISTEN_*`, `STATE_DIRECTORY`, `CACHE_DIRECTORY`,
  `CREDENTIALS_DIRECTORY`, and the `USER`/`LOGNAME`/`SHELL`/`HOME` values set by
  `User=`; the child's `HOME` is the literal above, never systemd's value): these
  exist **only in the wrapper's own environment** and never cross the `env -i`
  boundary. The wrapper does not read any of them. File modes come from the unit's
  `UMask=0077`, which `env -i` does not alter.

**The security property, stated precisely:**

- **Boundary guarantee:** no ambient parent or systemd variable, and no value
  injected into the unit or the wrapper, crosses the `env -i` boundary **as a
  variable**. The credential command's **initial** environment is exactly the
  twelve literals.
- **What that guarantee rests on (E3J9C-R):**
  - every script is `#!/usr/bin/bash -p`, which disables Bash's own startup
    mechanisms: `BASH_ENV`/`ENV` sourcing, function import from the environment,
    and `SHELLOPTS`, `BASHOPTS`, `CDPATH` and `GLOBIGNORE` from the environment;
  - `bash -p` **cannot** neutralise the dynamic loader, which acts before Bash
    starts: `LD_*` and similar variables in the wrapper's own environment would
    affect `bash`, `flock` and `/usr/bin/env` itself;
  - the supported production claim therefore assumes execution by a
    **root-authored system unit** whose environment, and the manager's, contain
    **no untrusted loader variables**. This is an assumption resting on root
    control, not a tested property;
  - direct execution by already-compromised code running as `eanhl-cloud` is
    outside the protection boundary (§4, §9).
- **Not claimed:** that every later process keeps exactly that set. Two kinds of
  variable legitimately appear after the boundary, and neither is evidence that an
  ambient parent value crossed it:
  - **bash runtime variables:** bash sets `PWD`, `SHLVL` and `_` (and `OLDPWD`
    after a directory change) from process state (working directory, nesting
    depth, the last command), not from the parent. For a deterministic `PWD`,
    every credential-bearing unit sets `WorkingDirectory=/var/lib/eanhl-cloud`
    (§8).
  - **pass-generated exports [SRC]:** `password-store.sh@1.7.4` runs
    `export GPG_TTY="${GPG_TTY:-$(tty 2>/dev/null)}"` and
    `export GIT_CEILING_DIRECTORIES="$PREFIX/.."`, with
    `PREFIX="${PASSWORD_STORE_DIR:-$HOME/.password-store}"`. pass and every
    process it starts (gpg, and any agent gpg starts) therefore carry both.
- **Permitted descendant union, with provenance and expected values:**

  | Name(s)                   | Provenance                                                               | Expected value                                                                                                                                                                                                             |
  | ------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | the twelve literals       | the wrapper, at the `env -i` boundary                                    | exactly the literal above (validation-only secondary processes: exactly one directory value replaced, §11)                                                                                                                 |
  | `PWD`                     | bash, from the working directory                                         | `/var/lib/eanhl-cloud`                                                                                                                                                                                                     |
  | `SHLVL`, `_`, `OLDPWD`    | bash, from process state                                                 | name only; the values are runtime state, never parent data                                                                                                                                                                 |
  | `GPG_TTY`                 | pass: `${GPG_TTY:-$(tty 2>/dev/null)}`                                   | **the empty string.** An ambient `GPG_TTY` cannot cross `env -i`, and `tty` is absent from the curated `PATH` (A3), so the substitution yields nothing **[VALIDATE]**                                                      |
  | `GIT_CEILING_DIRECTORIES` | pass: `"$PREFIX/.."`, where `PREFIX` is the literal `PASSWORD_STORE_DIR` | exactly **`/var/lib/eanhl-cloud/password-store/..`** (a plain string concatenation; nothing normalises it). For the validation-only `neg-nostore` secondary process: `<its replacement store directory>/..` **[VALIDATE]** |

- **Stop rule:** in any observation, a name outside this union, or a value other
  than the expected one for a twelve-literal, `PWD`, `GPG_TTY` or
  `GIT_CEILING_DIRECTORIES`, is a stop condition (E2, E3, §14). A non-empty
  `GPG_TTY` would mean either that an ambient value crossed or that `tty` became
  resolvable; both are failures.
- **How the two pass exports are validated on Hotel-Echo (E3J9C):**
  1. The installed `/usr/bin/pass` meets the §3 acceptance rule
     (`pass_script_hash_match=true`). Both `export` lines and the `PREFIX` line
     lie outside hunks H1–H7, so they equal upstream verbatim.
  2. `command -v tty` fails in the scrubbed child (A3).
  3. E1(b) proves that `PASSWORD_STORE_DIR` is exactly its literal and that no
     `GPG_TTY` exists at the boundary.

  Together with source review, these fix both values. A supplementary `/proc`
  observation (§11) that catches a live `pass` or `gpg` must report `GPG_TTY` empty
  and `GIT_CEILING_DIRECTORIES` equal to the expected value. If it catches nothing,
  the result is `not_observed`, which is evidence neither way.

- **The wrapper's own environment:** it runs with whatever systemd provides and does
  not read it. Proofs E1–E4 (§11) test the wrapper side, the exec boundary and
  downstream processes separately, and print booleans only. No environment value is
  secret by design, and no value is printed anyway.
- **Directory values:** production commands (key generation, `pass init`, the
  canary, the ceremony, logout, provider reads, the uploader) cannot alter any of
  the twelve **environment** values; the wrapper accepts no environment arguments.
  The wrapper does forward arbitrary argv (for example `gpg --homedir`), so what
  bounds the arguments is the launcher's fixed argv, not the wrapper (E3J9C-R).
  Only validation-only secondary processes may replace **exactly one** directory
  value (§11 test isolation) — the sole exception.

**Logging:**

- Direct E3J9C–E3J9E runs get `PROTON_DRIVE_LOG_LEVEL=ERROR` from this environment.
- Logs remain secret-class and mode-restricted. Ordinary verification inspects
  metadata (mode, owner, size, count) only, never contents.

**Cross-check against `ENV_ALLOWLIST`** (`backup-cloud-cli-core.mjs:354`): every
included name except the two `PROTON_DRIVE_*` constants is allowlisted. The Node
boundary sets `PROTON_DRIVE_CREDENTIALS_STORE` itself from `credentials.backend`.

**Mandatory Node-boundary correction (C1).** It is required before **any E3J10
action that executes the Proton CLI or can contact the provider, including
integration and proving runs**. It is not merely a precondition of final
activation.

- **Why the wrapper is not enough:** today `buildChildEnv()` drops
  `PROTON_DRIVE_LOG_LEVEL`, so an uploader-run CLI logs at DEBUG even under the
  wrapper.
- **The change:** set `env.PROTON_DRIVE_LOG_LEVEL = 'ERROR'` as a **literal** after
  the allowlist copy. It is never read from `baseEnv` and never added to
  `ENV_ALLOWLIST`, so the Node boundary forces `ERROR` independently of its parent
  environment. The docblock at `:317` is updated to match.
- **Required tests** (`ops/backup/lib/backup-cloud-cli.test.mjs`):
  - the child always receives exactly `ERROR` when the parent variable is absent;
  - a parent value of `DEBUG`, `debug`, an empty string or an invalid value leaves
    the child at `ERROR`;
  - the child's `PROTON_DRIVE_*` key set is exactly
    `{PROTON_DRIVE_CREDENTIALS_STORE, PROTON_DRIVE_LOG_LEVEL}`, even when the parent
    sets `PROTON_DRIVE_BASE_URL`, `PROTON_DRIVE_CACHE_DIR`,
    `PROTON_DRIVE_UNSAFE_CACHE` or an arbitrary `PROTON_DRIVE_X`.

## 8. systemd interaction (credential-relevant only) [DESIGN]

- **Properties every credential-bearing unit carries.** Transient units get them
  from the launcher; the validation probe unit and E3J10's uploader carry them in
  the unit file:
  - `User=eanhl-cloud`, `Group=eanhl-cloud`
  - `ExecStart=/usr/local/lib/eanhl-cloud/credential-exec <lockmode> <command-id> …`
    as the sole entry (§4). **No `EnvironmentFile=` and no `Environment=`**; the
    credential command's initial environment comes only from the wrapper's literals
    (§7). The one exception: the validation-only `--setenv` nonce and decoys of
    `pty-marker`, `env-proof` and the provider mode `e4-decoy` (E3J9D-R, §20)
    become the transient unit's `Environment=`. They stay in the wrapper's own
    environment, are not secret, and exist only to prove the boundary
  - `WorkingDirectory=/var/lib/eanhl-cloud`, so any derived `PWD` is deterministic
    (the launcher passes it as `-p WorkingDirectory=…` for transient units, the
    ceremony and logout included)
  - `UMask=0077`, `PrivateTmp=yes`, `ProtectHome=yes`, `ProtectSystem=strict`,
    `ReadWritePaths=/var/lib/eanhl-cloud /var/cache/eanhl-cloud`
  - **no `StateDirectory=`/`CacheDirectory=`** (E3J9C-R): with them, systemd would
    create a missing home or cache and recursively re-own a mismatched tree,
    adopting pre-existing state and hiding an incomplete M3. Without them, a
    missing directory fails `ReadWritePaths=`/`WorkingDirectory=` setup (fail
    closed)
  - **local-only units** (keygen, pass-init, the `probe` operation, pty-marker,
    env-proof and the removal subcommands): `PrivateNetwork=yes` (E3J9C-R), so
    "does not contact Proton" has a kernel basis; GnuPG's sockets live in
    GNUPGHOME **[VALIDATE]**
  - `NoNewPrivileges=yes`, `StandardInput=null` (except the ceremony's PTY),
    `KillMode=control-group`, no `PAMName=`
  - `Type=oneshot` with a `TimeoutStartSec=` bound (for the uploader, larger than
    its lock `--wait`)
- **Ordering:** `After=`/`Wants=network-online.target` only for units that start
  the Proton CLI: `auth-login`, `auth-logout` and the provider probe units the
  launcher's `provider-probe` builds (E3J9D-R, §20: transient units for `run` and
  the delayed slots, a fresh generated pair published by `unit-publish` for the
  boot slot; the former provider template was never installed and is deleted).
  Local probe modes have no unit file; they run only through the launcher's
  `probe` operation (§11).
- **Unit environment (E3J9D-R):** only `pty-marker`, `env-proof` and the single
  validation-only `e4-decoy` provider mode add unit environment, each an exact
  fixed set whose marker the launcher generates; no provider unit carries any
  other `Environment=` (§20).
- **Stop/restart:** the lock is released when the `flock` parent exits (§4). Cgroup
  cleanup separately ends stragglers (agent included, **[VALIDATE]**). The next
  start cold-starts.
- **Out of scope:** the production uploader unit, its timer and schedule, other
  hardening and the emitter (E3J10/E3J8B).

## 9. Exposure statement (operator-facing)

> **Option A stores the Proton CLI's complete credential snapshot where the service can use it without a human, protected only by Unix file permissions and account separation.** E3J9A's named checks evidenced no TPM device path and no `crypt` layer on Hotel-Echo (universal absence was not established), so no such protection is claimed.
>
> - **What source proves is stored** (CLI source at tag `js/v0.21.0`): `cachePassword`, `userKeyPassword`, session data (`uid`, `accessToken`, `refreshToken` and related fields), and telemetry state.
> - **What source does not establish:** which Proton products or account functions that session and `userKeyPassword` can reach; the full account-wide blast radius; whether `userKeyPassword` remains useful after the session is revoked remotely; whether a password change would be required after exposure. These are unknowns, not reassurances.
> - **Who can obtain it:** any code running as `eanhl-cloud`, root, and anyone with offline disk access (both key and store are on the `/` filesystem, for which E3J9A evidenced no `crypt` layer). GPG/pass gives **no secrecy against the identity that holds the usable key**.
> - **The session is dedicated but not scoped** (C6).
> - **Incident response options, kept separate:** (1) local logout, which clears local credentials and caches only; (2) remote session revocation through a Proton account control, whose coverage of CLI sessions is still to be verified; (3) a password change, as a separately justified action. None is claimed sufficient alone. Re-establishing service always needs a new key, a new empty store and a new operator login.
> - **Leakage channels designed out, not eliminated:**
>   - the repository holds paths, public fingerprints and a non-secret environment manifest;
>   - credential commands start from a fixed, positively enumerated environment, and no ambient or injected parent variable crosses into them — assuming a root-authored system unit with no untrusted loader variables (§7);
>   - the sign-in URL goes to the operator's PTY, once the A-series proofs pass;
>   - probes print a fixed vocabulary, and host-wide scans print booleans and counts;
>   - CLI logs are fixed at `ERROR` and mode-restricted;
>   - **the operator's scrollback during the ceremony contains the URL.**
> - **Accidental backup:** `/var/lib/eanhl-cloud` and `/var/cache/eanhl-cloud` must be excluded from host or file-level backups, or such a backup must be treated as containing the credential.
> - **Protects against:** other unprivileged local users and container uids, accidental reads through the repo, config, journal or transcripts, ambient variables leaking into credential commands, operator personal keys ever being involved, silent `unsafe_file` or keychain fallback, and concurrent credential writers.
> - **Does not protect against:** `eanhl-cloud` (including code already running as that identity, which can bypass the wrapper and launcher entirely), root, offline disk access, or kernel compromise.

("C6" in the statement is constraint C6 of
[`proton-drive-transport-feasibility.md`](proton-drive-transport-feasibility.md): no
append-only, folder-scoped or service-account credential is documented in Proton's
public sharing, CLI or SDK documentation.)

**D1 is the only credential-risk decision.** Either (a) explicitly accept storing
the **primary** account's complete CLI snapshot under option A, on the statement
above; or (b) use a **dedicated Proton account with sufficient quota**, whose quota
and cost remain unresolved by U5/U6 (a free or Mail Plus account is not assumed
sufficient). **D1 gates E3J9D only.** **D1 was accepted on 2026-09-28: option (a),
the primary account's complete CLI snapshot under option A (§20).**

## 10. Mutation and authorization inventory

Every row below is **[AUTH]**: none is authorized by this memo.

| #   | Mutation                                                                                                                                                                                                                                                                                                                           | Privilege            | Contacts Proton             | Rollback                                                  | Owner                                                                                      |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | --------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| M1  | `apt-get install --no-install-recommends pass` after an `-s` simulation, no `apt update`; confirm `/usr/bin/flock` (util-linux, with `--close`) and `/usr/bin/env` exist. **Done in E3J9C** (with its new dependency `tree` 2.3.1-1)                                                                                               | root                 | no                          | `apt-get -s remove pass tree`, then both; no autoremove   | E3J9C                                                                                      |
| M2  | Group + account `eanhl-cloud` (§1)                                                                                                                                                                                                                                                                                                 | root                 | no                          | §12 step 11                                               | E3J9C                                                                                      |
| M3  | `install -d` for `/var/lib/eanhl-cloud{,/gnupg,/password-store,/config,/data,/locks}`, `/var/cache/eanhl-cloud`, `/opt/eanhl-cloud/{bin,credential-bin}`, `/usr/local/lib/eanhl-cloud{,/validation}`; pre-create `locks/credential.lock` 0600                                                                                      | root                 | no                          | `rmdir`/`rm` of literal paths                             | E3J9C                                                                                      |
| M4  | Curated PATH: root-owned symlinks for exactly the §3 manifest (including `cat`; never the old conditional trio); manifest sha256 recorded                                                                                                                                                                                          | root                 | no                          | remove literal links, `rmdir`                             | E3J9C                                                                                      |
| M5  | Wrapper `credential-exec` (lock + `env -i` environment) and launcher `eanhl-cloud-credential`; sha256 recorded                                                                                                                                                                                                                     | root                 | no                          | remove after sha256 match                                 | E3J9C                                                                                      |
| M6  | CLI 0.8.0 `linux-x64`: acquire, verify SHA-512 against the recorded pin, install root:root 0755, deployment record. **Never executed.** Acquisition is either an unauthenticated fetch from Proton's public download host (named explicitly in the authorization) or a transfer of the byte-identical pinned file from the main PC | root                 | download host only, or none | remove literal file                                       | E3J9C                                                                                      |
| M7  | Validation tooling (probe, env-inspect, lockhold, PTY-marker, owned-inventory). **No unit file** in E3J9C: local modes run through the launcher's `probe`; E3J9D-R deletes the never-installed provider template and adds `unit-publish` (§20)                                                                                     | root                 | no                          | removed in M18                                            | E3J9C                                                                                      |
| M8  | GPG key via `keygen`, then gpg.conf                                                                                                                                                                                                                                                                                                | root→svc             | no                          | §12 step 8                                                | E3J9C                                                                                      |
| M9  | `pass init <fpr>` via `pass-init` on a proven-empty store (§5)                                                                                                                                                                                                                                                                     | root→svc             | no                          | §12 step 7                                                | E3J9C                                                                                      |
| M10 | Local proofs: A1–A10, E1–E3, L1, L2, K1–K6                                                                                                                                                                                                                                                                                         | svc units / launcher | no                          | canary removed in-run with `pass rm -f`; absence verified | E3J9C                                                                                      |
| M11 | **Operator `auth-login` ceremony** (§6)                                                                                                                                                                                                                                                                                            | root→svc, PTY        | **yes, authenticates**      | M19                                                       | E3J9D (**D1**)                                                                             |
| M12 | Provider read `filesystem info /my-files` (metadata only, stdout→`/dev/null`) via `provider-probe run` (§20)                                                                                                                                                                                                                       | svc unit             | **yes, one per run**        | none (read)                                               | E3J9D (exactly one, P0); E3J9E                                                             |
| M13 | a fresh launcher-generated pair `eanhl-cloud-cred-pprobe-boot-provider-<32 hex>.{service,timer}` (`OnBootSec=10min`, no recurrence) via `provider-probe schedule boot`, published by `unit-publish` (§20)                                                                                                                          | root                 | via M12                     | removed in M18                                            | E3J9E                                                                                      |
| M14 | Transient one-shot timers (`--on-active=20min` / `6h15min`) via `provider-probe schedule t20m\|t6h15m` (§20)                                                                                                                                                                                                                       | root                 | via M12                     | `collect` / `discard` (provenance-checked)                | E3J9E                                                                                      |
| M15 | Logout of all human sessions                                                                                                                                                                                                                                                                                                       | operator             | no                          | n/a                                                       | E3J9E                                                                                      |
| M16 | **Reboot** of Hotel-Echo (restarts its parallel web/worker/db deployment); read-only pre-check of restart policies and main-PC ingestion health first                                                                                                                                                                              | root                 | no                          | n/a                                                       | E3J9E (**D7**)                                                                             |
| M17 | Negative tests N1–N4 (N3 `run n3-busy`; N4 = E4 `run e4-decoy`, §20)                                                                                                                                                                                                                                                               | svc units            | N1, N2, N4 may              | in-run temp dirs                                          | E3J9E                                                                                      |
| M18 | Remove the boot pair (`collect`/`discard boot`) and all validation tooling incl. `unit-publish`; `daemon-reload` (D8)                                                                                                                                                                                                              | root                 | no                          | —                                                         | E3J9E end                                                                                  |
| M19 | Local `auth-logout` (`pass rm -f` + clear caches [SRC]; **local only**)                                                                                                                                                                                                                                                            | root→svc             | possibly (CLI start)        | —                                                         | rollback / rotation / recovery                                                             |
| M20 | Remote session revocation through a verified Proton account control                                                                                                                                                                                                                                                                | operator only        | yes                         | —                                                         | rollback / incident                                                                        |
| M21 | Account password change                                                                                                                                                                                                                                                                                                            | operator only        | yes                         | —                                                         | incident only, separately justified                                                        |
| M22 | Key deletion (`key-delete`); store/dir removal (as `eanhl-cloud`, §12); launcher, wrapper, curated PATH, CLI removal; account; packages `pass` and `tree`                                                                                                                                                                          | root                 | no                          | —                                                         | rollback, each separately                                                                  |
| C1  | **Repository code correction** (not a host mutation): literal `ERROR` in `buildChildEnv()` + §7 tests                                                                                                                                                                                                                              | local repo           | no                          | git revert                                                | **Must be merged before any E3J10 step that executes the CLI or can contact the provider** |

## 11. Acceptance protocol [DESIGN]

**Probe** (validation-only). It is started through the wrapper, so it runs as the
scrubbed child. Its argument is `local:<mode>` or `provider:<mode>`, each a closed
set (E3J9C-R):

- **Local modes** (`precheck`, `local`, `canary`, `canary-a`, `canary-b`,
  `neg-uninit`, `lockhold-hold`, `lockhold-long`, `lockhold-detach`,
  `busy-a`…`busy-d`) run **only** through `eanhl-cloud-credential probe <mode>`.
  That operation always passes `local:<mode>`, in a `PrivateNetwork=yes` transient
  unit with no network dependency, and has no provider mode in its allowlist.
- **Provider modes** (`provider`, `provider-freshcache`, `neg-nokey`,
  `neg-nostore`, and E3J9D-R's `e4-decoy`) run only through
  `eanhl-cloud-credential provider-probe`, which builds a fresh unit whose
  argument is always `provider:<mode>` from its closed table (§20). The former
  provider template is deleted.
- The internal `canary-nested` form (used by `lockhold`) is not launcher-startable.

It prints **only** lines matching `^E3J9 [a-z_]+=[a-z0-9_.:-]+$`. A value outside
that vocabulary prints as `invalid`, and a failed tool behind any count
(`loginctl`, `pgrep`, `find`) prints `invalid` and counts as a failure: a failed
scan never reads as `0`. Its first line is always `probe_mode=<mode>`, and it
prints exactly one `probe_result=` line (`lockhold` prints it for the lockhold
modes).

**The `probe` operation** (launcher, E3J9C-R) makes every result bound to one
invocation, so stale output cannot be accepted. E3J9D-R (§20) runs the same
bound runner for `provider-probe` too, and adds the stages marked (R) to local
and provider runs alike. Each stage fails closed:

1. exact allowlisted mode, else refused before any unit exists;
2. a fresh unit name (`eanhl-cloud-cred-probe-<mode>-<16 hex>`; provider:
   `eanhl-cloud-cred-pprobe-<slot>-<mode>-<32 hex>`), refused unless systemd
   reports it `not-found` and (R) the journal holds no record ever logged under
   it (the never-reused proof);
3. exactly one start (`systemd-run --no-block`, no `--collect`,
   `RemainAfterExit=yes`); a failed start fails, and (R) the unit is stopped only
   if it attests as this launcher's (a racing foreign unit is never touched);
4. its `InvocationID` bound within 10 s (`provider-probe run`: 30 s), else the
   unit is stopped and the run fails;
5. a bounded wait for `active/exited`, `failed` or `inactive` (expiry stops the
   unit and fails), then the `InvocationID` is re-read and a change fails;
6. (R) attestation: the unit's fixed properties (identity, hardening,
   `PrivateNetwork`, the single `ExecStart=` argv, `Environment`, description,
   fragment path) must be the ones the launcher builds;
7. (R) the single-invocation proof: a json view of every record ever logged
   under the name, requesting only `_SYSTEMD_INVOCATION_ID` (never `MESSAGE`),
   must show the bound id and the current `_BOOT_ID` on every record;
8. only records matching both `_SYSTEMD_UNIT=<unit>` and
   `_SYSTEMD_INVOCATION_ID=<id>` are read; a `journalctl` failure fails;
9. vocabulary lines are printed and every other record is only counted.
   (R) A provider run prints a vocabulary record only if its name is one the
   mode's probe arm emits and its value is of that name's class
   (`bound_disallowed_lines` counts the rest), and an independent classifier
   decides (§20.2). `pass` requires zero other records, the first record
   `probe_mode=<mode>`, exactly one `probe_mode`, exactly one
   `probe_result=pass` and exit 0. `busy` requires exit 75 and zero records.
   Everything else is `fail`. Each mode has fixed accepted outcomes (`busy-*`:
   busy; `canary-a`/`-b`: pass or busy; `n3-busy`: busy; the rest: pass);
10. **cleanup is part of the result** (E3J9C-R correction):
    - A keep mode (`canary`, `lockhold-detach`, `lockhold-long`, for K2/K3/K5)
      stays active only after it reached `pass`.
    - Every other run, including a failed or indeterminate keep-mode run, is
      stopped and reset. Cleanup succeeds only if the unit ends inactive or no
      longer loaded; a show, stop or reset failure is a cleanup failure.
    - `bound_cleanup_ok=true|false` is printed on every cleanup path (start
      failure, unbound invocation, timeout, changed invocation, journal failure,
      normal end). A failed cleanup turns any outcome into `fail`.
    - A unit name that already existed is never stopped: it is not this run's.
    - `probe-stop` requires the unit to be loaded (a typo never succeeds) and (R)
      to attest as a kept local probe unit this launcher built, and exits 0 only
      if the stop and the reset/cleanup succeed;

11. (R) provider runs then check their postconditions: the entry still a 0600
    regular file, no fallback file or extra store entry, no other active
    credential unit or service process, and, for `e4-decoy`, zero journal hits
    for its marker.

`env-proof` uses the same mechanics for its three steps.

**Sequencing (E3J9C §19.7):** acceptance steps run one at a time. Each probe
or launcher operation is evaluated completely (exit status, `probe_run_result`,
`bound_cleanup_ok`, and any count or boolean the row requires) before the next
starts, and any failure stops the run before another step begins. Only the K
rows that need concurrency (K1, K4, K5, K6) start overlapping operations, and
they are evaluated as one step.

The probe records:

- identity and groups booleans;
- `env_initial_exact` (its own exec-time environment, read from
  `/proc/self/environ`, equals the twelve literals), `env_descendant_within_permitted`
  (its current names ⊆ the §7 permitted union — the twelve ∪ {`PWD`, `SHLVL`, `_`,
  `OLDPWD`} ∪ {`GPG_TTY`, `GIT_CEILING_DIRECTORIES`} — and every name with a fixed
  expected value carries it), `env_pwd_is_workdir`, `env_forbidden_absent` and
  `env_nonce_absent`. Helper children report their **own** `/proc/self/environ`,
  so these reads are deterministic. These are booleans; unexpected variables are
  reported only as a count, never by name or value;
- `pass_script_hash_match` (the curated `pass` link resolves to `/usr/bin/pass`,
  a root:root 0755 regular file with the accepted §3 SHA-256),
  `pass_system_ext_dir_empty` (hunk H7's directory is root-owned, not
  group/world-writable and empty) and `tty_absent` (`command -v tty` fails in the
  child);
- the **supplementary** `/proc` observation (only in `lockhold` runs):
  `proc_obs=observed|not_observed`; only when observed, `proc_nonce_hits`,
  `proc_forbidden_names`, `proc_gpg_tty_empty` and `proc_git_ceiling_expected`;
- `[ -t 0 ]` false; `/run/user/$uid` absent; human session count; the `gpg-agent`
  count at start; CLI sha512 = pin;
- entry mode, size and mtime; fallback-file absence; log metadata;
- `pass_cmd_not_found=false` (no pass stderr contains `command not found`);
- the local `pass show` exit status, and the provider exit code mapped to
  `ok|login_required|pass_load_failed|timeout|credential_lock_busy|other`.

Stderr is never printed. Log contents are never read.

**Owned-inventory** (validation-only). Root runs `find` over each filesystem holding
`/`, `/var`, `/var/tmp`, `/opt`, `/etc`, `/usr/local`, `/tmp`, `/home`, `/run` and
`/dev/shm` for the uid/gid `eanhl-cloud` (E3J9C-R added the three tmpfs-prone
roots). It compares the results in memory against the §2 set, or, with
`expect-none` (§12 step 11), against the empty set. It emits **only**
`owned_expected_set_match`, `owned_unexpected_count` and `owned_scan_code`.
Preconditions in **both** modes, else scan code 4 (E3J9C-R: deliberately stricter
than the `auth-login` preflight, with no resident-agent exception):

- **no** process runs as `eanhl-cloud` (`pgrep -u` must report none; a `pgrep` or
  `/proc` error fails);
- no `eanhl-cloud-*` unit is activating, active, deactivating or reloading (a
  `systemctl` error fails).

If M8/L2 shows that GnuPG daemons stay resident, a design revision must add the
same evidence-bound rule here before owned-inventory can pass while they run.
The result is evidence only
within those scan roots. It never prints a path. On a mismatch: **stop**; only the
operator inspects, and names never go to an agent.

| Test                                                    | When                                  | Pass criterion                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1 curated inventory                                    | E3J9C, pre-ceremony                   | the directory contains exactly the §3 manifest (including `cat`); each entry is a symlink to its recorded `/usr/bin/…` target; the directory is root:root 0755; for each target the final `readlink -f` path, its owning package and the owner/mode of every hop are recorded, and any later change is a STOP (E3J9C-R)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| A2 non-writability                                      | E3J9C, pre-ceremony                   | as `eanhl-cloud` (through `setpriv`): the curated directory, every target and every final chain target, `/opt`, `/opt/eanhl-cloud`, `bin/`, the CLI, the wrapper and the launcher are not writable; targets are root-owned and not group/world-writable                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| A3 `xdg-open` and `tty`                                 | E3J9C, pre-ceremony                   | `command -v xdg-open` and `command -v tty` both fail in the scrubbed child (`tty` absence is what makes pass's `GPG_TTY` empty, §7)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| A4 no opener                                            | E3J9C, pre-ceremony                   | every §3 opener name fails `command -v` in the child. Host-wide opener presence is recorded as a boolean                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| A5 pass/GPG canary                                      | E3J9C                                 | = L1                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| A6 PTY marker                                           | E3J9C, pre-ceremony                   | `pty-marker` runs through the wrapper. The launcher passes a nonce to the unit via `--setenv` (never in the unit's `ExecStart=` argv, which systemd may log), so it reaches only the wrapper's environment. For the validation-only `pty-marker` command id alone, the wrapper hands the nonce to the scrubbed child as a positional argument. The child writes it to stdout and stderr. The operator sees it on the PTY; a root search of **all** journal entries since the test start returns `pty_marker_journal_hits=0`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| A7 CLI pin                                              | E3J9C, pre-ceremony                   | sha512 = pin, not executed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| A8 lock free                                            | pre-ceremony                          | nonblocking acquire succeeds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| A9 empty-store proof                                    | E3J9C, before `pass-init`             | the store directory is correctly owned and holds no entries and no `.gpg-id` (a scan failure refuses); that it is the M3 directory comes from the session record, not metadata                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| A10 pass error paths                                    | E3J9C                                 | in the child: `pass show e3j9-absent` exits ≠ 0 and its stderr contains `is not in the password store` (boolean); `neg-uninit` (a private empty store without `.gpg-id`) `insert` exits ≠ 0 and its stderr contains `You must run` (boolean, which proves `cat` works); `pass_cmd_not_found=false` throughout                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| E1 construction + initial exec environment              | E3J9C, pre-ceremony                   | (a) **Construction:** the installed wrapper's sha256 equals the repo template, and the repo test proves the template execs `/usr/bin/env -i` followed by exactly the twelve manifest literals, with no parent-value expansion. (b) **Exec boundary:** `env-inspect`, exec'd directly as the credential command, reads its exec-time environment from `/proc/self/environ` before doing anything else. The name set equals the twelve exactly, each value equals its literal (`env_initial_exact=true`), and every forbidden name is absent, systemd-added ones included                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| E2 wrapper side vs. downstream                          | E3J9C                                 | `env-proof` records, for the **wrapper's** own environment, the booleans `wrapper_has_invocation_id=true` and `wrapper_has_journal_stream=true`. Then, in the probe (a bash descendant) and in helper children that read their own `/proc/self/environ` (deterministic): `env_descendant_within_permitted=true` against the §7 union and its expected values, `env_pwd_is_workdir=true`, and none of `INVOCATION_ID`, `SYSTEMD_EXEC_PID`, `JOURNAL_STREAM` is present. pass's contribution is fixed statically: `pass_script_hash_match=true` (§3), A3 and E1(b) determine `GPG_TTY` = empty and `GIT_CEILING_DIRECTORIES` = `/var/lib/eanhl-cloud/password-store/..`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| E3 injected parent values have no effect on pass or GPG | E3J9C                                 | `env-proof` sets decoys on the unit via `--setenv`: `E3J9_INJECTED=<nonce>`, `GNUPGHOME=/nonexistent-e3j9`, `PASSWORD_STORE_DIR=/nonexistent-e3j9`, `PASSWORD_STORE_GPG_OPTS=--e3j9-invalid`, `PATH=/nonexistent-e3j9`, `GPG_TTY=/dev/e3j9-decoy`, `PROTON_DRIVE_BASE_URL=http://127.0.0.1:9`. **Required (all deterministic):** (a) E1(b) passes under the decoys, so the nonce and every decoy name are absent from the credential command's exec-time environment; (b) the L1 canary succeeds. Had the `GNUPGHOME` or `PASSWORD_STORE_DIR` decoy reached pass or gpg, the key or store would not be found; had `PASSWORD_STORE_GPG_OPTS` reached pass, gpg would reject the invalid option; had the `PATH` decoy reached the command, `/usr/bin/env bash` could not start pass; (c) the probe and its self-reporting helper children report `env_nonce_absent=true`. The base-URL decoy's effect is tested in E4, where the CLI runs; `GPG_TTY`'s is covered by (a) and the §7 static validation. **Supplementary only:** root may read `/proc/<pid>/environ` of a live `pass` or `gpg` during a `lockhold` canary. `proc_obs=not_observed` (the short-lived process was not caught) is recorded and is neither a pass nor proof. When observed, any nonce hit, forbidden name, non-empty `GPG_TTY` or unexpected `GIT_CEILING_DIRECTORIES` is a STOP |
| E4 injected decoys have no effect on the Proton CLI     | E3J9E                                 | provider probe with parent decoys `PROTON_DRIVE_CACHE_DIR=<private-tmp marker dir>`, `XDG_CACHE_HOME=<another marker dir>`, `PROTON_DRIVE_BASE_URL=http://127.0.0.1:9` and `E3J9_INJECTED=<nonce>`: `env_initial_exact=true` and `env_nonce_absent=true`; result `ok` (a CLI using the loopback discard-port base URL could not reach the provider); both marker dirs stay empty (vehicle: `provider-probe run e4-decoy`, E3J9D-R §20)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| L1 local key/store                                      | E3J9C                                 | canary match=true; then `pass rm -f`; absence verified; no pinentry process                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| L2 cold start                                           | E3J9C                                 | after stop/start: agent count 0 at start; L1 passes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| K1 contention across the whole foreground command       | E3J9C                                 | `lockhold` runs a foreground canary plus a fixed hold; second instances started at the beginning, middle and end all exit 75 / `credential_lock_busy` without starting pass or GPG (`probe_run_result=busy`: exit 75 and zero records)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| K2 descendants never hold the lock                      | E3J9C                                 | in a validation unit with `RemainAfterExit=yes`, `lockhold` leaves a detached `setsid` descendant running and exits its foreground command. While the descendant is verified alive (boolean), a nonblocking acquire succeeds; root reports `descendant_holds_lock_fd=false` (fd-link comparison, boolean only)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| K3 gpg-agent cannot keep it busy                        | E3J9C                                 | after an L1 canary in a `RemainAfterExit=yes` unit, while `gpg-agent` is verified still running: a nonblocking acquire succeeds and `agent_holds_lock_fd=false`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| K4 bounded and nonblocking semantics                    | E3J9C                                 | `--nonblock` → 75 immediately; `--wait=<short test bound>` → 75 on expiry while a holder runs. No launcher operation uses `--wait`, so that half is proven by the local test only and on the host in E3J10                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| K5 stop releases                                        | E3J9C                                 | `systemctl stop` of a holding `lockhold` → after the stop completes, a nonblocking acquire succeeds; no process of that unit remains; the canary entry is intact or absent (the next `probe local` starts with `store_other_entry_count=0`). The stopped holder's own result is `fail` by design                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| K6 no simultaneous rewrite                              | E3J9C                                 | two concurrent canaries: exactly one runs, the other is busy; the entry is intact                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| K7 reboot + lock order                                  | E3J9E (reboot); E3J10 (static order)  | the first boot probe acquires nonblocking; E3J10 statically verifies the wrapper is first in `ExecStart=`, no `flock` exists in `ops/backup/lib`, and the run-lock acquisition is unchanged                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| P0 first provider read                                  | E3J9D, straight after the ceremony    | `ok` via `provider-probe run provider` (§20); entry 0600; no `auth-session.json`; owned-inventory match=true                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| P1 stop/start pair                                      | E3J9E                                 | both `ok`; agent count 0 at each start                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| P2 fresh empty cache                                    | E3J9E                                 | `ok`; new cache under the private `/tmp` only                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| P3 human sessions = 0                                   | E3J9E T0+20 min                       | `ok`, sessions=0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| P4 ≥ 6 h                                                | E3J9E T0+6 h 15 min                   | `ok`, sessions=0; entry mtime/size recorded                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| P5 reboot                                               | E3J9E boot timer, no login since boot | `ok`, sessions=0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| N1 key unavailable                                      | E3J9E                                 | exit ≠ 0, `pass_load_failed`, no hang, no pinentry, no fallback file                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| N2 store unavailable                                    | E3J9E                                 | `login_required`; no URL-like output in the unit's journal                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| N3 lock held                                            | E3J9E                                 | `provider-probe run n3-busy` during a `lockhold-long` hold → `busy` (exit 75, zero records); pass and the CLI are never started (§20)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| N4                                                      | E3J9E                                 | = E4                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| J journal hygiene                                       | E3J9E end                             | every provider run reports `bound_nonvocab_lines=0` and `bound_disallowed_lines=0` for its own invocation (no raw journal read, §20); local probes as before                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

- **Test isolation:** `neg-*` and `provider-freshcache` **cannot** use parent
  environment overrides; `env -i` discards them (E1 under the E3/E4 decoys proves
  exactly that).
  - **Mechanism:** the probe, running as the scrubbed credential command, starts a
    validation-only secondary pass or CLI process with an environment rebuilt from
    the same twelve §7 literals. **Exactly one** directory value is replaced
    (`GNUPGHOME`, `PASSWORD_STORE_DIR` or `XDG_CACHE_HOME`), pointing at an empty
    private-`/tmp` directory.
  - **Scope:** this is the single documented exception. It is confined to
    validation tooling that is removed after E3J9E. Production commands cannot
    replace any value (§7).
- **Provider scope (D6, resolved):** `/my-files`, metadata `filesystem info` only,
  separately authorized per session. Every CLI invocation, N1/N2/E4 included, is
  treated as possibly Proton-contacting.
- **Provisional provider labels (E3J9C-R):** the probe's N1/N2 text anchors
  (`You need to login first`, `decryption failed`, `No secret key`) are hypotheses
  from source. The generic `Failed to load` anchor was removed because it could
  mislabel an unrelated error as `pass_load_failed`. Unmatched text is `other`,
  which fails the expectation. The anchors are to be replaced from E3J9E evidence.
- **Known template gap (closed by E3J9D-R, §20):** `env-proof` covers E1–E3; the
  E4/N4 vehicle is the validation-only `e4-decoy` provider mode, run through
  `provider-probe run e4-decoy` under E3J9E's authorization.
- **What E3/E4 prove, and what they do not:** the listed effect-bearing decoys had
  no effect, and the boundary admitted none of them. A canary does **not** by
  itself prove the absence of every arbitrary variable; that rests on the `env -i`
  construction (E1(a)), the exec-boundary observation (E1(b)) and source review of
  what pass exports (§7).
- **Overall PASS:** every row passes on its stated criteria. The
  supplementary `/proc` observation is never one of them: `not_observed` neither
  passes nor fails anything and is never cited as proof, while an observed
  forbidden marker, name or value is a STOP. U1 then closes for option A over the
  observed intervals only.
- **STOP (any one):** a prompt; a timeout; a pinentry process; an `unsafe_file` file;
  a line outside the vocabulary; `login_required` on the real store; a hash
  mismatch; owned-inventory match=false; a PTY-marker hit > 0; an E-series failure;
  `pass_script_hash_match=false` or `pass_system_ext_dir_empty=false`; a `probe_run_result` outside the mode's accepted outcomes; an observed descendant environment containing
  the nonce, a forbidden name or a wrong value (including a non-empty `GPG_TTY` or an
  unexpected `GIT_CEILING_DIRECTORIES`); unexpected lock busy or a descendant holding the lock; a curated-inventory
  mismatch; `command not found` from pass; a nonempty store before `pass-init`. On
  STOP: record, do not re-authenticate, and leave state for §12.
- **Sanitized output rules (summary):** probes print only the fixed vocabulary
  regex; stderr and log contents are never printed; environment findings are
  booleans and counts; owned-inventory and journal scans print booleans and counts,
  never paths or names; the sign-in URL is never handled by an agent; every recorded
  key fact is public metadata.
- **Cleanup (end of E3J9E, D8):** remove the boot pair through
  `provider-probe collect`/`discard boot` (§20), then all validation tooling
  and units from the host; verify transient timers are gone; `daemon-reload`. Repo
  copies remain under `validation/`, not installed.

## 12. Rollback (ordered; each step separately authorized)

**Current state (E3J9C passed, §19.9):** M1–M10 were completed for the
credential-foundation and local-proof scope only. No authentication (E3J9D),
provider contact, persistence or reboot validation (E3J9E) or activation has
happened, so no Proton entry exists: a rollback from this state follows the order
below without steps 2–6, and step 1 applies only to objects a later session
created. (While M1 was the only host change, §17, step 12 alone applied.)
**Update (E3J9D, §21), superseding "no authentication" above:** one
authentication happened and its session was revoked by the operator (step 3);
the entry was removed with `entry-remove`, the CLI state deleted and the key and
store rotated (step 6). So again no Proton entry exists, and a rollback from
this state still follows the order below without steps 2–6.

**Package removal (step 12):** review `apt-get -s remove pass tree`, confirm with
`apt-cache rdepends --installed tree` that nothing else needs `tree`, read the M1
transaction in `/var/log/apt/history.log`, then remove **both** packages. Never
run `autoremove`. Removing `pass` also removes its empty extensions directory.

**Order**, each step separately authorized:

1. Stop only E3J9 units: `probe-stop` for kept local probe units. **Every pprobe
   object** (the `run`, `t20m` and `t6h15m` transient units and timers, and the
   `boot` pair's unit files and wants link) is removed **only** through
   `provider-probe discard <slot>`, which proves its provenance before touching
   anything (§20); a refusal is a STOP for operator-only review, never a
   literal-path, manual or old-launcher removal. No other E3J9 unit file is
   installed (§10 M7); any other installed E3J9 file (the validation tooling at
   M18, the step 10 files) is removed by literal path only after a sha256 match
   with the repository.
2. **Local logout:** `sudo /usr/local/sbin/eanhl-cloud-credential auth-logout`,
   under the lock with the §7 environment. Proven effect [SRC]: the local pass
   entry is removed (`pass rm -f`) and caches are cleared. **This is not remote
   revocation.** Verify the entry is absent (metadata). If logout fails and the
   entry must still go, the fixed `entry-remove` subcommand removes exactly that
   entry with `pass rm -f`. A leftover canary is removed with `canary-remove`.
3. **Remote session revocation (separate):** the operator uses Proton's account
   session management; its coverage of CLI sessions is **[VALIDATE]**, recorded as
   an operator boolean.
4. **Password change (separate):** only when incident analysis justifies it.
5. If step 2 failed, keep the key: local cleanup may still need it. Retry only under
   new authorization.
6. **Recovery or rotation, when the service is to continue:** follow the §5 sequence
   (store removed → **old key deleted** → GNUPGHOME residue cleared under its
   inventory and STOP rules → new key + `gpg.conf` → `pass-init` → new operator
   login). There is **no in-place re-encryption** of the old store.
7. Password store: only if metadata shows exactly `.gpg-id` plus empty directories,
   remove them (as in step 9). Otherwise stop for operator-only review.
8. **Key deletion (separate authorization), only once no local cleanup still needs
   it:** `sudo eanhl-cloud-credential key-delete <FPR>`. It refuses unless the
   keyring holds exactly that one key, no credential unit is active and the store
   holds no entry (and any `.gpg-id` names that key). It deletes the key through
   the wrapper and removes `openpgp-revocs.d/<FPR>.rev` as `eanhl-cloud`.
9. GNUPGHOME, data, config, logs, cache and `locks/`: key files are named by
   keygrip, so their exact paths cannot be known in advance (E3J9C-R correction to
   "literal paths only"). Generate a metadata table, review it, then delete **as
   `eanhl-cloud`** through `setpriv`, with
   `find <literal top> -xdev -depth -type <reviewed types> -delete`. Root then
   `rmdir`s only verified-empty top directories. The identity cannot delete what
   it does not own.
10. Remove the launcher, the wrapper, the curated directory, and `/opt/eanhl-cloud`
    (the last after an E3J10 dependency review).
11. Account: no unit with `User=eanhl-cloud`; run `owned-inventory expect-none`
    from a root-only temporary copy (for example `/run/eanhl-cloud-rollback/`,
    removed afterwards; never recreate `/usr/local/lib/eanhl-cloud`). It requires
    that no process runs as `eanhl-cloud` and reports a match only if the identity
    owns nothing within its scan roots → `deluser --system eanhl-cloud`,
    `delgroup`. A mismatch means stop and operator-only inspection.
12. Packages: `pass` **and `tree`** (both installed by M1), as above.

## 13. Session sequence and dependency ordering

**Sequence: E3J9B-doc → E3J9C → E3J9D → E3J9E.** D1 gates **only** E3J9D; D7 gates
**only** E3J9E.

| Session                                   | Authorized mutations                                                                                                                                                                                        | Prohibited                                                                                                                                                                                                                | Operator                                                            | Verification                                                                                                                                                                                  | Checkpoint                                                                                                                         |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **E3J9B-doc** (local)                     | Design doc + pointer edits                                                                                                                                                                                  | Any host/provider action; code                                                                                                                                                                                            | —                                                                   | `git diff --check`, sensitive-value and stale-claim scans                                                                                                                                     | docs commit (only if separately authorized). **Complete locally** once written and verified                                        |
| **E3J9C** host foundation + local proof   | M1–M10                                                                                                                                                                                                      | Proton CLI execution, authentication, provider contact (except an explicitly named M6 download), reboot                                                                                                                   | sudo                                                                | getent/`passwd -S` locked, no linger, `id -G`, directory table, the §3 pass acceptance rule, CLI sha512 = pin, A1–A10, E1–E3, L1, L2, K1–K6, public key metadata                              | docs + templates. **PASSED (credential foundation + local proof; §19.9)**                                                          |
| **E3J9C-R** correction (local)            | Design memo, templates, local test harness, both external plan copies                                                                                                                                       | Any host, provider, credential, key, package or unit action; C1 or other E3J10 work; staging, commit, push                                                                                                                | —                                                                   | full-mode template test with mutation checks, `bash -n`, `systemd-analyze verify`, targeted Prettier, `git diff --check`                                                                      | docs + templates (§18). **Complete locally**; commit only if authorized                                                            |
| **E3J9D** ceremony                        | M11, exactly one M12 (P0)                                                                                                                                                                                   | Upload/list/create/trash; a second login; the agent seeing ceremony output                                                                                                                                                | **ceremony; D1 accepted**; the A-series and E1 re-passed in-session | §6 pre-checks with the E3J9D-R launcher, probe and `unit-publish` installed from a `main` commit after reauthorization; metadata table, owned-inventory, P0 via `provider-probe run provider` | docs                                                                                                                               |
| **E3J9E** lifecycle validation            | M12–M18                                                                                                                                                                                                     | Upload or other provider mutation; production unit; schedules beyond M13/M14                                                                                                                                              | logout; **reboot (D7)**                                             | P1–P5, K7 (reboot), E4, N1–N4, J, then M18 cleanup verified                                                                                                                                   | docs; U1 disposition                                                                                                               |
| **E3J9D-R** runner correction (local)     | Launcher `provider-probe`; probe `e4-decoy` and header; new `unit-publish`; provider template deleted; harness; docs                                                                                        | Any host, provider, credential, unit or install action; staging, commit, push                                                                                                                                             | —                                                                   | full harness ×3 with mutation checks, `--static-only`, `bash -n`, `perl -T -c`, `systemd-analyze verify`, targeted Prettier, `git diff --check`                                               | docs + templates (§20); review, checkpoint (`ef32c885`) and integration into `main` complete; next: explicit E3J9D reauthorization |
| Conditional local correction              | Observed credential-failure anchors (§0.8), only if E3J9E evidence warrants it                                                                                                                              | Host/provider                                                                                                                                                                                                             | —                                                                   | full `pnpm test:backup-producer` suite, mutation checks                                                                                                                                       | code commit                                                                                                                        |
| **C1 mandatory Node-boundary correction** | Literal `ERROR` in `buildChildEnv()` + §7 tests                                                                                                                                                             | Host/provider                                                                                                                                                                                                             | —                                                                   | full backup test suite; the three §7 test groups                                                                                                                                              | code commit. **Prerequisite of every CLI-executing or provider-contacting E3J10 step**                                             |
| **E3J10**                                 | Containment, artifact permissions, production config/unit integration (wrapper as `ExecStart=`, uploader command id added by design revision, bounded `--wait`, K7 static order check), pin re-verification | **Before C1 is merged:** any step that executes the Proton CLI or can contact the provider, including integration and proving runs. **At any time without separate authorization:** production schedule, E3J8B activation | —                                                                   | containment proof etc.                                                                                                                                                                        | —                                                                                                                                  |

**Dependency ordering:**

- E3J9B-doc → E3J9C → (D1) E3J9D → (D7) E3J9E. E3J9C stopped after M1;
  E3J9C-R corrected the design locally; the authorized 2026-09-26 continuation
  completed M2–M9 (after a reviewed, installed launcher correction) and stopped
  in M10; with the corrected probe installed, M10 passed in full (§19.8–§19.9),
  so E3J9C passed for its credential-foundation and local-proof scope. E3J9D needs D1
  **and** a passed E3J9C.
- **C1 is a mandatory prerequisite before any E3J10 step that executes the CLI or can
  contact Proton.** It can be written at any point after E3J9B-doc, and it must be
  merged before the first such step.
- E3J10 steps that do neither (directories, permissions, config validation, static
  checks, pin hashing) may precede C1.
- Neither E3J9D nor E3J9E depends on C1, because their direct CLI runs get `ERROR`
  from the wrapper.

**Repository files expected to change in later sessions** (none is authorized here):

- **E3J9C:** new under `ops/backup/credential/` — `credential-child-env.manifest`,
  `credential-bin.manifest`, `credential-exec`, `eanhl-cloud-credential`,
  `gpg.conf`, `README.md` (install, recovery, rotation and rollback runbook, no
  secrets); new under `ops/backup/credential/validation/` —
  `eanhl-cloud-credential-probe.sh`, a probe unit template (E3J9C-R replaced it
  with the provider-only `eanhl-cloud-credential-provider-probe@.service`),
  `env-inspect`, `lockhold`, `pty-marker`, `owned-inventory`; optionally
  `ops/backup/lib/backup-cloud-credential-env.test.mjs` (asserting that the wrapper's
  literals equal the env manifest, the manifest ⊆ `ENV_ALLOWLIST` ∪ {the two
  `PROTON_DRIVE_*`}, the wrapper uses `/usr/bin/env -i` and `flock --close` without
  `--no-fork`, and no forbidden name appears; needs `ENV_ALLOWLIST` exported); a
  pointer in `ops/README.md`; the execution record in this memo; HANDOFF; journal.
- **E3J9C-R (done locally, §18):** the templates above, plus
  `ops/backup/credential/pass-1.7.4-8.accepted-delta.escaped` and
  `ops/backup/credential/test/credential-templates.test.sh`; this memo; HANDOFF;
  journal; `ops/README.md`; both external plan copies (Revision 4).
- **E3J9D-R (done locally, §20):** `eanhl-cloud-credential`, the probe, the new
  `validation/unit-publish`, the deleted `validation/eanhl-cloud-credential-provider-probe@.service`,
  the harness; this memo; README; `ops/README.md`; HANDOFF; journal.
- **E3J9D:** this memo, HANDOFF, journal; the E3J9D-R launcher, probe and
  `unit-publish` are installed from a `main` commit (no further repository change).
- **E3J9E:** no committed boot-timer file (the launcher generates the boot pair,
  §20); results in this memo; U1 updates in the three planning memos; HANDOFF; journal.
- **Conditional correction:** `ops/backup/lib/internal/backup-cloud-cli-core.mjs`,
  `ops/backup/lib/backup-cloud-cli.test.mjs`,
  `ops/backup/lib/testdoubles/fake-proton-drive.mjs`, and an architecture-memo entry.
- **C1:** `ops/backup/lib/internal/backup-cloud-cli-core.mjs` (`buildChildEnv`,
  docblock), `ops/backup/lib/backup-cloud-cli.test.mjs` (and `fake-proton-drive.mjs`
  if it must record the child env), and an architecture-memo entry.

## 14. Stop-condition assessment

| Condition                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Status                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Docs don't establish that pass works with the explicit environment                                                                                                                                                                                                                                                                                                                                                                                                 | **Satisfied, with caveats.** [DOC] + [SRC] at `js/v0.21.0` (`e6a661f5…`) and `password-store.sh@1.7.4`. The binary's build suffix `06e8c605` is not a public commit, so the binary↔source link is by version label only. It is validated behaviourally |
| Curated PATH insufficient on an exercised path (including usage/error paths), or the installed pass fails the §3 acceptance rule (package 1.7.4-8, SHA-256 `b0da432e…8632`, exactly hunks H1–H7, extension directory root-owned and empty)                                                                                                                                                                                                                         | **Stop E3J9C**; re-derive §3 by design revision                                                                                                                                                                                                        |
| A store is not proven empty before `pass init`                                                                                                                                                                                                                                                                                                                                                                                                                     | **Stop**; no in-place re-encryption                                                                                                                                                                                                                    |
| Initial exec environment not exactly the twelve literals (E1); a descendant variable outside the §7 permitted union, or a wrong value for a name with a fixed expected value, including a non-empty `GPG_TTY` or a `GIT_CEILING_DIRECTORIES` other than `/var/lib/eanhl-cloud/password-store/..` (E2); installed pass `export` lines differing from upstream; a decoy having an effect (E3/E4); or an observed descendant containing the nonce or a forbidden name | **Stop.** A `not_observed` supplementary `/proc` result is not a stop and not a pass                                                                                                                                                                   |
| A descendant or `gpg-agent` holds the lock descriptor, or the lock is busy after its holder exits                                                                                                                                                                                                                                                                                                                                                                  | **Stop**                                                                                                                                                                                                                                               |
| Needs an operator's personal key or home                                                                                                                                                                                                                                                                                                                                                                                                                           | **No.** `ProtectHome=yes` enforces it                                                                                                                                                                                                                  |
| Requires `unsafe_file`                                                                                                                                                                                                                                                                                                                                                                                                                                             | **No**                                                                                                                                                                                                                                                 |
| Allowlist can't express the context without a code change                                                                                                                                                                                                                                                                                                                                                                                                          | **A code change (C1) is required.** It is bounded and local, and must be merged **before any E3J10 step that executes the CLI or can contact the provider**. It does not gate E3J9C–E3J9E                                                              |
| E3J9/E3J10 ownership irreconcilable                                                                                                                                                                                                                                                                                                                                                                                                                                | **Resolved** (D2)                                                                                                                                                                                                                                      |
| A secret or the URL must enter the repo, command line, transcript, journal, logs or agent output                                                                                                                                                                                                                                                                                                                                                                   | **No, by design**, conditional on the A- and E-series passing. Residual: operator scrollback                                                                                                                                                           |
| Unexpected `eanhl-cloud`-owned paths                                                                                                                                                                                                                                                                                                                                                                                                                               | **Stop**; operator-only inspection                                                                                                                                                                                                                     |
| Risk acceptance broader than authorized                                                                                                                                                                                                                                                                                                                                                                                                                            | **Resolved: D1 accepted on 2026-09-28 (§20)**                                                                                                                                                                                                          |

## 15. Operator decisions

**Resolved:**

- D2: CLI install and pin → E3J9C (architecture correction); E3J10 re-verifies the
  pin and owns containment and deployment.
- D3: account name `eanhl-cloud`.
- D4: key expiry `never`, event-driven rotation (always via a new empty store and a
  new login).
- D5: no off-host key backup; recovery = new key + new empty store + new operator
  login.
- D6: provider read `/my-files`, metadata `filesystem info` only, separately
  authorized.
- D8: validation tooling, units and timers are removed from the host after E3J9E
  unless separately adopted.
- D9: withdrawn; replaced by the curated-PATH design (§3).
- D1: accepted on 2026-09-28 — option (a): store the primary account's complete
  CLI snapshot under option A, on the §9 statement (§20).

**Still open (no others):**

- **D7 (gates E3J9E only):** reboot window on Hotel-Echo and acceptance of the
  impact on its parallel deployment.

## 16. Source basis

**Released binary [BIN]:** CLI 0.8.0 `linux-x64` (E3I) reports `js@0.21.0+06e8c605`.
Its SHA-512 pin (`cf61…ccaa28`) comes from
https://proton.me/download/drive/cli/index.html. The README is used only for
documented behaviour: https://github.com/ProtonDriveApps/sdk/blob/main/cli/README.md.

**Compared source [SRC]:**

- Tag `js/v0.21.0` resolves to commit `e6a661f55b8d7c406de87747b6796891587681e6`
  (GitHub API, 2026-09-24). `06e8c605` returned "No commit found". **`main` is not
  used as proof.**
- Files read: `cli/src/credentials/{passCredentialsStore,credentials}.ts`,
  `cli/src/config.ts`, `cli/src/cli/openBrowserUrl.ts`,
  `cli/src/commands/auth/{commandAuthLogin,commandAuthLogout}.ts`,
  `incubating/account/js/src/auth.ts`, `client/js/src/telemetry.ts`.
- A subprocess search of `cli/src` found only `xdg-open` and `pass`.

**Classification (source and evidence):**

| Class                          | Claims                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Observed from the binary       | version string; sha512; files and modes written ([E3I]); `version` reaching the network                                                                                                                                                                                                                                                                                        |
| Source correspondence          | §0.1–0.7; the §3 command table; pass's two exports (`GPG_TTY`, `GIT_CEILING_DIRECTORIES`) and the values they derive to (§7)                                                                                                                                                                                                                                                   |
| Source-derived hypothesis      | `Bun.spawn` resolving `pass` via the child `PATH` only; ENOENT on `xdg-open` leaving the URL on the PTY; GnuPG helpers located without `PATH`; `USER`/`LOGNAME`/`SHELL` not needed; the runtime values of pass's two exports inside live pass/gpg processes (fixed by source plus on-host preconditions; directly observed only if the supplementary `/proc` read catches one) |
| Requires Hotel-Echo validation | everything tagged [VALIDATE], every A/E/L/K/P/N/J row, the installed pass's two `export` lines, and `tty` absence                                                                                                                                                                                                                                                              |

**Remaining validation requirements:** every item in the last row above is
unvalidated. In addition, still to be established by later sessions:

- the `future-default` key parameters;
- the GnuPG agent's lifecycle under a system unit, including whether a
  `gpg-agent`/`keyboxd` stays resident after a unit stops, and, per daemon, its
  final executable path, its parent (`PPid`) and its cgroup. These fill the
  `auth-login` resident-agent rules; none is observed yet;
- remote-revocation coverage of CLI sessions;
- the Ubuntu 26.04 `adduser` behaviour.

Resolved by E3J9C (§17.1): the Hotel-Echo util-linux is 2.41.3 with `--close`.
Resolved by E3J9C-R (§3): the installed `pass` versus upstream 1.7.4, now an exact
acceptance rule. Its host re-verification before M2 stays read-only work for the
continuation.

New host items from E3J9C-R, all **[VALIDATE]**:

- `dpkg -V pass`;
- the final chain targets of the curated links;
- `/usr/bin/setpriv` present and accepting user names;
- uutils `env` preserving an empty argv element;
- uutils `install /dev/null` creating an empty file;
- GnuPG under `PrivateNetwork=yes`;
- journald attaching `_SYSTEMD_INVOCATION_ID` to a service's stdout records. The
  `probe` operation reads nothing, and so fails closed, if it does not;
- systemd's `stop`/`reset-failed` behaviour for a transient unit that is already
  unloaded. The cleanup treats "no longer loaded" as clean, and any other failure
  as a cleanup failure.

**Other sources:**

- **pass 1.7.4:**
  https://git.zx2c4.com/password-store/plain/src/password-store.sh?h=1.7.4 (sha256
  `b48d710a…bcd7`; `cat` at lines 89, 261, 278; `reencrypt_path` uses `sed`, `sort`,
  `head`, `mv`; exports `GPG_TTY="${GPG_TTY:-$(tty 2>/dev/null)}"` and
  `GIT_CEILING_DIRECTORIES="$PREFIX/.."`). No `src/platform/linux.sh` exists at 1.7.4.
- **util-linux `flock(1)`:** https://man7.org/linux/man-pages/man1/flock.1.html.
  Command form forks and the parent holds the lock. `-o, --close`: "Close the file
  descriptor on which the lock is held before executing command. This is useful if
  command spawns a child process which should not be holding the lock". `-F,
--no-fork` is incompatible with `--close`. Also `-n`, `-w`, `-E`. The local
  reference is util-linux 2.39.3; the Hotel-Echo version is **[VALIDATE]** in
  E3J9C.
- **coreutils `env(1)`:** `-i, --ignore-environment`: start with an empty
  environment.
- **GNU Bash manual (Shell Variables):** bash sets `PWD`, `SHLVL` and `_` itself.
  Together with pass's two exports, this is why §7 bounds descendants to a permitted
  union with expected values rather than the exact twelve.
- **GnuPG:** OpenPGP-Key-Management (`--quick-generate-key`, `--passphrase ''`);
  GPG-Esoteric-Options (`--pinentry-mode`); GPG-Configuration-Options;
  Invoking-GPG_002dAGENT; Invoking-gpgconf; whats-new-in-2.1 (`GPG_AGENT_INFO`
  ignored).
- **systemd:** `systemd.exec` (environment variables set for services,
  `WorkingDirectory=`, `UMask=`, `StateDirectory`/`CacheDirectory` (the reason they
  are not used, §8), `ProtectHome`, `PrivateNetwork`);
  `systemd.kill` (`KillMode=control-group`); `systemd.service`
  (`RemainAfterExit=`); `systemd-run` (`--pty`, `--uid`, `--setenv`, `-p`).
- **Debian/Ubuntu adduser:**
  https://manpages.debian.org/testing/adduser/adduser.8.en.html (re-confirm against
  Ubuntu 26.04 in E3J9C).

## 17. E3J9C execution record (2026-09-24) — STOPPED at the M1 `pass` comparison

**Outcome: STOPPED, not passed.** The installed `/usr/bin/pass` differs from upstream
1.7.4 beyond the platform line, which §3 and §14 make a stop condition ("stop and
re-derive this table"). M1 alone was completed. **M2–M10 were not performed, and no
A, E, L or K acceptance test ran on the host.** Nothing was retried, weakened or
rolled back. Dates are local (2026-09-24); the Hotel-Echo clock read
2026-09-25 ~05:03 UTC.

**Authorization:** E3J9C M1–M10 only. E3J9D, authentication, any Proton CLI
execution (even `version`/`help`), provider contact, reboot, deployment, scheduling
and activation were all excluded.

### 17.1 Preflight (read-only)

- **Repository:** `main`, `HEAD` = `origin/main` =
  `c99598e74f46f429bc00484b1ca7bd79c9e65e8b`, index empty, only the unrelated
  roster-design directory untracked (not opened).
- **External plan:** both copies under `~/.claude/plans/` have SHA-256
  `d3575941…afc9c` and are byte-identical.
- **H0 identity gate** (SSH over the established Tailscale path): hostname
  `hotel-echo`; the archived identity marker matched (no address printed); `utiz`
  uid/gid 1000, `HOME=/home/utiz`.
- **Collision checks:**
  - no `eanhl-cloud` user or group (`getent` rc 2);
  - every literal §2 target path absent;
  - no `eanhl-cloud*` unit or template;
  - no linger file.
- **Proposed ids:** adduser allocates the first free id from 100, so uid 104 and
  gid 107. Each owns 0 objects on `/` and `/tmp` (count-only scan).
- **`pass`:** not installed; candidate 1.7.4-8.
- **Tooling [VALIDATE] resolved:**
  - `/usr/bin/flock` is util-linux **2.41.3** and supports `--close`, `--nonblock`,
    `--wait` and `--conflict-exit-code`.
  - `/usr/bin/env` is **uutils coreutils 0.8.0** (a symlink into
    `/usr/lib/cargo/bin/coreutils/`, multicall). A read-only test as `utiz` showed
    that `env -i` keeps empty values and passes `--batch -x -- -i` after the
    command verbatim. E1(b) would still be the deciding check.
  - Curated targets `mkdir`, `dirname`, `base64`, `rmdir`, `cat` (and `uname`,
    `cut`, `tr`) resolve to that multicall binary. `rm` resolves to `gnurm`; the
    others are GNU.
  - `loginctl list-sessions` puts CLASS in column 6.
  - `sudo -n` worked for `utiz`, so no operator password was involved.
- **Upstream basis:** `password-store.sh@1.7.4`, fetched from the public source
  host. Its SHA-256 is `b48d710a…bcd7`, equal to §3.

### 17.2 Repository templates (Phase 1)

Written under `ops/backup/credential/`: both manifests, `credential-exec`,
`eanhl-cloud-credential`, `gpg.conf`, `README.md`, and `validation/` (probe script
and unit template, `env-inspect`, `lockhold`, `pty-marker`, `owned-inventory`). The
optional `.mjs` test was **not** added: it would need `ENV_ALLOWLIST` exported. C1
is not implemented.

**Local checks:**

- `bash -n` passes on all seven scripts.
- `systemd-analyze verify` reports only that the executable is not installed.
- A scratchpad harness (not committed) passed **93/93**. It covered:
  - the manifest ⇔ wrapper ⇔ `env-inspect` ⇔ probe literals, in order;
  - the manifest being a subset of `ENV_ALLOWLIST` plus the two `PROTON_DRIVE_*`;
  - command-form `flock --close`, with no `--no-fork`;
  - `env -i` used once, with no expansion in any literal;
  - `WorkingDirectory=` present, no `Environment=`, no `[Install]`;
  - in a sandbox with the real `flock`/`env` and decoys in the parent: the child's
    exec-time environment equals the twelve literals, arguments pass through, and
    the id/lock-mode/unknown-id refusals, the `pty-marker` nonce handling, 75 on
    `--nonblock` and `--wait`, and `--close` against a detached descendant all
    behave as designed;
  - `env-inspect` boundary and descendant rules, including empty `GPG_TTY`, the
    expected `GIT_CEILING_DIRECTORIES`, `PWD`, systemd names and never echoing the
    nonce;
  - the launcher's key-metadata parser against real gpg 2.4 colon field positions
    (confirmed with a throwaway key in a temporary local `GNUPGHOME`, since
    deleted), including the sanitiser;
  - the owned-inventory expected set;
  - a secret-marker scan.
- **E3J9C-R correction to this claim:**
  - that harness lived in scratch and was not reproducible from the repository;
  - it tested `env-inspect` only through its `stdin-*` modes, not the real
    `boundary` mode's parent/E2 checks;
  - it did not exercise the launcher flows, the probe canary, `lockhold`'s root
    modes, owned-inventory's scan or any unit.

  Its successor is the committed `ops/backup/credential/test/credential-templates.test.sh` (§18).

**Template choices a reviewer should check against this memo:**

- The probe carries helper modes that serve as K-test vehicles: `precheck`,
  `canary`, `canary-a`/`-b`, `lockhold-hold`/`-long`/`-detach` and `busy-a…d`.
- `env-inspect` adds the `stdin-*` and root-only `observe` modes.
- `lockhold` adds root-only `held`, `free` and `fdcheck` modes.
- The probe unit uses `RemainAfterExit=yes` (for K2/K3) and
  `After=`/`Wants=network-online.target` (for the provider modes).
- The E3 nonce is detected by a fixed `e3j9nonce` prefix, not handed to the probe.
- `env-proof` runs three units: boundary, canary and a supplementary observation.
- The provider modes and `auth-login`/`auth-logout` exist but were **never run**.
  Their failure-label anchors are hypotheses (§0.8).

### 17.3 M1 — package (the only host mutation)

- **Simulation** (`apt-get -s install --no-install-recommends pass`, run as `utiz`):
  - NEW: `pass` 1.7.4-8 (`all`) and its Depends `tree` 2.3.1-1;
  - 0 upgraded, 0 removed;
  - `gpg` stays on gnupg's 2.4.8-4ubuntu3.1 (`gpg-from-sq` was not selected);
  - Recommends not installed.
- **Install:** with `sudo`, no `apt update`, rc 0.
- **needrestart:** listed deferred restarts only. `docker`, `containerd`,
  `systemd-logind`, `networkd-dispatcher`, `unattended-upgrades` and `dbus` kept
  their 2026-09-03/09 start times, and the three web/worker/db containers stayed up
  (2–3 weeks). PackageKit was started on demand by apt.
- **Installed file:** `/usr/bin/pass` is root:root 0755, 25 821 bytes, SHA-256
  `b0da432e8d377a67c7a74a9111c6b32889cce62f6e4f506a7bbdba817a268632`. That is
  byte-identical to the main PC's Ubuntu `pass` 1.7.4-6 (E3J9C-R confirmed this by
  a full SHA-256 of the main-PC `/usr/bin/pass` and its dpkg md5sum). The package also created
  `/usr/lib/password-store/extensions/` (root-owned, empty).

**Comparison with upstream 1.7.4** (upstream line → installed line):

| Upstream | Change                                                             | Where                                   | On a path this design exercises?                                                                                                                             |
| -------- | ------------------------------------------------------------------ | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 249      | platform `source` line removed                                     | top level                               | documented difference; **the conditional `uname`/`cut`/`tr` trio is not needed**                                                                             |
| 297      | `${EDITOR:-vi}` → `${EDITOR:-editor}` in help text                 | `cmd_usage` heredoc                     | text only (usage is printed by `cat`)                                                                                                                        |
| 405, 417 | `tree … 3>&-`                                                      | `cmd_show` directory branch, `cmd_find` | no (directory `show` and `find` are excluded, §3)                                                                                                            |
| 503, 509 | `${EDITOR:-editor}`                                                | `cmd_edit`                              | no (`edit` excluded)                                                                                                                                         |
| 679      | `SYSTEM_EXTENSION_DIR=""` → `"/usr/lib/password-store/extensions"` | `cmd_extension`                         | no: reached only through the `*)` fallback; `init`/`show`/`insert`/`rm` dispatch explicitly (installed lines 705–714). The directory is root-owned and empty |

- The two `export` lines and the `PREFIX` line each appear exactly once, verbatim,
  so `pass_exports_match_upstream` would be `true`.
- **Assessment only, not a decision:** none of the six extra lines is on an exercised
  path, and the §3 command inventory would be unchanged. Accepting the Debian
  packaging delta, and pinning the installed hash, needs a design revision.
- **E3J9C-R correction:** one changed line **is** on an exercised path. The usage
  heredoc's `${EDITOR:-editor}` (H2) is printed by the A10 `neg-uninit` error path;
  it is text only and runs no command. E3J9C-R made the design revision: §3 now
  holds the full reachability table and the exact acceptance rule.

### 17.4 Not performed

- **Host steps:**
  - M2 identity and M3 directories;
  - M4 curated `PATH` and M5 wrapper/launcher;
  - M6 CLI (the main-PC source binary was not read, hashed or transferred);
  - M7 validation tooling/unit and `daemon-reload`;
  - M8 key and `gpg.conf`, M9 `pass init`;
  - M10 proofs.
- **Acceptance tests not run:** A1–A10, E1–E3, L1–L2 and K1–K6. The
  supplementary `/proc` observation did not run either.
- **Never done:** the Proton CLI was never executed; there was no Proton contact,
  no authentication, and no URL, token or session. There was also no reboot,
  deployment, timer, schedule, unit enablement or E3 activation.

### 17.5 Rollback surface and next step

- **Rollback (not authorized, not performed):** `apt-get -s remove pass`, reviewed
  for the auto-installed `tree`, then removal.
- **Remaining uncertainty:**
  - the uutils `env`/coreutils behaviour of the curated commands under pass;
  - the keybox vs keyboxd layout;
  - acceptance of the transient-unit property set by systemd 259;
  - everything tagged [VALIDATE].
- **Next:** a design revision that re-derives §3 against the installed 1.7.4-8
  (accept or reject the Debian delta; record the installed SHA-256), then a new
  E3J9C authorization continuing from M2. **E3J9D stays blocked**: on D1, and now
  also on E3J9C passing.
- **E3J9C-R update:** the rollback removes **both** `pass` and `tree` (M1 installed
  both), without `autoremove` (§12). The design revision is done (§18). What
  remains is the review of E3J9C-R, then a new authorization to continue from M2.

## 18. E3J9C-R correction record (2026-09-25) — local only

**Outcome:** the design and templates were corrected and verified locally. E3J9C
itself **has not passed**, and nothing changed on Hotel-Echo: `pass` and `tree`
stay installed as the partial host state, M2 and every later step remain
unperformed, and resuming at M2 needs a new, explicit authorization after this
correction has been reviewed. U1/E3J9 are open; D1 gates E3J9D; D7 gates E3J9E;
C1 gates CLI-executing or provider-contacting E3J10 steps; E3 is unactivated. No
Gate checkbox changed.

**Scope and prohibitions honoured:**

- No SSH or Hotel-Echo access; no Proton CLI, provider or network contact.
- No `pass`, GPG, credential, key, account, package, unit, Docker, database,
  deployment, scheduling or tunnel action.
- No staging, commit or push.
- `docs/design/roster-stats-design/` was not opened.

**Evidence.** The saved E3J9C artifacts were re-authenticated before any edit:

- upstream `password-store.sh` 1.7.4: `b48d710a…bcd7`;
- the installed `pass` copy: `b0da432e…8632`;
- the scratch harness: `89a5df5b…82b3`.

A full `diff -u` gave exactly hunks H1–H7 (§3). The main-PC `/usr/bin/pass`
(1.7.4-6) hashed to `b0da432e…8632` and matched its dpkg md5sum.

**Corrections** (each is recorded in place in the section named):

| Area                                 | Correction                                                                                                                                                                                                                                                                                  |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pass` acceptance (§3, §7, §11, §14) | Exact rule: package, full SHA-256, hunks H1–H7 and an empty root-owned extension directory; anything else is a STOP. Deterministic, whitespace-clean escaped manifest `pass-1.7.4-8.accepted-delta.escaped`. The H2 usage text is reachable but text only; the trio is dropped              |
| Environment boundary (§0, §7, §9)    | `bash -p` on every script; the stated limits cover the dynamic loader and code already running as `eanhl-cloud`; the argv bound is the launcher's fixed argv                                                                                                                                |
| Wrapper and lock (§4)                | Lock-file pre-check; exit-75 ambiguity; stop window corrected and made an E3J10 blocker; `--wait` proven locally only                                                                                                                                                                       |
| Launcher exit status (§4)            | Every subcommand exits 0 only when every operation and postcondition succeeded; `present`/`absent`/`error` presence checks                                                                                                                                                                  |
| systemd (§2, §8)                     | No `StateDirectory=`/`CacheDirectory=`; `PrivateNetwork=yes` for local units; network ordering only for units that start the CLI; the `--setenv` exception stated                                                                                                                           |
| Probes (§8, §11)                     | `local:`/`provider:` separation; the invocation-bound `probe` operation with cleanup as part of the result; a provider-only unit template with no raw journal recipe; fail-closed counts; sanitised `emit`; `secondary` rejects `..`; provisional N1/N2 anchors; the E4/N4 vehicle deferred |
| Authentication (§6)                  | Fail-closed, metadata-only `auth-login` preflight with structured resident-agent rules (executable, uid, PPid, cgroup; at most one each), empty until M8/L2 evidence; 900 s timeout                                                                                                         |
| Key and store (§5)                   | `keygen` requires the empty M3 GNUPGHOME and checks the resulting key topology; `gpg.conf` installed as `eanhl-cloud`; the A9 wording; recovery/rotation deletes the old key before `keygen`                                                                                                |
| Rollback (§12)                       | Current-state rollback is `pass` + `tree` with no `autoremove`; `entry-remove`, `canary-remove`, `key-delete` with postconditions; deletions as `eanhl-cloud`; `owned-inventory` with no-process preconditions in both modes; `expect-none` from a temporary path; added scan roots         |
| Curated commands (§3, A1/A2)         | Symlink-chain evidence (final target, package, every hop)                                                                                                                                                                                                                                   |
| Records (§17)                        | Harness claim qualified; H2 reachability corrected; main-PC identity confirmed by a full hash                                                                                                                                                                                               |

**Defect found during implementation.** The approved plan expected 7 unified-diff
hunks, but GNU diffutils merges H5 and H6 into one hunk with 3 lines of context.
The artifact and tests use the correct counts: 6 unified hunks, 7 plain-`diff`
change blocks, 13 changed lines.

**Second correction pass (in place, same day).** A review found seven defects
that the first harness did not cover:

1. The raw `.diff` artifact failed `git diff --no-index --check` (whitespace-only
   context lines, space-before-tab). It is replaced by the escaped manifest
   (§3), decoded and compared byte-for-byte (`cmp`); there is no `.gitattributes`
   exemption.
2. Several launcher subcommands printed a failed result but exited 0:
   - `auth-logout` ignored the unit result;
   - `pty-marker` exited 0 with `invalid` or non-zero journal hits;
   - `env-proof` did not aggregate its steps;
   - `keygen` printed metadata without checking the topology;
   - `pass-init` printed false postconditions;
   - `key-delete` printed the remaining key count without checking it;
   - a failed presence check read as "absent" (`svc_meta` empty).

   All now exit non-zero (§4).

3. Probe cleanup was not part of the result. A failed keep-mode probe was
   retained, cleanup failures were not reported, and `probe-stop` ignored the
   reset. Corrected (§11).
4. The preflight read only the executable and uid, although the design described
   uid, PPid and cgroup. Structured rules are now implemented, and the rule list
   stays empty (§6).
5. `owned-inventory`'s default mode checked only units. Both modes now require no
   service-identity process (§11).
6. The provider template's comment suggested a raw `journalctl -o cat` read. It
   is removed, and E3J9D/E must first supply a reviewed invocation-bound reader.
7. `lockhold free` and `fdcheck` exited 0 on a false result; they now exit
   non-zero.

**Third correction pass (in place, same day).** `svc_exists` used
`[ -e ] || [ -L ]`, which reports an object under an inaccessible parent as
`absent`. This was reproduced with a real mode-000 parent. The presence proof is
replaced by the listing-based, root-anchored proof described in §4. Its call
sites (`auth-logout`, `entry-remove`/`canary-remove`, the store and `.gpg-id`
checks in `key-delete`, and the revocation-file check after deletion) now pass
fixed relative contract paths, bound at startup to the absolute constants, and
fail non-zero on `error`. New genuine-filesystem regressions cover:

- a present object, and a dangling symlink (`present`);
- an absent object under traversable parents, and a missing intermediate
  directory (`absent`);
- parents with mode 000 and mode 100 (`error`, never `absent`);
- an intermediate symlink or regular file (`error`);
- 12 malformed paths, refused in the launcher and in the script;
- `auth-logout`, `entry-remove` and `key-delete` failing when their lookup is
  indeterminate.

Three mutations that remove the access-error distinction are caught.

**Files:**

- Templates:
  - 9 changed: `credential-exec`, `eanhl-cloud-credential`,
    `credential-bin.manifest`, `README.md`, and in `validation/` the probe,
    `env-inspect`, `lockhold`, `owned-inventory` and `pty-marker`;
  - 2 unchanged: `credential-child-env.manifest`, `gpg.conf`;
  - `validation/eanhl-cloud-credential-probe@.service` replaced by
    `validation/eanhl-cloud-credential-provider-probe@.service`;
  - 2 new: `pass-1.7.4-8.accepted-delta.escaped` (it replaces the first pass's
    `pass-1.7.4-8.accepted.diff`, which is removed) and
    `test/credential-templates.test.sh`.
- Docs: this memo, `HANDOFF.md`, `docs/journal/2026-09.md`, `ops/README.md`.
- Outside the repository: both plan copies carry an identical Revision 4 section,
  regenerated in the second pass. Their SHA-256 is
  `3d4d2b23821808cf4ed0e6c44428576e56aaa40f7a92d67a6e18ae5c351e7f3c`; their first 68 765 bytes still hash to revision 3
  (`d3575941…afc9c`).

**Verification (local only, after the third pass):**

- `E3J9_PASS_UPSTREAM=… E3J9_PASS_INSTALLED=… bash ops/backup/credential/test/credential-templates.test.sh`:
  **308 checks declared, 308 passed, 0 failed; 24 of 24 mutations killed**. The
  mutations weaken:
  - `bash -p` and the lock pre-check;
  - the probe count and `..` checks;
  - the store-scan and journal failure handling;
  - the invocation-ID match and the first-line rule;
  - the resident-agent cgroup, parent and per-process rule checks;
  - the `keygen`, `pass-init`, `auth-logout`, `key-delete`, `pty-marker` and
    `env-proof` postconditions and exit statuses;
  - the probe and `probe-stop` cleanup results;
  - the `lockhold` symlink check and the `owned-inventory` process precondition;
  - the `svc_exists` access-error distinction (a failed `cd`, a failed listing,
    and a revert to `[ -e ] || [ -L ]`).

  `--static-only` passes 304 checks with the same 24 mutations, and reports the
  delta regeneration as not run. Running with neither input nor flag refuses
  (exit 2).

- `bash -n` passes on all 8 shell files. `systemd-analyze verify` of a scratch
  instance of the provider template reports only the not-installed executable.
- `git diff --no-index --check /dev/null <file>` is clean for every untracked
  file. Targeted Prettier and `git diff --check` pass.

**What the local tests do not prove:** any Hotel-Echo behaviour (units, uutils,
GnuPG, systemd 259, journald invocation IDs, cleanup of unloaded transient units,
resident-agent parents or cgroups), dynamic-loader isolation, or protection
against code running as `eanhl-cloud`. Every **[VALIDATE]** item stays open (§16).

## 19. E3J9C continuation (2026-09-26) — PASSED for the credential-foundation and local-proof scope

**Outcome: E3J9C PASSED — for its credential-foundation and local-proof scope
only.** M2–M7 were completed and verified. M8 first stopped on a launcher
working-directory defect (§19.5); after that correction was installed, M8 and
M9 passed. M10's first run stopped on a probe vocabulary defect (§19.6); after
that correction was installed, M10 was rerun from the beginning, one step at a
time (§19.8): A1–A5 and A10 passed, and A6 was recorded as indeterminate from
the agent's PTY capture until the operator performed the required direct PTY
observation, which passed. The remaining rows then passed (§19.9): A7, A8,
E1(a), E1(b)–E3, L2, K1–K6 and owned-inventory (A9 passed at M9). This does
**not** close U1 or E3J9: persistence, reboot and lifecycle validation
(E3J9E), the operator ceremony (E3J9D) and provider behaviour remain unproven.

**History within this session:** two earlier attempts at M3 were refused by
the calling agent environment's auto-mode permission classifier ("Remote Shell
Writes") before any command reached the host. That was a local tool control,
not a §14 condition, and was not routed around. The operator then installed a
Claude Code permission rule for `ssh hotel-echo`, and the run resumed at M3.

**Network boundary:** the preflight fetched the public upstream
`password-store.sh@1.7.4` and the public Ubuntu `pass_1.7.4-8_all.deb`. The
Proton CLI was copied from the main PC. **There was no Proton or provider
contact, and the CLI was never executed.**

### 19.1 Preflight (read-only)

- Repository: `HEAD` = `origin/main` =
  `835b3ece652a12ee235f0b10ff7bbd4c80699ba0`, index empty, templates
  unmodified; unrelated user-owned paths left unopened.
- Local harness **308/308, 24/24 mutations killed** against the fresh
  upstream (sha256 `b48d710a…bcd7`) and the package-extracted `/usr/bin/pass`
  (`b0da432e…8632`, re-diffed to exactly H1–H7).
- Hotel-Echo: hostname `hotel-echo`, `utiz` uid/gid 1000. `pass` `1.7.4-8`,
  on-host sha256 `b0da432e…8632`, root:root 755, 25 821 bytes, `dpkg -V`
  clean, `export`/`PREFIX` lines verbatim, extension directory root-owned and
  empty; `tree`'s only reverse dependency is `pass`; the apt history holds
  only M1 plus unrelated unattended upgrades. `flock` util-linux 2.41.3,
  `env` uutils 0.8.0, `setpriv` present, systemd 259, Ubuntu 26.04.1 LTS,
  `adduser` 3.153ubuntu1; uutils `install /dev/null` gives an empty 0600 file
  (throwaway path, removed).

### 19.2 M2 — identity

`adduser --system --group --home /var/lib/eanhl-cloud --no-create-home
--shell /usr/sbin/nologin eanhl-cloud` → uid 104, gid 107 (as predicted).
`passwd -S` = `L`; `id -G` = `107` only; `nologin`; no linger; no sudoers
reference. Re-verified unchanged before M3, with no `eanhl-cloud` process or
unit and every M3 path absent.

### 19.3 Staging and source verification

- M6 source: the design's "byte-identical pinned file from the main PC".
  `~/.local/bin/proton-drive` there is 117 946 496 bytes, SHA-512 = pin
  (`cf61c268…ccaa28`); hashed, never executed.
- `utiz`-owned `~/e3j9c-stage/` (0700) on Hotel-Echo holds the committed
  templates, a `local.sha256` list generated from `HEAD`, and
  `proton-drive.src`. Before M3: no symlinks, every entry `utiz`-owned,
  `sha256sum -c` OK for all 11 template files, `proton-drive.src` SHA-512 =
  pin at the same size.

### 19.4 M3–M7 (host mutations, verified)

- **M3:** the README's exact `install -d` block and lock-file `install`. Result:
  `/var/lib/eanhl-cloud` and `gnupg`, `password-store`, `config`, `data`,
  `locks` directory eanhl-cloud 0700; `locks/credential.lock` regular empty
  file eanhl-cloud 0600; `/var/cache/eanhl-cloud` eanhl-cloud 0700;
  `/opt/eanhl-cloud`, `bin`, `credential-bin`, `/usr/local/lib/eanhl-cloud`,
  `validation` root 0755. Exactly 6 entries under the home, 0 in the cache.
- **M4 / A1 (pass):** 12 root-owned links, inventory exactly the manifest
  (sha256 `4e37a1c6…0c46`), directory root:root 0755, each `readlink` equal to
  its target. Final targets and packages: `bash`, `getopt` (util-linux),
  `gpg` (gpg; not the `gpg-from-sq` alternative), `pass`, `grep`, `find`
  (findutils) are root 0755 regular files in `/usr/bin`; `mkdir`, `dirname`,
  `base64`, `rmdir`, `cat` → `/usr/lib/cargo/bin/coreutils/<name>`
  (rust-coreutils); `rm` → `/usr/bin/gnurm` (gnu-coreutils). Every hop is
  root-owned; the only non-final hops are the root-owned `/usr/bin` symlinks.
  This inventory is the A1 baseline; any later change is a STOP.
- **M5 / M7:** installed from staging; installed sha256 equal to the
  repository file, owner and mode as specified:
  `credential-exec` root 0755 `19fd0828…a3f9`; `eanhl-cloud-credential` root
  0750 `be14bb2e…fe32`; validation `eanhl-cloud-credential-probe.sh`
  `db790d59…5874`, `env-inspect` `2f8f6355…6f9a`, `lockhold` `8780ceee…0b36`,
  `pty-marker` `dba7b014…98fe`, `owned-inventory` `436eed44…ee5a` (root 0755).
  No unit file is installed in E3J9C (§10 M7), so no `daemon-reload` was
  needed; no `eanhl-cloud` unit file exists.
- **M6 / A7 (pass):** `install -T` to `.proton-drive.new`, `mv -T` to
  `/opt/eanhl-cloud/bin/proton-drive`; SHA-512 = pin at source, temp and final
  path; root:root 0755, 117 946 496 bytes; `bin/` holds only that file.
  **Never executed.**

### 19.5 STOP at M8 — launcher working-directory defect

`sudo /usr/local/sbin/eanhl-cloud-credential keygen`, invoked from the
operator's home as the README's "run from a checkout" implies, printed
`E3J9 launcher_refused=gnupghome_unreadable` and exited 70. `svc_meta` had
passed; `svc_count`'s `setpriv … find <GNUPGHOME>` failed. Read-only
reproduction against the empty directory: run as `eanhl-cloud` from
`/home/utiz` (utiz 0750), GNU `find` exits 1 with "Failed to restore initial
working directory"; from `/` it exits 0. The launcher never changes to a
directory the service identity can access before its `setpriv` reads, so
every `svc_count` (keygen, pass-init, key-delete paths) depends on the
caller's working directory. It fails closed, never open, but the templated
flow cannot complete as documented. The local harness did not catch it
because `setpriv` and `find` are stubs there.

Not done on the host: running from `/` (a workaround, not the documented
procedure) or patching the installed template.

**Correction (same day; local, reviewed, then installed — §19.6).** Audit of every
privilege drop: the launcher's `as_svc` (six call sites — `svc_meta`,
`svc_exists`, `svc_count`, the `.gpg-id` read, the preflight `flock` and
`key-delete`'s revocation-file `rm`), `lockhold`'s `lock_free`, and the
README's three operator commands (M8 `gpg.conf`, A2 `test -w`, rollback
`find … -delete`). The design memo holds no executable `setpriv` command. The
probe, `env-inspect` and `pty-marker` run inside units with
`WorkingDirectory=/var/lib/eanhl-cloud`; `owned-inventory` and
`env-inspect observe` run as root without dropping privileges — not affected.

- `as_svc() ( cd / || exit 70; exec "$SETPRIV" … -- "$@" )`: a function-local
  subshell enters `/`, then execs setpriv (no extra shell after the drop);
  argv, redirections and exit status pass through; failing to enter `/`
  exits 70 without running setpriv.
- `lock_free` keeps its pre-open symlink/regular-file checks, then runs
  `( cd / || exit 70; exec "$SETPRIV" … flock … )`; exit 75 is preserved.
- README commands now read `( cd / && sudo /usr/bin/setpriv … )`; M8's
  `< gpg.conf` sits outside the group, so the checkout file is opened before
  `cd /`. Paths and deletion scope unchanged.
- Harness: the `setpriv` stub records its physical cwd and exact argv, and
  (opt-in) refuses any cwd other than `/`. New regressions invoke `keygen`,
  `pass-init`, `as_svc` and `lock_free` from a private caller directory; check
  argv byte-for-byte, exit status (incl. 42 and 75), stdout/stderr, and the
  exit-70 fail-closed branch; assert every README/memo `setpriv` command uses
  the safe form; and run the README's M8 command in a sandbox (checkout
  `gpg.conf` copied, mode 0600, `set -C` still refuses). Two new mutations
  (removing either safe-cwd step) are killed.
- Evidence: against the pre-fix templates the final harness gives **312
  passed, 16 failed** (all 16 new regressions; the stricter stub refuses at the
  first drop, so pre-fix `keygen` refuses `gnupghome_wrong`). Post-fix: **326
  passed, 0 failed, 26/26 mutations killed** (stable over three runs);
  `--static-only` 322 passed; `bash -n` clean.
- Boundary: the local tests prove the templates enter `/` before a _stubbed_
  setpriv; the host behaviour is proven by §19.6 (`lockhold free` and M8/M9
  run from `/home/utiz`).

Post-stop state (read-only, as `eanhl-cloud` from `/`): GNUPGHOME 0 entries,
store 0 entries, home 6 entries, cache 0, lock still an empty 0600 file; no
`eanhl-cloud` process, unit or linger file. No gpg or pass command ran.

### 19.6 Reinstall, M8–M9, and the M10 stop

- **Pre-mutation checks** (identity, M1–M7 as in §19.4, the old launcher and
  `lockhold` hashes `be14bb2e…fe32` / `8780ceee…0b36`; no unit, service or CLI
  process, key, `.gpg-id` or session file) all matched. The staged launcher
  and `lockhold` were the stale bytes and were not used.
- **Reinstall (only these two files):** working-tree bytes transferred into
  `~/e3j9c-stage/corrected/`, hashes checked before and after transfer,
  installed with `install -T` to a temporary name, re-hashed, then `mv -T`:
  - `/usr/local/sbin/eanhl-cloud-credential` — regular file (not a symlink),
    root:root 0750, 40 919 bytes, sha256
    `dff64fa17599c705fe602d69646e8d20b2e1d727b236931298f2b24d2f37eecf`;
  - `/usr/local/lib/eanhl-cloud/validation/lockhold` — regular file, root:root
    0755, 5 774 bytes, sha256
    `4af4ad4a6b6ed22190a70c7cfc7e2d9550fcb3e74a82b7744df8b3d94e4e6991`.
- **Former failure context:** from `/home/utiz` (0750), `lockhold free` gave
  `lock_free_nonblock=true`, and M8 `keygen` reported
  `gnupghome_entry_count_before=0` — past the old `gnupghome_unreadable`
  refusal.
- **M8 (pass):** `keygen` from `/home/utiz`: ed25519 sign/certify primary,
  cv25519 encryption subkey, one secret key, one UID matching, no expiry,
  secret parts present, `keygen_postconditions_ok=true`. `gpg.conf` installed
  with the README safe-cwd command: regular file, eanhl-cloud 0600, bytes equal
  to the repository. Fingerprints are public metadata but were not recorded;
  M9 took the fingerprint from the `openpgp-revocs.d/<FPR>.rev` file name,
  listed as `eanhl-cloud` without reading contents.
- **M9 (pass), including A9:** `pass-init`: store directory correct and empty
  before (`store_entry_count_before=0`), key match, `.gpg-id` 0600 holding
  exactly the fingerprint, no other entry.
- **Resident processes:** after `keygen`, `pass-init` and every probe, no
  `eanhl-cloud` process and no active `eanhl-cloud-*` unit (so no resident
  `gpg-agent`/`keyboxd` survived its unit; the resident-agent rule list stays
  empty).
- **M10 passed:** A1 (inventory, targets, final paths unchanged); A2 (25
  paths, each `test -w` as `eanhl-cloud` exit 1, every final target root-owned
  and not group/world-writable); A7 (CLI SHA-512 = pin, not executed); A8
  (`lock_free_nonblock=true`); E1(a) (installed wrapper sha256 = repository).
- **M10 STOP — probe vocabulary defect.** `probe precheck`, `probe local` and
  `probe neg-uninit` each reported `probe_failures=0` and `probe_result=pass`,
  with every environment, identity, opener, `tty`, pinentry and canary check
  true (`local`: canary insert/show/match/`rm -f` and removal true; absent-entry
  and uninitialised-store anchors true). But the launcher counted
  `bound_nonvocab_lines=1` per run and classified `probe_run_result=fail`
  (exit 1) — a §11 STOP. A metadata-only read of the `precheck` unit's record
  (no message text) showed one 34-character stdout line from the probe
  process, starting `E3J9`. Cause, from the repository: probe line 247 emits
  `pass_script_sha256_match`, the only emitted name with digits, while the
  launcher's `VOCAB` is `^E3J9 [a-z_]+=…`; §11 specifies both. The length is
  consistent with the value `true`, but that is not accepted as a result. The
  harness missed it because probe output and the journal are stubbed there.
  The second and third probes were run past the first failure (one loop,
  evaluated afterwards); both were in-scope local probes, cleaned up, and
  `local` removed its canary.
- **Final host state:** key and `gpg.conf` present; store holds only `.gpg-id`
  (no canary); lock an empty 0600 file; no `eanhl-cloud` process, unit or
  linger; no session, data, cache or CLI-log files; CLI never executed.

### 19.7 Local probe-vocabulary correction (not installed) and next step

On the host: M1–M9 and the corrected launcher and `lockhold`.
`~/e3j9c-stage/` (including `corrected/`) is **retained** because M10 did not
pass. Not accepted or not run: A3–A6, A10, E1(b)–E3, L1–L2, K1–K6 and
owned-inventory. **E3J9C remains stopped and not passed.**

**Local correction (same day, no host or provider action).**

- The probe's `check_commands` now emits `pass_script_hash_match` (§3, §7,
  §11 and the README updated). The internal function keeps its accurate name
  `pass_script_sha256_match()`; it is never emitted. The launcher's vocabulary
  is unchanged (not widened).
- Why the harness passed the defect: its extractor's class `[a-z_"${}]+`
  stopped at the first digit, so the name was read as `pass_script_sha`, and it
  skipped every quoted (so every dynamic) name. It is replaced by a check of
  the complete first token of every production `emit`/`expect`/`emit_count`
  call and every literal `printf 'E3J9 <name>='` in all seven templates:
  literals must match `^[a-z_]+$`; the 17 dynamic names must use a placeholder
  enumerated per file (`${label//-/_}`, `${last}`, `${p}`, and the probe's two
  `"$1"` forwarders), each expansion is checked, and the enumerations are tied
  to the source; anything else fails as unenumerated. Fixture tests prove a
  digit name is reported in full, quoted and unenumerated names are reported,
  and comments are ignored. A runtime test runs the probe's real `emit`, `tf`,
  `expect` and `check_commands` (predicates stubbed) and requires all five
  records to match the launcher's own `VOCAB`. Two mutations restoring the old
  name (static and runtime) are killed. No other emitted name violates the
  grammar.
- Evidence: against the unfixed probe, **335 passed, 4 failed** (the four new
  regressions); fixed, **337 passed, 0 failed, 28/28 mutations killed**,
  including the accepted-delta regeneration (stable over three runs);
  `--static-only` 333.
- **Execution discipline:** the earlier M10 run started `local` and
  `neg-uninit` after `precheck` had failed, because the three probes ran in one
  loop and were evaluated afterwards. The README now requires one probe (or
  other acceptance step) at a time, evaluated completely, stopping before the
  next on any failure. No code change compensates for this.

Next (done, §19.8): the corrected probe was reviewed, reinstalled alone and M10 rerun from the beginning, one step at a time.

### 19.8 Probe reinstall and M10 rerun (stopped at A6)

- **Preconditions (all matched):** identity; no `eanhl-cloud` process, unit or
  CLI process; M8 metadata (one revocation file, two private-key files, one
  keyring, `gpg.conf` 0600); M9 store holding only `.gpg-id` (0600, one line);
  no session, Proton entry, data, cache or CLI-log file; installed probe
  regular root:root 0755, not a symlink, sha256
  `db790d59d39d3ada58829a903e4588d99a1c5be460d23bff5faced18ea415874`; launcher
  `dff64fa1…`, `lockhold` `4af4ad4a…`, wrapper `19fd0828…` unchanged.
- **Reinstall (only the probe):** transferred to
  `~/e3j9c-stage/corrected/eanhl-cloud-credential-probe.sh`, hash checked,
  `install -T` to a temporary name, re-hashed, `mv -T` into place. Final:
  `/usr/local/lib/eanhl-cloud/validation/eanhl-cloud-credential-probe.sh`,
  regular file, not a symlink, root:root 0755, 16 790 bytes, sha256
  `7a5807bf260f9d3ddb9d5696743101a16232dee131a3df20bfa4121aca50d6cb`.
- **M10 rerun, one step at a time, each evaluated before the next:**
  1. **A1 pass:** 12 links, inventory and targets exact, final chain targets
     unchanged and root 0755, manifest sha256 equal.
  2. **A2 pass:** 25 paths, each `test -w` as `eanhl-cloud` exit 1 (safe-cwd
     form); every final target root-owned, not group/world-writable.
  3. **`probe precheck` pass (A3, A4, E2 helpers):** `probe_run_result=pass`,
     `bound_nonvocab_lines=0`, `pass_script_hash_match=true`, every
     environment/identity/`tty`/opener/pinentry check true.
  4. **`probe local` pass (A5/L1, A10 absent entry):** canary insert, show,
     match and `rm -f` true, removal verified, absent-entry anchor present,
     `probe_run_result=pass`.
  5. **`probe neg-uninit` pass (A10):** uninitialised-store `insert` non-zero
     with its anchor, no `command not found`, `probe_run_result=pass`.
  6. **A6 STOP — indeterminate.** `pty-marker` through `ssh -tt`: the
     launcher reported `pty_marker_journal_hits=0`, `pty_marker_result=pass`,
     exit 0. The agent held the PTY stream only in memory (never displayed or
     stored) and counted marker lines: the stderr marker appeared once with a
     32-hex nonce, but the stdout marker line did not match the strict line
     pattern, and the launcher's `pty_marker_unit_rc` line was also absent
     from the parsed stream — the capture was altered or interleaved in a way
     that was not established. The capture was discarded by design, and
     re-running A6 would have been a retry, so A6's "nonce seen on the PTY"
     half is not proven.
     **Subsequently passed by operator observation:** the operator ran the
     installed `pty-marker` through `ssh -tt` and observed exactly one stdout
     and one stderr marker carrying the same valid 32-character lowercase
     hexadecimal nonce, `pty_marker_unit_rc=0`, `pty_marker_journal_hits=0`,
     `pty_marker_result=pass`, and SSH exit 0. **A6 passed.** The nonce is not
     recorded anywhere.
- **Processes:** after every step, no `eanhl-cloud` process and no active
  `eanhl-cloud-*` unit; no resident `gpg-agent`/`keyboxd`; the resident-agent
  rule list stays empty.
- **Final state:** store holds only `.gpg-id` (no canary); no session, data,
  cache or CLI-log file; lock an empty 0600 file; no linger; CLI never
  executed, no Proton contact. `~/e3j9c-stage/` (now with the corrected probe
  copy) is **retained**.

**Next (done, §19.9):** A6 was established by the operator's own PTY observation, and M10 continued from A7.

### 19.9 M10 completion from A7 (pass) and cleanup

Preconditions matched: identity; installed probe `7a5807bf…d6cb`, regular,
root:root 0755, not a symlink; no `eanhl-cloud` process, unit or CLI process;
store `.gpg-id` only (no canary or Proton entry); no session, data, cache or
CLI-log file. Each row ran alone and was evaluated before the next; only
K1/K4/K5/K6 overlapped operations, each as one row.

| Row                         | Result                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A7                          | pass — CLI regular root:root 0755, 117 946 496 bytes, SHA-512 = pin; not executed                                                                                                                                                                                                                                                                                                                                                             |
| A8                          | pass — `lock_free_nonblock=true`                                                                                                                                                                                                                                                                                                                                                                                                              |
| E1(a)                       | pass — installed wrapper sha256 = repository (`19fd0828…a3f9`, identical to HEAD); construction proven by the local harness                                                                                                                                                                                                                                                                                                                   |
| E1(b), E2, E3 (`env-proof`) | pass — three `envproof_step_result=pass`, `envproof_nonce_journal_hits=0`, `envproof_result=pass`; boundary `env_initial_exact=true` under the decoys, wrapper has invocation id and journal stream, descendants within the permitted union, canary succeeded under the decoys. Supplementary `/proc`: observed, 0 nonce hits, 0 forbidden names, 0 wrong values, `GPG_TTY` empty, `GIT_CEILING_DIRECTORIES` as expected (not cited as proof) |
| L2                          | pass — no active unit or process before; `gpg_agent_count_at_start=0`; canary round trip clean                                                                                                                                                                                                                                                                                                                                                |
| K1                          | pass — `lockhold-hold` pass; `busy-a`/`-b`/`-c` at ≈2 s/10 s/18 s each `busy` (exit 75, zero records)                                                                                                                                                                                                                                                                                                                                         |
| K2                          | pass — `lockhold-detach` kept; `fdcheck`: descendant 1, `lock_fd_holder_count=0`, lock free; `probe-stop` ok                                                                                                                                                                                                                                                                                                                                  |
| K3                          | pass — `canary` kept; `fdcheck`: `gpg-agent` count 1, holders 0, lock free; after `probe-stop` no `eanhl-cloud` process (the agent ends with its unit)                                                                                                                                                                                                                                                                                        |
| K4                          | pass — `busy-d` immediately `busy` while `lockhold-long` held; holder passed, kept, then stopped                                                                                                                                                                                                                                                                                                                                              |
| K5                          | pass — `probe-stop` during the `lockhold-long` hold; lock free, stopped unit 0 processes and 0 holders; next `probe local` started with `store_other_entry_count=0` and passed (the stopped holder's own `fail` is by design)                                                                                                                                                                                                                 |
| K6                          | pass — `canary-a` pass, `canary-b` busy; store `.gpg-id` only afterwards                                                                                                                                                                                                                                                                                                                                                                      |
| owned-inventory             | pass — `owned_expected_set_match=true`, `owned_unexpected_count=0`, `owned_scan_code=0`                                                                                                                                                                                                                                                                                                                                                       |

- **Processes:** after every row, no `eanhl-cloud` process and no active
  `eanhl-cloud-*` unit. `gpg-agent` exists only inside a running credential
  unit and ends with it; no resident process outside a unit was seen, so the
  resident-agent rule list stays empty.
- **[VALIDATE] items now observed on Hotel-Echo (only for these intervals):**
  GnuPG works under `PrivateNetwork=yes`; the empty passphrase argv survives
  uutils `env`; journald attaches `_SYSTEMD_INVOCATION_ID` to service stdout;
  `gpg-agent` ends at unit stop; the key uses a keybox (`pubring.kbx`).
- **Final installed-artifact check:** wrapper, launcher, probe, `env-inspect`,
  `lockhold`, `owned-inventory` and `pty-marker` each regular, root-owned,
  correct mode, not a symlink, sha256 = repository; CLI SHA-512 = pin; 12
  curated links; `/usr/bin/pass` hash unchanged.
- **Cleanup:** `~/e3j9c-stage/` removed by its literal path (no glob or
  variable) as `utiz`; absence confirmed.
- **Never done:** Proton CLI execution, authentication, login/logout,
  credential insertion, provider contact, unit enablement or timers,
  scheduling, reboot, E3J9D/E3J9E, C1 or E3J10 work, D1/D7 decisions.

**State after E3J9C:** the option-A foundation is installed and locally
proven. The validation tooling remains installed until E3J9E (D8). Next in the
sequence: E3J9D (the operator ceremony) is gated by D1; E3J9E (lifecycle and
reboot) by D7; C1 must merge before any E3J10 step that executes the CLI or can
contact Proton. U1/E3J9 stay open; E3 stays unactivated and nothing is
monitored; no Gate checkbox changed.

## 20. E3J9D stop and E3J9D-R provider-runner correction (2026-09-28) — local only

**Outcome: E3J9D stopped before any host access; E3J9D-R was implemented locally, then
independently reviewed, checkpointed at `ef32c885` and integrated into `main`
(2026-09-30). Nothing was installed.** D1 was accepted by the
operator on 2026-09-28: option (a), the primary account's complete CLI snapshot
under option A (§9). U1 and E3J9 remain open, D7 still gates E3J9E, C1 still
gates every E3J10 step that executes the CLI or can contact Proton, and E3
remains unactivated and unmonitored. No Gate checkbox changed.

### 20.1 E3J9D (stopped before host access)

E3J9D was authorized for the operator ceremony and exactly one P0 read, from a
fresh worktree at `671efb9` (then the `main` tip). Reading the committed templates
showed that P0 had no approved path: the provider template (never installed)
required, before its installation or start, a separately reviewed
invocation-bound, vocabulary-filtered reader (§18 correction 6), and the
launcher's `probe` operation accepts local modes only. Running P0 would have
meant a raw `systemctl start` plus a journal read, or an unreviewed reader. The
session stopped: no Hotel-Echo access, no ceremony, no provider contact.

### 20.2 Design (the reviewed plan, option 1)

- **One launcher-owned path.** `eanhl-cloud-credential provider-probe run <mode>`
  (`provider`, `provider-freshcache`, `neg-nokey`, `neg-nostore`, `n3-busy`,
  `e4-decoy`), `schedule <slot>` and `collect <slot>` (`t20m`, `t6h15m`, `boot`,
  mode always `provider`), `discard <slot>` (also `now`). Exact whole-argument
  matches against closed tables; anything else is refused before any system call.
  The provider template is deleted; the local `probe` operation still has no
  provider mode.
- **Fresh identity.** `eanhl-cloud-cred-pprobe-<slot>-<mode>-<32 hex>` (16
  `/dev/urandom` bytes, validated). Before any start: `LoadState` must be
  `not-found` and the journal must hold no record for the name; no retry.
- **The shared bound runner, now for local and provider units** (so the host
  exercises every new format before any provider contact): exactly one start,
  bound and rechecked `InvocationID`, bounded waits, a fixed property
  attestation, and a single-invocation proof (a json view requesting only
  `_SYSTEMD_INVOCATION_ID`; every record must carry the bound id and the expected
  `_BOOT_ID`) before the unit-and-invocation `-o cat` read.
- **Projection and classification.** A provider record is printed only if its
  name is one the running mode's probe arm emits (`PROVIDER_MODE_NAMES`, tied to
  the probe by a static test) and its value is of that name's class
  (`PROVIDER_RECORD_NAMES`); everything else is counted, never printed. An
  independent classifier requires the first record, exactly-once records, the
  mode's `provider_result` label, `provider_rc` consistency, every required value,
  unit state and, for scheduled slots, `human_sessions=0`. Cleanup is part of the
  result; postconditions follow it.
- **Provenance before every mutation.** Objects created by the invocation (after
  the never-reused proof and one successful start or publication) may be cleaned
  by it; any other object is stopped, reset, disabled or removed only after the
  fixed property attestation (and, for the boot pair, byte equality with the
  canonical renderer). Unproven objects are never touched
  (`pp_provenance=ambiguous|missing|foreign|mismatch|unproven`). `probe-stop` now
  attests its kept unit the same way.
- **E4/N4 (`e4-decoy`).** The launcher gives the parent unit exactly four fixed
  decoys (`PROTON_DRIVE_CACHE_DIR=/tmp/e3j9-e4-pdcache`,
  `XDG_CACHE_HOME=/tmp/e3j9-e4-xdgcache`, `PROTON_DRIVE_BASE_URL=http://127.0.0.1:9`,
  `E3J9_INJECTED=e3j9nonce<32 hex>` it generates); it attests the unit's
  `Environment` and scans the journal for the marker. The probe reads only
  `/proc/<its PPID>/environ` (the wrapper-exec'd `flock`) in memory, prints
  booleans and a count, requires its own exact twelve literals, creates both
  marker directories in its private `/tmp` and requires them empty after an `ok`
  CLI run. This is the only provider-mode unit environment; production and the
  other provider modes carry none.
- **Boot id.** `/proc/sys/kernel/random/boot_id` must be exactly one canonical
  lowercase UUID plus one LF (`read -d ''` must end at EOF); it is normalised to
  32 lowercase hex (journald's `_BOOT_ID` form) and used only in that form in
  unit descriptions, file pairs and journal checks.
- **Boot pair publication.** A new validation-only helper,
  `validation/unit-publish` (Perl, `-T`, core `Fcntl`/`POSIX`/`IO::Handle` only,
  invoked under `env -i`), checks the `/etc/systemd/system` chain (real
  directories, `root:root`, no group/other write), creates each file with
  `O_EXCL|O_NOFOLLOW`, rechecks its identity, publishes it with `link(2)` (never
  replacing a name), fsyncs files and the directory, rolls back only
  identity-and-byte-proven own objects, and unpublishes only after proving both
  files. The launcher enables the timer only after publication and attests the
  enablement.
- **Rejected:** a nonce-bearing template instance (the nonce would enter the
  credential command's argv, and a persistent template is a second provider path)
  and a fixed instance relying on `InvocationID` (it violates the fresh-name rule
  and can accept a previous invocation's output).

### 20.3 Corrections found while implementing the plan

- The plan's three E4 record names contained a digit (`e4_marker_dirs_created`,
  `e4_pdcache_entry_count`, `e4_xdgcache_entry_count`); the launcher's vocabulary
  is `^E3J9 [a-z_]+=…`, so they would have been counted as non-vocabulary on the
  host (the §19.6 defect class; the existing emitted-name check caught it). They
  are `decoy_marker_dirs_created`, `decoy_pdcache_entry_count` and
  `decoy_xdgcache_entry_count`.
- A `busy` run has zero records, so the single-invocation proof requires "no
  foreign record"; at least one record is required for `pass`, and exactly zero
  for `busy`.
- `O_CLOEXEC` is not exported by Perl's `Fcntl`; Perl marks every descriptor
  above `$^F` close-on-exec itself and the helper executes nothing.
- A delayed `schedule` or `collect` permits the other delayed slot's loaded
  (active) timer in its active-unit checks, not only in the pprobe object check.
- `n3-busy` runs during a `lockhold-long` hold, whose unit is `activating`; the
  precondition accepts `activating|active`, attests the unit and requires the
  lock to be held.

### 20.4 Files and installed-file accounting

| Repository file                                                                                                     | Change                                                                                                          | Host reinstall (after review, merge and reauthorization) |
| ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `ops/backup/credential/eanhl-cloud-credential`                                                                      | modified; sha256 `0244f8eeb537f29130e71c129c3591aa0bf866e47e7e06ebc3d046b040f55de9` (was `dff64fa1…`)           | yes                                                      |
| `ops/backup/credential/validation/eanhl-cloud-credential-probe.sh`                                                  | `e4-decoy`, header; sha256 `46b112c2334fc5d05395d3172d47addb5e80c92f75a7ef779e674e87694e11ed` (was `7a5807bf…`) | yes                                                      |
| `ops/backup/credential/validation/unit-publish`                                                                     | new; sha256 `5acf467780e325078aa1462a96eef3fea44bf33ee29486b93eafae8b9eacdc69`                                  | yes (first used in E3J9E)                                |
| `ops/backup/credential/validation/eanhl-cloud-credential-provider-probe@.service`                                   | deleted (never installed)                                                                                       | nothing to remove                                        |
| `credential-exec`, `env-inspect`, `lockhold`, `owned-inventory`, `pty-marker`, manifests, `gpg.conf`, escaped delta | unchanged                                                                                                       | no; hashes re-verified                                   |

### 20.5 Local evidence (hermetic)

Fake `systemctl`, `systemd-run`, `journalctl`, `setpriv`, `pgrep`, `od`, boot-id
file, `/proc` tree and CLI; no real systemd, journal, CLI, SSH or network. The
authenticated inputs were upstream `password-store.sh@1.7.4` (`b48d710a…bcd7`)
and `/usr/bin/pass` extracted from the Ubuntu `pass_1.7.4-8_all.deb`
(`b0da432e…8632`), re-authenticated before every full run. Final verification
on the final bytes, with the branch based on the exact commit `ab05da38`: three
consecutive full harness runs, each **604 passed, 0 failed; mutations 72 killed
(the 44 new plan targets plus the existing 28), 0 survived**, with identical
output; one `--static-only` run, 600 passed, 0 failed, 72 killed, 0 survived
(the four accepted-delta checks reported NOT RUN). `bash -n` (8 shell files),
`perl -T -c` and `systemd-analyze verify` (only the not-installed executable)
are clean.

### 20.6 Boundary, limitations and next steps

- **[VALIDATE] on Hotel-Echo, before any provider contact** (local bound runs in
  the same-session pre-ceremony proofs): the journal json shape and `_BOOT_ID`;
  the `systemctl show --value` formats used by attestation (`Environment` via
  `env-proof`); the boot-id read. Timer formats are first exercised by
  `schedule`, before the timer fires; after-fire formats first by `collect`
  (a mismatch fails closed into operator review). perl-base module presence is
  checked read-only before installation.
- **Residuals:** root can change `/etc/systemd/system` between a check and an
  `unlink` (identity and byte rechecks narrow, not close, the window; an
  immediately recycled inode number defeats a dev/ino check, leaving only the byte
  check); stopping a provider unit mid-run is the §4 stop window.
- **Sequence:** independent review → authorized checkpoint → merge into `main`
  (all three done: reviewed, checkpointed at `ef32c885`, integrated into `main`;
  next is explicit E3J9D reauthorization) → explicit E3J9D reauthorization → reinstall the three files from that `main`
  commit (hashes recorded) → same-session pre-ceremony proofs (A1–A4, A10, E1(a),
  `env-proof`, one `probe busy-a`) → operator ceremony → exactly one
  `provider-probe run provider` (P0) → `owned-inventory`.
- **Rollback:** revert the merge; on the host first `provider-probe discard` each
  pprobe object (provenance-checked; a refusal is a STOP for operator-only review,
  never a literal-path or manual removal), then reinstall the previous launcher and probe bytes
  (`dff64fa1…`, `7a5807bf…`) and remove `unit-publish` after a hash match.

## 21. E3J9D execution (2026-09-30) — STOPPED after the ceremony; P0 not run; credential revoked, removed and rotated

**Outcome: E3J9D did NOT pass.** The reinstall and every pre-ceremony proof
passed, and the operator's ceremony completed. The operator then reported that
they had accidentally pasted the sign-in URL and terminal output to another
agent (Codex), and stopped the session before P0.

- **Disclosure boundary.** The Claude execution agent did not receive the
  ceremony URL or the raw ceremony output before the operator reported the
  sanitized result; the disclosure was to Codex. No credential material (URL,
  ceremony output, session content, token or fingerprint) is recorded in this
  repository.
- **Provider-contact boundary.** The ceremony itself contacted Proton. **P0 was
  never attempted (`p0_attempt_count=0`)**, no provider-probe unit ran, and
  there was no provider contact after the ceremony. The local cleanup and
  rotation (§21.4) neither executed the Proton CLI nor contacted Proton.

The operator revoked the specific new CLI session at Proton (no unexpected
sessions observed, no password change), and a separately authorized local scope
then removed the local credential state and rotated the service key and store. E3J9D remains incomplete and needs a newly
authorized ceremony. U1 and E3J9 remain open, D7 gates E3J9E, C1 remains the
E3J10 prerequisite, and E3 remains unactivated and unmonitored. No Gate
checkbox changed.

Source: the clean worktree at `main` commit
`8c76a2c6286fef7a07f5cf0123f1a66d4445e5dd`. The dirty primary checkout was
fingerprinted read-only and not touched. Host access used only the `hotel-echo`
SSH alias. Two earlier attempts were refused locally by the agent tool's
auto-mode classifier before reaching the host; they were not routed around, and
the session resumed with normal per-command approval.

### 21.1 Preflight and reinstall (passed)

- **H0:** hostname `hotel-echo`; the archived Stage D identity marker matched
  (no address printed); `utiz` uid/gid 1000, `/home/utiz`, `/bin/bash`.
- **Pre-install (read-only):** `eanhl-cloud` locked, own group only, `nologin`,
  no linger, no sudoers reference; 0 active/loaded `eanhl-cloud*` units and 0
  unit files; no CLI process, no service process, no pprobe object, the old
  provider template never installed; lock free; store exactly `.gpg-id`; no
  `auth-session.*`; data, config and cache empty; CLI regular root:root 0755,
  SHA-512 = pin; installed launcher `dff64fa1…` and probe `7a5807bf…`;
  `unit-publish` absent; `network-online.target` active; the `unit-publish`
  Perl modules present (perl 5.40.1).
- **Install (only these three files):** a fresh `utiz` 0700 staging directory,
  each file transferred no-clobber and re-hashed on the host, then
  `install -T` to a temporary name, re-hashed, `mv -T`:

  | Installed path                                                          | Owner / mode   | sha256                                                             |
  | ----------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------ |
  | `/usr/local/sbin/eanhl-cloud-credential`                                | root:root 0750 | `0244f8eeb537f29130e71c129c3591aa0bf866e47e7e06ebc3d046b040f55de9` |
  | `/usr/local/lib/eanhl-cloud/validation/eanhl-cloud-credential-probe.sh` | root:root 0755 | `46b112c2334fc5d05395d3172d47addb5e80c92f75a7ef779e674e87694e11ed` |
  | `/usr/local/lib/eanhl-cloud/validation/unit-publish`                    | root:root 0755 | `5acf467780e325078aa1462a96eef3fea44bf33ee29486b93eafae8b9eacdc69` |

  All regular files (not symlinks) and executable; `perl -T -c` on
  `unit-publish` rc 0. The wrapper, the other validation tools, the
  directories, the curated links and the CLI were unchanged against a baseline
  taken before installation. No unit file was installed and no `daemon-reload`
  ran.

### 21.2 Same-session pre-ceremony proofs (all passed, one row at a time)

| Row                  | Result                                                                                                                                                                                                                                                                                                                                 |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1                   | 12 links, exactly the manifest, directory root:root 0755; targets, final paths, packages and root-owned hops identical to the §19.4 baseline                                                                                                                                                                                           |
| A2                   | 25 paths, each `test -w` as `eanhl-cloud` exit 1 (safe-cwd form); every final target root-owned, not group/world-writable                                                                                                                                                                                                              |
| `probe precheck`     | `probe_run_result=pass` (A3/A4/E2 helpers), `bound_nonvocab_lines=0`, cleanup ok                                                                                                                                                                                                                                                       |
| `probe local`        | pass: canary insert/show/match/`rm -f` and removal, absent-entry anchor                                                                                                                                                                                                                                                                |
| `probe neg-uninit`   | pass (A10)                                                                                                                                                                                                                                                                                                                             |
| A7 / A8              | CLI SHA-512 = pin, not executed / `lock_free_nonblock=true`                                                                                                                                                                                                                                                                            |
| E1(a)                | installed wrapper (`19fd0828…`) and the three reinstalled files equal the repository bytes                                                                                                                                                                                                                                             |
| `env-proof`          | three `envproof_step_result=pass`, `envproof_nonce_journal_hits=0`, `envproof_result=pass`; boundary booleans exact; supplementary `/proc` observed with 0 nonce hits, 0 forbidden names, 0 wrong values, `GPG_TTY` empty, `GIT_CEILING_DIRECTORIES` as expected (not cited as proof)                                                  |
| L2                   | no unit or service process before; `gpg_agent_count_at_start=0`; `probe local` pass                                                                                                                                                                                                                                                    |
| Busy                 | one `lockhold-hold` (pass) overlapped by one `busy-a`: `busy`, exit 75, zero records; cleanup ok; afterwards 0 probe units and 0 service processes                                                                                                                                                                                     |
| Host formats (§20.6) | boot id canonical and normalised to 32 hex; the json single-invocation view gave 28 records, each with one well-formed invocation id (1 distinct) and the current `_BOOT_ID`, no `MESSAGE` field; `systemctl show --value` formats as expected; attestation passed on every bound run (incl. `Environment` under the env-proof decoys) |
| Auth preconditions   | one key (1 revocation file, 2 private-key files, keybox), store exactly `.gpg-id` matching it, 0 `auth-session.*`, no active unit, no service or CLI process, lock free, CLI pin exact                                                                                                                                                 |

- **This is the first host evidence for the E3J9D-R bound-runner formats**
  (never-reused name, single-invocation and `_BOOT_ID` proofs, attestation)
  on local units. No provider unit ever ran, so the provider projection and
  classifier remain host-unproven.
- **Agent-side evaluation defects (no host finding).** The agent's own local
  output filter or check scripts mishandled output four times: `precheck` was
  first evaluated with a filter that dropped non-vocabulary lines without
  counting them, so that local-only row was re-run once with counting (0 lines,
  pass both times). The busy row's post-check lock line was mislabelled and
  counted as one non-vocabulary line (the row's own criteria all passed; the
  lock was free at the next check). The read-only host-format check was re-run
  twice (agent-chosen record names containing a digit or capital, a zero-record
  sample unit, and a bash `BASH_REMATCH` ordering bug). Lesson, the same class
  as §19.6: ad-hoc check names must match `^[a-z_]+$`.

### 21.3 Ceremony and stop

- The operator ran `auth-login` in their own terminal; the Claude execution
  agent did not run it. Operator report, sanitized: completed; `ssh_rc=0`;
  final record exactly `E3J9 auth_login_unit_rc=0`. The ceremony contacted
  Proton.
- The operator then reported that they had accidentally pasted the sign-in URL
  and terminal output to Codex, and stopped the session. The Claude execution
  agent had not received the URL or the raw output before that report. **P0
  was never attempted, no provider-probe unit ran, and there was no provider
  contact after the ceremony; no further host action followed until the
  separately authorized cleanup.** No URL, ceremony output or other credential
  material is recorded in this repository.
- **Remote revocation (operator, §12 step 3):** completed; coverage the
  specific new CLI session; no unexpected sessions seen; no password change
  (§12 step 4 not judged necessary).

### 21.4 Local cleanup and key/store rotation (separately authorized; passed)

This scope neither executed the Proton CLI nor contacted Proton: `auth-logout`
was deliberately not used because it runs the CLI with network access.

1. **Reconfirmation:** 0 active or loaded credential units, 0 pprobe files and
   0 pprobe unit names in the journal (P0 never attempted), 0 service or CLI
   processes, lock free, installed hashes as §21.1. Metadata inventory (counts,
   types, modes, never names): the encrypted entry (0600) at its fixed path;
   `data/proton-drive-cli` with 2 `.json` files; the cache's `proton-drive-cli`
   with 2 `.sqlite` files; `.local/state/proton-drive-cli` with 1 log; 0
   unexpected paths; every object service-owned with mode 0600/0700;
   `owned-inventory` match, 0 unexpected, code 0.
2. **`entry-remove`** (local `pass rm -f`, `PrivateNetwork=yes`):
   `entry_remove_unit_rc=0`, `entry_after=absent`; the empty entry directories
   went with it.
3. **CLI state:** three literal tops (`/var/lib/eanhl-cloud/data/proton-drive-cli`,
   `/var/cache/eanhl-cloud/proton-drive-cli`, `/var/lib/eanhl-cloud/.local`),
   each proven a real directory, then deleted as `eanhl-cloud` with the §12
   step 9 command (`find <top> -xdev -depth -type f,d -delete`); each absent
   afterwards; `data` and the cache empty.
4. **Store:** shape proven (`.gpg-id` only, one line, equal to the single
   revocation name); the store top deleted as `eanhl-cloud` (§12 step 7), then
   recreated empty with the M3 `install -d` line (0700, service-owned, 0
   entries).
5. **`key-delete <FPR>`**, the fingerprint derived on the host from the single
   revocation file name and never printed: `key_secret_count=1` → `0`,
   revocation file absent, `key_delete_postconditions_ok=true`.
6. **GNUPGHOME residue:** `key-delete` leaves keyring files behind, and
   `keygen` requires an empty GNUPGHOME. Inventory: 5 regular files and 2 empty
   directories, service-owned, correct modes, no symlink, socket or FIFO, no
   service process. Cleared as `eanhl-cloud` with the §12 step 9 command plus
   `-mindepth 1`, keeping the M3 directory itself; afterwards 0 entries and
   the directory still 0700 and service-owned. **Design gap (now corrected in
   §5 and the README):** the rotation sequence did not state this step; it is
   required by the `keygen` precondition.
7. **`keygen`:** ed25519 sign/certify primary, cv25519 encryption subkey, one
   secret key, one matching UID, no expiry, `key_topology_ok=true`,
   `keygen_postconditions_ok=true`. Fingerprints are not recorded.
8. **`gpg.conf`** installed with the README M8 command (as `eanhl-cloud`,
   `set -C`): regular 0600, service-owned, sha256 equal to the repository file.
9. **`pass-init <new FPR>`** (host-derived, never printed): store empty before,
   key match, `.gpg-id` 0600 single line, no other entry,
   `pass_init_postconditions_ok=true`.
10. **Staging:** `/home/utiz/e3j9d-stage-2026-09-30` proven to hold exactly the
    three files (`utiz` 0600, reviewed hashes), removed by literal paths;
    absence confirmed.
11. **Acceptance:** `probe local` against the new key and store passed (canary
    round trip, `gpg_agent_count_at_start=0`, no auth entry, 0 logs, 0 fallback
    files). Final state: every installed file equal to the repository, CLI pin
    exact, curated links unchanged; store exactly `.gpg-id` matching the new
    key (1 revocation file, 2 private-key files); 0 `auth-session.*`; data,
    config and cache empty; no `.local`; 0 active/loaded units, 0 unit files, 0
    pprobe journal units; 0 service or CLI processes; lock free; no linger;
    `owned-inventory` match, 0 unexpected, code 0.

**Agent-side evaluation/process defects during the cleanup (not host
findings).**

- In two read-only checks, agent-chosen check names contained digits (an
  inventory class named for the M3 directories; two GNUPGHOME mode-check
  names), so the agent's own vocabulary filter suppressed those lines. The
  first was covered by the same check's `owned-inventory` result (code 0, which
  requires the M3 directories to be correct) and again by the final
  `owned-inventory`; the second by a read-only rerun with valid names (0 bad
  modes) before anything was deleted.
- The `gpg.conf` installation and its verification were issued together
  instead of being evaluated as separate rows.
- The final hash, mode, ownership, key/store checks and `owned-inventory`
  (step 11) nevertheless all passed.

### 21.5 State and next step

On Hotel-Echo: the E3J9C foundation with the E3J9D-R launcher, probe and
`unit-publish` installed (validation tooling kept until E3J9E, D8), a fresh
service key with `gpg.conf`, and an initialised store holding only `.gpg-id`.
No Proton session, no CLI data, cache or log, no unit, timer or schedule.
**Next:** a newly authorized E3J9D (the same pre-ceremony proofs, a new
operator ceremony with the ceremony output kept away from every agent, then
exactly one P0). Never done in this session: P0 or any provider-probe unit,
provider contact after the ceremony, `auth-logout`, Proton CLI execution during
cleanup, upload, listing, create, move, trash or deletion of Proton data,
scheduling, timers, reboot, activation, E3J9E, C1 or E3J10.
