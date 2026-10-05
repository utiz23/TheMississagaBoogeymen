/**
 * classify-push.mjs — unit tests.
 *
 * Exercises the classifier against REAL git objects in a scratch repo (no
 * mocked plumbing), so the fast-forward / rename / object-type logic is
 * proven against actual git behavior rather than a model of it. No network,
 * no Docker, no database.
 */

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  classifyPush,
  isVideoStatsPath,
  NEW_BRANCH_BASE_REF,
  ZERO_OID_40,
} from './classify-push.mjs'

function git(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

function initRepo() {
  const dir = mkdtempSync(path.join(tmpdir(), 'classify-push-'))
  git(dir, ['init', '--initial-branch=main', '-q'])
  git(dir, ['config', 'user.email', 'test@example.com'])
  git(dir, ['config', 'user.name', 'Test'])
  return dir
}

function writeAndCommit(dir, files, message) {
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel)
    mkdirSync(path.dirname(full), { recursive: true })
    writeFileSync(full, content)
  }
  git(dir, ['add', '-A'])
  git(dir, ['commit', '-q', '-m', message])
  return git(dir, ['rev-parse', 'HEAD'])
}

function stdinLine(localRef, localOid, remoteRef, remoteOid) {
  return `${localRef} ${localOid} ${remoteRef} ${remoteOid}\n`
}

/** Classify a single fast-forward push of main from `base` to `head`. */
function classifyMainPush(dir, base, head, env = {}) {
  const stdin = stdinLine('refs/heads/main', head, 'refs/heads/main', base)
  return classifyPush({ stdinText: stdin, repoRoot: dir, env })
}

