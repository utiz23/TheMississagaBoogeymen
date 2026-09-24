# Cloud-backup monitoring export (E3J8A)

> **NOTHING HERE IS ACTIVATED, AND NOTHING IS MONITORED.** This document
> describes code that exists locally and has never been run against
> Healthchecks.io. No account, check, ping key, Pushover integration or e-mail
> integration has been created, nothing schedules the command, and **no human
> has received a test notification**. Until all of that is true, the correct
> description of the system remains the one in
> `docs/planning/proton-drive-cloud-transport-architecture.md` §5.6:
> **"attestations are written; nobody is watching them."** Both the freshness
> signal and the export report carry a fixed `"monitored": false` field that
> says so, and validation refuses any other value.

---

## 1. THE ACCEPTED RISK — read this first

**The Healthchecks project ping key is a bearer credential with project-wide
blast radius.** Anyone who holds it can ping _any_ check in the Healthchecks
project — including **forging a healthy ping for this one**, which would keep the
dead-man's switch quiet while backups were silently failing.

That risk is **explicitly accepted** by operator decision. It is not mitigated
here, and this document does not pretend otherwise. What follows from accepting
it:

- the key file is owner-only and mode **exactly `0600`**, outside the
  repository, and is never pasted into any configuration file;
- disclosure of the key is a monitoring-integrity incident, not merely a
  nuisance: rotate the project ping key at Healthchecks and replace the key
  file;
- a forged healthy ping is **undetectable from this side**. Nothing local can
  distinguish it from a real one.

---

## 2. What this command does

One invocation:

1. reads the cloud configuration and derives the E3J7 freshness signal from the
   attestations already on this host;
2. classifies it — **`fresh` → the success endpoint, everything else → `/fail`**;
3. POSTs the signal (or a closed failure body) to **one** hosted Healthchecks.io
   slug check, as **at most one HTTPS request, with no retry**;
4. prints one `eanhl.monitor-export-report` v1 JSON line on stdout.

```bash
node ops/backup/eanhl-backup-monitor-export.mjs \
     --cloud-config <path> --monitor-config <path>
```

Both flags are required, exactly once each. The two configurations are
**separate surfaces with separate owners, lifetimes and failure domains**, and
neither references the other: a malformed monitor config cannot stop the
uploader, and a malformed cloud config cannot redirect a ping.

The ping origin is **`https://hc-ping.com`, port 443, as a module constant** in
`ops/backup/lib/internal/backup-healthchecks-transport-core.mjs`. It is
deliberately **not configurable**, for the same reason E3J7's approved 8 h / 24 h
thresholds are not: configuration that could name the destination would be
configuration that could name where to send a bearer credential.

**There is no local watcher and no local notification code, and none is
planned.** The watcher is Healthchecks.io's own grace timer; Pushover and
`alerts@boogeymen.app` are its integrations (memo §5.2 pieces 4 and 5).

---

## 3. The monitor configuration

`ops/backup/eanhl-backup-monitor.example.json` is the shape, and it validates as
written:

```json
{
  "watcher": {
    "provider": "healthchecks_io",
    "slug": "eanhl-cloud-backup-freshness",
    "pingKeyFile": "/etc/eanhl/healthchecks-ping-key"
  },
  "ping": {
    "requestTimeoutMs": 10000,
    "connectTimeoutMs": 5000
  }
}
```

Every value above is an **illustrative placeholder**; no path is claimed to exist
on any host, and nothing in this repository reads that file automatically.

**The example file carries no `_comment` key, unlike the cloud example.** That is
deliberate: this schema is _exactly closed_ — two top-level keys, three under
`watcher`, two under `ping`, and any unknown key at any depth rejected with
`config_field_unknown`. There is therefore **no field an inline secret could
occupy**, and no field for an origin, host, port, scheme, request path, query or
threshold either. The commentary that would have lived in the file lives here
instead.

Secrets are kept out **structurally**, not by guessing at values. There is no
value-shape heuristic, because one would collide with legitimate values — the
slug alphabet is a subset of the key alphabet. The inherited
secret-shaped-key-**name** rule still applies, with a generic, location-free
diagnostic that never echoes the offending key or its value.

Other rules:

- `provider` is a closed one-member enum. No default, no fallback.
- `pingKeyFile` is a **path only**: absolute and lexically canonical. Its
  contents are never read by the validator.
- `requestTimeoutMs` ∈ [1000, 60000]; `connectTimeoutMs` ∈ [1000, 30000]; and
  `connectTimeoutMs` must be **strictly less than** `requestTimeoutMs`, so that a
  connect deadline can actually fire first and keep "never connected"
  distinguishable from "connected and then stalled".

