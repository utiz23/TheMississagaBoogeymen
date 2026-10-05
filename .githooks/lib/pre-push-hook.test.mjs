/**
 * .githooks/pre-push — integration (behavioural) suite.
 *
 * Exercises the REAL hook script and the REAL classifier against a scratch
 * "local" + bare "remote" git repo pair, with scripts/verify-ocr.sh replaced
 * by a recording fake so the full path can be proven WITHOUT running the
 * 20-minute OCR/video suite or touching a database.
 *
 * No Docker, no PostgreSQL, no network — `git push` targets a local bare
 * repo via a filesystem path.
 */

import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, cpSync, chmodSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '../..')

function git(cwd, args, opts = {}) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', ...opts })
}

const FULL_MARKER = 'FULL_VERIFICATION_RAN'

const configured = {
  TEST_DATABASE_URL: 'postgresql://eanhl_test:testpw@127.0.0.1:5434/eanhl_test',
  TEST_DB_CONTAINER: 'eanhl-verify-test-db-test-1',
  TEST_DB_COMPOSE_PROJECT: 'eanhl-verify-test',
  TEST_DB_COMPOSE_SERVICE: 'db-test',
}

/**
 * Build a "local" clone of a fresh bare "remote" repo. The local repo carries
 * a real copy of .githooks (wired via core.hooksPath) plus a stubbed
 * scripts/verify-ocr.sh that only records that it ran — never the real
 * harness.
 */
function makeRepoPair() {
  const workDir = mkdtempSync(path.join(tmpdir(), 'pre-push-hook-'))
  const remoteDir = path.join(workDir, 'remote.git')
  const localDir = path.join(workDir, 'local')

  git(workDir, ['init', '--bare', '--initial-branch=main', remoteDir])

  mkdirSync(localDir)
  git(localDir, ['init', '--initial-branch=main', '-q'])
  git(localDir, ['config', 'user.email', 'test@example.com'])
  git(localDir, ['config', 'user.name', 'Test'])
  git(localDir, ['remote', 'add', 'origin', remoteDir])

  // Real hook + real classifier, copied from the repo under test.
  const hooksDst = path.join(localDir, '.githooks')
  cpSync(path.join(REPO_ROOT, '.githooks/pre-push'), path.join(hooksDst, 'pre-push'))
  mkdirSync(path.join(hooksDst, 'lib'), { recursive: true })
  for (const f of ['classify-push.mjs', 'classify-push-cli.mjs']) {
    cpSync(path.join(REPO_ROOT, '.githooks/lib', f), path.join(hooksDst, 'lib', f))
  }
  chmodSync(path.join(hooksDst, 'pre-push'), 0o755)
  chmodSync(path.join(hooksDst, 'lib/classify-push-cli.mjs'), 0o755)
  git(localDir, ['config', 'core.hooksPath', '.githooks'])

  // Stubbed full-verification harness: records that it ran, never launches
  // the real 20-minute suite.
  mkdirSync(path.join(localDir, 'scripts'), { recursive: true })
  writeFileSync(
    path.join(localDir, 'scripts/verify-ocr.sh'),
    ['#!/usr/bin/env bash', `echo "${FULL_MARKER}"`, 'exit 0', ''].join('\n'),
    { mode: 0o755 },
  )

  const initial = path.join(localDir, 'HANDOFF.md')
  writeFileSync(initial, '# handoff\n')
  git(localDir, ['add', '-A'])
  git(localDir, ['commit', '-q', '-m', 'init'])
  // The very first push creates the branch with no origin/main to compare
  // against, which the classifier sends to full verification — so this setup
  // step needs TEST_* configured. It is not part of what any test below
  // asserts on.
  git(localDir, ['push', '-q', 'origin', 'main'], { env: { ...process.env, ...configured } })

  return { workDir, remoteDir, localDir }
}

