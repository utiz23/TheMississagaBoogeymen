# Hotel-Echo Proton credential mechanism (option A) — templates and runbook

Repository templates for the E3J9 option-A credential mechanism: a dedicated,
locked `eanhl-cloud` system identity whose Proton Drive CLI credential is held in
`pass` under a dedicated no-passphrase GPG key. The authoritative design, the
acceptance protocol and the execution records are in
[`docs/planning/proton-drive-hotel-echo-credential-design.md`](../../../docs/planning/proton-drive-hotel-echo-credential-design.md)
(§ numbers below refer to it). Every host step is **separately authorized**: this
file installs nothing on its own, and a subcommand existing here is not an
authorization to run it.

**Current state (2026-09-26, design memo §19):** **E3J9C passed — for its
credential-foundation and local-proof scope only.** Installed on Hotel-Echo:
`pass` 1.7.4-8 + `tree`, the `eanhl-cloud` identity, the directories and lock,
the curated `PATH`, the wrapper, the corrected launcher, `lockhold` and probe,
the other validation scripts (kept until E3J9E, D8), the pinned CLI (never
executed), the service key with `gpg.conf`, and the initialised store
(`.gpg-id` only). M10 passed in full, one step at a time (A6 by the operator's
direct PTY observation), and the final owned-inventory matched. The staging
directory was removed. U1 and E3J9 remain open.

**2026-09-28 (design memo §20):** D1 was accepted. E3J9D stopped before any host
access because no reviewed provider reader existed. **E3J9D-R (independently
reviewed, checkpointed at `ef32c885` and integrated into `main`)** adds the launcher-owned `provider-probe` operation, the
probe's E4/N4 `e4-decoy` mode and the `unit-publish` helper, and deletes the
never-installed provider template. Nothing has been installed from E3J9D-R: review, checkpoint and the merge
into `main` are done, and after explicit E3J9D reauthorization (still required)
the launcher, the probe and `unit-publish` are reinstalled from that `main`
commit. E3J9E needs D7, and C1 must merge before any E3J10 step that executes
the CLI or can contact Proton. No authentication has happened and nothing is
scheduled.

Nothing here is secret. The repository holds paths, command names, the twelve
environment literals and public fingerprints only. Never add a key, a Proton
credential, canary plaintext, an authentication URL, a token or session content.

## Files

