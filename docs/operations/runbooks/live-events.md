# Runbook: live events (E1)

Status: written 2026-11-14 with task `docs/tasks/2026-11-14-web-live-events-e1.md`. Not deployed
until the operator gives the OK. Design: `docs/superpowers/specs/2026-11-14-live-events-interface.md`.

Readers: the operator, the website Lead, and the engine Lead (card E2: the sender).

## 1. What it does

- OBS (later the engine) sends one small JSON event to the website for each game moment.
- The website stores each event once, in the table `live_events` (kept 30 days).
- At the horn of period 3 or later (`period_end` with `period` 3, 4, 5 or 6), or at `game_end`,
  the worker reads the EA match lists at once and again at +1, +2, +4 and +8 minutes (5 checks at
  most). It stops when the new game is in. Then the Discord post goes out at once.
- A check reads only the EA match lists (3 calls; 1 call when the event has `match_type`). The
  normal 5-minute pass does not change.
- Events never change match data. EA stays the truth.

## 2. How the sender reaches the website

The route is **not** on the public internet. A request that comes through the Cloudflare tunnel
(`boogeymen.app`) gets `404`.

| Sender runs on                      | URL                                                  |
| ----------------------------------- | ---------------------------------------------------- |
| the main PC (today: OBS + capture)  | `http://100.98.29.119:3100/api/internal/live-events` |
| Hotel-Echo, in a compose container  | `http://web:3000/api/internal/live-events`           |
| Hotel-Echo, on the host (no Docker) | `http://127.0.0.1:3000/api/internal/live-events`     |

- `100.98.29.119` is Hotel-Echo's Tailscale address. Only devices on the operator's tailnet can
  reach it. The port is published only when `.env` on Hotel-Echo has
  `LIVE_EVENTS_BIND_ADDR=100.98.29.119` (the default is loopback).
- The port reaches the whole website, not only this route, but only for tailnet devices.
- Plain HTTP is acceptable on these paths: Tailscale encrypts the traffic, and the Docker network
  and loopback stay on the machine. The HMAC protects the body in every case.

## 3. How a sender signs a request

The sender keeps two secrets in a local file outside git (for example
`~/.config/eanhl/live-events.env`, mode 600). They are the same two values as in Hotel-Echo's `.env`:

- `LIVE_EVENTS_TOKEN`: the bearer token.
- `LIVE_EVENTS_HMAC_KEY`: the HMAC key.

Each request has these headers:

| Header                    | Value                                                                                    |
| ------------------------- | ---------------------------------------------------------------------------------------- |
| `Content-Type`            | `application/json`                                                                       |
| `Authorization`           | `Bearer <LIVE_EVENTS_TOKEN>`                                                             |
| `X-Live-Events-Timestamp` | Unix time now, in whole seconds (for example `1763090441`)                               |
| `X-Live-Events-Signature` | `sha256=<hex>`: HMAC-SHA256 with `LIVE_EVENTS_HMAC_KEY` of the text `<timestamp>.<body>` |

Rules:

- Sign the **exact bytes** that you send as the body. Do not format the JSON again after you sign it.
- The timestamp must be within 2 minutes of Hotel-Echo's clock. Keep the sender's clock correct (NTP).
- Make a new timestamp and a new signature for each send, also for a retry.
- A retry with the same `id` is safe: the website stores the event once and answers
  `"duplicate": true`.

### Example (bash + curl, placeholder secrets)

```bash
# Placeholders: put the real values in a local file outside git, never in a script or a chat.
LIVE_EVENTS_TOKEN='REPLACE_WITH_TOKEN'
LIVE_EVENTS_HMAC_KEY='REPLACE_WITH_HMAC_KEY'
URL='http://100.98.29.119:3100/api/internal/live-events'

BODY='{"v":1,"id":"obs-2026-11-14T03:20:41Z-period_end","type":"period_end","source":"obs","at":"2026-11-14T03:20:41Z","game_title":"nhl27","period":3}'
TS=$(date +%s)
SIG=$(printf '%s.%s' "$TS" "$BODY" | openssl dgst -sha256 -hmac "$LIVE_EVENTS_HMAC_KEY" -hex | sed 's/^.*= //')

curl -sS -X POST "$URL" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $LIVE_EVENTS_TOKEN" \
  -H "X-Live-Events-Timestamp: $TS" \
  -H "X-Live-Events-Signature: sha256=$SIG" \
  --data-binary "$BODY"
# → 202 {"ok":true,"id":"obs-2026-11-14T03:20:41Z-period_end","duplicate":false}
```

### Example (Python 3, standard library only)

