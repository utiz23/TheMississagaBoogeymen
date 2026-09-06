/**
 * Backup producer — process-boundary suite.
 *
 * The producer's correctness depends on two facts that live only in the spawn
 * layer, and that no amount of testing the orchestrator can establish:
 *
 *   1. `pg_dump` and `pg_restore` are the ones INSIDE the database container.
 *      A host `pg_dump` 18.x will dump a 16.x server successfully and produce
 *      an archive `postgres:16-alpine`'s `pg_restore` cannot read — a failure
 *      that would only surface during a recovery.
 *   2. The staged archive reaches `pg_restore` over stdin, so validation never
 *      writes a plaintext copy of the database inside the container.
 *
 * Both are asserted by putting a recording `docker` shim on PATH and reading
 * back the argv and stdin it was handed. No real Docker, no PostgreSQL.
 */

import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  freeSpace,
  overwriteFile,
  readFileHead,
  runDump,
  sha256File,
  validateArchive,
} from './backup-boundaries.mjs'

import { installTestWatchdog } from './test-diagnostics.mjs'

// Report the active test and what is still alive if anything stalls.
installTestWatchdog({ label: 'boundaries' })

const dirs = []
function sandbox() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'eanhl-boundaries-'))
  dirs.push(d)
  return d
}
test.after(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true })
})

/**
 * A `docker` shim that records argv and stdin, then behaves as `body` says.
 * Returns a restore function for PATH.
 */
function fakeDocker(dir, body) {
  const bin = path.join(dir, 'bin')
  fs.mkdirSync(bin, { recursive: true })
  fs.writeFileSync(
    path.join(bin, 'docker'),
    `#!/bin/sh\nprintf '%s\\n' "$@" > "${dir}/argv.txt"\n${body}\n`,
    { mode: 0o755 },
  )
  const previous = process.env.PATH
  process.env.PATH = `${bin}${path.delimiter}${previous}`
  return () => {
    process.env.PATH = previous
  }
}

const argvOf = (dir) => fs.readFileSync(`${dir}/argv.txt`, 'utf8').trim().split('\n')

test('the dump runs pg_dump INSIDE the container, in custom format, on the exported snapshot', async () => {
  const dir = sandbox()
  const restore = fakeDocker(dir, `printf 'PGDMP-fake-archive-bytes'`)
  try {
    const out = `${dir}/a.dump`
    const result = await runDump({
      container: 'eanhl-fake-db-1',
      database: 'eanhl',
      user: 'eanhl',
      snapshotId: '00000003-0000B219-1',
      outPath: out,
      maxBytes: 1_000_000,
    })
    const argv = argvOf(dir)
    assert.deepEqual(argv, [
      'exec',
      'eanhl-fake-db-1',
      'pg_dump',
      '-U',
      'eanhl',
      '-d',
      'eanhl',
      '--format=custom',
      '--no-owner',
      '--no-privileges',
      '--snapshot=00000003-0000B219-1',
    ])
    assert.equal(argv[0], 'exec', 'pg_dump must never be a host binary')
    assert.equal(result.truncated, false)
    assert.equal(fs.readFileSync(out, 'utf8'), 'PGDMP-fake-archive-bytes')
    assert.equal(result.bytes, 'PGDMP-fake-archive-bytes'.length)
  } finally {
    restore()
  }
})

test('a non-zero pg_dump exit fails, and stderr on a zero exit fails too', async () => {
  const dir = sandbox()
  let restore = fakeDocker(dir, 'echo "pg_dump: error: connection failed" >&2; exit 1')
  try {
    await assert.rejects(
      runDump({
        container: 'c',
        database: 'd',
        user: 'u',
        snapshotId: 's',
        outPath: `${dir}/b.dump`,
        maxBytes: 1000,
      }),
      /pg_dump exited 1.*connection failed/s,
    )
  } finally {
    restore()
  }

  // Exit 0 with stderr output is also a refusal: pg_dump warnings during a
  // backup are not something to shrug at, and the plan requires empty stderr.
  const dir2 = sandbox()
  restore = fakeDocker(dir2, 'printf "PGDMP"; echo "pg_dump: warning: something odd" >&2; exit 0')
  try {
    await assert.rejects(
      runDump({
        container: 'c',
        database: 'd',
        user: 'u',
        snapshotId: 's',
        outPath: `${dir2}/c.dump`,
        maxBytes: 1000,
      }),
      /wrote to stderr despite exit 0/,
    )
  } finally {
    restore()
  }
})