### 3.1 Slug policy

`SLUG_PATTERN` is `/^[a-z0-9_-]{1,64}$/`. The **alphabet** — lowercase ASCII
letters, digits, underscores and hyphens — is the one Healthchecks documents for
slug ping URLs. Underscores are accepted, a one-character slug is accepted, and
there is **no first- or last-character restriction**.

**The 64-character maximum is a deliberate LOCAL project restriction, not part of
the provider's documented grammar.** Healthchecks publishes no slug length limit
that this reproduces. It exists so a request path stays small and bounded; a
longer legitimate slug would be a local policy change, made in
`ops/backup/lib/backup-monitor-config.mjs`, not a provider incompatibility.

Path safety follows from the alphabet alone: it contains no `/`, `.`, `%`, `?`,
`#`, `@`, `:`, whitespace, NUL or uppercase character, so a `.`/`..` segment is
impossible, percent-encoding is never needed, and no accepted slug can introduce
a second path segment.

---

## 4. Provisioning the ping-key file

The key file lives **outside this repository** and is created by the operator.

| Property | Requirement                                                                                                            |
| -------- | ---------------------------------------------------------------------------------------------------------------------- |
| Location | outside the repo; never in `ops/`, never in git                                                                        |
| Owner    | the uid that runs the command (`st.uid === geteuid()`)                                                                 |
| Type     | a **regular file**, never a symlink (checked by `lstat` _and_ `O_NOFOLLOW`)                                            |
| Mode     | **exactly `0600`**                                                                                                     |
| Size     | 1 to 256 bytes                                                                                                         |
| Contents | exactly the bearer ping key, strict UTF-8, ASCII-only, NUL-free                                                        |
| Newline  | **at most one trailing `\n`.** No `\r` anywhere, no leading, interior or other trailing whitespace, and no second line |
| Shape    | `/^[A-Za-z0-9_-]{16,64}$/`                                                                                             |

```bash
install -d -m 0700 /etc/eanhl
printf '%s' "$PING_KEY" > /etc/eanhl/healthchecks-ping-key
chmod 0600 /etc/eanhl/healthchecks-ping-key
```

**"Exactly `0600`" means exactly that.** The check is the single comparison
`(mode & 0o7777) === 0o600`, which rejects every group and world bit, the owner
execute bit, **and** the setuid/setgid/sticky bits. `0640`, `0644`, `0400` and
`0700` are all refused. No weaker mask appears anywhere in the module or in this
document.

The key is read **fresh on every invocation**, never cached, never assigned to a
module-level binding, never placed in `process.env` or `argv`, and never
interpolated into a message, code, report or thrown error. A read failure yields
one closed code — `key_file_unreadable`, `key_file_not_regular`,
`key_file_symlink`, `key_file_owner`, `key_file_mode`, `key_file_size`,
`key_file_identity_changed`, `key_file_encoding`, `key_file_shape` — and nothing
else: **no path, no content, no native error, no `errno`**.

`/^[A-Za-z0-9_-]{16,64}$/` is a **conservative URL-path-safe shape bound, not a
claim about the provider's key grammar.** A real key outside that shape fails
closed at read time, before any request is constructed.

### 4.1 Close-on-exec — the accurate statement

The descriptor is opened `O_RDONLY | O_NOFOLLOW | O_NONBLOCK`. **`O_CLOEXEC` is
not specified, and no numeric constant is manufactured in its place:** on this
repository's runtime (Node v22.22.2, verified) `fs.constants.O_CLOEXEC` is
`undefined`, so including it in the flag expression would produce `NaN` rather
than a flag.

So: **close-on-exec for this descriptor is supplied by Node/libuv's own fs
implementation; this module neither controls it explicitly nor proves it
independently.** That is acceptable here because the reader spawns no subprocess
and closes the descriptor within the same invocation. It is deliberately not
turned into a native dependency or a subprocess test.

---

## 5. What the request is, and what it is not

| Aspect               | Value                                                                                                           |
| -------------------- | --------------------------------------------------------------------------------------------------------------- |
| Method               | `POST`, always, for both endpoints                                                                              |
| Path                 | `/<ping-key>/<slug>` or `/<ping-key>/<slug>/fail` — nothing else                                                |
| `content-type`       | `application/json; charset=utf-8`                                                                               |
| `content-length`     | the exact byte length, always explicit; **chunked transfer is never used**                                      |
| `user-agent`         | the fixed literal `eanhl-backup-monitor-export/1` — no hostname, version or environment data                    |
| `accept`             | `text/plain`                                                                                                    |
| `connection`         | `close`, with `agent: false`, so no socket outlives the invocation                                              |
| Other headers        | **none** — no cookie, no authorization, no custom header                                                        |
| Request body ceiling | 16 KiB, checked **before** the request is constructed; a larger body is a **local refusal, never a truncation** |

