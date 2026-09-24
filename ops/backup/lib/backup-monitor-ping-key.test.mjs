/**
 * The Healthchecks ping-key file reader (E3J8A).
 *
 * Every key value below is a SYNTHETIC per-test string. No real ping key exists,
 * is used, or is referenced anywhere in this suite, and nothing here opens a
 * socket or contacts any host.
 *
 * Files live in a `0700` sandbox under the OS temp directory, removed after each
 * test. The cases that require a filesystem state Node cannot create portably —
 * an `fstat` that disagrees with the `lstat` that preceded it, a read that
 * returns a bad count, a close that fails — are driven through the module's own
 * dependency seam, which is what that seam is for.
 */

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, test } from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  PING_KEY_FAILURE_CODES,
  PING_KEY_MAX_BYTES,
  PING_KEY_PATTERN,
  REAL_PING_KEY_DEPS,
  makePingKeyReader,
} from './internal/backup-monitor-ping-key-core.mjs'

import { installTestWatchdog } from './test-diagnostics.mjs'

installTestWatchdog({ label: 'monitor-ping-key', warnAfterMs: 10_000, intervalMs: 5_000 })

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SOURCE = path.join(HERE, 'internal', 'backup-monitor-ping-key-core.mjs')

const READER = makePingKeyReader(REAL_PING_KEY_DEPS)
const read = (p) => READER.readPingKey(p)

/** A fresh synthetic marker, unique per call, matching the accepted shape. */
let markerCounter = 0
function marker() {
  markerCounter += 1
  const body = `synthetic${String(markerCounter).padStart(4, '0')}`.replace(/[^A-Za-z0-9]/g, '')
  const value = `${body}${'Z'.repeat(Math.max(0, 20 - body.length))}`
  assert.ok(PING_KEY_PATTERN.test(value), value)
  return value
}

const dirs = []
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {
      /* best effort */
    }
  }
})

/** A `0700` sandbox directory. */
function sandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eanhl-pingkey-'))
  fs.chmodSync(dir, 0o700)
  dirs.push(dir)
  return dir
}

/** Write `contents` at `<sandbox>/key` with an explicit mode. */
function keyFile(contents, mode = 0o600, name = 'key') {
  const dir = sandbox()
  const file = path.join(dir, name)
  fs.writeFileSync(file, contents)
  fs.chmodSync(file, mode)
  return { dir, file }
}

const HAS_CHOWN = (() => {
  try {
    return process.geteuid() === 0
  } catch {
    return false
  }
})()

// ═════════════════════════════════════════════════════════════════════════════
// The happy path, and the newline rule
// ═════════════════════════════════════════════════════════════════════════════

test('a 0600 owner-only regular file holding one key is read', () => {
  const key = marker()
  const { file } = keyFile(key)
  assert.deepEqual({ ...read(file) }, { state: 'ok', key })
})

test('EXACTLY ONE trailing newline is stripped, and nothing else is', () => {
  const key = marker()
  assert.equal(read(keyFile(`${key}\n`).file).key, key)
  // Two newlines leave a trailing newline in the value, which fails the shape.
  assert.equal(read(keyFile(`${key}\n\n`).file).code, 'key_file_shape')
})

test('the result is frozen, and carries nothing but a state and a key', () => {
  const { file } = keyFile(marker())
  const r = read(file)
  assert.ok(Object.isFrozen(r))
  assert.deepEqual(Object.keys(r).sort(), ['key', 'state'])
})

test('the key is read FRESH on every call and never cached', () => {
  const first = marker()
  const { file } = keyFile(first)
  assert.equal(read(file).key, first)
  const second = marker()
  fs.writeFileSync(file, second)
  fs.chmodSync(file, 0o600)
  assert.equal(read(file).key, second, 'a cached reader would still report the first key')
  fs.rmSync(file)
  assert.equal(read(file).code, 'key_file_unreadable', 'a cached reader would still succeed')
})

// ═════════════════════════════════════════════════════════════════════════════
// Path rules
// ═════════════════════════════════════════════════════════════════════════════

test('a non-absolute, non-canonical, empty or non-string path is refused without reading', () => {
  const { dir, file } = keyFile(marker())
  for (const p of [
    '',
    'relative/key',
    `${dir}/./key`,
    `${dir}//key`,
    `${dir}/../${path.basename(dir)}/key`,
    `${file}/`,
    null,
    undefined,
    7,
    {},
  ]) {
    const r = read(p)
    assert.equal(r.state, 'failed', String(p))
    assert.equal(r.code, 'key_file_unreadable', String(p))
  }
  // The same file by its canonical path still reads, so the sandbox is fine.
  assert.equal(read(file).state, 'ok')
})

