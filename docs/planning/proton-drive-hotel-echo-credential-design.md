# Proton Drive on Hotel-Echo — option-A credential mechanism design (E3J9B-doc)

**Stage:** E3J9B-doc · **Date:** 2026-09-24 · **Type:** design memo, local
documentation only · **Status:** design approved and recorded; **nothing is
implemented.** U1 and E3J9 remain open. E3 remains unactivated.

This memo durably records the approved option-A design for a service-usable Proton
Drive CLI credential on Hotel-Echo, and the separately authorized sessions that
would build and prove it. It is derived from the approved plan (revision 3 with
its same-day review correction, SHA-256
`d35759417f68a66bf767cae6cf824ed79ff75e9fd1a8d8151a7e6c5d932afc9c`, kept outside
the repository) and keeps that plan's section numbering, so the
cross-references below (§4, §7, §9, §11 …) resolve inside this file.

**What documenting the design does and does not do.**

- E3J9A remains complete **only as read-only feasibility evidence**
  ([`proton-drive-hotel-echo-credential-feasibility.md`](proton-drive-hotel-echo-credential-feasibility.md)).
- E3J9B-doc is complete locally once this memo and the narrow pointer edits exist.
- **E3J9C is not authorized and not started.** E3J9B-doc itself installed or
  configured none of the option-A components on Hotel-Echo.
- **Writing this design down creates nothing on the host:** no GPG key,
  credential store, `eanhl-cloud` system account, CLI installation, lock, wrapper,
  service unit or curated `PATH` comes into existence because of it. Every
  mechanism below is a specification, not a fact about the host.
- U1 and E3J9 remain open; **D1 and D7 are unresolved**; E3 is unactivated; no Gate
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
   Nothing from the parent or systemd crosses that boundary, so everything `pass`
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
| HOME                           | `/var/lib/eanhl-cloud`                                                                               | eanhl-cloud:eanhl-cloud | 0700          | —                                                                  | `StateDirectory=eanhl-cloud`, `StateDirectoryMode=0700`                                                                                                               |
| **Secret**                     | `/var/lib/eanhl-cloud/gnupg` (GNUPGHOME)                                                             | svc                     | 0700          | 0600                                                               | Layout, socket location and agent behaviour are **[VALIDATE]** (§5)                                                                                                   |
| **Secret**                     | `/var/lib/eanhl-cloud/password-store` (PASSWORD_STORE_DIR)                                           | svc                     | 0700          | 0600 (`.gpg-id`, `ch.proton.drive/drive-sdk-cli/auth-session.gpg`) | Always initialised **empty** (§5). No `pass git init`                                                                                                                 |
| **Lock**                       | `/var/lib/eanhl-cloud/locks/credential.lock`                                                         | svc                     | `locks/` 0700 | 0600, pre-created empty                                            | Kernel `flock` only; content never read (§4)                                                                                                                          |
| Sensitive non-secret           | `/var/lib/eanhl-cloud/data` (XDG_DATA_HOME)                                                          | svc                     | 0700          | 0600 (child `UMask=0077`)                                          | [BIN] the CLI otherwise writes 0644                                                                                                                                   |
| **Secret-class logs**          | `/var/lib/eanhl-cloud/.local/state/proton-drive-cli/proton-drive.log*`                               | svc                     | 0700          | 0600                                                               | Level fixed at `ERROR` (§7). Verification reads metadata only                                                                                                         |
| Non-secret                     | `/var/lib/eanhl-cloud/config` (XDG_CONFIG_HOME)                                                      | svc                     | 0700          | 0600                                                               | Set so nothing falls back to other defaults                                                                                                                           |
| Cache                          | `/var/cache/eanhl-cloud` (XDG_CACHE_HOME)                                                            | svc                     | 0700          | 0600                                                               | `CacheDirectory=eanhl-cloud`. Disposable                                                                                                                              |
| Runtime                        | `/tmp` private per unit (`PrivateTmp=yes`)                                                           | —                       | —             | —                                                                  | No runtime directory is used                                                                                                                                          |
| **Curated PATH**               | `/opt/eanhl-cloud/credential-bin`                                                                    | root:root               | 0755          | root-owned symlinks only                                           | Exact manifest in §3                                                                                                                                                  |
| CLI executable                 | `/opt/eanhl-cloud/bin/proton-drive`                                                                  | root:root               | 0755          | 0755                                                               | SHA-512 pinned; always invoked by absolute path                                                                                                                       |
| **Lock + environment wrapper** | `/usr/local/lib/eanhl-cloud/credential-exec`                                                         | root:root               | 0755          | 0755                                                               | The **single definition** of the credential command's initial environment at the `env -i` boundary (§7) and the only entry point for credential-bearing commands (§4) |
| Launcher                       | `/usr/local/sbin/eanhl-cloud-credential`                                                             | root:root               | 0755          | 0750                                                               | Root-only fixed subcommands; builds every transient unit (§4, §6)                                                                                                     |
| Validation tooling             | `/usr/local/lib/eanhl-cloud/validation/` (probe, env-inspect, lockhold, PTY-marker, owned-inventory) | root:root               | 0755          | 0755                                                               | Removed after E3J9E (D8); re-installed from repo templates only if rollback needs it                                                                                  |

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
| Platform line (**conditional**) | `uname`, `cut`, `tr`           | only if the installed `/usr/bin/pass` still has the upstream `PLATFORM_FUNCTION_FILE` `source` line (E3J9C compares with upstream) **[VALIDATE]**                                                                                                                                                                                |

