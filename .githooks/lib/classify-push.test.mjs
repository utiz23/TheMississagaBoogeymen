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

import { classifyPush, isAllowedDocPath, ZERO_OID_40 } from './classify-push.mjs'

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

test('isAllowedDocPath: root-level md files are allowed', () => {
  assert.equal(isAllowedDocPath('HANDOFF.md'), true)
  assert.equal(isAllowedDocPath('README.md'), true)
  assert.equal(isAllowedDocPath('CLAUDE.md'), true)
})

test('isAllowedDocPath: docs/**/*.md is allowed, nested', () => {
  assert.equal(isAllowedDocPath('docs/ARCHITECTURE.md'), true)
  assert.equal(isAllowedDocPath('docs/operations/deploy-notes.md'), true)
  assert.equal(isAllowedDocPath('docs/a/b/c/deep.md'), true)
})

test('isAllowedDocPath: rejects non-md docs files', () => {
  assert.equal(isAllowedDocPath('docs/data.json'), false)
  assert.equal(isAllowedDocPath('docs/notes.txt'), false)
})

test('isAllowedDocPath: rejects excluded directories even when .md', () => {
  assert.equal(isAllowedDocPath('apps/web/README.md'), false)
  assert.equal(isAllowedDocPath('packages/db/README.md'), false)
  assert.equal(isAllowedDocPath('tools/game_ocr/README.md'), false)
  assert.equal(isAllowedDocPath('ops/README.md'), false)
  assert.equal(isAllowedDocPath('scripts/README.md'), false)
  assert.equal(isAllowedDocPath('research/notes.md'), false)
  assert.equal(isAllowedDocPath('.githooks/README.md'), false)
  assert.equal(isAllowedDocPath('.github/README.md'), false)
})

test('isAllowedDocPath: rejects nested root-like traversal', () => {
  assert.equal(isAllowedDocPath('nested/dir/file.md'), false)
})