test('a missing file is unreadable, not "not regular"', () => {
  const dir = sandbox()
  assert.equal(read(path.join(dir, 'absent')).code, 'key_file_unreadable')
})

// ═════════════════════════════════════════════════════════════════════════════
// Symlinks, directories, FIFOs
// ═════════════════════════════════════════════════════════════════════════════

test('a symlink to a perfectly good key file is refused', () => {
  const key = marker()
  const { dir, file } = keyFile(key)
  const link = path.join(dir, 'link')
  fs.symlinkSync(file, link)
  assert.equal(read(link).code, 'key_file_symlink')
  // The target itself still reads: it is the LINK that is refused.
  assert.equal(read(file).key, key)
})

test('a dangling symlink is refused as a symlink, not as unreadable', () => {
  const dir = sandbox()
  const link = path.join(dir, 'link')
  fs.symlinkSync(path.join(dir, 'absent'), link)
  assert.equal(read(link).code, 'key_file_symlink')
})

test('a directory is not a regular file', () => {
  const dir = sandbox()
  const sub = path.join(dir, 'sub')
  fs.mkdirSync(sub, { mode: 0o700 })
  assert.equal(read(sub).code, 'key_file_not_regular')
})

test('a FIFO at the path is refused, and O_NONBLOCK keeps the open from hanging', () => {
  const dir = sandbox()
  const fifo = path.join(dir, 'fifo')
  let made = false
  try {
    execFileSync('mkfifo', ['-m', '600', fifo], { stdio: 'ignore' })
    made = true
  } catch {
    /* mkfifo unavailable */
  }
  if (!made) {
    assert.ok(true, 'mkfifo is unavailable on this host; the injected-fstat case below covers it')
    return
  }
  // No writer is ever opened. Without O_NONBLOCK this open would block forever;
  // the test completing at all is the evidence.
  const r = read(fifo)
  assert.equal(r.state, 'failed')
  assert.ok(['key_file_not_regular', 'key_file_size'].includes(r.code), r.code)
})

test('a FIFO swapped in between lstat and open is refused by the DESCRIPTOR check', () => {
  // Driven through the seam: `lstat` reports a good regular file, the descriptor
  // turns out not to be one. That is exactly the TOCTOU window O_NONBLOCK keeps
  // from hanging and `fstat` then closes.
  const { file } = keyFile(marker())
  const real = REAL_PING_KEY_DEPS
  const reader = makePingKeyReader({
    ...real,
    fstat: (fd) => {
      const st = real.fstat(fd)
      return { ...stLike(st), isFile: () => false }
    },
  })
  assert.equal(reader.readPingKey(file).code, 'key_file_not_regular')
})

// ═════════════════════════════════════════════════════════════════════════════
// Owner and mode
// ═════════════════════════════════════════════════════════════════════════════

test(
  'a file owned by another uid is refused',
  { skip: HAS_CHOWN ? false : 'requires root to create a file owned by another uid' },
  () => {
    const { file } = keyFile(marker())
    fs.chownSync(file, 65534, 65534)
    assert.equal(read(file).code, 'key_file_owner')
  },
)

test('a wrong owner is refused when the uid is supplied through the seam', () => {
  // The same rule, exercised without needing two uids on this host.
  const { file } = keyFile(marker())
  const reader = makePingKeyReader({ ...REAL_PING_KEY_DEPS, geteuid: () => 65534 })
  assert.equal(reader.readPingKey(file).code, 'key_file_owner')
})

test('THE MODE MUST BE EXACTLY 0600 — every other mode is refused', () => {
  const key = marker()
  for (const mode of [
    0o400, 0o200, 0o601, 0o604, 0o606, 0o610, 0o620, 0o640, 0o644, 0o660, 0o664, 0o666, 0o700,
    0o750, 0o755, 0o770, 0o777, 0o000,
  ]) {
    const { file } = keyFile(key, mode)
    assert.equal(read(file).code, 'key_file_mode', `mode 0${mode.toString(8)} must be refused`)
  }
  const { file } = keyFile(key, 0o600)
  assert.equal(read(file).state, 'ok')
})