**Curated manifest:** `bash getopt gpg pass mkdir dirname grep find base64 rm rmdir
cat`, plus the conditional trio (`uname cut tr`) only if required.

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
and key rotation all use a newly created, proven-empty store (§5). Supporting
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
- If the installed `/usr/bin/pass` differs from upstream beyond the platform-line
  edit, **stop** and re-derive this table.

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
  3. runs **`exec /usr/bin/flock --exclusive --close <lockmode> --conflict-exit-code
75 /var/lib/eanhl-cloud/locks/credential.lock /usr/bin/env -i <§7
environment> <absolute command> [args…]`**.
- **The operator never types a `systemd-run` line.** The root-only launcher
  `/usr/local/sbin/eanhl-cloud-credential` has fixed subcommands: `keygen`,
  `pass-init`, `pty-marker`, `env-proof`, `auth-login`, `auth-logout`. Each builds
  the identical §8 property set with the wrapper as its command.
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
- **Residual window (documented stop-overlap limitation):** if a stop signals the
  `flock` parent while its foreground command is still dying, another unit could
  acquire the lock during that brief overlap. Stops are operator-initiated, and K5
  observes the ordering. This is recorded, not eliminated.
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
  no `gpg-agent.conf`.
- **Empty-store rule:** `pass init <primary fingerprint>` runs only through
  `pass-init`, and only after a metadata check proves the store directory **newly
  created and empty** (no `.gpg-id`, no entries). Anything else means **stop**.
  `.gpg-id` has exactly one line.
- **Canary:** `pass insert -f -m e3j9-canary/probe` from random bytes, then
  `pass show` compared inside the probe (boolean only), then the noninteractive
  **`pass rm -f e3j9-canary/probe`**. Absence is then verified.
- **Recovery (D5, resolved):** no off-host private-key backup and no recovery
  material. Recovery means:
  1. local logout if still possible;
  2. remove the old store contents (metadata-proven);
  3. recreate the store directory empty (`install -d`);
  4. generate a new key;
  5. `pass-init` on the proven-empty store;
  6. **a new operator login**.

  There is no in-place re-encryption.

- **Rotation:** triggered by suspected compromise, host rebuild or identity change.
  The sequence is the same as recovery: local logout → old store removed → **new
  empty store** → new key → `pass-init` → **new operator login** → old key deleted
  (§12 order). Rotation never runs `pass init` over existing entries.
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
- **Immediately before the ceremony (read-only):** CLI SHA-512 = pin; A1–A4, A10 and
  E1 re-run; the lock is free; the store holds only `.gpg-id`; no
  `auth-session.json` in the §2 trees; `.gpg-id` = the recorded fingerprint; no
  `eanhl-cloud` process running.
- **Operator conduct:** open the URL on another device, never paste it anywhere, and
  clear scrollback afterwards. Type any mailbox-password prompt in the PTY. **No
  credential is copied from the main PC.**
- **Expected state created:** `auth-session.gpg` (0600),
  `data/proton-drive-cli/*.json`, `cache/proton-drive-cli/*.sqlite`, the
  secret-class log. **Never** `auth-session.json`.