There is **no query string of any kind**, no `create` parameter and no `rid`
parameter. The path has exactly two or three segments — never one, so a UUID
endpoint is structurally impossible — and a third segment, when present, is
exactly `fail`, so `/start`, `/log` and an exit-code endpoint are all excluded.
The request is issued from an explicit options object, never from a `URL`
round-trip, so no normalization can alter it.

**No redirect is ever followed.** `https.request` does not follow redirects, the
`Location` header is never read, and a 3xx head yields `redirect_refused`.

The response is bounded at **64 bytes**. One byte past that stops accumulation,
destroys the request and reports `body_oversized`; the full body is never
buffered, never decoded past the ceiling, and never logged.

---

## 6. Delivery evidence — the conservative model

| `delivery`      | What it means                                                                                                                  |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `not_sent`      | **No HTTPS request was ever constructed or started.** Only a local refusal strictly _before_ `https.request()` may report this |
| `indeterminate` | A request was started; **no complete response head was received**                                                              |
| `delivered`     | **A complete HTTP response head was received from the remote peer**                                                            |

**`delivered` means only that a response head arrived.** It is **not** a claim
that Healthchecks recorded, processed or persisted the heartbeat — a head can
come from a proxy, an error page, or a server that rejected the request outright.
The only documented provider acknowledgement is **`outcome: "accepted"`**: status
**exactly 200** plus a body of **exactly the bytes `OK`** (2 bytes, no trailing
newline).

**Request execution starts at the moment `https.request()` is called.** After
that call, `not_sent` is never reported again for any reason — so a synchronous
throw from `https.request()` itself, and a synchronous throw from `req.end()`,
are both `indeterminate`. The options object is fully validated first, so neither
path is expected, and neither is treated as evidence that nothing reached the
peer.

DNS failure, connect failure, TLS handshake failure, a write error, a reset, a
timeout and a cancellation are **all `indeterminate`** once execution has
started. Node's socket events do not reliably establish that zero bytes reached
the peer, and byte-level non-delivery is never inferred from them.

`error_class` (`dns`, `connect`, `tls`, `write`, `reset`, `timeout`, `cancelled`,
`other`) is a **diagnostic hint only and is never evidence of non-delivery.**
Node's codes vary by platform and TLS stack; the mapping is best-effort, and
`delivery` is unaffected by its value.

**EXACTLY-ONCE IS NEVER CLAIMED.** The design is at-most-one-request per
invocation with a possibly-unknown outcome. **A ping may have been received even
when the process exits non-zero.** A dead-man's switch tolerates this: a lost
ping is a missed heartbeat, and the watcher alarms only after the grace period.

Healthchecks documents rate limiting **above five pings per minute**, which one
request per invocation at a 30-minute cadence cannot provoke. If a 429 arrives
anyway it is `delivered` + `status_unexpected`, handled fail-closed and **never
retried**.

### 6.1 The `OK` contract is documented, not yet observed

`EXPECTED_RESPONSE_BODY = 'OK'` is the contract the Healthchecks.io ping-endpoint
HTTP API documentation (`healthchecks.io/docs/http_api/`) specifies. **Live
compatibility is not verified in this checkpoint** — verifying it means
contacting the provider — and confirming it is a **required step of the
activation test** in §9.

**An observed `OK\n` would not automatically widen the accepted contract.** It
would be a discrepancy between the documented contract and the deployed
implementation, resolved by its own operator decision and recorded before any
constant changes. The failure mode meanwhile is safe: a mismatch is _rejected_,
never falsely accepted.

---

## 7. Which local failures still ping — a deliberate asymmetry

A **cloud-side** failure — the cloud config is unreadable, evaluation threw, the
signal is invalid or too large — **still produces a `/fail` ping**, carrying a
closed failure body:

```json
{
  "kind": "eanhl.monitor-export-failure",
  "schema_version": 1,
  "generated_at": "…|null",
  "reason": "…",
  "monitored": false
}
```

with `reason` ∈ `cloud_config_invalid`, `signal_unavailable`, `signal_invalid`,
`signal_oversized`, `internal_error`. That is exactly the condition worth
alarming on, so the alarm should fire at once rather than wait out a grace
period.