function withRepo(fn) {
  const dir = initRepo()
  try {
    fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('isVideoStatsPath: video-stats tools and the verification harness count', () => {
  assert.equal(isVideoStatsPath('tools/game_ocr/game_ocr/reader.py'), true)
  assert.equal(isVideoStatsPath('tools/video_ingest/video_ingest/cli.py'), true)
  assert.equal(isVideoStatsPath('tools/video_ingest/README.md'), true)
  assert.equal(isVideoStatsPath('apps/worker/scripts/with-test-db.mjs'), true)
  assert.equal(isVideoStatsPath('scripts/verify-ocr.sh'), true)
})

test('isVideoStatsPath: any non-notes path with an "ocr" segment counts', () => {
  assert.equal(isVideoStatsPath('apps/worker/src/ingest-ocr.ts'), true)
  assert.equal(isVideoStatsPath('apps/worker/src/ocr-promoters/loadout.ts'), true)
  assert.equal(isVideoStatsPath('packages/db/src/queries/ocr-coverage.ts'), true)
  assert.equal(isVideoStatsPath('docs/ocr/tier0-quarantined-worker-tests.txt'), true)
  // Markdown outside docs/ can be machine input (the match-250 benchmark).
  assert.equal(
    isVideoStatsPath('research/OCR-SS/Manual OCR benchmark for verification V2.md'),
    true,
  )
})

test('isVideoStatsPath: prose notes never count, even with an "ocr" segment', () => {
  assert.equal(isVideoStatsPath('HANDOFF.md'), false)
  assert.equal(isVideoStatsPath('docs/ocr/notes.md'), false)
  assert.equal(isVideoStatsPath('docs/a/b/ocr-plan.md'), false)
})

test('isVideoStatsPath: website, backup, config and hook paths do not count', () => {
  assert.equal(isVideoStatsPath('apps/web/src/app/page.tsx'), false)
  assert.equal(isVideoStatsPath('apps/worker/src/ingest.ts'), false)
  assert.equal(isVideoStatsPath('packages/db/src/queries/game-titles.ts'), false)
  assert.equal(isVideoStatsPath('ops/nightly-backup/backup.sh'), false)
  assert.equal(isVideoStatsPath('docker-compose.yml'), false)
  assert.equal(isVideoStatsPath('package.json'), false)
  assert.equal(isVideoStatsPath('.githooks/pre-push'), false)
  assert.equal(isVideoStatsPath('apps/web/src/procrastinate.ts'), false)
})

test('HANDOFF.md-only update takes the fast path', () => {
  withRepo((dir) => {
    const base = writeAndCommit(dir, { 'HANDOFF.md': '# handoff\n' }, 'init')
    const head = writeAndCommit(dir, { 'HANDOFF.md': '# handoff v2\n' }, 'update handoff')
    const result = classifyMainPush(dir, base, head)
    assert.equal(result.mode, 'fast', JSON.stringify(result))
    assert.deepEqual(result.paths, ['HANDOFF.md'])
    assert.equal(result.diffCheck.ok, true, JSON.stringify(result))
  })
})

test('website code change takes the fast path', () => {
  withRepo((dir) => {
    const base = writeAndCommit(dir, { 'apps/web/src/index.ts': 'a\n' }, 'init')
    const head = writeAndCommit(dir, { 'apps/web/src/index.ts': 'b\n' }, 'code')
    assert.equal(classifyMainPush(dir, base, head).mode, 'fast')
  })
})

test('backup scripts, compose, dependencies and hook changes take the fast path', () => {
  withRepo((dir) => {
    const base = writeAndCommit(dir, { 'package.json': '{}\n' }, 'init')
    const head = writeAndCommit(
      dir,
      {
        'package.json': '{"a":1}\n',
        'pnpm-lock.yaml': 'lockfile\n',
        'ops/nightly-backup/backup.sh': '#!/bin/sh\n',
        'docker-compose.yml': 'services: {}\n',
        '.githooks/pre-push': '#!/bin/bash\n',
      },
      'non-ocr changes',
    )
    const result = classifyMainPush(dir, base, head)
    assert.equal(result.mode, 'fast', JSON.stringify(result))
  })
})

test('video-stats tool change classifies full', () => {
  withRepo((dir) => {
    const base = writeAndCommit(dir, { 'tools/game_ocr/reader.py': 'a\n' }, 'init')
    const head = writeAndCommit(dir, { 'tools/game_ocr/reader.py': 'b\n' }, 'ocr change')
    const result = classifyMainPush(dir, base, head)
    assert.equal(result.mode, 'full', JSON.stringify(result))
    assert.match(result.reason, /video-stats/)
  })
})

test('worker OCR file change classifies full', () => {
  withRepo((dir) => {
    const base = writeAndCommit(dir, { 'apps/worker/src/ingest-ocr.ts': 'a\n' }, 'init')
    const head = writeAndCommit(dir, { 'apps/worker/src/ingest-ocr.ts': 'b\n' }, 'worker ocr')
    assert.equal(classifyMainPush(dir, base, head).mode, 'full')
  })
})

test('docs plus video-stats code in the same push classifies full', () => {
  withRepo((dir) => {
    const base = writeAndCommit(
      dir,
      { 'HANDOFF.md': 'a\n', 'tools/video_ingest/x.py': 'a\n' },
      'init',
    )
    const head = writeAndCommit(
      dir,
      { 'HANDOFF.md': 'b\n', 'tools/video_ingest/x.py': 'b\n' },
      'mixed',
    )
    assert.equal(classifyMainPush(dir, base, head).mode, 'full')
  })
})

test('new branch is compared with where it left origin/main (fast when no video-stats change)', () => {
  withRepo((dir) => {
    const base = writeAndCommit(dir, { 'tools/game_ocr/reader.py': 'a\n' }, 'init')
    git(dir, ['update-ref', NEW_BRANCH_BASE_REF, base])
    git(dir, ['checkout', '-q', '-b', 'feature'])
    const head = writeAndCommit(dir, { 'apps/web/src/x.ts': 'x\n' }, 'feature work')
    const stdin = stdinLine('refs/heads/feature', head, 'refs/heads/feature', ZERO_OID_40)
    const result = classifyPush({ stdinText: stdin, repoRoot: dir, env: {} })
    assert.equal(result.mode, 'fast', JSON.stringify(result))
    // Only the branch's own change is considered, not origin/main's history.
    assert.deepEqual(result.paths, ['apps/web/src/x.ts'])
  })
})

test('new branch with a video-stats change classifies full', () => {
  withRepo((dir) => {
    const base = writeAndCommit(dir, { 'HANDOFF.md': 'a\n' }, 'init')
    git(dir, ['update-ref', NEW_BRANCH_BASE_REF, base])
    git(dir, ['checkout', '-q', '-b', 'feature'])
    const head = writeAndCommit(dir, { 'tools/video_ingest/x.py': 'x\n' }, 'ocr work')
    const stdin = stdinLine('refs/heads/feature', head, 'refs/heads/feature', ZERO_OID_40)
    const result = classifyPush({ stdinText: stdin, repoRoot: dir, env: {} })
    assert.equal(result.mode, 'full', JSON.stringify(result))
  })
})

test('new branch with no origin/main to compare against classifies full', () => {
  withRepo((dir) => {
    const head = writeAndCommit(dir, { 'HANDOFF.md': 'a\n' }, 'init')
    const stdin = stdinLine('refs/heads/feature', head, 'refs/heads/feature', ZERO_OID_40)
    const result = classifyPush({ stdinText: stdin, repoRoot: dir, env: {} })
    assert.equal(result.mode, 'full', JSON.stringify(result))
    assert.match(result.reason, /new branch/i)
  })
})

test('deleted branch takes the fast path with no paths', () => {
  withRepo((dir) => {
    const head = writeAndCommit(dir, { 'HANDOFF.md': 'a\n' }, 'init')
    const stdin = stdinLine('(delete)', ZERO_OID_40, 'refs/heads/feature', head)
    const result = classifyPush({ stdinText: stdin, repoRoot: dir, env: {} })
    assert.equal(result.mode, 'fast', JSON.stringify(result))
    assert.deepEqual(result.paths, [])
  })
})

test('deleted tag classifies full', () => {
  withRepo((dir) => {
    const head = writeAndCommit(dir, { 'HANDOFF.md': 'a\n' }, 'init')
    const stdin = stdinLine('(delete)', ZERO_OID_40, 'refs/tags/v1.0.0', head)
    const result = classifyPush({ stdinText: stdin, repoRoot: dir, env: {} })
    assert.equal(result.mode, 'full', JSON.stringify(result))
  })
})

test('tag / non-head ref classifies full', () => {
  withRepo((dir) => {
    const base = writeAndCommit(dir, { 'HANDOFF.md': 'a\n' }, 'init')
    const head = writeAndCommit(dir, { 'HANDOFF.md': 'b\n' }, 'update')
    git(dir, ['tag', 'v1.0.0', head])
    const stdin = stdinLine('refs/tags/v1.0.0', head, 'refs/tags/v1.0.0', base)
    const result = classifyPush({ stdinText: stdin, repoRoot: dir, env: {} })
    assert.equal(result.mode, 'full', JSON.stringify(result))
  })
})

test('non-fast-forward update classifies full', () => {
  withRepo((dir) => {
    const base = writeAndCommit(dir, { 'HANDOFF.md': 'a\n' }, 'init')
    // Diverge: build a sibling commit not descended from base's later history.
    const sideA = writeAndCommit(dir, { 'HANDOFF.md': 'b\n' }, 'side a')
    git(dir, ['checkout', '-q', '-b', 'side', base])
    const sideB = writeAndCommit(dir, { 'HANDOFF.md': 'c\n' }, 'side b')
    // remote is sideA, local (to be pushed) is sideB — neither is an ancestor of the other.
    const result = classifyMainPush(dir, sideA, sideB)
    assert.equal(result.mode, 'full', JSON.stringify(result))
    assert.match(result.reason, /fast-forward/i)
  })
})

test('malformed stdin (wrong field count) classifies full', () => {
  withRepo((dir) => {
    const result = classifyPush({ stdinText: 'only two fields\n', repoRoot: dir, env: {} })
    assert.equal(result.mode, 'full', JSON.stringify(result))
    assert.match(result.reason, /malformed/i)
  })
})

test('empty stdin classifies full', () => {
  withRepo((dir) => {
    const result = classifyPush({ stdinText: '', repoRoot: dir, env: {} })
    assert.equal(result.mode, 'full', JSON.stringify(result))
    assert.match(result.reason, /empty/i)
  })
})

test('multiple refs without video-stats changes take the fast path', () => {
  withRepo((dir) => {
    const base = writeAndCommit(dir, { 'HANDOFF.md': 'a\n' }, 'init')
    git(dir, ['branch', 'other', base])
    const headMain = writeAndCommit(dir, { 'HANDOFF.md': 'b\n' }, 'main docs')
    git(dir, ['checkout', '-q', 'other'])
    const headOther = writeAndCommit(dir, { 'apps/web/src/x.ts': 'x\n' }, 'other code')
    const stdin =
      stdinLine('refs/heads/main', headMain, 'refs/heads/main', base) +
      stdinLine('refs/heads/other', headOther, 'refs/heads/other', base)
    const result = classifyPush({ stdinText: stdin, repoRoot: dir, env: {} })
    assert.equal(result.mode, 'fast', JSON.stringify(result))
  })
})

test('multiple refs with one video-stats change classifies full', () => {
  withRepo((dir) => {
    const base = writeAndCommit(dir, { 'HANDOFF.md': 'a\n' }, 'init')
    git(dir, ['branch', 'other', base])
    const headMain = writeAndCommit(dir, { 'HANDOFF.md': 'b\n' }, 'main docs')
    git(dir, ['checkout', '-q', 'other'])
    const headOther = writeAndCommit(dir, { 'tools/game_ocr/x.py': 'x\n' }, 'other ocr')
    const stdin =
      stdinLine('refs/heads/main', headMain, 'refs/heads/main', base) +
      stdinLine('refs/heads/other', headOther, 'refs/heads/other', base)
    const result = classifyPush({ stdinText: stdin, repoRoot: dir, env: {} })
    assert.equal(result.mode, 'full', JSON.stringify(result))
  })
})

test('video-stats-to-docs rename classifies full (rename detection disabled exposes both sides)', () => {
  withRepo((dir) => {
    const base = writeAndCommit(dir, { 'tools/game_ocr/notes.py': 'identical content\n' }, 'init')
    mkdirSync(path.join(dir, 'docs'), { recursive: true })
    git(dir, ['mv', 'tools/game_ocr/notes.py', 'docs/notes.md'])
    git(dir, ['commit', '-q', '-m', 'rename ocr code to docs'])
    const head = git(dir, ['rev-parse', 'HEAD'])
    const result = classifyMainPush(dir, base, head)
    assert.equal(result.mode, 'full', JSON.stringify(result))
    assert.ok(result.paths.includes('tools/game_ocr/notes.py'), JSON.stringify(result))
    assert.ok(result.paths.includes('docs/notes.md'), JSON.stringify(result))
  })
})

test('paths containing spaces are classified correctly', () => {
  withRepo((dir) => {
    const base = writeAndCommit(
      dir,
      { 'docs/my notes.md': 'a\n', 'research/OCR-SS/bench mark.md': 'a\n' },
      'init',
    )
    const fastHead = writeAndCommit(dir, { 'docs/my notes.md': 'b\n' }, 'spacey docs')
    const fast = classifyMainPush(dir, base, fastHead)
    assert.equal(fast.mode, 'fast', JSON.stringify(fast))
    assert.deepEqual(fast.paths, ['docs/my notes.md'])
    const fullHead = writeAndCommit(
      dir,
      { 'research/OCR-SS/bench mark.md': 'b\n' },
      'spacey benchmark',
    )
    assert.equal(classifyMainPush(dir, fastHead, fullHead).mode, 'full')
  })
})

test('EANHL_PRE_PUSH_FULL=1 converts a fast push to full', () => {
  withRepo((dir) => {
    const base = writeAndCommit(dir, { 'HANDOFF.md': 'a\n' }, 'init')
    const head = writeAndCommit(dir, { 'HANDOFF.md': 'b\n' }, 'docs')
    const result = classifyMainPush(dir, base, head, { EANHL_PRE_PUSH_FULL: '1' })
    assert.equal(result.mode, 'full', JSON.stringify(result))
    assert.match(result.reason, /override/i)
  })
})

test('fast push with a git diff --check failure blocks (not full, not silently allowed)', () => {
  withRepo((dir) => {
    const base = writeAndCommit(dir, { 'HANDOFF.md': 'a\n' }, 'init')
    // Trailing whitespace triggers `git diff --check`.
    const head = writeAndCommit(dir, { 'HANDOFF.md': 'a   \nb\n' }, 'trailing whitespace')
    const result = classifyMainPush(dir, base, head)
    assert.equal(result.mode, 'fast', JSON.stringify(result))
    assert.equal(result.diffCheck.ok, false, JSON.stringify(result))
    assert.match(result.diffCheck.output, /whitespace/i)
  })
})

test('new-branch fast push still runs git diff --check on the branch range', () => {
  withRepo((dir) => {
    const base = writeAndCommit(dir, { 'HANDOFF.md': 'a\n' }, 'init')
    git(dir, ['update-ref', NEW_BRANCH_BASE_REF, base])
    git(dir, ['checkout', '-q', '-b', 'feature'])
    const head = writeAndCommit(dir, { 'apps/web/src/x.ts': 'x   \n' }, 'trailing whitespace')
    const stdin = stdinLine('refs/heads/feature', head, 'refs/heads/feature', ZERO_OID_40)
    const result = classifyPush({ stdinText: stdin, repoRoot: dir, env: {} })
    assert.equal(result.mode, 'fast', JSON.stringify(result))
    assert.equal(result.diffCheck.ok, false, JSON.stringify(result))
  })
})

test('missing/malformed object id classifies full conservatively', () => {
  withRepo((dir) => {
    const head = writeAndCommit(dir, { 'HANDOFF.md': 'a\n' }, 'init')
    const fakeOid = 'deadbeef'.repeat(5) // 40 hex chars, not a real object
    assert.equal(classifyMainPush(dir, fakeOid, head).mode, 'full')
  })
})

test('no-op push (identical oids) takes the fast path with no paths', () => {
  withRepo((dir) => {
    const head = writeAndCommit(dir, { 'HANDOFF.md': 'a\n' }, 'init')
    const result = classifyMainPush(dir, head, head)
    assert.equal(result.mode, 'fast', JSON.stringify(result))
    assert.deepEqual(result.paths, [])
  })
})