test('setuid, setgid and sticky COMBINED WITH 0600 are still refused', () => {
  const key = marker()
  for (const extra of [0o4000, 0o2000, 0o1000, 0o7000]) {
    const { file } = keyFile(key, 0o600)
    fs.chmodSync(file, 0o600 | extra)
    const observed = fs.statSync(file).mode & 0o7777
    if (observed === 0o600) {
      // Some filesystems silently drop these bits; then there is nothing to test.
      continue
    }
    assert.equal(read(file).code, 'key_file_mode', `0${(0o600 | extra).toString(8)}`)
  }
})

// ═════════════════════════════════════════════════════════════════════════════
// Size
// ═════════════════════════════════════════════════════════════════════════════

test('an empty file is a size failure, not an encoding or shape failure', () => {
  const { file } = keyFile('', 0o600)
  assert.equal(read(file).code, 'key_file_size')
})

test('a file larger than the ceiling is refused before it is read', () => {
  assert.equal(PING_KEY_MAX_BYTES, 256)
  const { file } = keyFile('a'.repeat(PING_KEY_MAX_BYTES + 1), 0o600)
  assert.equal(read(file).code, 'key_file_size')
})

test('a file exactly at the ceiling is read, and then refused only on its SHAPE', () => {
  const { file } = keyFile('a'.repeat(PING_KEY_MAX_BYTES), 0o600)
  // 256 'a's is inside the size ceiling but outside the 16-64 shape bound.
  assert.equal(read(file).code, 'key_file_shape')
})

test('a file that grows under the descriptor is a size failure, never a truncation', () => {
  const { file } = keyFile(marker())
  const real = REAL_PING_KEY_DEPS
  let calls = 0
  const reader = makePingKeyReader({
    ...real,
    read: (fd, buffer) => {
      calls += 1
      // Always report a full buffer: more bytes keep arriving than `size` allowed.
      buffer.fill(0x61)
      return buffer.length
    },
  })
  assert.equal(reader.readPingKey(file).code, 'key_file_size')
  assert.ok(calls >= 1)
})

test('a short read is a size failure: a partial key is never accepted', () => {
  const key = marker()
  const { file } = keyFile(key)
  const reader = makePingKeyReader({
    ...REAL_PING_KEY_DEPS,
    read: () => 0, // immediate end-of-file with nothing read
  })
  assert.equal(reader.readPingKey(file).code, 'key_file_size')
})

test('a negative or non-integer read count is a read failure, never end-of-file', () => {
  const { file } = keyFile(marker())
  for (const n of [-1, 1.5, Number.NaN, 'x', undefined]) {
    const reader = makePingKeyReader({ ...REAL_PING_KEY_DEPS, read: () => n })
    assert.equal(reader.readPingKey(file).code, 'key_file_unreadable', String(n))
  }
})

test('an EAGAIN from the read is a read failure, never end-of-file', () => {
  const { file } = keyFile(marker())
  const reader = makePingKeyReader({
    ...REAL_PING_KEY_DEPS,
    read: () => {
      const err = new Error('would block')
      err.code = 'EAGAIN'
      throw err
    },
  })
  assert.equal(reader.readPingKey(file).code, 'key_file_unreadable')
})

// ═════════════════════════════════════════════════════════════════════════════
// Descriptor identity
// ═════════════════════════════════════════════════════════════════════════════

/** Copy a bigint stat into a mutable plain object that keeps its predicates. */
function stLike(st) {
  return {
    dev: st.dev,
    ino: st.ino,
    uid: st.uid,
    gid: st.gid,
    mode: st.mode,
    size: st.size,
    isFile: () => st.isFile(),
    isSymbolicLink: () => st.isSymbolicLink(),
  }
}