A **monitor-side** failure — the monitor config is invalid, or the ping key is
unavailable — makes a request path impossible, so **no ping is sent at all**,
`delivery` is `not_sent`, and the process exits **3**. That is the dead-man's
switch working as designed: **silence is itself the alarm**, after the grace
period.

---

## 8. The exit-code contract

Ping state and report writability are encoded **independently**, so every code is
truthful about both. **No second stdout line is ever attempted.**

| Code          | Ping attempt                                                                                                   | Report line on stdout                                  |
| ------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| **0**         | attempted and **accepted** (200 + the exact body `OK`)                                                         | written in full                                        |
| **2**         | **not attempted** — invalid invocation, **or `--help`**                                                        | none attempted (usage goes to stdout for `--help`)     |
| **3**         | **not attempted** — a local refusal before `https.request()`                                                   | written in full                                        |
| **4**         | attempted, `delivered`, **not accepted**                                                                       | written in full                                        |
| **5**         | attempted, delivery **indeterminate**                                                                          | written in full                                        |
| **6**         | attempted (or possibly attempted), outcome now unreported                                                      | **could not be written in full**                       |
| **7**         | **not attempted** — a local refusal                                                                            | **could not be written in full**                       |
| **130 / 143** | cancelled by SIGINT / SIGTERM; before request start → `not_sent`, after start without a head → `indeterminate` | best-effort; **never attempted after a second signal** |

**Exit 0 means the ping was accepted — NOT that the backup is fresh.** The
verdict is the report's `signal_status` field.

**`--help` exits 2, not 0.** Exit 0 is reserved for an accepted ping, and
`--help` attempts none; reporting 0 for it would make the one code an operator
most wants to trust ambiguous. Code 2 therefore reads as "no ping was attempted:
the invocation was invalid, or usage was requested".

Exits **6** and **7** mean this host has **no machine-readable record of the
invocation**. The watcher is unaffected: what it observes is the ping, not the
report. When the orchestrator itself breaks its contract the attempt state is
genuinely unknown, and **6** is reported rather than 7 precisely because 6 does
not assert that no request was issued.

**Code 1 is deliberately unused.** "The backup is not fresh" is not an exit
status; it is `signal_status` in the report.

### 8.1 Cancellation ordering

- The **entrypoint owns the single `AbortController`**. The transport never
  creates one, never installs a process-signal listener, and never calls
  `process.exit`.
- Listeners are installed **before any argument parsing, config loading, JSON
  parsing or validation**, so none of that work is uninterruptible, and they are
  removed in a `finally` that runs on every exit path.
- **First signal:** record the name once, `abort()`, write one fixed stderr line,
  and **do not exit** — the settled result still drives the report.
- **Second signal:** one synchronous bounded stderr line (well under `PIPE_BUF`),
  then immediate exit **with the code of the first recorded signal**. No stdout
  report is attempted.
- Cancellation **before** `https.request()` is `not_sent`; **after** the call
  without a response head is `indeterminate`; after a head keeps `delivered`
  with `body_truncated`.
- Settlement is **one-shot**: it clears both timers, unsubscribes every
  classifying listener, removes its `abort` listener from the caller's signal,
  destroys the request once, and records the result. Late `error`, `close`,
  `timeout`, `response` and `abort` events cannot change it. The `abort`
  listener is removed on every path, not left to `{ once: true }`, which only
  removes it if abort actually fires. So a long-lived, never-aborted signal
  shared across invocations accumulates no listeners. One no-op
  `error` absorber stays subscribed on purpose — a destroyed `ClientRequest`
  routinely emits a further `error`, and an emitter with no `error` listener
  throws, which would take the process down _after_ a perfectly good ping.

### 8.2 The report

One JSON line, `eanhl.monitor-export-report` v1, assembled from string literals
and closed codes only. It carries no path, identifier, host, URL, key or free
text.

What is printed is never the object handed to the serializer. Because
`validateExportReport()` and `serializeExportReport()` are public, a caller can
pass them anything, so both first build a small, flat projection: a Proxy is
refused without any trap firing, the prototype must be `Object.prototype` or
`null`, the `Reflect.ownKeys()` set must be exactly the report's keys (no symbol,
no non-enumerable extra, no own `toJSON`), and every field must be an own
enumerable data property holding a primitive — an accessor is refused without
being invoked. The copied primitives go into a fresh, frozen, null-prototype
object, which alone is validated and serialized through the shared validate →
stringify → reparse → re-validate → compare discipline. The entrypoint prints,
and takes its exit status from, that projection only.

