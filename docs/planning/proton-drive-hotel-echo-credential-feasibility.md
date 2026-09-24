# Proton Drive on Hotel-Echo — service-compatible credential feasibility (E3J9A)

**Stage:** E3J9A · **Date:** 2026-09-24 · **Type:** read-only host inspection +
desk assessment · **Status:** complete as feasibility evidence; **U1 and E3J9
remain open.**

This memo records what a strictly read-only inspection of Hotel-Echo found about
the prerequisites for a non-interactive, headless, service-mode Proton Drive CLI
invocation across the intended six-hour schedule and reboot. It narrows the
candidate credential mechanisms. It proves no persistence property, provisions
nothing, and authorizes nothing: E3J9 setup, E3J10, deployment, scheduling and
E3J8B all remain unauthorized.

Evidence tags used throughout:

| Tag | Meaning |
| --- | --- |
| **[HE-OBS]** | Observed read-only on Hotel-Echo during one of this session's SSH calls — a point-in-time fact about that SSH session |
| **[REPO]** | Repository evidence (code, earlier memos) |
| **[E3I]** | Main-PC evidence from E3I (`proton-drive-scratch-experiment.md`) |
| **[INFER]** | Reasoned conclusion, not tested |
| **[UNKNOWN]** | Not determinable within this session's scope |
| **[NEEDS-MUTATION]** | Requires a separately authorized setup/mutation session |
| **[NEEDS-OPERATOR]** | Requires operator interaction, Proton authentication, secret provisioning, or logout/idle/reboot observation |

---

## 1. Scope, method and what was not done

- **Baseline (local, before and after):** `main`, `HEAD` = `origin/main` =
  `bc4c0f777110cba798807f78c94269776eff15f3`, index empty, only the unrelated
  user-owned `docs/design/roster-stats-design/` untracked (not touched).
- **Access:** six non-interactive SSH calls (`BatchMode=yes`, stdin
  `/dev/null`, 90 s `timeout`) to `utiz@100.98.29.119` over the existing
  Tailscale path. H0 identity gate passed: hostname `hotel-echo`, the archived
  Stage D identity marker matched, user `utiz` (uid/gid 1000). **[HE-OBS]**
- **Commands:** exactly the approved plan's H0–H5, classified below. H4 is
  self-gated and **skipped itself** (its prerequisite was absent). A
  Claude Code permission prompt interrupted H3 once; the identical command was
  re-issued after one-time operator approval and ran once. The interruption is
  a local tooling event, not a host finding.

| Step | Evidence purpose | Commands (read-only) |
| --- | --- | --- |
| H0 | Identity gate | `hostname`; `grep -q` identity-marker match (no address printed); `id`; `$HOME`/`$SHELL` |
| H1 | Host / service environment | `/etc/os-release`; `uname -srm`; kernel `osrelease`; `systemd-detect-virt` (and `-c`); PID 1 `comm`; `systemctl --version`; `systemctl is-system-running`; `systemctl --user is-system-running`; `loginctl show-user -p Linger -p State -p RuntimePath`; `stat` of the linger file; nine named variables printed individually; `stat /run/user/1000` |
| H2 | Prerequisite presence | `command -v` for 21 named tools; `dpkg-query -W`; `apt-cache policy` (existing local index, no update); `update-alternatives --query pinentry`; `stat` of the documented CLI path |
| H3 | Credential-store / agent metadata | `stat` of named credential, Proton-state, keyring, systemd-user and runtime-socket paths; `systemctl --user list-unit-files` / `is-active` for named units; `ps -e -o user=,pid=,comm=` filtered to named agents |
| H4 | Secret Service name registration | Self-gate (bus socket + `dbus.service` active + `dbus-send`) → **skipped** |
| H5 | Service identity / storage posture | `getent passwd/group eanhl-backup`; `stat` of its linger file; `findmnt -T /` and `-T /home`; `lsblk`; `stat` of TPM device/sysfs paths and `credential.secret`; second `ps` observation |