| Repository file                                    | Host target                                               | Owner / mode     |
| -------------------------------------------------- | --------------------------------------------------------- | ---------------- |
| `credential-exec`                                  | `/usr/local/lib/eanhl-cloud/credential-exec`              | root:root 0755   |
| `eanhl-cloud-credential`                           | `/usr/local/sbin/eanhl-cloud-credential`                  | root:root 0750   |
| `credential-bin.manifest`                          | symlinks in `/opt/eanhl-cloud/credential-bin/` (dir 0755) | root:root        |
| `credential-child-env.manifest`                    | none (reference copy of the wrapper's twelve literals)    | —                |
| `gpg.conf`                                         | `/var/lib/eanhl-cloud/gnupg/gpg.conf` (after `keygen`)    | eanhl-cloud 0600 |
| `pass-1.7.4-8.accepted-delta.escaped`              | none (evidence for the `pass` acceptance rule, §3)        | —                |
| `validation/eanhl-cloud-credential-probe.sh`       | `/usr/local/lib/eanhl-cloud/validation/` (same name)      | root:root 0755   |
| `validation/env-inspect`, `lockhold`, `pty-marker` | `/usr/local/lib/eanhl-cloud/validation/` (same names)     | root:root 0755   |
| `validation/owned-inventory`                       | same directory (rollback: a root-only temporary path)     | root:root 0755   |
| `validation/unit-publish`                          | `/usr/local/lib/eanhl-cloud/validation/unit-publish`      | root:root 0755   |
| `test/credential-templates.test.sh`                | none (local template tests)                               | —                |

The validation tooling (including `unit-publish`) is removed from the host after
E3J9E (D8). There is no probe unit file: local probe modes run only through the
launcher's `probe` operation, provider modes only through its `provider-probe`
operation (E3J9D-R; the former provider template is deleted and was never
installed).

## The installed `pass` (acceptance rule, §3)

Accepted exactly: package `pass` **1.7.4-8**; `/usr/bin/pass` a regular file,
root:root 0755, 25 821 bytes, SHA-256
`b0da432e8d377a67c7a74a9111c6b32889cce62f6e4f506a7bbdba817a268632`; the only
differences from upstream 1.7.4 are hunks H1–H7 (6 unified hunks, 7 change
blocks, 13 changed lines), recorded in the whitespace-clean escaped manifest
[`pass-1.7.4-8.accepted-delta.escaped`](pass-1.7.4-8.accepted-delta.escaped).
Each raw unified-diff line is written as `|<escaped>|`, with `\\` for a backslash
and `\t` for a TAB; the local test decodes it and compares it byte-for-byte with
the regenerated diff. `/usr/lib/password-store/extensions` exists,
is root-owned, not group/world-writable and empty. **Any other hash, version or
hunk means STOP.** The probe checks the hash (`pass_script_hash_match`) and
the extension directory (`pass_system_ext_dir_empty`).

## What each piece guarantees — and what it does not

- **`credential-exec`** is the only entry point for credential-bearing commands.
  It refuses unless it runs as `eanhl-cloud`, maps a closed set of command ids to
  fixed absolute paths, refuses unless the lock file already exists as a regular
  non-symlink file, and execs
  `/usr/bin/flock --exclusive --close <--nonblock|--wait=N> --conflict-exit-code 75
/var/lib/eanhl-cloud/locks/credential.lock /usr/bin/env -i <twelve literals> <cmd>`.
  Exit 75 means lock busy or wait expired (a command could also exit 75 itself,
  so "busy" evidence is exit 75 **and** no command output).
- **Environment boundary, stated precisely.** `bash -p` (every script here)
  disables Bash's own startup mechanisms: `BASH_ENV`/`ENV`, imported functions,
  and `SHELLOPTS`/`BASHOPTS`/`CDPATH`/`GLOBIGNORE` from the environment. It
  cannot neutralise the dynamic loader, which acts before Bash starts. The
  supported claim — no variable from the wrapper's environment reaches the
  credential command — assumes execution by a root-authored system unit with no
  untrusted loader variables. That is an assumption resting on root control,
  not a tested property.
- **Not an access-control boundary.** The wrapper, the launcher and root
  ownership are consistency controls for root-authored units. Code already
  running as `eanhl-cloud` can run gpg, pass or the CLI directly with any
  environment and any arguments, and is outside the protection boundary.
- **`eanhl-cloud-credential`** (root only) has fixed subcommands, no generic
  runner: `keygen`, `pass-init <fpr>`, `probe <local-mode>`, `probe-stop <unit>`,
  `pty-marker`, `env-proof`, `auth-login`, `auth-logout`,
  `provider-probe run|schedule|collect|discard <closed argument>` (E3J9D-R), and
  the rollback-only `entry-remove`, `canary-remove`, `key-delete <fpr>`.
  Local-only units get `PrivateNetwork=yes`; only `auth-login`/`auth-logout` and
  the `provider-probe` units get network ordering.
  There is no `StateDirectory=`/`CacheDirectory=`: a missing M3 directory fails
  the unit instead of being created or re-owned by systemd. Root never reads
  inside the `eanhl-cloud`-owned trees directly; those reads run as
  `eanhl-cloud` through `setpriv`.
- **Exit status is the result.** Every launcher subcommand exits 0 only when
  every operation **and** postcondition succeeded:
  - `keygen`: the expected key topology;
  - `pass-init`: `.gpg-id` exact and the only entry;
  - `auth-logout`, `entry-remove`, `canary-remove`: the unit succeeded and the
    entry is proven absent;
  - `key-delete`: no secret key left and the revocation file gone;
  - `pty-marker`: the unit succeeded and there are exactly 0 journal hits;
  - `env-proof`: three passing steps and 0 nonce hits;
  - `probe`/`probe-stop`: the accepted outcome and a successful cleanup;
  - `provider-probe` (E3J9D-R): each verb (`run`, `schedule`, `collect`,
    `discard`) exits 0 only when every applicable requirement defined under
    Provider probes below succeeds — its classified outcome, invocation and
    boot binding, identity and provenance checks, cleanup, publication or
    removal, and postconditions (design §11, §20). A refusal or an
    indeterminate state (for example `pending`) exits non-zero.

  A presence check reports `present`, `absent` or `error`; `error` never counts
  as absent. The check runs as `eanhl-cloud` and walks a fixed relative path
  from `/var/lib/eanhl-cloud`, listing each directory with a fixed `find`
  expression. `absent` is reported only after the containing directory was
  reached and listed successfully. An unreadable or inaccessible directory, an
  intermediate symlink or a malformed path gives `error`. It is not race-free
  against concurrent changes by `eanhl-cloud` itself (design §4). `lockhold free`
  and `fdcheck` exit non-zero unless the lock is free.

- **`probe <mode>`** starts exactly one fresh, never-reused transient unit with
  `probe local:<mode>`, binds its `InvocationID`, waits for it, reads **only**
  that invocation's journal records, prints only vocabulary lines, counts (never
  prints) any other line, and ends with `probe_run_result=pass|busy|fail`. Any
  failure at any stage is `fail`. Stale output of an earlier run cannot match.
  Cleanup is part of the result: a keep mode (`canary`, `lockhold-detach`,
  `lockhold-long`) is left running only after `pass`. Every other run is stopped
  and reset, `bound_cleanup_ok=` is printed, and a failed cleanup makes the run
  `fail`. `probe-stop` requires a loaded unit, and it fails unless the stop and
  the reset succeed.