`slug` is `null` **only** when no valid monitor config could be loaded, which
means no request path could exist; validation enforces that a `null` slug implies
`delivery: "not_sent"`. A non-null `slug` must match the config's own
`SLUG_PATTERN` (§3.1), imported rather than restated — being a string is not
enough, so a path such as `/etc/shadow`, a URL, whitespace or an oversized value
is refused by validation and serialization alike. Other cross-field rules: `not_sent` requires
`request_started: false` and `attempts: 0`; `delivered` requires a non-null
`response_status`; `indeterminate` requires a null one; `outcome: "accepted"`
requires `response_status: 200` and `delivery: "delivered"`; the success endpoint
requires the signal body and `signal_status: "fresh"`; and **`monitored` must be
exactly `false`**.

### 8.3 Caller-owned arguments and signals

`pingHealthchecks()` and `runMonitorExport()` forward their argument object
**unread**; neither public wrapper destructures it. Each core first builds a
fresh flat projection with the same discipline as the report: a Proxy (live or
revoked) is refused before any trap can run, the prototype must be
`Object.prototype` or `null`, the own keys must be exactly the documented
required keys plus an optional `signal`, and every value must be an own
enumerable data property — an accessor is refused without being invoked.

`signal` must be omitted, `undefined`, or a **genuine** `AbortSignal` (`null` is
refused). Genuineness is decided without running caller code: no Proxy, a
prototype of exactly `AbortSignal.prototype`, no own accessor (a real signal has
only internal data slots, so an accessor forged under one of them is refused
before Node's brand check could invoke it), then Node's native `aborted` getter
as the brand check. After that the signal is read only through captured
intrinsics (`aborted`, `EventTarget.prototype.addEventListener` /
`removeEventListener`), never through its own members.

A refused transport call returns the ordinary frozen `local_refused` result
(`not_sent`, zero attempts) before the key read, any timer, or the request. A
refused `runMonitorExport()` call rejects with one fixed `TypeError` before the
clock, either config read, the evaluator or the transport. Neither echoes
anything the caller supplied.

---

## 9. Activation checklist — NOT RUN IN THIS CHECKPOINT

Every step below requires its own authorization. None of it has been done.

1. Create the Healthchecks.io project and **one** dedicated slug check, with
   **period 1 h and grace 1 h** (the emitter's intended cadence is every
   **30 min**, so one missed emission is tolerated before the alarm).
2. Attach the integrations: **Pushover primary, `alerts@boogeymen.app`
   secondary**. Both are Healthchecks-side configuration; there is no local
   notification code.
3. Generate the project ping key and provision the key file per §4. Re-read §1:
   the forged-healthy-ping risk is accepted, not mitigated.
4. Write the real monitor config from §3 and point `--monitor-config` at it.
5. Run the command once by hand and confirm **`outcome: "accepted"`** — this is
   where the documented `OK` body contract (§6.1) is observed for the first time.
   A discrepancy is recorded and decided, not silently accommodated.
6. **Deliberately fail a ping and confirm a human receives the notification**, on
   both channels.
7. Schedule the emitter. **Backup scheduling does not exist yet**, which is what
   actually blocks activation.
8. Only when **all** of 1-7 hold may `monitored` become `true`, and only in a
   later, separately authorized session. Flipping it earlier would make the
   signal assert something no one has observed — the precise failure memo §5.6
   exists to prevent.

---

## 10. Honest non-claims

- **Nothing is monitored.** No provider object exists, nothing schedules the
  command, and no human has received a test notification.
- **A forged healthy ping is undetectable from this side** (§1).
- **Exactly-once delivery is not claimed**, and `delivered` is not provider
  acknowledgement (§6).
- **The live `OK` contract is unverified** (§6.1).
- **The real ping-key format is unverified.** The accepted shape is a
  conservative bound that fails closed.
- **Close-on-exec is not independently proven** (§4.1).
- **`error_class` fidelity is best-effort** and never affects `delivery`.
- **`internal/` is a convention, not access control.** What is guaranteed is
  narrower: no public wrapper re-exports the key reader or the path builder, a
  static test proves only the transport core imports the reader among production
  modules, and the load-bearing evidence is the runtime unique-marker leak tests.
  Malicious or later-modified local repository code is out of scope.

---

## 11. Related documents

- `docs/planning/proton-drive-cloud-transport-architecture.md` §5.2, §5.6, §5.7
  — the five pieces, what must not be claimed, and this emitter as implemented.
- `docs/operations/backup-producer.md` §8 — operator decision D1, and the rule
  that these backups must not be described as monitored until a human has
  received a test notification.
- `docs/journal/2026-09.md` — the dated E3J8A entry.