test('the byte ceiling stops an oversized dump mid-stream instead of filling the disk', async () => {
  const dir = sandbox()
  // 2 MiB of output against a 64 KiB ceiling.
  const restore = fakeDocker(dir, `head -c 2097152 /dev/zero`)
  try {
    const result = await runDump({
      container: 'c',
      database: 'd',
      user: 'u',
      snapshotId: 's',
      outPath: `${dir}/big.dump`,
      maxBytes: 65_536,
    })
    assert.equal(result.truncated, true, 'the producer must be told the ceiling was hit')
    assert.ok(
      fs.statSync(`${dir}/big.dump`).size <= 65_536,
      `the stream must have been cut at the ceiling, saw ${fs.statSync(`${dir}/big.dump`).size} bytes`,
    )
  } finally {
    restore()
  }
})

test('archive validation runs the CONTAINER pg_restore and feeds the archive over stdin', async () => {
  const dir = sandbox()
  const restore = fakeDocker(dir, `cat > "${dir}/stdin.bin"; exit 0`)
  try {
    fs.writeFileSync(`${dir}/a.dump`, 'PGDMP-archive-content')

    const list = await validateArchive({
      container: 'eanhl-fake-db-1',
      archivePath: `${dir}/a.dump`,
      mode: 'list',
    })
    assert.equal(list.code, 0)
    assert.deepEqual(argvOf(dir), ['exec', '-i', 'eanhl-fake-db-1', 'pg_restore', '--list'])
    assert.equal(
      fs.readFileSync(`${dir}/stdin.bin`, 'utf8'),
      'PGDMP-archive-content',
      'the archive must arrive on stdin — nothing is copied into the container',
    )

    await validateArchive({
      container: 'eanhl-fake-db-1',
      archivePath: `${dir}/a.dump`,
      mode: 'full',
    })
    assert.deepEqual(argvOf(dir), [
      'exec',
      '-i',
      'eanhl-fake-db-1',
      'pg_restore',
      '-f',
      '/dev/null',
    ])
  } finally {
    restore()
  }
})

test('a pg_restore refusal surfaces its exit code and stderr rather than throwing', async () => {
  const dir = sandbox()
  const restore = fakeDocker(
    dir,
    `cat > /dev/null; echo "pg_restore: error: did not find magic string" >&2; exit 1`,
  )
  try {
    fs.writeFileSync(`${dir}/bad.dump`, 'not an archive')
    const result = await validateArchive({
      container: 'c',
      archivePath: `${dir}/bad.dump`,
      mode: 'list',
    })
    assert.equal(result.code, 1)
    assert.match(result.stderr, /did not find magic string/)
  } finally {
    restore()
  }
})

test('an unknown validation mode is a programming error, not a silent skip', () => {
  assert.throws(
    () => validateArchive({ container: 'c', archivePath: '/x', mode: 'quick' }),
    /unknown archive validation mode/,
  )
})

test('sha256File streams, and agrees with a one-shot hash of a multi-megabyte file', () => {
  const dir = sandbox()
  const p = `${dir}/big.bin`
  const chunk = Buffer.alloc(1 << 20, 7)
  fs.writeFileSync(p, Buffer.concat([chunk, chunk, Buffer.from('tail')]))
  const oneShot = createHash('sha256').update(fs.readFileSync(p)).digest('hex')
  assert.match(sha256File(p), /^[0-9a-f]{64}$/)
  assert.equal(sha256File(p), oneShot, 'the streaming hash must equal a one-shot hash')
})

test('readFileHead reads only the head, and overwriteFile zeroes the whole file', () => {
  const dir = sandbox()
  const p = `${dir}/x.bin`
  fs.writeFileSync(p, 'age-encryption.org/v1\nrest of the payload')
  assert.equal(readFileHead(p, 21), 'age-encryption.org/v1')
  overwriteFile(p, fs.statSync(p).size)
  const after = fs.readFileSync(p)
  assert.equal(after.length, 'age-encryption.org/v1\nrest of the payload'.length)
  assert.ok(
    after.every((b) => b === 0),
    'every byte must have been overwritten',
  )
})

test('freeSpace reports available (not total-free) bytes for a real path', () => {
  const info = freeSpace(os.tmpdir())
  assert.ok(Number.isFinite(info.freeBytes) && info.freeBytes >= 0)
  assert.ok(info.totalBytes >= info.freeBytes)
})