- **The curated `PATH`** holds exactly the `credential-bin.manifest` links. `tty`,
  `xdg-open` and every browser or opener are absent by construction (A1, A3, A4).
- **Validation output** is limited to lines matching
  `^E3J9 [a-z_]+=[a-z0-9_.:-]+$`; a value outside it prints as `invalid`, and a
  failed scan behind a count prints `invalid` and fails — never `0`.

## Install order (E3J9C, M1–M10; each session separately authorized)

Literal paths only. No recursive `chown`/`chmod`/`rm`, and nothing may be adopted
from pre-existing state. Record every command and result in the design memo.
Commands run from a checkout of this directory on Hotel-Echo.

1. **M1 (done in E3J9C):** `pass` 1.7.4-8 + `tree` 2.3.1-1 installed. **M2–M7
   were done on 2026-09-26 (memo §19)**; re-verify the §3 acceptance rule and the
   installed hashes read-only before resuming.
2. **M2:**
   `sudo adduser --system --group --home /var/lib/eanhl-cloud --no-create-home --shell /usr/sbin/nologin eanhl-cloud`.
   Check: `passwd -S` locked, `id -G eanhl-cloud` = its own gid only, no linger
   file, no `authorized_keys`, no sudoers entry.
3. **M3** (in this order; then `stat` every path):
   ```bash
   sudo install -d -o eanhl-cloud -g eanhl-cloud -m 0700 /var/lib/eanhl-cloud
   for d in gnupg password-store config data locks; do
     sudo install -d -o eanhl-cloud -g eanhl-cloud -m 0700 "/var/lib/eanhl-cloud/$d"
   done
   sudo install -d -o eanhl-cloud -g eanhl-cloud -m 0700 /var/cache/eanhl-cloud
   sudo install -d -o root -g root -m 0755 /opt/eanhl-cloud /opt/eanhl-cloud/bin /opt/eanhl-cloud/credential-bin
   sudo install -d -o root -g root -m 0755 /usr/local/lib/eanhl-cloud /usr/local/lib/eanhl-cloud/validation
   sudo install -o eanhl-cloud -g eanhl-cloud -m 0600 /dev/null /var/lib/eanhl-cloud/locks/credential.lock
   ```
   The last line must yield an empty regular file (`stat` shows
   `regular empty file 600`); the host `install` may be uutils — **[VALIDATE]**.