**Not done, in either direction:** no Proton CLI execution (none was found on
`PATH` or at the documented user path); no `pass`, `gpg`, `gpg-agent`,
`gpg-connect-agent`, `gpgconf`, `pinentry`, `secret-tool`, `systemd-creds` or
`tpm2_*` execution; no
authentication or logout; no sudo, install, removal, upgrade or apt update; no
service, socket, linger or configuration change; no directory listing, no
file-content read under any credential, config, startup or unit path; no
environment dump; no direct `dbus-send` query and no Secret Service name
query — H4 skipped because its conservative gate required `dbus.service` active
and that condition was false (status queries such as `loginctl` and
`systemctl --user` still ran and used the normal manager/bus infrastructure);
no Docker, database, tunnel, deployment, scheduling, reboot, logout or idle
wait; no git on Hotel-Echo; no provider or other external contact.

### 1.1 Causality boundary — how to read every host observation

- Each SSH call is its own login session, with sshd/PAM activity and login
  records (wtmp/journal). Six calls were six separate observations.
- Which shell startup files the remote shell sourced is **not established**;
  no startup-file contents were inspected.
- `pam_systemd` may create or expose a user manager and `/run/user/1000` for
  each session.
- Therefore every user-manager, D-Bus, runtime-directory, socket and process
  fact below is **point-in-time during an SSH session** — not evidence of
  state at boot, before login, after logout, or under a scheduled service. No
  process is attributed to startup configuration or to E3J9A.
- **One correlation, stated as inference only:** the runtime socket mtimes
  observed in H3 (`2026-09-24 07:29:25Z`) are ~30 s before a local clock
  reading taken shortly after H3 returned (`07:29:53Z`). With `Linger=no`,
  that is **consistent with** the SSH session itself having (re)created the
  user runtime directory, but it does not prove it. **[INFER]**
- The two `ps` observations (H3, H5) are two time-separated point
  observations. They cannot show that E3J9A caused, or did not cause, any
  process lifecycle change.
- Reading files may update atime (root filesystem is mounted `relatime`).
  Only existing metadata was read; no remote file was intentionally created or
  modified.

---

## 2. Host facts (all **[HE-OBS]**, point-in-time SSH observations)

| Area | Observation |
| --- | --- |
| OS / kernel | Ubuntu 26.04.1 LTS; Linux 7.0.0-30-generic; x86_64 |
| Virtualization | `systemd-detect-virt` = `none`; `-c` = `none` — native Linux, not WSL, VM or container as detected |
| Init | PID 1 = `systemd`; systemd **259** (259.5-0ubuntu3.4); system state `running` |
| User manager | `systemctl --user is-system-running` = `running` (during the session) |
| Session / linger | `loginctl`: `State=active`, `RuntimePath=/run/user/1000`, **`Linger=no`**; no linger file for `utiz` |
| Runtime dir | `/run/user/1000` directory, mode 700, `utiz:utiz` |
| Session variables | `XDG_RUNTIME_DIR=/run/user/1000`; `DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus`; `GNUPGHOME`, `PASSWORD_STORE_DIR`, `GPG_AGENT_INFO`, `XDG_DATA_HOME`, `XDG_CONFIG_HOME`, `XDG_CACHE_HOME`, `TMPDIR` all **unset** — interactive-SSH values, **not** canonical service-mode values |
| Proton CLI | **Absent** — not on `PATH`, nothing at `~/.local/bin/proton-drive`; so no hash comparison with the main-PC baseline was possible |
| `pass` | **Absent** (no command, no package). Local-index candidate `1.7.4-8` |
| GnuPG | `gnupg`/`gpg`/`gpg-agent` **2.4.8-4ubuntu3.1** installed; `gpg`, `gpg-agent`, `gpgconf` on `PATH` (none executed) |
| pinentry | `pinentry-curses` 1.3.2-3ubuntu1 is the only registered alternative; `pinentry-tty`/`-gnome3`/`-qt` absent (tty candidate `1.3.2-3ubuntu1` in local index) |
| Secret Service | None of the inspected common provider packages/tools installed (`gnome-keyring`, KWallet, KeePassXC); no libsecret library or `secret-tool`; no keyring runtime path among the named paths. Registration or activation of some other/custom provider was not queried (H4 skipped). Local-index candidates: `gnome-keyring` 50.0-1, `libsecret-tools` 0.21.7-2build1 |
| D-Bus | `dbus`, `dbus-bin`, `dbus-user-session` 1.16.2-2ubuntu4 installed; `dbus-broker` not installed; `dbus-send` present |
| systemd credentials / TPM | `systemd-creds` on `PATH` (not executed); `tpm-udev` 4.1.3-6 installed; `tpm2-tools` absent (candidate 5.7-1build1); **no `/dev/tpm0`, `/dev/tpmrm0` or `/sys/class/tpm/tpm0`**; no `/var/lib/systemd/credential.secret` |
| `~/.gnupg` (default path) | **Does not exist** (nor any of the named files under it); other GnuPG homes were not looked for |
| `~/.password-store` | **Does not exist** |
| Proton CLI state dirs | `~/.local/share/`, `~/.config/`, `~/.cache/` `proton-drive-cli` — **none exist** |
| Keyrings / user units | `~/.local/share/keyrings` and `~/.config/systemd/user` — **do not exist** |
| Runtime sockets | User bus socket present (mode 666). Runtime `gnupg` directory (700) and all four standard gpg-agent socket paths queried by name exist (600, `utiz:utiz`); no keyring runtime path |
| User units | `gpg-agent.socket` and its three companion sockets and `keyboxd.socket` **enabled** (vendor preset); `gpg-agent.socket` **active**, `gpg-agent.service` **inactive**; `dbus.socket` **active**, `dbus.service` **inactive** |
| Processes (H3 and H5) | Among the named set, only one `dbus-daemon` running as the system message-bus user; no `gpg-agent`, `keyboxd`, keyring or `pinentry` process at either observation |
| Service identity | No `eanhl-backup` user or group (`getent` rc 2 for both); no linger file for it |
| Storage | `/` and `/home` resolve to the same ext4 filesystem on a plain disk partition, `rw,relatime`; `lsblk` shows **no `crypt` layer** — full-disk encryption **not evidenced** (not the same as "not encrypted") |

