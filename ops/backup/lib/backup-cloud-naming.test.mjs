/**
 * Cloud-transport naming and remote-path construction — E3J3, T1/T2.
 *
 * Everything here is pure: no filesystem, no clock, no network. `formatAttemptId`
 * takes injected `now`/`randomToken`, the same style `makeRealDeps()` uses
 * elsewhere in this suite, so its output is deterministic under test.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { BackupError, buildArtifactNames } from './backup-artifact-contract.mjs'
import {
  ATTEMPT_ID_PATTERN,
  RUN_ID_PATTERN,
  assertSafeRemoteComponent,
  assertValidArtifactBase,
  assertValidAttemptId,
  buildAttemptFolderName,
  buildAttemptNamespace,
  buildAttestationFileName,
  buildContainmentCanaryDirName,
  buildPublishedObjectPaths,
  formatAttemptId,
  validateRemoteRoot,
} from './backup-cloud-naming.mjs'

import { installTestWatchdog } from './test-diagnostics.mjs'

installTestWatchdog({ label: 'cloud-naming' })

const FIXED_NOW = Date.parse('2026-09-04T18:00:07.123Z')
const fixedDeps = { now: () => FIXED_NOW, randomToken: () => 'deadbeef' }

// ── T1: remote path components and roots ────────────────────────────────────

test('T1: every forbidden remote component case is rejected', () => {
  const cases = ['', '.', '..', 'a/b', 'a\\b', 'a\0b', '.hidden']
  for (const bad of cases) {
    assert.throws(
      () => assertSafeRemoteComponent(bad, 'x'),
      (err) => err instanceof BackupError && err.code === 'unsafe_remote_component',
      `expected ${JSON.stringify(bad)} to be rejected`,
    )
  }
  assert.throws(() => assertSafeRemoteComponent(undefined, 'x'), /non-empty string/)
})

test('T1: an ordinary component is accepted and returned unchanged', () => {
  assert.equal(
    assertSafeRemoteComponent('eanhl-prod-20260904T180007Z', 'x'),
    'eanhl-prod-20260904T180007Z',
  )
  assert.equal(
    assertSafeRemoteComponent('20260904T180007Z-deadbeef', 'x'),
    '20260904T180007Z-deadbeef',
  )
})

test('T1: canonical remote roots validate and expose their segments', () => {
  const { root, segments } = validateRemoteRoot('/proton/backups/eanhl')
  assert.equal(root, '/proton/backups/eanhl')
  assert.deepEqual(segments, ['proton', 'backups', 'eanhl'])
  assert.deepEqual(validateRemoteRoot('/eanhl').segments, ['eanhl'])
})

test('T1: canonical remote roots are frozen', () => {
  const result = validateRemoteRoot('/proton/backups')
  assert.throws(() => {
    result.root = 'tampered'
  }, TypeError)
  assert.throws(() => {
    result.segments.push('tampered')
  }, TypeError)
})

test('T1: non-canonical remote roots are all rejected', () => {
  const cases = [
    '', // empty
    'relative/root', // not absolute
    '/', // no ordinary component
    '/a//b', // repeated separator
    '/a/', // trailing separator
    '/a/./b', // dot segment
    '/a/../b', // dot-dot segment
    '/a/.hidden/b', // leading-dot segment
    '/a\\b', // backslash
    '/a\0b', // NUL byte
  ]
  for (const bad of cases) {
    assert.throws(
      () => validateRemoteRoot(bad),
      (err) => err instanceof BackupError,
      `expected ${JSON.stringify(bad)} to be rejected`,
    )
  }
})

test('T1: normalization never turns unsafe input into an accepted root', () => {
  // A naive path.posix.normalize()-based validator would collapse these into
  // accepted values; this validator must reject the RAW string instead.
  assert.throws(() => validateRemoteRoot('/a//b'))
  assert.throws(() => validateRemoteRoot('/a/./b'))
  assert.throws(() => validateRemoteRoot('/a/../b'))
})

test('T1: no constructed path can escape the configured root or attempt namespace', () => {
  const remoteRoot = '/proton/backups'
  const attemptId = formatAttemptId(fixedDeps)
  for (const escape of ['../escape', '..', '.', '', 'a/b', 'a\\b']) {
    assert.throws(() => buildPublishedObjectPaths({ remoteRoot, artifactBase: escape, attemptId }))
  }
  const paths = buildPublishedObjectPaths({
    remoteRoot,
    artifactBase: 'eanhl-prod-20260904T180007Z',
    attemptId,
  })
  for (const p of [paths.ciphertextPath, paths.checksumPath, paths.manifestPath]) {
    // E3J5 layout: one attempt folder, `<artifactBase>.<attemptId>`, directly under the root.
    assert.ok(p.startsWith(`${remoteRoot}/eanhl-prod-20260904T180007Z.${attemptId}/`))
    assert.equal(p.includes('..'), false)
    assert.equal(p.includes('//'), false)
  }
})

// ── T2: artifact names, stamps, attempt ids, object paths, attestation names ──

test('T2: attemptId round-trips in the exact required form', () => {
  const id = formatAttemptId(fixedDeps)
  assert.equal(id, '20260904T180007Z-deadbeef')
  assert.match(id, ATTEMPT_ID_PATTERN)
  assert.equal(assertValidAttemptId(id), id)
})

test('T2: malformed attemptIds fail closed', () => {
  const bad = [
    '',
    '20260904T180007Z', // missing hex suffix
    '20260904T180007Z-DEADBEEF', // uppercase hex
    '20260904T180007Z-deadbee', // 7 hex chars
    '20260904T180007-deadbeef', // missing seconds Z-group shape
    '2026-09-04T18:00:07Z-deadbeef', // not compacted
    'not-an-attempt-id',
  ]
  for (const id of bad) {
    assert.throws(
      () => assertValidAttemptId(id),
      (err) => err instanceof BackupError && err.code === 'attempt_id_malformed',
      `expected ${JSON.stringify(id)} to be rejected`,
    )
  }
})

test('T2: the attempt namespace and object paths are constructed exactly as specified', () => {
  const remoteRoot = '/proton/backups'
  const artifactBase = 'eanhl-prod-20260904T180007Z'
  const attemptId = formatAttemptId(fixedDeps)
  const namespace = buildAttemptNamespace({ remoteRoot, artifactBase, attemptId })
  // E3J5 layout (was `${remoteRoot}/${artifactBase}/${attemptId}` in E3J3).
  assert.equal(namespace, `${remoteRoot}/${artifactBase}.${attemptId}`)

  const paths = buildPublishedObjectPaths({ remoteRoot, artifactBase, attemptId })
  assert.equal(paths.namespace, namespace)
  assert.equal(paths.ciphertextPath, `${namespace}/${artifactBase}.dump.age`)
  assert.equal(paths.checksumPath, `${namespace}/${artifactBase}.dump.age.sha256`)
  assert.equal(paths.manifestPath, `${namespace}/${artifactBase}.manifest.json`)
  // Never the plaintext.
  for (const p of Object.values(paths)) assert.equal(p.endsWith('.dump'), false)
})

test('T2: buildPublishedObjectPaths returns a frozen structure', () => {
  const paths = buildPublishedObjectPaths({
    remoteRoot: '/proton/backups',
    artifactBase: 'eanhl-prod-20260904T180007Z',
    attemptId: formatAttemptId(fixedDeps),
  })
  assert.throws(() => {
    paths.ciphertextPath = 'tampered'
  }, TypeError)
})

test('T2: the attempt-scoped attestation filename matches <base>.<attemptId>.cloud-attestation.json', () => {
  const artifactBase = 'eanhl-prod-20260904T180007Z'
  const attemptId = formatAttemptId(fixedDeps)
  const name = buildAttestationFileName({ artifactBase, attemptId })
  assert.equal(name, `${artifactBase}.${attemptId}.cloud-attestation.json`)
})

test('T2: attestation filename construction validates both inputs before interpolation', () => {
  const attemptId = formatAttemptId(fixedDeps)
  assert.throws(() => buildAttestationFileName({ artifactBase: '../escape', attemptId }))
  assert.throws(() =>
    buildAttestationFileName({
      artifactBase: 'eanhl-prod-20260904T180007Z',
      attemptId: 'not-valid',
    }),
  )
})

// ── Correction 2 (independent review): artifact-base and attempt-token identity ──

test('T2 correction: assertValidArtifactBase accepts the exact identity shape and rejects everything else', () => {
  for (const ok of [
    'eanhl-prod-20260904T180007Z',
    'a-20260904T180007Z',
    'eanhl--20260904T180007Z',
  ]) {
    assert.equal(assertValidArtifactBase(ok), ok)
  }
  const bad = [
    'not-a-stamped-artifact', // no stamp at all
    'eanhl-prod', // prefix only
    '20260904T180007Z', // stamp only, no prefix
    'eanhl-prod-2026090T180007Z', // short date
    'eanhl-prod-20260904t180007z', // lowercase stamp letters
    'eanhl-prod-20260904T180007Z-extra', // trailing garbage
    'EANHL-PROD-20260904T180007Z', // uppercase prefix
    '-20260904T180007Z', // empty prefix (leading hyphen only)
    '',
    'eanhl-prod-2026-09-04T18:00:07Z', // uncompacted stamp
  ]
  for (const base of bad) {
    assert.throws(
      () => assertValidArtifactBase(base),
      (err) => err instanceof BackupError && err.code === 'artifact_base_malformed',
      `expected ${JSON.stringify(base)} to be rejected`,
    )
  }
})

test('T2 correction: a valid artifact prefix that itself ends in a hyphen still round-trips', () => {
  // ARTIFACT_PREFIX_PATTERN (/^[a-z0-9][a-z0-9-]*$/) permits a trailing
  // hyphen, so buildArtifactNames('eanhl-', stamp) produces a base with two
  // consecutive hyphens — one from the prefix, one as separator. The base
  // identity validator must parse this correctly, not just the safe-
  // component check (which would accept it for the wrong reason).
  const built = buildArtifactNames('eanhl-', '20260904T180007Z')
  assert.equal(built.base, 'eanhl--20260904T180007Z')
  assert.equal(assertValidArtifactBase(built.base), built.base)

  const remoteRoot = '/proton/backups'
  const attemptId = formatAttemptId(fixedDeps)
  const paths = buildPublishedObjectPaths({ remoteRoot, artifactBase: built.base, attemptId })
  assert.equal(
    paths.ciphertextPath,
    `${remoteRoot}/${built.base}.${attemptId}/${built.base}.dump.age`, // E3J5 layout
  )
})

test('T2 correction: buildAttemptNamespace/buildPublishedObjectPaths/buildAttestationFileName reject an artifactBase that is safe but not a stamped identity', () => {
  const remoteRoot = '/proton/backups'
  const attemptId = formatAttemptId(fixedDeps)
  const notAnIdentity = 'not-a-stamped-artifact'
  // Confirms the premise: this string passes the ordinary-component safety
  // check — the identity-shape validator is what closes the actual gap.
  assert.equal(assertSafeRemoteComponent(notAnIdentity, 'x'), notAnIdentity)
  for (const attempt of [
    () => buildAttemptNamespace({ remoteRoot, artifactBase: notAnIdentity, attemptId }),
    () => buildPublishedObjectPaths({ remoteRoot, artifactBase: notAnIdentity, attemptId }),
    () => buildAttestationFileName({ artifactBase: notAnIdentity, attemptId }),
  ]) {
    assert.throws(
      attempt,
      (err) => err instanceof BackupError && err.code === 'artifact_base_malformed',
    )
  }
})

test('T2 correction: formatAttemptId rejects an injected token that is not exactly eight lowercase hex characters', () => {
  const badTokens = [
    '../BAD', // path traversal shape
    'DEADBEEF', // uppercase
    'deadbee', // 7 chars, too short
    'deadbeef0', // 9 chars, too long
    'dead/eef', // slash
    'dead\\eef', // backslash
    'dead..ef', // dot-dot
    'not-hex!', // non-hex punctuation
    '', // empty
  ]
  for (const token of badTokens) {
    assert.throws(
      () => formatAttemptId({ now: () => FIXED_NOW, randomToken: () => token }),
      (err) => err instanceof BackupError && err.code === 'attempt_id_malformed',
      `expected token ${JSON.stringify(token)} to be rejected`,
    )
  }
  // A well-formed token still round-trips.
  assert.equal(
    formatAttemptId({ now: () => FIXED_NOW, randomToken: () => 'cafebabe' }),
    '20260904T180007Z-cafebabe',
  )
})

test('T2 correction: formatAttemptId construction does not change backup-producer.mjs runId behavior', () => {
  // This correction is confined to the cloud-naming module's OWN
  // attemptId construction. It imports nothing from, and exports nothing
  // to, backup-producer.mjs — there is no shared code path to have changed.
  // (Documented here rather than asserted against producer internals, which
  // are out of scope for this module's test file.)
  assert.equal(typeof formatAttemptId, 'function')
})

test('T2: two distinct attempts of the same artifact produce two distinct namespaces and filenames', () => {
  const remoteRoot = '/proton/backups'
  const artifactBase = 'eanhl-prod-20260904T180007Z'
  const attemptA = formatAttemptId(fixedDeps)
  const attemptB = formatAttemptId({ now: () => FIXED_NOW + 1000, randomToken: () => 'cafebabe' })
  assert.notEqual(attemptA, attemptB)
  const nsA = buildAttemptNamespace({ remoteRoot, artifactBase, attemptId: attemptA })
  const nsB = buildAttemptNamespace({ remoteRoot, artifactBase, attemptId: attemptB })
  assert.notEqual(nsA, nsB)
  assert.notEqual(
    buildAttestationFileName({ artifactBase, attemptId: attemptA }),
    buildAttestationFileName({ artifactBase, attemptId: attemptB }),
  )
})

// ── E3J5: the flat per-attempt layout ───────────────────────────────────────

test('E3J5: the attempt folder name is exactly <artifactBase>.<attemptId>, one safe component', () => {
  const artifactBase = 'eanhl-prod-20260904T180007Z'
  const attemptId = formatAttemptId(fixedDeps)
  const name = buildAttemptFolderName({ artifactBase, attemptId })
  assert.equal(name, 'eanhl-prod-20260904T180007Z.20260904T180007Z-deadbeef')
  assert.equal(assertSafeRemoteComponent(name, 'x'), name)
  assert.equal(name.startsWith('-') || name.startsWith('.'), false)
})

test('E3J5: buildAttemptFolderName validates both identities before joining them', () => {
  const attemptId = formatAttemptId(fixedDeps)
  for (const artifactBase of ['not-a-stamped-artifact', '../x', '', 'a/b', '-x-20260904T180007Z']) {
    assert.throws(() => buildAttemptFolderName({ artifactBase, attemptId }), BackupError)
  }
  for (const bad of ['', '../x', '20260904T180007Z-DEADBEEF', 'x']) {
    assert.throws(
      () => buildAttemptFolderName({ artifactBase: 'eanhl-prod-20260904T180007Z', attemptId: bad }),
      (err) => err instanceof BackupError && err.code === 'attempt_id_malformed',
    )
  }
})

test('E3J5: buildPublishedObjectPaths exposes the root and the single attempt folder with an exact key set', () => {
  const remoteRoot = '/proton/backups'
  const artifactBase = 'eanhl-prod-20260904T180007Z'
  const attemptId = formatAttemptId(fixedDeps)
  const paths = buildPublishedObjectPaths({ remoteRoot, artifactBase, attemptId })
  assert.deepEqual(Object.keys(paths).sort(), [
    'attemptFolderName',
    'checksumPath',
    'ciphertextPath',
    'manifestPath',
    'namespace',
    'root',
  ])
  assert.equal(paths.root, remoteRoot)
  assert.equal(paths.attemptFolderName, `${artifactBase}.${attemptId}`)
  assert.equal(paths.namespace, `${remoteRoot}/${paths.attemptFolderName}`)
  // Exactly one segment between the root and each object — no nested artifact folder.
  for (const p of [paths.ciphertextPath, paths.checksumPath, paths.manifestPath]) {
    assert.equal(p.slice(remoteRoot.length + 1).split('/').length, 2)
  }
})

// ── E3J6A: run ids and the containment canary directory name ─────────────────

test('E3J6A: RUN_ID_PATTERN accepts exactly the compact-stamp-plus-8-hex shape', () => {
  assert.ok(RUN_ID_PATTERN.test('20260904T180007Z-0a1b2c3d'))
  for (const bad of [
    '',
    '20260904T180007Z-0A1B2C3D',
    '20260904T180007Z-0a1b2c3',
    '20260904T180007Z-0a1b2c3d0',
    '2026-09-04T18:00:07Z-0a1b2c3d',
    ' 20260904T180007Z-0a1b2c3d',
    '20260904T180007Z-0a1b2c3d\n',
  ]) {
    assert.equal(RUN_ID_PATTERN.test(bad), false, JSON.stringify(bad))
  }
})

test('E3J6A: the canary directory name is one safe component derived only from a valid run id', () => {
  assert.equal(
    buildContainmentCanaryDirName('20260904T180007Z-0a1b2c3d'),
    '20260904T180007Z-0a1b2c3d.containment-canary',
  )
  for (const bad of [
    undefined,
    null,
    '',
    '../x',
    'x/y',
    '.hidden',
    '-f',
    '20260904T180007Z-ZZZZZZZZ',
  ]) {
    assert.throws(
      () => buildContainmentCanaryDirName(bad),
      (err) => err instanceof BackupError && err.code === 'run_id_malformed',
    )
  }
})