4. **M4:** one root-owned symlink per manifest line, then A1:
   ```bash
   grep -v -E '^(#|$)' credential-bin.manifest | while read -r name target; do
     sudo ln -s -- "$target" "/opt/eanhl-cloud/credential-bin/$name"
   done
   ```
5. **M5/M7:** `sudo install -o root -g root -m 0755 credential-exec /usr/local/lib/eanhl-cloud/credential-exec`;
   `sudo install -o root -g root -m 0750 eanhl-cloud-credential /usr/local/sbin/eanhl-cloud-credential`;
   each validation script (E3J9D-R: including `unit-publish`; there is no unit
   file) with
   `sudo install -o root -g root -m 0755 validation/<name> /usr/local/lib/eanhl-cloud/validation/<name>`.
   Record `sha256sum` of every installed file and compare with the repository.
6. **M6 (never executed):** acquire the CLI as the authorization names; then
   ```bash
   sha512sum <source>                     # = the pin
   sudo install -o root -g root -m 0755 -T <source> /opt/eanhl-cloud/bin/.proton-drive.new
   sudo sha512sum /opt/eanhl-cloud/bin/.proton-drive.new   # = the pin
   sudo mv -T /opt/eanhl-cloud/bin/.proton-drive.new /opt/eanhl-cloud/bin/proton-drive
   sudo sha512sum /opt/eanhl-cloud/bin/proton-drive        # = the pin
   ```
7. **M8:** `sudo eanhl-cloud-credential keygen` (refuses unless GNUPGHOME is the
   empty M3 directory). Then install `gpg.conf` **as `eanhl-cloud`** (never as
   root into its directory; `set -C` refuses an existing file):

   ```bash
   ( cd / && sudo /usr/bin/setpriv --reuid=eanhl-cloud --regid=eanhl-cloud --clear-groups -- \
     /usr/bin/bash -p -c 'umask 077; set -C; cat > /var/lib/eanhl-cloud/gnupg/gpg.conf' ) < gpg.conf
   ```

   `< gpg.conf` sits **outside** the group: the shell opens the checkout's
   `gpg.conf` first, then the group enters `/`, so the service identity never
   inherits the operator's working directory (design §19.5) and never reads
   `/gpg.conf`.

8. **M9:** `sudo eanhl-cloud-credential pass-init <fpr>` (A9: refuses unless the
   store is empty and correctly owned; that it is the M3 directory is
   established by the session record).
9. **M10:** the proofs below.

## Acceptance procedures (E3J9C; §11)

Use **only** these operations. Never raw `systemctl start` or `journalctl`.
`<unit>` is the `bound_unit=` value a `probe` run prints.

**Run the rows one at a time.** Start one probe or launcher operation, evaluate
it completely (exit status, `probe_run_result`, `bound_cleanup_ok`, and every
count or boolean its row requires), and stop before starting the next on any
failure. Never launch several rows in one loop and evaluate afterwards (design
§19.7). Only K1, K4, K5 and K6 start overlapping operations by design; each is
evaluated as one step.