What the metadata does **not** establish: anything about other users or root;
arbitrary system-wide or manually installed binaries beyond the named
`command -v`/package checks; custom service-unit environments; alternate
`XDG_*`, `GNUPGHOME`, `PASSWORD_STORE_DIR` or Proton-state locations; whether
any GPG identity or key exists anywhere other than the default path; whether a
Secret Service name is registered or activatable by some other/custom provider
(H4 did not run); effective gpg-agent TTLs, system-level GnuPG
configuration, whether firmware has a TPM that is disabled or hidden, how the
user manager, agent and bus behave without an SSH session, after logout, under
a scheduled service, or after reboot. **[UNKNOWN]**

---

## 3. Conclusions supported by those facts

1. **The inspection established no usable Proton credential mechanism or
   Proton session for `utiz` in the inspected default/current-session
   locations.** The Proton CLI, `pass`, and the inspected default state/store
   paths (`~/.gnupg`, `~/.password-store`, the three `proton-drive-cli` XDG
   directories) were absent; none of the inspected common Secret Service
   provider packages/tools was installed; no `eanhl-backup` identity exists.
   **[HE-OBS]** The inspection covered the `utiz` account, its active SSH
   environment, documented/default user paths, named packages/tools and
   specifically queried paths. It did **not** search other users or root,
   arbitrary system-wide or manually installed binaries, custom service-unit
   environments, or alternate environment-selected `XDG_*`, `GNUPGHOME`,
   `PASSWORD_STORE_DIR` or Proton-state locations — so it does **not**
   establish universal absence across those, including whether any GPG
   identity or key exists elsewhere. **[UNKNOWN]** For the inspected context,
   whatever mechanism is chosen starts from missing prerequisites, which are
   remediable. **[NEEDS-MUTATION]**
2. **Installed building blocks:** GnuPG 2.4.8 with socket-activated per-user
   gpg-agent units and `pinentry-curses`; D-Bus prerequisites
   (`dbus`, `dbus-user-session`); systemd 259 with `systemd-creds`.
   **[HE-OBS]**
3. **No hardware- or disk-encryption-backed protection is evidenced.** No TPM
   device path is exposed and no `crypt` layer appears under `/`. **[HE-OBS]**
   "Not evidenced" is not "does not exist": firmware may hold a disabled TPM,
   and other protection may exist outside what `lsblk` shows. **[UNKNOWN]** On
   current evidence, key material usable by an unattended service after reboot
   would be protected by file permissions, account separation and root
   integrity rather than by hardware or disk encryption. **[INFER]**
