#!/usr/bin/env node
/**
 * TEST DOUBLE — a fake `docker` binary. Never used by a real backup.
 *
 * Copied onto PATH as `docker` by ops/backup/lib/backup-lifecycle.test.mjs so
 * the producer's REAL boundaries can be exercised end to end — real spawns,
 * real pipes, real signals — without Docker or PostgreSQL.
 *
 * It records lifecycle markers so a test can assert what actually happened to
 * the child: `<label>.started` when it begins, and `<label>.stopped` carrying
 * the signal and a timestamp when it is terminated. That is how "the run lock
 * was released only after the work stopped" is checked with real timestamps
 * rather than by reading the implementation.
 *
 * Behaviour is chosen by environment variable:
 *   FAKE_MARKER_DIR    directory for the markers above (required for markers)
 *   FAKE_DUMP_MODE     ok (default) | hang | hang-ignore-term | slow | fail | stderr | big
 *   FAKE_RESTORE_MODE  ok (default) | hang | fail
 *   FAKE_PS_MODE       ok (default) | empty | fail | hang  — the container probe
 *   FAKE_DUMP_BYTES    payload size for mode ok/slow (default 512)
 */

import fs from 'node:fs'

const markerDir = process.env.FAKE_MARKER_DIR
const mark = (name, body = '') => {
  if (!markerDir) return
  try {
    fs.writeFileSync(`${markerDir}/${name}`, body)
  } catch {
    /* the test may already have torn the directory down */
  }
}

/**
 * Publish this process's command line the way a container-side process would
 * appear in `ps`, and remove it on any ORDERLY exit.
 *
 * A SIGKILLed process never runs its handlers, so its entry survives — which is
 * precisely the real-world distinction the producer's probe has to detect:
 * a stopped `docker` client is not a stopped container-side command.
 */
function publishCommandLine(label) {
  const cmdline = `${markerDir}/${label}.cmdline`
  mark(`${label}.cmdline`, `${process.argv.slice(2).join(' ')}`)
  process.on('exit', () => {
    try {
      fs.rmSync(cmdline, { force: true })
    } catch {
      /* the test may already have torn the directory down */
    }
  })
}

function holdOpen(label) {
  // ORDER MATTERS. Tests synchronise on `<label>.started`, then abort the run
  // and expect the container probe to see this command. If `.started` were
  // written first, the probe could run in the window before `.cmdline` existed
  // and report the command "confirmed gone" — an intermittent, timing-dependent
  // failure of the retained-lock tests. `.started` is published LAST so it is a
  // correct happens-after barrier for everything the probe needs.
  publishCommandLine(label)
  mark(`${label}.started`, `${process.pid} ${Date.now()}`)
  for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
    process.on(sig, () => {
      mark(`${label}.stopped`, `${sig} ${Date.now()}`)
      process.exit(143)
    })
  }
  // Keep the event loop alive without busy-waiting.
  setInterval(() => {}, 1000)
}

const argv = process.argv.slice(2)

// `docker image inspect …` — the producer treats a failure as a recorded
// warning, which keeps these tests free of image assumptions.
if (argv[0] === 'image') process.exit(1)

if (argv[0] !== 'exec') {
  process.stderr.write(`fake-docker: unsupported command ${JSON.stringify(argv[0])}\n`)
  process.exit(2)
}

let i = 1
while (argv[i] === '-i' || argv[i] === '-t' || argv[i] === '-it') i++
i++ // container name
const command = argv[i]

// ── the read-only command inventory the producer's probe reads ───────────────
//
// FAKE_PS_MODE: ok (default) | fail | hang — so a test can drive the
// "probe cannot answer" branch, which must retain the run lock.
if (command === 'ps') {
  const psMode = process.env.FAKE_PS_MODE ?? 'ok'
  if (psMode === 'fail') {
    process.stderr.write('Error response from daemon: container not running\n')
    process.exit(1)
  }
  if (psMode === 'hang') {
    setInterval(() => {}, 1000)
  } else if (psMode === 'empty') {
    // The container answers, and none of this run's commands are listed —
    // i.e. termination IS confirmed even though a client was killed locally.
    process.stdout.write('postgres\nps -A -o args=\n')
    process.exit(0)
  } else {
    let listed = []
    try {
      listed = fs
        .readdirSync(markerDir)
        .filter((n) => n.endsWith('.cmdline'))
        .map((n) => fs.readFileSync(`${markerDir}/${n}`, 'utf8').trim())
        .filter(Boolean)
    } catch {
      listed = []
    }
    process.stdout.write(['postgres', ...listed, 'ps -A -o args='].join('\n') + '\n')
    process.exit(0)
  }
}