| Test                        | Procedure                                                                                                                                                                                                                                   | Pass                                                                                                                                                            |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A1                          | For each manifest link: `stat -c '%F %U:%G'` = `symbolic link root:root`; `readlink` = manifest target; record `readlink -f`, `dpkg -S <final>` and owner/mode of every hop; directory listing = manifest exactly; directory root:root 0755 | all match; any change later = STOP                                                                                                                              |
| A2                          | `( cd / && sudo /usr/bin/setpriv --reuid=eanhl-cloud --regid=eanhl-cloud --clear-groups -- /usr/bin/test -w <path> )` for the curated dir, every final target, `/opt`, `/opt/eanhl-cloud`, `bin/`, the CLI, the wrapper, the launcher       | every test fails (exit 1)                                                                                                                                       |
| A3, A4, E2 (helpers)        | `sudo eanhl-cloud-credential probe precheck`                                                                                                                                                                                                | `probe_run_result=pass`                                                                                                                                         |
| A5 / L1, A10 (absent entry) | `sudo eanhl-cloud-credential probe local`                                                                                                                                                                                                   | pass                                                                                                                                                            |
| A10 (`neg-uninit`)          | `sudo eanhl-cloud-credential probe neg-uninit`                                                                                                                                                                                              | pass                                                                                                                                                            |
| A6                          | `sudo eanhl-cloud-credential pty-marker` in a terminal                                                                                                                                                                                      | nonce seen on the PTY; `pty_marker_journal_hits=0`                                                                                                              |
| A7                          | `sudo sha512sum /opt/eanhl-cloud/bin/proton-drive`                                                                                                                                                                                          | = pin                                                                                                                                                           |
| A8                          | `sudo /usr/local/lib/eanhl-cloud/validation/lockhold free`                                                                                                                                                                                  | `lock_free_nonblock=true`                                                                                                                                       |
| E1(a)                       | installed wrapper sha256 = repository file; the local test proves the template                                                                                                                                                              | equal                                                                                                                                                           |
| E1(b), E2, E3               | `sudo eanhl-cloud-credential env-proof`                                                                                                                                                                                                     | three `envproof_step_result=pass`; `envproof_nonce_journal_hits=0`; supplementary `proc_obs` never cited as proof                                               |
| L2                          | confirm no `eanhl-cloud` unit is active, then `probe local` again                                                                                                                                                                           | pass; `gpg_agent_count_at_start=0`                                                                                                                              |
| K1                          | shell A: `probe lockhold-hold`; shells B, C, D at ≈2 s, ≈10 s, ≈18 s: `probe busy-a`, `busy-b`, `busy-c`                                                                                                                                    | A pass; each B/C/D `busy`                                                                                                                                       |
| K2                          | `probe lockhold-detach` (kept); `lockhold fdcheck <unit>.service`; then `probe-stop <unit>`                                                                                                                                                 | descendant count 1, `lock_fd_holder_count=0`, `lock_free_nonblock=true`                                                                                         |
| K3                          | `probe canary` (kept); `lockhold fdcheck <unit>.service`; then `probe-stop <unit>`                                                                                                                                                          | agent count ≥ 1, `lock_fd_holder_count=0`, `lock_free_nonblock=true`                                                                                            |
| K4                          | shell A: `probe lockhold-long`; shell B: `probe busy-d`                                                                                                                                                                                     | B `busy` immediately. The `--wait` expiry half is proven by the local test only (no launcher operation uses `--wait`); its host proof belongs to E3J10          |
| K5                          | shell A: `probe lockhold-long`; during the hold, shell B: `probe-stop <unit>`; then `lockhold free`, `lockhold fdcheck <unit>.service`, and `probe local`                                                                                   | lock free, 0 processes, `store_other_entry_count=0` at the start of `local`. A's own result is `fail` by design; K5 is judged only by the checks after the stop |
| K6                          | start `probe canary-a` and `probe canary-b` at the same time in two shells                                                                                                                                                                  | exactly one `pass`, one `busy`; entry intact                                                                                                                    |
| inventory                   | `sudo /usr/local/lib/eanhl-cloud/validation/owned-inventory` — both modes require no `eanhl-cloud` process at all and no active credential unit (else code 4, no resident-agent exception)                                                  | match=true, count 0, code 0                                                                                                                                     |

Known stop-window limitation (§4): with `KillMode=control-group`, a stop sends
SIGTERM to the `flock` parent and the command together; `flock` does not handle
SIGTERM, so the lock is released while pass/gpg may still be exiting. E3J9 has
no concurrent writer; this is an **E3J10 design blocker**.

