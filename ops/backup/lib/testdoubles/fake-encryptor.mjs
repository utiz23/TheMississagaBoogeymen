#!/usr/bin/env node
/**
 * TEST DOUBLE — a fake encryption executable. **This is not `age` and it
 * performs no encryption.** It exists so the producer's subprocess contract —
 * argv, exit codes, the stdout ciphertext stream, the byte ceiling and
 * cancellation — can be exercised on a host where `age` is not installed and no
 * key exists.
 *
 * Nothing it produces is confidential, and no test using it may be reported as
 * cryptographic verification.
 *
 * CONTRACT: ciphertext goes to STDOUT. The double is never handed `--output`,
 * because the producer owns the output descriptor — that is what makes the byte
 * ceiling a bound rather than a measurement.
 *
 * Behaviour is chosen by FAKE_ENC_MODE:
 *   ok (default)  header + a copy of the input
 *   passthrough   an exact copy of the input, no header
 *   fail          exit 3 with stderr
 *   empty         exit 0 having written nothing
 *   hang          write the header, then never exit
 *   oversized     64 KiB chunks on a timer, slowly, forever
 *   burst         ONE synchronous 8 MiB write, finished before any timer could
 *                 fire — the case a polling budget cannot catch
 *
 * FAKE_MARKER_DIR gets `encryption.started` / `encryption.stopped` markers.
 */

import fs from 'node:fs'

const HEADER = 'age-encryption.org/v1\n-> X25519 test-double\n'
const mode = process.env.FAKE_ENC_MODE ?? 'ok'
const markerDir = process.env.FAKE_MARKER_DIR
const mark = (name, body = '') => {
  if (!markerDir) return
  try {
    fs.writeFileSync(`${markerDir}/${name}`, body)
  } catch {
    /* the test may already have torn the directory down */
  }
}

const argv = process.argv.slice(2)
if (argv.includes('--output')) {
  process.stderr.write(
    'fake-encryptor: --output is not part of the contract; ciphertext goes to stdout\n',
  )
  process.exit(64)
}
const inPath = argv[argv.length - 1]

mark('encryption.started', `${process.pid} ${Date.now()}`)
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    mark('encryption.stopped', `${sig} ${Date.now()}`)
    process.exit(143)
  })
}

// stdout may be closed under us the moment the producer's ceiling fires.
process.stdout.on('error', () => process.exit(141))

if (mode === 'fail') {
  process.stderr.write('age: error: failed to read recipients file\n')
  process.exit(3)
} else if (mode === 'empty') {
  process.exit(0)
} else if (mode === 'passthrough') {
  process.stdout.write(fs.readFileSync(inPath))
} else if (mode === 'hang') {
  process.stdout.write(HEADER)
  setInterval(() => {}, 1000)
} else if (mode === 'burst') {
  // The reproduction case: everything in one go, before any sampling timer.
  process.stdout.write(HEADER)
  process.stdout.write(Buffer.alloc(8 * 1024 * 1024, 0x41))
} else if (mode === 'oversized') {
  process.stdout.write(HEADER)
  const chunk = Buffer.alloc(65536, 0x41)
  let written = 0
  const timer = setInterval(() => {
    if (!process.stdout.write(chunk)) {
      /* backpressure: keep going, the producer decides when to stop us */
    }
    written += 1
    if (written >= 400) {
      clearInterval(timer)
      process.exit(0)
    }
  }, 10)
} else {
  process.stdout.write(HEADER + fs.readFileSync(inPath, 'latin1'), 'latin1')
}