// ── psql: the snapshot-owning session ────────────────────────────────────────
if (command === 'psql') {
  holdOpen('psql')
  let buffer = ''
  let sql = ''
  const rows = (...lines) => process.stdout.write(lines.map((l) => `${l}\n`).join(''))
  const ECHO = '\\echo '

  const answer = (statement) => {
    if (statement.includes('pg_export_snapshot')) {
      rows(
        '00000003-0000B219-1|2026-09-04T18:00:07Z|1788577207.879956|4242|16.13|7412345678901234567',
      )
    } else if (statement.startsWith('SELECT pg_backend_pid()::text')) {
      rows('4242|1788577207.879956')
    } else if (statement.includes('to_regclass')) {
      for (const m of statement.matchAll(/\('([a-z_.]+)'\)/g)) rows(`${m[1]}|true`)
    } else if (statement.includes('count(*)')) {
      for (const m of statement.matchAll(/SELECT '([a-z_.]+)'/g)) rows(`${m[1]}|7`)
    } else if (statement.includes('pg_extension')) {
      rows('plpgsql 1.0')
    } else if (statement.includes('__drizzle_migrations')) {
      rows('49')
    }
    // COMMIT / ROLLBACK produce no rows.
  }

  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (chunk) => {
    buffer += chunk
    let nl
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl)
      buffer = buffer.slice(nl + 1)
      if (line.startsWith(ECHO)) {
        answer(sql.trim())
        sql = ''
        process.stdout.write(`${line.slice(ECHO.length)}\n`)
      } else {
        sql += line + '\n'
      }
    }
  })
  process.stdin.on('end', () => process.exit(0))
} else if (command === 'pg_dump') {
  // ── pg_dump ────────────────────────────────────────────────────────────────
  const mode = process.env.FAKE_DUMP_MODE ?? 'ok'
  const payloadBytes = Number(process.env.FAKE_DUMP_BYTES ?? 512)
  const header = 'PGDMP  '

  if (mode === 'fail') {
    process.stderr.write('pg_dump: error: connection to server was lost\n')
    process.exit(1)
  } else if (mode === 'stderr') {
    process.stdout.write(header + 'x'.repeat(payloadBytes))
    process.stderr.write('pg_dump: warning: something odd\n')
    process.exit(0)
  } else if (mode === 'hang') {
    // Emit a little, then never finish. This is the wedged-`docker exec` case.
    process.stdout.write(header)
    holdOpen('pg_dump')
  } else if (mode === 'hang-ignore-term') {
    // Models a container-side command that OUTLIVES the docker client: it
    // ignores SIGTERM, so only SIGKILL stops it, and SIGKILL never runs the
    // exit handler — leaving its `ps` entry behind exactly as a real orphaned
    // container-side process would.
    process.stdout.write(header)
    // Same ordering rule as holdOpen: the command line is visible before the
    // marker the tests wait on.
    publishCommandLine('pg_dump')
    mark('pg_dump.started', `${process.pid} ${Date.now()}`)
    process.on('SIGTERM', () => {})
    process.on('SIGINT', () => {})
    setInterval(() => {}, 1000)
  } else if (mode === 'slow') {
    holdOpen('pg_dump')
    process.stdout.write(header)
    let written = 0
    const timer = setInterval(() => {
      process.stdout.write('x'.repeat(64))
      written += 64
      if (written >= payloadBytes) {
        clearInterval(timer)
        process.exit(0)
      }
    }, 5)
  } else if (mode === 'big') {
    holdOpen('pg_dump')
    process.stdout.write(header)
    const chunk = 'x'.repeat(65536)
    setInterval(() => process.stdout.write(chunk), 2)
  } else {
    publishCommandLine('pg_dump')
    process.stdout.write(header + 'x'.repeat(payloadBytes))
    process.exit(0)
  }
} else if (command === 'pg_restore') {
  // ── pg_restore ─────────────────────────────────────────────────────────────
  const mode = process.env.FAKE_RESTORE_MODE ?? 'ok'
  if (mode === 'hang') {
    holdOpen('pg_restore')
    process.stdin.resume()
  } else if (mode === 'fail') {
    process.stdin.resume()
    process.stderr.write('pg_restore: error: did not find magic string in file header\n')
    process.exit(1)
  } else {
    publishCommandLine('pg_restore')
    process.stdout.write(';\n; Archive created by a test double\n')
    process.stdin.on('data', () => {})
    process.stdin.on('end', () => process.exit(0))
    process.stdin.resume()
  }
} else {
  process.stderr.write(`fake-docker: unsupported exec command ${JSON.stringify(command)}\n`)
  process.exit(2)
}