test('HANDOFF.md-only update classifies docs-only', () => {
  const dir = initRepo()
  try {
    const base = writeAndCommit(dir, { 'HANDOFF.md': '# handoff\n' }, 'init')
    const head = writeAndCommit(dir, { 'HANDOFF.md': '# handoff v2\n' }, 'update handoff')
    const stdin = stdinLine('refs/heads/main', head, 'refs/heads/main', base)
    const result = classifyPush({ stdinText: stdin, repoRoot: dir, env: {} })
    assert.equal(result.mode, 'docs-only', JSON.stringify(result))
    assert.deepEqual(result.paths, ['HANDOFF.md'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('root markdown-only update classifies docs-only', () => {
  const dir = initRepo()
  try {
    const base = writeAndCommit(dir, { 'README.md': 'a\n' }, 'init')
    const head = writeAndCommit(dir, { 'README.md': 'b\n', 'DEPLOY.md': 'c\n' }, 'docs')
    const stdin = stdinLine('refs/heads/main', head, 'refs/heads/main', base)
    const result = classifyPush({ stdinText: stdin, repoRoot: dir, env: {} })
    assert.equal(result.mode, 'docs-only', JSON.stringify(result))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('docs/**/*.md-only update classifies docs-only', () => {
  const dir = initRepo()
  try {
    const base = writeAndCommit(dir, { 'docs/ARCHITECTURE.md': 'a\n' }, 'init')
    const head = writeAndCommit(
      dir,
      { 'docs/ARCHITECTURE.md': 'b\n', 'docs/operations/notes.md': 'c\n' },
      'docs',
    )
    const stdin = stdinLine('refs/heads/main', head, 'refs/heads/main', base)
    const result = classifyPush({ stdinText: stdin, repoRoot: dir, env: {} })
    assert.equal(result.mode, 'docs-only', JSON.stringify(result))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('research/**/*.md update classifies full', () => {
  const dir = initRepo()
  try {
    const base = writeAndCommit(dir, { 'research/notes.md': 'a\n' }, 'init')
    const head = writeAndCommit(dir, { 'research/notes.md': 'b\n' }, 'research update')
    const stdin = stdinLine('refs/heads/main', head, 'refs/heads/main', base)
    const result = classifyPush({ stdinText: stdin, repoRoot: dir, env: {} })
    assert.equal(result.mode, 'full', JSON.stringify(result))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('tools/**/*.md update classifies full', () => {
  const dir = initRepo()
  try {
    const base = writeAndCommit(dir, { 'tools/video_ingest/README.md': 'a\n' }, 'init')
    const head = writeAndCommit(dir, { 'tools/video_ingest/README.md': 'b\n' }, 'tools docs')
    const stdin = stdinLine('refs/heads/main', head, 'refs/heads/main', base)
    const result = classifyPush({ stdinText: stdin, repoRoot: dir, env: {} })
    assert.equal(result.mode, 'full', JSON.stringify(result))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('code-only update classifies full', () => {
  const dir = initRepo()
  try {
    const base = writeAndCommit(dir, { 'apps/web/src/index.ts': 'a\n' }, 'init')
    const head = writeAndCommit(dir, { 'apps/web/src/index.ts': 'b\n' }, 'code')
    const stdin = stdinLine('refs/heads/main', head, 'refs/heads/main', base)
    const result = classifyPush({ stdinText: stdin, repoRoot: dir, env: {} })
    assert.equal(result.mode, 'full', JSON.stringify(result))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('package.json / lockfile update classifies full', () => {
  const dir = initRepo()
  try {
    const base = writeAndCommit(dir, { 'package.json': '{}\n' }, 'init')
    const head = writeAndCommit(
      dir,
      { 'package.json': '{"a":1}\n', 'pnpm-lock.yaml': 'lockfile\n' },
      'deps',
    )
    const stdin = stdinLine('refs/heads/main', head, 'refs/heads/main', base)
    const result = classifyPush({ stdinText: stdin, repoRoot: dir, env: {} })
    assert.equal(result.mode, 'full', JSON.stringify(result))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('docs plus code in the same push classifies full', () => {
  const dir = initRepo()
  try {
    const base = writeAndCommit(dir, { 'HANDOFF.md': 'a\n', 'apps/web/src/x.ts': 'a\n' }, 'init')
    const head = writeAndCommit(
      dir,
      { 'HANDOFF.md': 'b\n', 'apps/web/src/x.ts': 'b\n' },
      'mixed',
    )
    const stdin = stdinLine('refs/heads/main', head, 'refs/heads/main', base)
    const result = classifyPush({ stdinText: stdin, repoRoot: dir, env: {} })
    assert.equal(result.mode, 'full', JSON.stringify(result))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('hook/classifier change classifies full', () => {
  const dir = initRepo()
  try {
    const base = writeAndCommit(dir, { '.githooks/pre-push': '#!/bin/bash\n' }, 'init')
    const head = writeAndCommit(dir, { '.githooks/pre-push': '#!/bin/bash\necho hi\n' }, 'hook change')
    const stdin = stdinLine('refs/heads/main', head, 'refs/heads/main', base)
    const result = classifyPush({ stdinText: stdin, repoRoot: dir, env: {} })
    assert.equal(result.mode, 'full', JSON.stringify(result))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('new branch (remote all-zero oid) classifies full', () => {
  const dir = initRepo()
  try {
    const head = writeAndCommit(dir, { 'HANDOFF.md': 'a\n' }, 'init')
    const stdin = stdinLine('refs/heads/feature', head, 'refs/heads/feature', ZERO_OID_40)
    const result = classifyPush({ stdinText: stdin, repoRoot: dir, env: {} })
    assert.equal(result.mode, 'full', JSON.stringify(result))
    assert.match(result.reason, /branch creation|new branch/i)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('deleted branch (local all-zero oid) classifies full', () => {
  const dir = initRepo()
  try {
    const head = writeAndCommit(dir, { 'HANDOFF.md': 'a\n' }, 'init')
    const stdin = stdinLine('(delete)', ZERO_OID_40, 'refs/heads/feature', head)
    const result = classifyPush({ stdinText: stdin, repoRoot: dir, env: {} })
    assert.equal(result.mode, 'full', JSON.stringify(result))
    assert.match(result.reason, /delet/i)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('tag / non-head ref classifies full', () => {
  const dir = initRepo()
  try {
    const base = writeAndCommit(dir, { 'HANDOFF.md': 'a\n' }, 'init')
    const head = writeAndCommit(dir, { 'HANDOFF.md': 'b\n' }, 'update')
    git(dir, ['tag', 'v1.0.0', head])
    const stdin = stdinLine('refs/tags/v1.0.0', head, 'refs/tags/v1.0.0', base)
    const result = classifyPush({ stdinText: stdin, repoRoot: dir, env: {} })
    assert.equal(result.mode, 'full', JSON.stringify(result))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('non-fast-forward update classifies full', () => {
  const dir = initRepo()
  try {
    const base = writeAndCommit(dir, { 'HANDOFF.md': 'a\n' }, 'init')
    // Diverge: build a sibling commit not descended from base's later history.
    const sideA = writeAndCommit(dir, { 'HANDOFF.md': 'b\n' }, 'side a')
    git(dir, ['checkout', '-q', '-b', 'side', base])
    const sideB = writeAndCommit(dir, { 'HANDOFF.md': 'c\n' }, 'side b')
    // remote is sideA, local (to be pushed) is sideB — neither is an ancestor of the other.
    const stdin = stdinLine('refs/heads/main', sideB, 'refs/heads/main', sideA)
    const result = classifyPush({ stdinText: stdin, repoRoot: dir, env: {} })
    assert.equal(result.mode, 'full', JSON.stringify(result))
    assert.match(result.reason, /fast-forward/i)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('malformed stdin (wrong field count) classifies full', () => {
  const dir = initRepo()
  try {
    const result = classifyPush({ stdinText: 'only two fields\n', repoRoot: dir, env: {} })
    assert.equal(result.mode, 'full', JSON.stringify(result))
    assert.match(result.reason, /malformed/i)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('empty stdin classifies full', () => {
  const dir = initRepo()
  try {
    const result = classifyPush({ stdinText: '', repoRoot: dir, env: {} })
    assert.equal(result.mode, 'full', JSON.stringify(result))
    assert.match(result.reason, /empty/i)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('multiple refs, all allowed docs, classifies docs-only', () => {
  const dir = initRepo()
  try {
    const base = writeAndCommit(dir, { 'HANDOFF.md': 'a\n' }, 'init')
    git(dir, ['branch', 'other', base])
    const headMain = writeAndCommit(dir, { 'HANDOFF.md': 'b\n' }, 'main docs')
    git(dir, ['checkout', '-q', 'other'])
    const headOther = writeAndCommit(dir, { 'docs/notes.md': 'x\n' }, 'other docs')
    const stdin =
      stdinLine('refs/heads/main', headMain, 'refs/heads/main', base) +
      stdinLine('refs/heads/other', headOther, 'refs/heads/other', base)
    const result = classifyPush({ stdinText: stdin, repoRoot: dir, env: {} })
    assert.equal(result.mode, 'docs-only', JSON.stringify(result))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('multiple refs with one non-doc change classifies full', () => {
  const dir = initRepo()
  try {
    const base = writeAndCommit(dir, { 'HANDOFF.md': 'a\n' }, 'init')
    git(dir, ['branch', 'other', base])
    const headMain = writeAndCommit(dir, { 'HANDOFF.md': 'b\n' }, 'main docs')
    git(dir, ['checkout', '-q', 'other'])
    const headOther = writeAndCommit(dir, { 'apps/web/src/x.ts': 'x\n' }, 'other code')
    const stdin =
      stdinLine('refs/heads/main', headMain, 'refs/heads/main', base) +
      stdinLine('refs/heads/other', headOther, 'refs/heads/other', base)
    const result = classifyPush({ stdinText: stdin, repoRoot: dir, env: {} })
    assert.equal(result.mode, 'full', JSON.stringify(result))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('code-to-docs rename classifies full (rename detection disabled exposes both sides)', () => {
  const dir = initRepo()
  try {
    const base = writeAndCommit(dir, { 'apps/web/src/notes.ts': 'identical content\n' }, 'init')
    mkdirSync(path.join(dir, 'docs'), { recursive: true })
    git(dir, ['mv', 'apps/web/src/notes.ts', 'docs/notes.md'])
    git(dir, ['commit', '-q', '-m', 'rename code to docs'])
    const head = git(dir, ['rev-parse', 'HEAD'])
    const stdin = stdinLine('refs/heads/main', head, 'refs/heads/main', base)
    const result = classifyPush({ stdinText: stdin, repoRoot: dir, env: {} })
    assert.equal(result.mode, 'full', JSON.stringify(result))
    assert.ok(result.paths.includes('apps/web/src/notes.ts'), JSON.stringify(result))
    assert.ok(result.paths.includes('docs/notes.md'), JSON.stringify(result))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('docs-to-code rename classifies full', () => {
  const dir = initRepo()
  try {
    const base = writeAndCommit(dir, { 'docs/notes.md': 'identical content\n' }, 'init')
    mkdirSync(path.join(dir, 'apps/web/src'), { recursive: true })
    git(dir, ['mv', 'docs/notes.md', 'apps/web/src/notes.ts'])
    git(dir, ['commit', '-q', '-m', 'rename docs to code'])
    const head = git(dir, ['rev-parse', 'HEAD'])
    const stdin = stdinLine('refs/heads/main', head, 'refs/heads/main', base)
    const result = classifyPush({ stdinText: stdin, repoRoot: dir, env: {} })
    assert.equal(result.mode, 'full', JSON.stringify(result))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('paths containing spaces are classified correctly (docs-only)', () => {
  const dir = initRepo()
  try {
    const base = writeAndCommit(dir, { 'docs/my notes.md': 'a\n' }, 'init')
    const head = writeAndCommit(dir, { 'docs/my notes.md': 'b\n' }, 'spacey docs')
    const stdin = stdinLine('refs/heads/main', head, 'refs/heads/main', base)
    const result = classifyPush({ stdinText: stdin, repoRoot: dir, env: {} })
    assert.equal(result.mode, 'docs-only', JSON.stringify(result))
    assert.deepEqual(result.paths, ['docs/my notes.md'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('paths containing spaces are classified correctly (full, non-doc)', () => {
  const dir = initRepo()
  try {
    const base = writeAndCommit(dir, { 'apps/web/my file.ts': 'a\n' }, 'init')
    const head = writeAndCommit(dir, { 'apps/web/my file.ts': 'b\n' }, 'spacey code')
    const stdin = stdinLine('refs/heads/main', head, 'refs/heads/main', base)
    const result = classifyPush({ stdinText: stdin, repoRoot: dir, env: {} })
    assert.equal(result.mode, 'full', JSON.stringify(result))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('EANHL_PRE_PUSH_FULL=1 converts a docs-only push to full', () => {
  const dir = initRepo()
  try {
    const base = writeAndCommit(dir, { 'HANDOFF.md': 'a\n' }, 'init')
    const head = writeAndCommit(dir, { 'HANDOFF.md': 'b\n' }, 'docs')
    const stdin = stdinLine('refs/heads/main', head, 'refs/heads/main', base)
    const result = classifyPush({ stdinText: stdin, repoRoot: dir, env: { EANHL_PRE_PUSH_FULL: '1' } })
    assert.equal(result.mode, 'full', JSON.stringify(result))
    assert.match(result.reason, /override/i)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('docs-only push with a git diff --check failure blocks (not full, not silently allowed)', () => {
  const dir = initRepo()
  try {
    const base = writeAndCommit(dir, { 'HANDOFF.md': 'a\n' }, 'init')
    // Trailing whitespace triggers `git diff --check`.
    const head = writeAndCommit(dir, { 'HANDOFF.md': 'a   \nb\n' }, 'trailing whitespace')
    const stdin = stdinLine('refs/heads/main', head, 'refs/heads/main', base)
    const result = classifyPush({ stdinText: stdin, repoRoot: dir, env: {} })
    assert.equal(result.mode, 'docs-only', JSON.stringify(result))
    assert.equal(result.diffCheck.ok, false, JSON.stringify(result))
    assert.match(result.diffCheck.output, /whitespace/i)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('missing/malformed object id classifies full conservatively', () => {
  const dir = initRepo()
  try {
    const head = writeAndCommit(dir, { 'HANDOFF.md': 'a\n' }, 'init')
    const fakeOid = 'deadbeef'.repeat(5) // 40 hex chars, not a real object
    const stdin = stdinLine('refs/heads/main', head, 'refs/heads/main', fakeOid)
    const result = classifyPush({ stdinText: stdin, repoRoot: dir, env: {} })
    assert.equal(result.mode, 'full', JSON.stringify(result))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('no-op push (identical oids) classifies docs-only with no paths', () => {
  const dir = initRepo()
  try {
    const head = writeAndCommit(dir, { 'HANDOFF.md': 'a\n' }, 'init')
    const stdin = stdinLine('refs/heads/main', head, 'refs/heads/main', head)
    const result = classifyPush({ stdinText: stdin, repoRoot: dir, env: {} })
    assert.equal(result.mode, 'docs-only', JSON.stringify(result))
    assert.deepEqual(result.paths, [])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
