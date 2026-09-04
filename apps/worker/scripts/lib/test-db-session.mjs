/**
 * Disposable verification-database session.
 *
 * Orchestrates: attest → sweep stale clones → CREATE clone → copy source →
 * run the caller's command against the clone → DROP clone.
 *
 * The single rule this module exists to enforce: **no destructive SQL is
 * issued before `attestNonProductionTarget()` resolves.** Attestation is called
 * here (not injected), so a test can drive the real guard with fake process
 * boundaries and assert that a rejection produced zero CREATE/DROP calls.
 *
 * All process boundaries are injected via `deps`, so this module is testable
 * without Docker, PostgreSQL, secrets, or production data.
 */

import {
  APPROVED_DATABASE_NAME,
  attestNonProductionTarget,
  GuardError,
  quoteIdentifier,
} from './test-db-guard.mjs'

/**
 * A clone is swept only if it is BOTH (a) unconnected and (b) older than this.
 * Neither alone is safe against a concurrent run: an in-use clone briefly has
 * zero connections between tests, and a concurrent run's clone is recent.
 */
export const SWEEP_MIN_AGE_MS = 2 * 60 * 60 * 1000 // 2h >> a full suite run

const CLONE_PREFIX = 'eanhl_test_'

/**
 * Recover a clone's creation time from its name (`eanhl_test_<pid>_<base36ms>`).
 *
 * The suffix must be base36 in its ENTIRETY — `parseInt` stops at the first
 * invalid character, which would silently turn a foreign database name into a
 * plausible (and very old) timestamp and hand it to the sweeper.
 */
export function cloneAgeMs(name, nowMs) {
  const suffix = name.slice(name.lastIndexOf('_') + 1)
  if (!/^[0-9a-z]+$/.test(suffix)) return NaN
  const ts = parseInt(suffix, 36)
  return Number.isFinite(ts) && ts > 0 ? nowMs - ts : NaN
}

/**
 * The ONLY place destructive DDL is emitted.
 *
 * `statement` is built here from a validated, quoted identifier — callers pass
 * a verb, never SQL text.
 */
function runDdl(deps, attestation, verb, database) {
  const ident = quoteIdentifier(database)
  const statement =
    verb === 'create'
      ? `CREATE DATABASE ${ident}`
      : verb === 'drop'
        ? `DROP DATABASE IF EXISTS ${ident} WITH (FORCE)`
        : null
  if (statement === null) {
    throw new GuardError(
      'unsupported_ddl',
      `refusing to run unsupported DDL verb "${String(verb)}"`,
    )
  }
  return psql(deps, attestation, attestation.sourceDatabase, statement)
}

function psql(deps, attestation, targetDatabase, statement) {
  return deps.dockerExec([
    'exec',
    attestation.container,
    'psql',
    '-U',
    attestation.user,
    '-d',
    targetDatabase,
    '-tAX',
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    statement,
  ])
}

/**
 * Drop clones leaked by a previously hard-killed run. Best-effort: never blocks
 * the run. Only ever called AFTER attestation.
 */
function sweepStaleClones(deps, attestation, log) {
  let candidates
  try {
    candidates = String(
      psql(
        deps,
        attestation,
        attestation.sourceDatabase,
        `SELECT datname FROM pg_database d WHERE datname LIKE '${CLONE_PREFIX}%' ` +
          'AND NOT EXISTS (SELECT 1 FROM pg_stat_activity a WHERE a.datname = d.datname)',
      ) ?? '',
    )
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
  } catch {
    return // sweep is best-effort
  }
  const nowMs = deps.now()
  for (const name of candidates) {
    // Only ever consider a name that is itself a valid clone name in the
    // approved namespace. A LIKE pattern is not an authorisation.
    if (!name.startsWith(CLONE_PREFIX) || !APPROVED_DATABASE_NAME.test(name)) continue
    if (name === attestation.sourceDatabase) continue
    const age = cloneAgeMs(name, nowMs)
    // Skip unparseable names (be conservative) and anything recent enough to be
    // a concurrent run's clone.
    if (!Number.isFinite(age) || age < SWEEP_MIN_AGE_MS) continue
    try {
      runDdl(deps, attestation, 'drop', name)
      log(`swept stale clone ${name} (age ${Math.round(age / 60000)}m)`)
    } catch {
      /* leave it; not fatal */
    }
  }
}

/** Build the child environment: DATABASE_URL is OVERWRITTEN, never inherited. */
export function buildChildEnv(env, attestation) {
  const cloneUrl = new URL(attestation.testDatabaseUrl)
  cloneUrl.pathname = `/${attestation.cloneDatabase}`
  const childEnv = { ...env }
  // Delete first so an inherited production value cannot survive under any
  // key-ordering or case-folding surprise, then set the attested clone.
  delete childEnv['DATABASE_URL']
  childEnv['DATABASE_URL'] = cloneUrl.toString()
  return childEnv
}

/**
 * Attest, provision a disposable clone, hand it to `run`, then drop it.
 *
 * @param {object} args
 * @param {Record<string,string|undefined>} args.env
 * @param {object} args.deps  { dockerExec, dockerExecInherit, networkSystemIdentifier, now, pid, log, registerCleanup? }
 * @param {(ctx: {childEnv: Record<string,string>, attestation: object}) => Promise<number>} args.run
 * @returns {Promise<number>} exit status from `run`
 */
export async function withTestDatabase({ env, deps, run }) {
  const log = deps.log ?? (() => {})

  // Nothing destructive may precede this call.
  const attestation = await attestNonProductionTarget({ env, deps })
  log(
    `attested nonproduction target: container=${attestation.container} ` +
      `project=${attestation.project} service=${attestation.service} ` +
      `source=${attestation.sourceDatabase} system_identifier=${attestation.systemIdentifier}`,
  )

  sweepStaleClones(deps, attestation, log)

  let created = false
  const dropClone = () => {
    if (!created) return
    try {
      runDdl(deps, attestation, 'drop', attestation.cloneDatabase)
      created = false
      log(`dropped clone ${attestation.cloneDatabase}`)
    } catch (err) {
      log(`WARN: failed to drop clone ${attestation.cloneDatabase}: ${err?.message ?? String(err)}`)
    }
  }
  deps.registerCleanup?.(dropClone)

  log(
    `cloning ${attestation.sourceDatabase} -> ${attestation.cloneDatabase} (container ${attestation.container})`,
  )
  try {
    runDdl(deps, attestation, 'drop', attestation.cloneDatabase)
    runDdl(deps, attestation, 'create', attestation.cloneDatabase)
    created = true
    // Pipe dump->restore entirely inside the container (fast, no host round-trip).
    // `set -o pipefail` so a pg_dump failure is NOT masked by psql exiting 0
    // (which would leave a silently-partial clone). Values are passed as
    // positional args and quoted, so a db/user name with shell metacharacters
    // cannot break out of or inject into the command.
    deps.dockerExecInherit([
      'exec',
      attestation.container,
      'bash',
      '-lc',
      'set -o pipefail; ' +
        'pg_dump -U "$1" --no-owner --no-privileges "$2" | ' +
        'psql -U "$1" -d "$3" -q -v ON_ERROR_STOP=1',
      'with-test-db', // $0
      attestation.user, // $1
      attestation.sourceDatabase, // $2
      attestation.cloneDatabase, // $3
    ])
  } catch (err) {
    dropClone()
    throw new GuardError('clone_failed', `clone failed: ${err?.message ?? String(err)}`)
  }

  try {
    return await run({ childEnv: buildChildEnv(env, attestation), attestation })
  } finally {
    dropClone()
  }
}