test('dev, ino, uid, mode and size drift between lstat and fstat is refused', () => {
  const real = REAL_PING_KEY_DEPS
  const drifts = [
    ['dev', (st) => ({ ...st, dev: st.dev + 1n }), 'key_file_identity_changed'],
    ['ino', (st) => ({ ...st, ino: st.ino + 1n }), 'key_file_identity_changed'],
    // A uid/mode/size that drifts ALSO stops satisfying its own absolute rule,
    // and the absolute rule is checked first — each guard carries its own code.
    ['uid', (st) => ({ ...st, uid: st.uid + 1n }), 'key_file_owner'],
    ['mode', (st) => ({ ...st, mode: (st.mode & ~0o777n) | 0o644n }), 'key_file_mode'],
    ['size', (st) => ({ ...st, size: st.size + 1n }), 'key_file_identity_changed'],
    ['size-over-ceiling', (st) => ({ ...st, size: 100_000n }), 'key_file_size'],
  ]
  for (const [what, mutate, code] of drifts) {
    const { file } = keyFile(marker())
    const reader = makePingKeyReader({
      ...real,
      fstat: (fd) => {
        const st = stLike(real.fstat(fd))
        return { ...mutate(st), isFile: st.isFile, isSymbolicLink: st.isSymbolicLink }
      },
    })
    assert.equal(reader.readPingKey(file).code, code, what)
  }
})

test('a non-bigint stat field fails closed', () => {
  const real = REAL_PING_KEY_DEPS
  for (const field of ['dev', 'ino', 'uid', 'mode', 'size']) {
    const { file } = keyFile(marker())
    const reader = makePingKeyReader({
      ...real,
      lstat: (p) => {
        const st = stLike(real.lstat(p))
        return { ...st, [field]: Number(st[field]) }
      },
    })
    assert.equal(reader.readPingKey(file).state, 'failed', field)
  }
})

// ═════════════════════════════════════════════════════════════════════════════
// Close
// ═════════════════════════════════════════════════════════════════════════════

test('A CLOSE FAILURE IS A FAILURE OF THE READ, even when the bytes were good', () => {
  const key = marker()
  const { file } = keyFile(key)
  const real = REAL_PING_KEY_DEPS
  const reader = makePingKeyReader({
    ...real,
    close: (fd) => {
      real.close(fd)
      throw new Error('close failed')
    },
  })
  const r = reader.readPingKey(file)
  assert.equal(r.state, 'failed')
  assert.equal(r.code, 'key_file_unreadable')
  assert.equal('key' in r, false, 'no key may survive a failed read')
})

test('the descriptor is closed on every path, including a refusal', () => {
  const real = REAL_PING_KEY_DEPS
  const opened = []
  const closed = []
  const reader = makePingKeyReader({
    ...real,
    open: (p) => {
      const fd = real.open(p)
      opened.push(fd)
      return fd
    },
    close: (fd) => {
      closed.push(fd)
      return real.close(fd)
    },
  })
  reader.readPingKey(keyFile(marker()).file) // ok
  reader.readPingKey(keyFile('a'.repeat(200), 0o600).file) // shape refusal
  assert.equal(opened.length, 2)
  assert.deepEqual(closed, opened)
})

// ═════════════════════════════════════════════════════════════════════════════
// Encoding and shape
// ═════════════════════════════════════════════════════════════════════════════

test('invalid UTF-8, non-ASCII, NUL and control characters are ENCODING failures', () => {
  const cases = [
    ['invalid UTF-8', Buffer.from([0xc3, 0x28, 0x61, 0x61])],
    ['lone continuation byte', Buffer.from([0x80])],
    ['non-ASCII but valid UTF-8', Buffer.from('ábcdefghijklmnopq', 'utf8')],
    ['NUL', Buffer.from('abcdefghijklmnop\0', 'utf8')],
    ['carriage return', Buffer.from('abcdefghijklmnop\r\n', 'utf8')],
    ['tab', Buffer.from('abcdefgh\tijklmnop', 'utf8')],
    ['vertical tab', Buffer.from('abcdefgh\vijklmnop', 'utf8')],
  ]
  for (const [what, bytes] of cases) {
    const { file } = keyFile(bytes, 0o600)
    assert.equal(read(file).code, 'key_file_encoding', what)
  }
})

test('printable whitespace and a second line are SHAPE failures', () => {
  const key = marker()
  const cases = [
    ['leading space', ` ${key}`],
    ['trailing space', `${key} `],
    ['interior space', `${key.slice(0, 8)} ${key.slice(8)}`],
    ['trailing space after newline strip', `${key} \n`],
    ['second line', `${key}\nsecond`],
    ['second line after strip', `${key}\nsecond\n`],
  ]
  for (const [what, contents] of cases) {
    const { file } = keyFile(contents, 0o600)
    assert.equal(read(file).code, 'key_file_shape', what)
  }
})