```python
import hashlib, hmac, json, time, urllib.request

def send_live_event(url: str, token: str, hmac_key: str, event: dict) -> int:
    body = json.dumps(event, separators=(",", ":")).encode("utf-8")
    ts = str(int(time.time()))
    sig = hmac.new(hmac_key.encode(), ts.encode() + b"." + body, hashlib.sha256).hexdigest()
    req = urllib.request.Request(url, data=body, method="POST", headers={
        "Content-Type": "application/json",
        "Authorization": f"Bearer {token}",
        "X-Live-Events-Timestamp": ts,
        "X-Live-Events-Signature": f"sha256={sig}",
    })
    with urllib.request.urlopen(req, timeout=5) as resp:  # never block the game: short timeout
        return resp.status  # 202
```

## 4. The event (v1)

Required: `v` (must be `1`), `id`, `type`, `source`, `at`. The full shape is in the design, §3.

- `id`: 1-128 characters of `A-Z a-z 0-9 . _ : @ + -`. Make it unique per event.
- `type`: `lobby_countdown`, `game_start`, `period_end`, `goal`, `penalty`, `end_of_game_screen`
  or `game_end`.
- `source`: `obs` or `engine`.
- `at`: ISO 8601 time with `Z` or an offset, for example `2026-11-14T03:20:41Z`.
- Optional fields: absent or `null`, else the type in §3 (`period` 1-6, `score` `{bgm, opp}`,
  `team` `bgm`/`opp`, `side` `home`/`away`, `strength` `ev`/`pp`/`sh`, `sure` true/false, and so on).
- **New in E1:** optional `match_type`: `gameType5`, `gameType10` or `club_private` (the EA mode
  played). When it is there, each check calls 1 EA match list instead of 3.
- For the quick checks, a `period_end` must have `period`. Earlier horns (period 1 and 2) start
  nothing.
- Unknown fields are refused (`400`). The body must be 4096 bytes or less.

## 5. Answers

| Status | Meaning                                                           | Sender does                        |
| ------ | ----------------------------------------------------------------- | ---------------------------------- |
| `202`  | Stored (`duplicate: false`) or already stored (`duplicate: true`) | Nothing                            |
| `400`  | The event is not valid v1; `error` names the field                | Fix the sender; do not retry       |
| `401`  | Token, timestamp or signature is wrong (one answer for all three) | Check secrets and clock            |
| `404`  | It came through the public tunnel                                 | Use the Tailscale URL              |
| `413`  | Body over 4096 bytes                                              | Send less                          |
| `415`  | `Content-Type` is not `application/json`                          | Fix the header                     |
| `429`  | Over 60 requests a minute; see `Retry-After`                      | Wait, then retry                   |
| `503`  | Secrets not set on the website, or the database is not ready      | Retry later; tell the website Lead |

The website logs only the outcome, the type and the id. It never logs the token, the key, the
signature or the body.

## 6. Deploy (operator's OK; the Lead does it)

1. Apply migration `packages/db/migrations/0079_live_events.sql` (the command is in its header).
   Rollback: `DROP TABLE IF EXISTS "live_events";` after the code is rolled back.
2. On Hotel-Echo, add to `.env` (make each secret with `openssl rand -hex 32`):
   `LIVE_EVENTS_TOKEN=…`, `LIVE_EVENTS_HMAC_KEY=…`, `LIVE_EVENTS_BIND_ADDR=100.98.29.119`.
3. Rebuild and restart `web` and `worker` (skill `docker-redeploy`).
4. Check the port is on the Tailscale address only: `ss -ltnp | grep 3100` shows
   `100.98.29.119:3100`, not `0.0.0.0:3100`. From a device that is not on the tailnet, the port
   must not answer.
5. Check the tunnel refuses: `curl -sS -o /dev/null -w '%{http_code}' -X POST https://boogeymen.app/api/internal/live-events`
   gives `404`.
6. Send one test event with the example in section 3 (use `"type":"lobby_countdown"`: it starts no
   EA checks). Expect `202`.

**Boot order:** Docker can bind `100.98.29.119` only when Tailscale is up. If Docker starts `web`
before Tailscale at boot, the bind fails and `web` does not start (the whole site is down). Before
the deploy, check how Hotel-Echo boots (`systemctl cat docker` / `tailscaled`; an
`After=tailscaled.service` drop-in for `docker.service`, or `net.ipv4.ip_nonlocal_bind=1`). If
`DB_BIND_ADDR` is already the Tailscale address on Hotel-Echo, the same risk exists today and the
boot order is already proven.

## 7. Worker log lines

- `[live-events] quick checks start on period_end <id>`
- `[live-events] quick check 2/5 (<id>): 3 match-list calls (gameType5,gameType10,club_private; nhl27), 0 new games`
- `[live-events] quick checks end (new-game | checks-done) for <id>`
- `[live-events] <type> <id>: no new series (series-running | game-already-in | stale)`
- `[live-events] could not read live events (normal polling continues): …` (at most every 10
  minutes; the table is missing or the database is down)