4. **`Linger=no` for `utiz`.** Under standard systemd behaviour a `systemd
   --user` manager and its socket-activated agents do not persist without a
   login session. **[INFER]** — not observed; logout/idle/reboot observation is
   **[NEEDS-OPERATOR]**. This bears on a user-unit design only; a system
   service running as a dedicated account does not inherently depend on
   linger. **[INFER]**
5. **The interactive-SSH values of the allowlisted variables are not canonical
   service-mode values** (`ENV_ALLOWLIST`,
   `ops/backup/lib/internal/backup-cloud-cli-core.mjs`). Canonical values
   remain an E3J9/E3J10 question. **[REPO]** + **[HE-OBS]**
6. **Secret Service registration is unknown.** None of the inspected common
   provider packages/tools was installed and no keyring runtime path was found
   among the named paths, but no direct `dbus-send` or Secret Service name
   query ran (H4 skipped), so registration or activation of some other/custom
   provider is unknown. **[UNKNOWN]**

---

## 4. Candidate assessment

Missing packages below are remediable prerequisites, not by themselves
evidence that an experiment would be unsafe. In every candidate the uploader
keeps its rule: it consumes an already-available credential context and
performs no unlock operation itself
(`proton-drive-cloud-transport-architecture.md` §7.2). **[REPO]**

| # | Candidate | Present | Missing | Survives reboot unattended? | Uploader-rule compatible? | Read-only verdict |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `pass` + passphrase-protected dedicated key, operator-unlocked | gpg 2.4.8, gpg-agent socket units, pinentry-curses | Proton CLI, `pass`, key, store; plus whatever the chosen unit model needs | **No** — only while an agent holds the unlocked key | Yes, if unlock is done outside the uploader | **Open, operator-gated class only** |
| 2 | `pass` + non-interactive / service-readable key | same as 1 | same as 1 | Designed to permit unattended reboot use, but **unproven**; requires setup and service-mode ≥ 6 h / logout / reboot observation | Yes | **Open; not selected** — requires the operator to accept the exposure below |
| 3 | `pass` + systemd-credential / TPM-assisted unlock | `systemd-creds`, systemd 259, `tpm-udev` | an exposed TPM (for the TPM form), `tpm2-tools`, all of 1's gaps | TPM form: **no exposed TPM was evidenced; viability unknown** pending firmware/host investigation; non-TPM form: **semantics not established** | Yes, if a separate unit (not the uploader) makes the key available | **Open; needs official-documentation research, and firmware inspection for the TPM form** |
| 4 | Secret Service (`keychain`) under a headless service | `dbus-user-session`, `dbus-send` | an installed provider (none of the inspected ones is), libsecret, a session bus available to the service, a headless unlock path | **Unknown; no headless unlock path evidenced** | Yes in principle | **Not recommended** on current evidence |
| 5 | Operator-gated design + compensating freshness rule | as 1 | as 1, plus an operator cadence | No — intentionally not unattended | Yes | **Conceptually available after setup; not currently available on Hotel-Echo** |
| 6 | `unsafe_file` | — | — | — | — | **Rejected (unchanged)** |

Per-candidate detail:

1. **Operator-unlocked protected key.** **[E3I]/[REPO]:** on the main PC, with
   documented default agent TTLs, the cached key was absent at +3 h 54 m and
   +25 h. **[HE-OBS]:** the default `~/.gnupg` path does not exist on
   Hotel-Echo, so there is no user-level `gpg-agent.conf` at that path.
   **[UNKNOWN]:** system-level configuration, effective TTLs, agent lifecycle
   and cache behaviour on Hotel-Echo. A longer cache TTL could never survive
   reboot by itself. This remains an operator-unlocked design unless some
   separately authorized mechanism makes the key available again. Secret at
   rest: a passphrase-protected key; host compromise while unlocked exposes the
   session.
2. **Service-readable key.** Stated plainly: **filesystem permissions of the
   service identity become the effective protection, and compromise of that
   identity (or root) recovers the stored Proton session.** With no disk
   encryption evidenced, offline access to the disk would likely expose it too
   **[INFER]**. A dedicated or otherwise restricted identity narrows who can
   read it; it does not remove the exposure. Rollback: delete the key and
   store, revoke the Proton session.