test('the shape bound is enforced at both ends and over the alphabet', () => {
  assert.equal(read(keyFile('a'.repeat(15), 0o600).file).code, 'key_file_shape', '15 characters')
  assert.equal(read(keyFile('a'.repeat(16), 0o600).file).state, 'ok', '16 characters')
  assert.equal(read(keyFile('a'.repeat(64), 0o600).file).state, 'ok', '64 characters')
  assert.equal(read(keyFile('a'.repeat(65), 0o600).file).code, 'key_file_shape', '65 characters')
  for (const bad of [
    'a'.repeat(15) + '.',
    'a'.repeat(15) + '/',
    'a'.repeat(15) + '%',
    'a'.repeat(15) + '+',
  ]) {
    assert.equal(read(keyFile(bad, 0o600).file).code, 'key_file_shape', bad)
  }
  for (const good of ['A'.repeat(16), '0'.repeat(16), '_'.repeat(16), '-'.repeat(16)]) {
    assert.equal(read(keyFile(good, 0o600).file).state, 'ok', good)
  }
})

// ═════════════════════════════════════════════════════════════════════════════
// The closed failure vocabulary, and what never escapes
// ═════════════════════════════════════════════════════════════════════════════

test('every failure carries ONLY a closed code — no path, no content, no native error', () => {
  const key = marker()
  const probes = [
    () => read(''),
    () => read(path.join(sandbox(), 'absent')),
    () => read(keyFile('', 0o600).file),
    () => read(keyFile(key, 0o644).file),
    () => read(keyFile('a'.repeat(300), 0o600).file),
    () => read(keyFile(Buffer.from([0x80]), 0o600).file),
    () => read(keyFile(`${key} `, 0o600).file),
  ]
  for (const probe of probes) {
    const r = probe()
    assert.equal(r.state, 'failed')
    assert.deepEqual(Object.keys(r), ['state', 'code'])
    assert.ok(PING_KEY_FAILURE_CODES.includes(r.code), r.code)
    assert.ok(Object.isFrozen(r))
    const text = JSON.stringify(r)
    assert.equal(text.includes(os.tmpdir()), false, 'a path leaked')
    assert.equal(text.includes(key), false, 'content leaked')
    assert.equal(/ENOENT|EACCES|ELOOP|errno|syscall/.test(text), false, 'a native error leaked')
  }
})

test('a synthetic key never appears in any failure result', () => {
  const key = marker()
  for (const mode of [0o644, 0o640, 0o666]) {
    const { file } = keyFile(key, mode)
    assert.equal(JSON.stringify(read(file)).includes(key), false)
  }
})

test('PING_KEY_FAILURE_CODES is frozen and every code is reachable', () => {
  assert.ok(Object.isFrozen(PING_KEY_FAILURE_CODES))
  assert.equal(new Set(PING_KEY_FAILURE_CODES).size, PING_KEY_FAILURE_CODES.length)
  const real = REAL_PING_KEY_DEPS
  const seen = new Set()
  const add = (r) => {
    if (r.state === 'failed') seen.add(r.code)
  }
  add(read(path.join(sandbox(), 'absent'))) // unreadable
  add(read(keyFile('', 0o600).file)) // size
  add(read(keyFile(marker(), 0o644).file)) // mode
  add(read(keyFile('a'.repeat(300), 0o600).file)) // size
  add(read(keyFile(Buffer.from([0x80]), 0o600).file)) // encoding
  add(read(keyFile('short', 0o600).file)) // shape
  {
    const dir = sandbox()
    const sub = path.join(dir, 'sub')
    fs.mkdirSync(sub, { mode: 0o700 })
    add(read(sub)) // not_regular
  }
  {
    const { dir, file } = keyFile(marker())
    const link = path.join(dir, 'link')
    fs.symlinkSync(file, link)
    add(read(link)) // symlink
  }
  add(makePingKeyReader({ ...real, geteuid: () => 65534 }).readPingKey(keyFile(marker()).file))
  {
    const { file } = keyFile(marker())
    const reader = makePingKeyReader({
      ...real,
      fstat: (fd) => {
        const st = stLike(real.fstat(fd))
        return { ...st, ino: st.ino + 1n }
      },
    })
    add(reader.readPingKey(file)) // identity_changed
  }
  assert.deepEqual([...seen].sort(), [...PING_KEY_FAILURE_CODES].sort())
})