function pushWithEnv(localDir, env = {}, refspec = 'main') {
  const childEnv = { ...process.env }
  for (const key of Object.keys(childEnv)) {
    if (key === 'TEST_DATABASE_URL' || key.startsWith('TEST_DB_')) delete childEnv[key]
  }
  Object.assign(childEnv, env)
  const result = spawnSync('git', ['push', 'origin', refspec], {
    cwd: localDir,
    env: childEnv,
    encoding: 'utf8',
  })
  return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` }
}

function commitFile(localDir, rel, content, message) {
  mkdirSync(path.dirname(path.join(localDir, rel)), { recursive: true })
  writeFileSync(path.join(localDir, rel), content)
  git(localDir, ['add', '-A'])
  git(localDir, ['commit', '-q', '-m', message])
}

test('pushing a docs-only change skips the full harness and requires no TEST_* config', () => {
  const { workDir, localDir } = makeRepoPair()
  try {
    writeFileSync(path.join(localDir, 'HANDOFF.md'), '# handoff v2\n')
    git(localDir, ['add', '-A'])
    git(localDir, ['commit', '-q', '-m', 'docs update'])

    const { status, output } = pushWithEnv(localDir) // no TEST_* set at all
    assert.equal(status, 0, `push should succeed${output}`)
    assert.match(output, /classification: fast path/, output)
    assert.ok(!output.includes(FULL_MARKER), `full harness must not have run${output}`)
  } finally {
    rmSync(workDir, { recursive: true, force: true })
  }
})

test('pushing a website code change skips the full harness and requires no TEST_* config', () => {
  const { workDir, localDir } = makeRepoPair()
  try {
    commitFile(localDir, 'apps/web/src/index.ts', 'export const x = 1\n', 'website change')

    const { status, output } = pushWithEnv(localDir) // no TEST_* set at all
    assert.equal(status, 0, `push should succeed${output}`)
    assert.match(output, /no video-stats paths changed/, output)
    assert.ok(!output.includes(FULL_MARKER), `full harness must not have run${output}`)
  } finally {
    rmSync(workDir, { recursive: true, force: true })
  }
})

test('pushing a new branch without video-stats changes is compared with origin/main and skips the harness', () => {
  const { workDir, localDir } = makeRepoPair()
  try {
    git(localDir, ['checkout', '-q', '-b', 'feature'])
    commitFile(localDir, 'ops/nightly-backup/backup.sh', '#!/bin/sh\n', 'backup change')

    const { status, output } = pushWithEnv(localDir, {}, 'feature') // no TEST_* set at all
    assert.equal(status, 0, `push should succeed${output}`)
    assert.match(output, /classification: fast path/, output)
    assert.ok(!output.includes(FULL_MARKER), `full harness must not have run${output}`)
  } finally {
    rmSync(workDir, { recursive: true, force: true })
  }
})

test('pushing a video-stats change without TEST_* config refuses before running the harness', () => {
  const { workDir, localDir } = makeRepoPair()
  try {
    commitFile(localDir, 'tools/game_ocr/reader.py', 'x = 1\n', 'video-stats change')

    const { status, output } = pushWithEnv(localDir) // no TEST_* set
    assert.notEqual(status, 0, `push should be refused${output}`)
    assert.match(output, /FULL verification required/, output)
    assert.match(output, /verification-database configuration is incomplete/, output)
    assert.ok(!output.includes(FULL_MARKER), `full harness must not have run${output}`)
  } finally {
    rmSync(workDir, { recursive: true, force: true })
  }
})

test('pushing a video-stats change with TEST_* configured runs the full harness', () => {
  const { workDir, localDir } = makeRepoPair()
  try {
    commitFile(localDir, 'tools/game_ocr/reader.py', 'x = 1\n', 'video-stats change')

    const { status, output } = pushWithEnv(localDir, configured)
    assert.equal(status, 0, `push should succeed${output}`)
    assert.match(output, /FULL verification required/, output)
    assert.ok(output.includes(FULL_MARKER), `full harness should have run${output}`)
  } finally {
    rmSync(workDir, { recursive: true, force: true })
  }
})

test('EANHL_PRE_PUSH_FULL=1 forces the full harness even for a docs-only change', () => {
  const { workDir, localDir } = makeRepoPair()
  try {
    writeFileSync(path.join(localDir, 'HANDOFF.md'), '# handoff v3\n')
    git(localDir, ['add', '-A'])
    git(localDir, ['commit', '-q', '-m', 'docs update'])

    const { status, output } = pushWithEnv(localDir, { ...configured, EANHL_PRE_PUSH_FULL: '1' })
    assert.equal(status, 0, `push should succeed${output}`)
    assert.match(output, /override: EANHL_PRE_PUSH_FULL/, output)
    assert.ok(output.includes(FULL_MARKER), `full harness should have run${output}`)
  } finally {
    rmSync(workDir, { recursive: true, force: true })
  }
})

test('a fast-path push with a git diff --check failure is blocked, not silently allowed or upgraded to full', () => {
  const { workDir, localDir } = makeRepoPair()
  try {
    writeFileSync(path.join(localDir, 'HANDOFF.md'), 'trailing ws   \nmore\n')
    git(localDir, ['add', '-A'])
    git(localDir, ['commit', '-q', '-m', 'whitespace'])

    const { status, output } = pushWithEnv(localDir) // no TEST_* set
    assert.notEqual(status, 0, `push should be blocked${output}`)
    assert.match(output, /classification: fast path/, output)
    assert.match(output, /BLOCKED.*git diff --check/s, output)
    assert.ok(!output.includes(FULL_MARKER), `full harness must not have run${output}`)
    // EANHL_PRE_PUSH_FULL forces the full ~20-minute suite; it does not fix a
    // whitespace error, so it must never be offered as the remedy here.
    assert.ok(
      !output.includes('EANHL_PRE_PUSH_FULL'),
      `diff --check failure output must not recommend EANHL_PRE_PUSH_FULL as a fix: ${output}`,
    )
    assert.match(output, /fix the issues.*push again/is, output)
  } finally {
    rmSync(workDir, { recursive: true, force: true })
  }
})

test('hook output no longer recommends --no-verify as the actionable fix', () => {
  const { workDir, localDir } = makeRepoPair()
  try {
    commitFile(localDir, 'tools/game_ocr/reader.py', 'x = 1\n', 'video-stats change')

    const { output } = pushWithEnv(localDir) // no TEST_* set -> blocked
    assert.ok(
      !/push without verifying/i.test(output) && !output.includes('--no-verify'),
      `hook output should not steer users to --no-verify: ${output}`,
    )
  } finally {
    rmSync(workDir, { recursive: true, force: true })
  }
})