3. **systemd credentials / TPM.** `systemd-creds` was neither executed nor
   researched against official documentation in this session, so **non-TPM
   systemd-credential behaviour and protection semantics were not
   established**; they need separate official-documentation research before any
   setup design. **[UNKNOWN]** Any design that ultimately stores
   service-usable key material on the same host must document its at-rest,
   service-account, root-compromise and offline-disk exposure. No exposed TPM
   was evidenced (no TPM device or sysfs path observed); TPM viability remains
   unknown pending firmware/host investigation, and firmware could expose one
   later. **[NEEDS-OPERATOR]**
4. **Secret Service.** Needs a provider installed, a user bus available to the
   service, and an unlock trigger without a graphical PAM login. Nothing
   observed shows a plausible path to that last part; package presence alone
   would be insufficient.
5. **Operator-gated + freshness rule.** A conceptually available design option
   **after** separately authorized prerequisite installation, credential
   provisioning and Proton authentication — **not currently available on
   Hotel-Echo**, where the Proton CLI, `pass` and the default password-store
   path are absent. It is intentionally not unattended: a human unlocks per
   window, and the approved E3J7 8 h / 24 h freshness bands and the E3J8
   alerting design (not yet activated) then apply to the human cadence.

---

## 5. Decision: no unattended credential-mechanism experiment selected yet

Applying the approved evidence-driven rule:

- **E3J9A selects no unattended credential-mechanism experiment yet.** On
  current evidence (no TPM path, no `crypt` layer evidenced), an unattended
  mechanism intended to work after reboot would rely on service-usable key
  material protected by permissions and account separation — so choosing one
  needs an operator decision about credential availability and protection
  first.
  **[HE-OBS]** + **[INFER]**
- Protected-key designs (1, 5) cannot survive reboot unattended; the
  service-readable design (2) is designed to permit it, at the stated
  exposure, but that is unproven until setup and service-mode ≥ 6 h / logout /
  reboot observation. **Which trade-off to accept is an operator risk
  decision, not something host evidence can settle.**
- Candidate 3 stays open pending documentation research (non-TPM form) and
  firmware inspection (TPM form).
- Secret Service is not recommended on current evidence.
- `unsafe_file` remains rejected.

**The blocker is an operator choice among** **[NEEDS-OPERATOR]**:

- **(a)** accepting a service-readable credential under a dedicated or
  otherwise restricted identity, with the candidate 2 exposure written down;
- **(b)** using an operator-gated protected credential, accepting the loss of
  unattended reboot operation (candidate 5);
- **(c)** investigating whether firmware can expose a TPM before designing a
  TPM-assisted mechanism (candidate 3).

After that choice, one mechanism-specific setup experiment can be designed. Its
separate authorization covers only what the chosen design needs:

- sudo and a dedicated identity **only if** the design creates that identity
  or installs system-wide components;
- linger **only for** a `systemd --user` design — a system service running as
  a dedicated account does not inherently require it; the choice between a
  system unit and a user unit is itself an E3J9/E3J10 deployment decision;
- package installation (e.g. `pass`, the official Proton CLI pinned by
  SHA-512), key provisioning and operator-performed Proton `auth login`, as
  applicable;
- lifecycle observation: **logout and reboot tests remain required for any
  claim about unattended lifecycle behaviour**, over at least one six-hour
  interval.

**[NEEDS-MUTATION]** + **[NEEDS-OPERATOR]**

## 6. What remains to close U1 / E3J9

1. The operator choice in §5.
2. For candidate 3: official systemd-credential documentation research, and
   firmware inspection for the TPM form.
3. A separately authorized setup session implementing exactly one mechanism,
   with the system-unit vs user-unit decision made.
4. Canonical, trusted values for every allowlisted credential-related variable
   under the real service unit (E3J9/E3J10).
5. Service-mode, non-TTY CLI reuse observed across ≥ 6 h, logout and reboot on
   Hotel-Echo.
6. Documentation of the resulting at-rest, service-account, root-compromise
   and offline-disk exposure.

**U1: open (further narrowed). E3J9: not complete. E3J10, deployment,
scheduling and E3J8B: not authorized.**