test('makePingKeyReader refuses an incomplete dependency set', () => {
  assert.throws(() => makePingKeyReader(null), TypeError)
  assert.throws(() => makePingKeyReader({}), TypeError)
  for (const name of ['lstat', 'open', 'fstat', 'read', 'close', 'geteuid']) {
    const deps = { ...REAL_PING_KEY_DEPS }
    delete deps[name]
    assert.throws(() => makePingKeyReader(deps), TypeError, name)
  }
})

// ═════════════════════════════════════════════════════════════════════════════
// Static regressions
// ═════════════════════════════════════════════════════════════════════════════

const codeOf = (file) =>
  fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => !/^\s*(\*|\/\*|\/\/)/.test(line))
    .join('\n')

test('static: the open flag expression is EXACTLY O_RDONLY | O_NOFOLLOW | O_NONBLOCK', () => {
  const code = codeOf(SOURCE)
  assert.ok(
    code.includes(
      'const READ_NO_FOLLOW = fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK',
    ),
    'the flag expression must be exactly the three documented flags',
  )
  // `\b` so the `READ_NO_FOLLOW` identifier does not read as an `O_FOLLOW` flag.
  const flags = [...code.matchAll(/\bO_[A-Z_]+/g)].map((m) => m[0])
  assert.deepEqual(new Set(flags), new Set(['O_RDONLY', 'O_NOFOLLOW', 'O_NONBLOCK']))
})

test('static: NO O_CLOEXEC identifier and NO manufactured numeric constant in its place', () => {
  const full = fs.readFileSync(SOURCE, 'utf8')
  const code = codeOf(SOURCE)
  // The identifier may be DISCUSSED in the docblock (the honest statement about
  // close-on-exec), but must never appear in executable code.
  assert.equal(/O_CLOEXEC/.test(code), false, 'O_CLOEXEC must not appear in code')
  assert.ok(full.includes('O_CLOEXEC'), 'the docblock must state the close-on-exec position')
  assert.ok(
    /close-on-exec for this descriptor is supplied\s+\*\s+by Node\/libuv/.test(full),
    'the honest close-on-exec statement must be present',
  )
  // No hand-rolled flag number: 0o2000000 / 524288 are the usual candidates.
  for (const forbidden of [/0o2000000/, /\b524288\b/, /0x80000/]) {
    assert.equal(forbidden.test(code), false, String(forbidden))
  }
})

test('static: the mode rule is the single exact comparison, with no weaker mask anywhere', () => {
  const code = codeOf(SOURCE)
  assert.ok(code.includes('const REQUIRED_MODE = 0o600n'))
  assert.ok(code.includes('const MODE_MASK = 0o7777n'))
  assert.equal(code.match(/\(lst\.mode & MODE_MASK\) !== REQUIRED_MODE/g).length, 1)
  assert.equal(code.match(/\(fst\.mode & MODE_MASK\) !== REQUIRED_MODE/g).length, 1)
  // No weaker mask: 0o077, 0o022, 0o777 would each admit a mode 0600 does not.
  for (const forbidden of [/0o077/, /0o022/, /0o777\b/, /0o7777[^n]/]) {
    assert.equal(forbidden.test(code), false, String(forbidden))
  }
})

test('static: the reader holds no write, spawn, network or environment capability', () => {
  const code = codeOf(SOURCE)
  for (const forbidden of [
    /writeFileSync/,
    /unlinkSync/,
    /rmSync/,
    /renameSync/,
    /mkdirSync/,
    /chmodSync/,
    /\bspawn\b/,
    /execSync/,
    /child_process/,
    /node:net/,
    /node:http/,
    /node:https/,
    /\bfetch\b/,
    /O_CREAT/,
    /O_WRONLY/,
    /\bO_TRUNC\b/,
    /process\.env/,
    /process\.exit\(/,
    /process\.on\(/,
  ]) {
    assert.equal(forbidden.test(code), false, String(forbidden))
  }
})

test('static: the key is never module-level, never logged, and never interpolated', () => {
  const code = codeOf(SOURCE)
  assert.equal(/console\./.test(code), false)
  assert.equal(/\$\{key\}/.test(code), false)
  assert.equal(/\$\{text\}/.test(code), false)
  // `key` exists only as a local inside `readPingKey` and in the returned record.
  assert.equal(/^(export )?(const|let|var) key\b/m.test(code), false)
  // No public wrapper file exists for this core.
  assert.equal(fs.existsSync(path.join(HERE, 'backup-monitor-ping-key.mjs')), false)
})