- **Verification without exposing contents:** in-tree metadata from a fixed
  expected-path table, plus per-directory counts of other entries; the sanitized
  owned-inventory; then exactly one `/my-files` metadata `info` read (P0).
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
  injected into the unit or the wrapper, crosses the `env -i` boundary. The
  credential command's **initial** environment is exactly the twelve literals.
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
  1. The installed `/usr/bin/pass` is compared with upstream 1.7.4, and both
     `export` lines must match verbatim (`pass_exports_match_upstream=true`).
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
  the twelve values; the wrapper accepts no environment arguments. Only
  validation-only secondary processes may replace **exactly one** directory value
  (§11 test isolation) — the sole exception.

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
    (§7)
  - `WorkingDirectory=/var/lib/eanhl-cloud`, so any derived `PWD` is deterministic
    (the launcher passes it as `-p WorkingDirectory=…` for transient units, the
    ceremony and logout included)
  - `UMask=0077`, `PrivateTmp=yes`, `ProtectHome=yes`, `ProtectSystem=strict`,
    `ReadWritePaths=/var/lib/eanhl-cloud /var/cache/eanhl-cloud`
  - `StateDirectory=eanhl-cloud`/`0700`, `CacheDirectory=eanhl-cloud`/`0700`
  - `NoNewPrivileges=yes`, `StandardInput=null` (except the ceremony's PTY),
    `KillMode=control-group`, no `PAMName=`
  - `Type=oneshot` with a `TimeoutStartSec=` bound (for the uploader, larger than
    its lock `--wait`)
- **Ordering:** `After=`/`Wants=network-online.target` only for units that contact
  Proton.
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
>   - credential commands start from a fixed, positively enumerated environment, and no ambient or injected parent variable crosses into them;
>   - the sign-in URL goes to the operator's PTY, once the A-series proofs pass;
>   - probes print a fixed vocabulary, and host-wide scans print booleans and counts;
>   - CLI logs are fixed at `ERROR` and mode-restricted;
>   - **the operator's scrollback during the ceremony contains the URL.**
> - **Accidental backup:** `/var/lib/eanhl-cloud` and `/var/cache/eanhl-cloud` must be excluded from host or file-level backups, or such a backup must be treated as containing the credential.
> - **Protects against:** other unprivileged local users and container uids, accidental reads through the repo, config, journal or transcripts, ambient variables leaking into credential commands, operator personal keys ever being involved, silent `unsafe_file` or keychain fallback, and concurrent credential writers.
> - **Does not protect against:** `eanhl-cloud`, root, offline disk access, or kernel compromise.

("C6" in the statement is constraint C6 of
[`proton-drive-transport-feasibility.md`](proton-drive-transport-feasibility.md): no
append-only, folder-scoped or service-account credential is documented in Proton's
public sharing, CLI or SDK documentation.)

**D1 is the only credential-risk decision.** Either (a) explicitly accept storing
the **primary** account's complete CLI snapshot under option A, on the statement
above; or (b) use a **dedicated Proton account with sufficient quota**, whose quota
and cost remain unresolved by U5/U6 (a free or Mail Plus account is not assumed
sufficient). **D1 gates E3J9D only.**

## 10. Mutation and authorization inventory

Every row below is **[AUTH]**: none is authorized by this memo.

| #   | Mutation                                                                                                                                                                                                                                                                                                                           | Privilege            | Contacts Proton             | Rollback                                                  | Owner                                                                                      |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | --------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| M1  | `apt-get install --no-install-recommends pass` after an `-s` simulation, no `apt update`; confirm `/usr/bin/flock` (util-linux, with `--close`) and `/usr/bin/env` exist                                                                                                                                                           | root                 | no                          | `apt remove` after `-s` review                            | E3J9C                                                                                      |
| M2  | Group + account `eanhl-cloud` (§1)                                                                                                                                                                                                                                                                                                 | root                 | no                          | §12 step 11                                               | E3J9C                                                                                      |
| M3  | `install -d` for `/var/lib/eanhl-cloud{,/gnupg,/password-store,/config,/data,/locks}`, `/var/cache/eanhl-cloud`, `/opt/eanhl-cloud/{bin,credential-bin}`, `/usr/local/lib/eanhl-cloud{,/validation}`; pre-create `locks/credential.lock` 0600                                                                                      | root                 | no                          | `rmdir`/`rm` of literal paths                             | E3J9C                                                                                      |
| M4  | Curated PATH: root-owned symlinks for exactly the §3 manifest (including `cat`; the conditional trio only if required); manifest sha256 recorded                                                                                                                                                                                   | root                 | no                          | remove literal links, `rmdir`                             | E3J9C                                                                                      |
| M5  | Wrapper `credential-exec` (lock + `env -i` environment) and launcher `eanhl-cloud-credential`; sha256 recorded                                                                                                                                                                                                                     | root                 | no                          | remove after sha256 match                                 | E3J9C                                                                                      |
| M6  | CLI 0.8.0 `linux-x64`: acquire, verify SHA-512 against the recorded pin, install root:root 0755, deployment record. **Never executed.** Acquisition is either an unauthenticated fetch from Proton's public download host (named explicitly in the authorization) or a transfer of the byte-identical pinned file from the main PC | root                 | download host only, or none | remove literal file                                       | E3J9C                                                                                      |
| M7  | Validation tooling (probe, env-inspect, lockhold, PTY-marker, owned-inventory) + `eanhl-cloud-credential-probe@.service`, `daemon-reload`, **no enable**                                                                                                                                                                           | root                 | no                          | removed in M18                                            | E3J9C                                                                                      |
| M8  | GPG key via `keygen`, then gpg.conf                                                                                                                                                                                                                                                                                                | root→svc             | no                          | §12 step 8                                                | E3J9C                                                                                      |
| M9  | `pass init <fpr>` via `pass-init` on a newly created, proven-empty store                                                                                                                                                                                                                                                           | root→svc             | no                          | §12 step 7                                                | E3J9C                                                                                      |
| M10 | Local proofs: A1–A10, E1–E3, L1, L2, K1–K6                                                                                                                                                                                                                                                                                         | svc units / launcher | no                          | canary removed in-run with `pass rm -f`; absence verified | E3J9C                                                                                      |
| M11 | **Operator `auth-login` ceremony** (§6)                                                                                                                                                                                                                                                                                            | root→svc, PTY        | **yes, authenticates**      | M19                                                       | E3J9D (**D1**)                                                                             |
| M12 | Provider read `filesystem info /my-files` (metadata only, stdout→`/dev/null`)                                                                                                                                                                                                                                                      | svc unit             | **yes, one per run**        | none (read)                                               | E3J9D (exactly one, P0); E3J9E                                                             |
| M13 | `eanhl-cloud-credential-probe-boot.timer` (`OnBootSec=10min`, no recurrence)                                                                                                                                                                                                                                                       | root                 | via M12                     | removed in M18                                            | E3J9E                                                                                      |
| M14 | Transient one-shot timers (`--on-active=20min` / `6h15min`)                                                                                                                                                                                                                                                                        | root                 | via M12                     | self-removing; verified                                   | E3J9E                                                                                      |
| M15 | Logout of all human sessions                                                                                                                                                                                                                                                                                                       | operator             | no                          | n/a                                                       | E3J9E                                                                                      |
| M16 | **Reboot** of Hotel-Echo (restarts its parallel web/worker/db deployment); read-only pre-check of restart policies and main-PC ingestion health first                                                                                                                                                                              | root                 | no                          | n/a                                                       | E3J9E (**D7**)                                                                             |
| M17 | Negative tests N1–N4                                                                                                                                                                                                                                                                                                               | svc units            | N1, N2, N4 may              | in-run temp dirs                                          | E3J9E                                                                                      |
| M18 | Remove boot timer and all validation tooling/units; `daemon-reload` (D8)                                                                                                                                                                                                                                                           | root                 | no                          | —                                                         | E3J9E end                                                                                  |
| M19 | Local `auth-logout` (`pass rm -f` + clear caches [SRC]; **local only**)                                                                                                                                                                                                                                                            | root→svc             | possibly (CLI start)        | —                                                         | rollback / rotation / recovery                                                             |
| M20 | Remote session revocation through a verified Proton account control                                                                                                                                                                                                                                                                | operator only        | yes                         | —                                                         | rollback / incident                                                                        |
| M21 | Account password change                                                                                                                                                                                                                                                                                                            | operator only        | yes                         | —                                                         | incident only, separately justified                                                        |
| M22 | Key deletion; store/dir removal; launcher, wrapper, curated PATH, CLI removal; account; package                                                                                                                                                                                                                                    | root                 | no                          | —                                                         | rollback, each separately                                                                  |
| C1  | **Repository code correction** (not a host mutation): literal `ERROR` in `buildChildEnv()` + §7 tests                                                                                                                                                                                                                              | local repo           | no                          | git revert                                                | **Must be merged before any E3J10 step that executes the CLI or can contact the provider** |

## 11. Acceptance protocol [DESIGN]

**Probe** (validation-only). It is started through the wrapper, so it runs as the
scrubbed child. The instance selects its mode: `local`, `provider`,
`provider-freshcache`, `neg-nokey`, `neg-nostore`, `neg-uninit`. It prints **only**
lines matching `^E3J9 [a-z_]+=[a-z0-9_.:-]+$`. It records:

- identity and groups booleans;
- `env_initial_exact` (its own exec-time environment, read from
  `/proc/self/environ`, equals the twelve literals), `env_descendant_within_permitted`
  (its current names ⊆ the §7 permitted union — the twelve ∪ {`PWD`, `SHLVL`, `_`,
  `OLDPWD`} ∪ {`GPG_TTY`, `GIT_CEILING_DIRECTORIES`} — and every name with a fixed
  expected value carries it), `env_pwd_is_workdir`, `env_forbidden_absent` and
  `env_nonce_absent`. Helper children report their **own** `/proc/self/environ`,
  so these reads are deterministic. These are booleans; unexpected variables are
  reported only as a count, never by name or value;
- `pass_exports_match_upstream` (the installed pass's two `export` lines equal
  upstream 1.7.4) and `tty_absent` (`command -v tty` fails in the child);
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
`/`, `/var`, `/opt`, `/etc`, `/usr/local`, `/tmp` and `/home` for the uid/gid
`eanhl-cloud`. It compares the results in memory against the §2 set and emits
**only** `owned_expected_set_match`, `owned_unexpected_count` and `owned_scan_code`.
It never prints a path. On a mismatch: **stop**; only the operator inspects, and
names never go to an agent.

| Test                                                    | When                                  | Pass criterion                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1 curated inventory                                    | E3J9C, pre-ceremony                   | the directory contains exactly the §3 manifest (including `cat`); each entry is a symlink to its recorded `/usr/bin/…` target; the directory is root:root 0755                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| A2 non-writability                                      | E3J9C, pre-ceremony                   | as `eanhl-cloud`: the curated directory, every target, `/opt`, `/opt/eanhl-cloud`, `bin/`, the CLI, the wrapper and the launcher are not writable; targets are root-owned and not group/world-writable                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| A3 `xdg-open` and `tty`                                 | E3J9C, pre-ceremony                   | `command -v xdg-open` and `command -v tty` both fail in the scrubbed child (`tty` absence is what makes pass's `GPG_TTY` empty, §7)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| A4 no opener                                            | E3J9C, pre-ceremony                   | every §3 opener name fails `command -v` in the child. Host-wide opener presence is recorded as a boolean                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| A5 pass/GPG canary                                      | E3J9C                                 | = L1                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| A6 PTY marker                                           | E3J9C, pre-ceremony                   | `pty-marker` runs through the wrapper. The launcher passes a nonce to the unit via `--setenv` (never in the unit's `ExecStart=` argv, which systemd may log), so it reaches only the wrapper's environment. For the validation-only `pty-marker` command id alone, the wrapper hands the nonce to the scrubbed child as a positional argument. The child writes it to stdout and stderr. The operator sees it on the PTY; a root search of **all** journal entries since the test start returns `pty_marker_journal_hits=0`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| A7 CLI pin                                              | E3J9C, pre-ceremony                   | sha512 = pin, not executed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| A8 lock free                                            | pre-ceremony                          | nonblocking acquire succeeds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| A9 empty-store proof                                    | E3J9C, before `pass-init`             | the store directory was newly created and holds no entries and no `.gpg-id`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| A10 pass error paths                                    | E3J9C                                 | in the child: `pass show e3j9-absent` exits ≠ 0 and its stderr contains `is not in the password store` (boolean); `neg-uninit` (a private empty store without `.gpg-id`) `insert` exits ≠ 0 and its stderr contains `You must run` (boolean, which proves `cat` works); `pass_cmd_not_found=false` throughout                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| E1 construction + initial exec environment              | E3J9C, pre-ceremony                   | (a) **Construction:** the installed wrapper's sha256 equals the repo template, and the repo test proves the template execs `/usr/bin/env -i` followed by exactly the twelve manifest literals, with no parent-value expansion. (b) **Exec boundary:** `env-inspect`, exec'd directly as the credential command, reads its exec-time environment from `/proc/self/environ` before doing anything else. The name set equals the twelve exactly, each value equals its literal (`env_initial_exact=true`), and every forbidden name is absent, systemd-added ones included                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| E2 wrapper side vs. downstream                          | E3J9C                                 | `env-proof` records, for the **wrapper's** own environment, the booleans `wrapper_has_invocation_id=true` and `wrapper_has_journal_stream=true`. Then, in the probe (a bash descendant) and in helper children that read their own `/proc/self/environ` (deterministic): `env_descendant_within_permitted=true` against the §7 union and its expected values, `env_pwd_is_workdir=true`, and none of `INVOCATION_ID`, `SYSTEMD_EXEC_PID`, `JOURNAL_STREAM` is present. pass's contribution is fixed statically: `pass_exports_match_upstream=true`, A3 and E1(b) determine `GPG_TTY` = empty and `GIT_CEILING_DIRECTORIES` = `/var/lib/eanhl-cloud/password-store/..`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| E3 injected parent values have no effect on pass or GPG | E3J9C                                 | `env-proof` sets decoys on the unit via `--setenv`: `E3J9_INJECTED=<nonce>`, `GNUPGHOME=/nonexistent-e3j9`, `PASSWORD_STORE_DIR=/nonexistent-e3j9`, `PASSWORD_STORE_GPG_OPTS=--e3j9-invalid`, `PATH=/nonexistent-e3j9`, `GPG_TTY=/dev/e3j9-decoy`, `PROTON_DRIVE_BASE_URL=http://127.0.0.1:9`. **Required (all deterministic):** (a) E1(b) passes under the decoys, so the nonce and every decoy name are absent from the credential command's exec-time environment; (b) the L1 canary succeeds. Had the `GNUPGHOME` or `PASSWORD_STORE_DIR` decoy reached pass or gpg, the key or store would not be found; had `PASSWORD_STORE_GPG_OPTS` reached pass, gpg would reject the invalid option; had the `PATH` decoy reached the command, `/usr/bin/env bash` could not start pass; (c) the probe and its self-reporting helper children report `env_nonce_absent=true`. The base-URL decoy's effect is tested in E4, where the CLI runs; `GPG_TTY`'s is covered by (a) and the §7 static validation. **Supplementary only:** root may read `/proc/<pid>/environ` of a live `pass` or `gpg` during a `lockhold` canary. `proc_obs=not_observed` (the short-lived process was not caught) is recorded and is neither a pass nor proof. When observed, any nonce hit, forbidden name, non-empty `GPG_TTY` or unexpected `GIT_CEILING_DIRECTORIES` is a STOP |
| E4 injected decoys have no effect on the Proton CLI     | E3J9E                                 | provider probe with parent decoys `PROTON_DRIVE_CACHE_DIR=<private-tmp marker dir>`, `XDG_CACHE_HOME=<another marker dir>`, `PROTON_DRIVE_BASE_URL=http://127.0.0.1:9` and `E3J9_INJECTED=<nonce>`: `env_initial_exact=true` and `env_nonce_absent=true`; result `ok` (a CLI using the loopback discard-port base URL could not reach the provider); both marker dirs stay empty                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| L1 local key/store                                      | E3J9C                                 | canary match=true; then `pass rm -f`; absence verified; no pinentry process                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| L2 cold start                                           | E3J9C                                 | after stop/start: agent count 0 at start; L1 passes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| K1 contention across the whole foreground command       | E3J9C                                 | `lockhold` runs a foreground canary plus a fixed hold; second instances started at the beginning, middle and end all exit 75 / `credential_lock_busy` without starting pass or GPG                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| K2 descendants never hold the lock                      | E3J9C                                 | in a validation unit with `RemainAfterExit=yes`, `lockhold` leaves a detached `setsid` descendant running and exits its foreground command. While the descendant is verified alive (boolean), a nonblocking acquire succeeds; root reports `descendant_holds_lock_fd=false` (fd-link comparison, boolean only)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| K3 gpg-agent cannot keep it busy                        | E3J9C                                 | after an L1 canary in a `RemainAfterExit=yes` unit, while `gpg-agent` is verified still running: a nonblocking acquire succeeds and `agent_holds_lock_fd=false`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| K4 bounded and nonblocking semantics                    | E3J9C                                 | `--nonblock` → 75 immediately; `--wait=<short test bound>` → 75 on expiry while a holder runs                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| K5 stop releases                                        | E3J9C                                 | `systemctl stop` of a holding `lockhold` → after the stop completes, a nonblocking acquire succeeds; no process of that unit remains                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| K6 no simultaneous rewrite                              | E3J9C                                 | two concurrent canaries: exactly one runs, the other is busy; the entry is intact                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| K7 reboot + lock order                                  | E3J9E (reboot); E3J10 (static order)  | the first boot probe acquires nonblocking; E3J10 statically verifies the wrapper is first in `ExecStart=`, no `flock` exists in `ops/backup/lib`, and the run-lock acquisition is unchanged                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| P0 first provider read                                  | E3J9D, straight after the ceremony    | `ok`; entry 0600; no `auth-session.json`; owned-inventory match=true                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| P1 stop/start pair                                      | E3J9E                                 | both `ok`; agent count 0 at each start                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| P2 fresh empty cache                                    | E3J9E                                 | `ok`; new cache under the private `/tmp` only                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| P3 human sessions = 0                                   | E3J9E T0+20 min                       | `ok`, sessions=0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| P4 ≥ 6 h                                                | E3J9E T0+6 h 15 min                   | `ok`, sessions=0; entry mtime/size recorded                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| P5 reboot                                               | E3J9E boot timer, no login since boot | `ok`, sessions=0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| N1 key unavailable                                      | E3J9E                                 | exit ≠ 0, `pass_load_failed`, no hang, no pinentry, no fallback file                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| N2 store unavailable                                    | E3J9E                                 | `login_required`; no URL-like output in the unit's journal                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| N3 lock held                                            | E3J9E                                 | `credential_lock_busy`; pass and the CLI are never started                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| N4                                                      | E3J9E                                 | = E4                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| J journal hygiene                                       | E3J9E end                             | every probe journal line is a systemd lifecycle line or matches the vocabulary regex                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

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
  `pass_exports_match_upstream=false`; an observed descendant environment containing
  the nonce, a forbidden name or a wrong value (including a non-empty `GPG_TTY` or an
  unexpected `GIT_CEILING_DIRECTORIES`); unexpected lock busy or a descendant holding the lock; a curated-inventory
  mismatch; `command not found` from pass; a nonempty store before `pass-init`. On
  STOP: record, do not re-authenticate, and leave state for §12.
- **Sanitized output rules (summary):** probes print only the fixed vocabulary
  regex; stderr and log contents are never printed; environment findings are
  booleans and counts; owned-inventory and journal scans print booleans and counts,
  never paths or names; the sign-in URL is never handled by an agent; every recorded
  key fact is public metadata.
- **Cleanup (end of E3J9E, D8):** remove the boot timer and all validation tooling
  and units from the host; verify transient timers are gone; `daemon-reload`. Repo
  copies remain under `validation/`, not installed.

## 12. Rollback (ordered; each step separately authorized)

1. Stop and disable only E3J9 units and timers. Remove unit files by literal path
   after a sha256 match. `daemon-reload`.
2. **Local logout:** `sudo /usr/local/sbin/eanhl-cloud-credential auth-logout`,
   under the lock with the §7 environment. Proven effect [SRC]: the local pass
   entry is removed (`pass rm -f`) and caches are cleared. **This is not remote
   revocation.** Verify the entry is absent (metadata).
3. **Remote session revocation (separate):** the operator uses Proton's account
   session management; its coverage of CLI sessions is **[VALIDATE]**, recorded as
   an operator boolean.
4. **Password change (separate):** only when incident analysis justifies it.
5. If step 2 failed, keep the key: local cleanup may still need it. Retry only under
   new authorization.
6. **Recovery or rotation, when the service is to continue:** follow the §5 sequence
   (new empty store → new key → `pass-init` → new operator login). There is **no
   in-place re-encryption** of the old store.
7. Password store: only if metadata shows exactly `.gpg-id` plus empty directories,
   `rm` the literal file and `rmdir` bottom-up. Otherwise stop for operator-only
   review.
8. **Key deletion (separate authorization), only once no local cleanup still needs
   it:** prove the keyring holds only the recorded fingerprint;
   `gpg --batch --yes --delete-secret-and-public-key <FPR>` via the wrapper; remove
   `openpgp-revocs.d/<FPR>.rev` by literal path.
9. Remove GNUPGHOME, data, config, logs, cache and `locks/` after a metadata table
   proves every entry is E3J9-created. Use literal paths only.
10. Remove the launcher, the wrapper, the curated directory, and `/opt/eanhl-cloud`
    (the last after an E3J10 dependency review).
11. Account: `pgrep -u eanhl-cloud` empty; no unit with `User=eanhl-cloud`;
    owned-inventory (re-installed from the repo template) reports
    `owned_unexpected_count=0` → `deluser --system eanhl-cloud`, `delgroup`. A
    mismatch means stop and operator-only inspection.
12. Package: `apt-get -s remove pass` review, then removal.

## 13. Session sequence and dependency ordering

**Sequence: E3J9B-doc → E3J9C → E3J9D → E3J9E.** D1 gates **only** E3J9D; D7 gates
**only** E3J9E.

| Session                                   | Authorized mutations                                                                                                                                                                                        | Prohibited                                                                                                                                                                                                                | Operator                                                            | Verification                                                                                                                                                     | Checkpoint                                                                                  |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| **E3J9B-doc** (local)                     | Design doc + pointer edits                                                                                                                                                                                  | Any host/provider action; code                                                                                                                                                                                            | —                                                                   | `git diff --check`, sensitive-value and stale-claim scans                                                                                                        | docs commit (only if separately authorized). **Complete locally** once written and verified |
| **E3J9C** host foundation + local proof   | M1–M10                                                                                                                                                                                                      | Proton CLI execution, authentication, provider contact (except an explicitly named M6 download), reboot                                                                                                                   | sudo                                                                | getent/`passwd -S` locked, no linger, `id -G`, directory table, pass-vs-upstream comparison, CLI sha512 = pin, A1–A10, E1–E3, L1, L2, K1–K6, public key metadata | docs + `ops/backup/credential/` templates. **Requires separate authorization; not started** |
| **E3J9D** ceremony                        | M11, exactly one M12 (P0)                                                                                                                                                                                   | Upload/list/create/trash; a second login; the agent seeing ceremony output                                                                                                                                                | **ceremony; D1 accepted**; the A-series and E1 re-passed in-session | §6 pre-checks, metadata table, owned-inventory, P0                                                                                                               | docs                                                                                        |
| **E3J9E** lifecycle validation            | M12–M18                                                                                                                                                                                                     | Upload or other provider mutation; production unit; schedules beyond M13/M14                                                                                                                                              | logout; **reboot (D7)**                                             | P1–P5, K7 (reboot), E4, N1–N4, J, then M18 cleanup verified                                                                                                      | docs; U1 disposition                                                                        |
| Conditional local correction              | Observed credential-failure anchors (§0.8), only if E3J9E evidence warrants it                                                                                                                              | Host/provider                                                                                                                                                                                                             | —                                                                   | full `pnpm test:backup-producer` suite, mutation checks                                                                                                          | code commit                                                                                 |
| **C1 mandatory Node-boundary correction** | Literal `ERROR` in `buildChildEnv()` + §7 tests                                                                                                                                                             | Host/provider                                                                                                                                                                                                             | —                                                                   | full backup test suite; the three §7 test groups                                                                                                                 | code commit. **Prerequisite of every CLI-executing or provider-contacting E3J10 step**      |
| **E3J10**                                 | Containment, artifact permissions, production config/unit integration (wrapper as `ExecStart=`, uploader command id added by design revision, bounded `--wait`, K7 static order check), pin re-verification | **Before C1 is merged:** any step that executes the Proton CLI or can contact the provider, including integration and proving runs. **At any time without separate authorization:** production schedule, E3J8B activation | —                                                                   | containment proof etc.                                                                                                                                           | —                                                                                           |

**Dependency ordering:**

- E3J9B-doc → E3J9C → (D1) E3J9D → (D7) E3J9E.
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
  `eanhl-cloud-credential-probe.sh`, `eanhl-cloud-credential-probe@.service`,
  `env-inspect`, `lockhold`, `pty-marker`, `owned-inventory`; optionally
  `ops/backup/lib/backup-cloud-credential-env.test.mjs` (asserting that the wrapper's
  literals equal the env manifest, the manifest ⊆ `ENV_ALLOWLIST` ∪ {the two
  `PROTON_DRIVE_*`}, the wrapper uses `/usr/bin/env -i` and `flock --close` without
  `--no-fork`, and no forbidden name appears; needs `ENV_ALLOWLIST` exported); a
  pointer in `ops/README.md`; the execution record in this memo; HANDOFF; journal.
- **E3J9D:** this memo, HANDOFF, journal.
- **E3J9E:** new `ops/backup/credential/validation/eanhl-cloud-credential-probe-boot.timer`;
  results in this memo; U1 updates in the three planning memos; HANDOFF; journal.
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
| Curated PATH insufficient on an exercised path (including usage/error paths), or installed pass differs from upstream beyond the platform line                                                                                                                                                                                                                                                                                                                     | **Stop E3J9C**; re-derive §3 by design revision                                                                                                                                                                                                        |
| A store is not proven empty before `pass init`                                                                                                                                                                                                                                                                                                                                                                                                                     | **Stop**; no in-place re-encryption                                                                                                                                                                                                                    |
| Initial exec environment not exactly the twelve literals (E1); a descendant variable outside the §7 permitted union, or a wrong value for a name with a fixed expected value, including a non-empty `GPG_TTY` or a `GIT_CEILING_DIRECTORIES` other than `/var/lib/eanhl-cloud/password-store/..` (E2); installed pass `export` lines differing from upstream; a decoy having an effect (E3/E4); or an observed descendant containing the nonce or a forbidden name | **Stop.** A `not_observed` supplementary `/proc` result is not a stop and not a pass                                                                                                                                                                   |
| A descendant or `gpg-agent` holds the lock descriptor, or the lock is busy after its holder exits                                                                                                                                                                                                                                                                                                                                                                  | **Stop**                                                                                                                                                                                                                                               |
| Needs an operator's personal key or home                                                                                                                                                                                                                                                                                                                                                                                                                           | **No.** `ProtectHome=yes` enforces it                                                                                                                                                                                                                  |
| Requires `unsafe_file`                                                                                                                                                                                                                                                                                                                                                                                                                                             | **No**                                                                                                                                                                                                                                                 |
| Allowlist can't express the context without a code change                                                                                                                                                                                                                                                                                                                                                                                                          | **A code change (C1) is required.** It is bounded and local, and must be merged **before any E3J10 step that executes the CLI or can contact the provider**. It does not gate E3J9C–E3J9E                                                              |
| E3J9/E3J10 ownership irreconcilable                                                                                                                                                                                                                                                                                                                                                                                                                                | **Resolved** (D2)                                                                                                                                                                                                                                      |
| A secret or the URL must enter the repo, command line, transcript, journal, logs or agent output                                                                                                                                                                                                                                                                                                                                                                   | **No, by design**, conditional on the A- and E-series passing. Residual: operator scrollback                                                                                                                                                           |
| Unexpected `eanhl-cloud`-owned paths                                                                                                                                                                                                                                                                                                                                                                                                                               | **Stop**; operator-only inspection                                                                                                                                                                                                                     |
| Risk acceptance broader than authorized                                                                                                                                                                                                                                                                                                                                                                                                                            | **OPEN, gating E3J9D only (D1)**                                                                                                                                                                                                                       |

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

**Still open (no others):**

- **D1 (gates E3J9D only):** accept storing the primary account's complete CLI
  snapshot under option A (§9), **or** use a dedicated Proton account with
  sufficient quota (quota and cost unresolved by U5/U6).
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
unvalidated. In addition, still to be established by later sessions: the Hotel-Echo
util-linux version (local reference 2.39.3), the installed `pass` versus upstream
1.7.4 (platform line and the two `export` lines), the `future-default` key parameters, the GnuPG agent's
lifecycle under a system unit, remote-revocation coverage of CLI sessions, and the
Ubuntu 26.04 `adduser` behaviour.

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
  `WorkingDirectory=`, `UMask=`, `StateDirectory`/`CacheDirectory`, `ProtectHome`);
  `systemd.kill` (`KillMode=control-group`); `systemd.service`
  (`RemainAfterExit=`); `systemd-run` (`--pty`, `--uid`, `--setenv`, `-p`).
- **Debian/Ubuntu adduser:**
  https://manpages.debian.org/testing/adduser/adduser.8.en.html (re-confirm against
  Ubuntu 26.04 in E3J9C).