## Authentication (E3J9D only, gated by D1)

The operator alone runs `sudo eanhl-cloud-credential auth-login` in their own SSH
terminal. The launcher first runs a fail-closed preflight (CLI pin; store holds
exactly `.gpg-id` matching the key; no `auth-session.json`; no active
`eanhl-cloud-*` unit; every `eanhl-cloud` process satisfies a structured
resident-agent rule — exact final executable path, all four uids equal to the
service uid, the rule's exact `PPid`, and exactly one cgroup v2 line whose path
matches the rule — with at most one process per rule; the lock can be acquired).
The rules come only from M8/L2 host evidence and the list is **empty** until
then, so any resident process refuses. The preflight reads only
`/proc/<pid>/exe`, the `Uid:`/`PPid:` lines of `status`, and `cgroup` — never a
process's command line or environment. No agent runs the ceremony, sees its output or handles the URL.
Open the URL on another device, never paste it anywhere, and clear scrollback
afterwards. A timeout (900 s) is a STOP.

**P0 (straight after a clean ceremony, exactly once, no retry):**
`sudo eanhl-cloud-credential provider-probe run provider`. Accept only exit 0 with
`provider_run_result=pass`, `bound_cleanup_ok=true`, `bound_single_invocation=true`,
`bound_boot_id_match=true`, `bound_nonvocab_lines=0`, `bound_disallowed_lines=0`,
`provider_result=ok` and every `pp_post_*` true or 0; then
`sudo /usr/local/lib/eanhl-cloud/validation/owned-inventory` must report
`owned_expected_set_match=true`. Any other outcome is a STOP.

## Provider probes (E3J9D/E3J9E; design §20)

`provider-probe` is the only path for a provider probe mode. Each verb is a
capability, not an authorization; E3J9D uses only `run provider`.

| Verb       | Argument (closed)                                                                                       | What it does                                                                                                                            |
| ---------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `run`      | `provider`, `provider-freshcache`, `neg-nokey`, `neg-nostore`, `n3-busy`, `e4-decoy`                    | one fresh `eanhl-cloud-cred-pprobe-now-<mode>-<32 hex>` unit, started once, read through the invocation-bound runner, always cleaned up |
| `schedule` | `t20m`, `t6h15m` (transient timer), `boot` (a generated pair published by `unit-publish`, then enabled) | one fresh pair, attested before it can fire; mode `provider`                                                                            |
| `collect`  | `t20m`, `t6h15m`, `boot`                                                                                | proves the pair, reads the fired invocation (`pending` if it has not fired), removes the pair                                           |
| `discard`  | `now`, `t20m`, `t6h15m`, `boot`                                                                         | provenance-checked removal only; never reads the journal                                                                                |

- Preconditions refuse (exit 65) before any provider contact: CLI pin, one key
  and `.gpg-id`, the entry `0600`, no extra store entry or `auth-session.json`, no
  other active credential unit or pprobe object, no `eanhl-cloud` process, the
  lock free (`n3-busy`: held by the attested `lockhold-long` unit), network-online
  active (`run`), a valid boot id.
- Output: only `^E3J9 [a-z_]+=…` lines; provider records only with a name the
  mode's probe arm emits and a value of its class; everything else is counted.
- Provenance: `collect`, `discard` and `probe-stop` touch only objects that
  attest as the launcher's (and, for the boot pair, equal the canonical bytes);
  an object that does not attest is never touched (`collect`/`discard`:
  `pp_provenance=<reason>`, exit 65 when refused at discovery; `probe-stop`:
  `probe_provenance=unproven`, exit 1). A refusal is a STOP for operator-only
  review — never a manual or old-launcher removal.
- Sequencing (enforced): `run` refuses while any pprobe object exists;
  `schedule boot` refuses until the delayed pairs are collected; run
  `owned-inventory` only when nothing is armed.

## Recovery and rotation (§5)

There is no in-place re-encryption and no off-host key backup. Because `keygen`
requires an empty keyring and `pass-init` exactly one key, the order is:

1. local logout: `auth-logout` (if it fails, `entry-remove`, separately
   authorized);
2. remove the store contents, proven by metadata, and recreate the store
   directory empty (`install -d`);
3. **delete the old key** (`key-delete <old-fpr>`) — after step 2 it protects
   nothing;
4. `keygen`;
5. `pass-init` on the proven-empty store;
6. **a new operator login**.

## Rollback (§12; each step separately authorized)

**Current state (E3J9C passed, design memo §19):** M1–M10 are done for the
credential-foundation and local-proof scope only. No authentication, provider
contact, persistence or reboot validation, or activation has happened, so no
Proton entry exists: a rollback from this state follows the order below without
steps 2–3, and step 1 applies only to objects a later session created. (While
M1 was the only host change, the package step alone applied.)

**Package step (step 9):** review `apt-get -s remove pass tree`; confirm with
`apt-cache rdepends --installed tree` that nothing else needs `tree`; read the M1
transaction in `/var/log/apt/history.log`; then remove both. **Never run
`autoremove`.** Removing `pass` also removes its empty extensions directory.

**Order** (each step separately authorized):

1. Stop E3J9 units (`probe-stop` for kept probe units) and remove every pprobe
   object with `provider-probe discard <slot>` (provenance-checked; a refusal is a
   STOP for operator-only review, never a literal-path, manual or old-launcher
   removal); `daemon-reload`.
2. Local logout: `sudo eanhl-cloud-credential auth-logout` — **not** remote
   revocation; verify by metadata that the entry is gone. If it fails and the
   entry must go: `entry-remove`. A leftover canary: `canary-remove`.
3. Remote session revocation and a password change are separate operator actions.
4. Password store: only if metadata shows exactly `.gpg-id` plus empty
   directories, remove them (as below). Otherwise stop for operator review.
5. Key deletion: `sudo eanhl-cloud-credential key-delete <fpr>` (refuses unless
   it is the only key and the store holds no entry; it also removes
   `openpgp-revocs.d/<FPR>.rev`).
6. GNUPGHOME, data, config, logs, cache, `locks/`: key files are named by
   keygrip, so exact paths are not known in advance. Generate a metadata table,
   review it, then delete **as `eanhl-cloud`** —
   `( cd / && sudo /usr/bin/setpriv --reuid=eanhl-cloud --regid=eanhl-cloud --clear-groups -- /usr/bin/find <literal top> -xdev -depth -type <reviewed types> -delete )`
   — and let root `rmdir` only verified-empty top directories.
7. Remove the launcher, the wrapper, the curated directory, and `/opt/eanhl-cloud`
   (the last after an E3J10 dependency review).
8. Account: run `owned-inventory expect-none` from a root-only temporary copy
   (e.g. `/run/eanhl-cloud-rollback/`, removed afterwards; never recreate
   `/usr/local/lib/eanhl-cloud`): it requires that no process runs as
   `eanhl-cloud` and reports match=true only if the identity owns nothing; then
   `deluser --system eanhl-cloud` and `delgroup eanhl-cloud`.
9. Package: as above (`pass` and `tree`, no `autoremove`).

## Local tests

```bash
E3J9_PASS_UPSTREAM=<password-store 1.7.4 script> E3J9_PASS_INSTALLED=<Ubuntu pass 1.7.4-8 copy> \
  bash ops/backup/credential/test/credential-templates.test.sh
```

They prove template construction and logic on the local machine, including
mutation checks that each security check fails on a weakened template. They do
**not** prove any Hotel-Echo behaviour, dynamic-loader isolation, or protection
against code running as `eanhl-cloud`. `--static-only` skips the accepted-delta
regeneration and says so.

## Exposure (summary of §9)

Anything running as `eanhl-cloud`, root, or with offline disk access can use the
stored Proton session. `/var/lib/eanhl-cloud` and `/var/cache/eanhl-cloud` must be
kept out of host backups, or any such backup must be treated as containing the
credential.
