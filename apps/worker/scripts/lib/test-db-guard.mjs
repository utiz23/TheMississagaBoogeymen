/**
 * Verification-database isolation guard.
 *
 * THREAT MODEL (why this file exists)
 * -----------------------------------
 * The verification harness clones a database and then runs suites that WRITE
 * (worker integration tests, the @eanhl/db run-quality integration tests, the
 * `--full` reprocess E2E). Every one of those writes lands wherever
 * DATABASE_URL points. The previous harness derived that target from the
 * application's production DATABASE_URL — falling back to parsing the repo-root
 * `.env` — and accepted the target if its host looked like loopback.
 *
 * That is not a safety property. Concretely:
 *   - `DATABASE_URL` in this repo is the PRODUCTION DSN. Cloning "from" it means
 *     reading production, and one missing/edited line away from writing it.
 *   - A loopback host proves nothing: `ssh -L 5433:prod-db:5432` makes a remote
 *     production cluster answer on 127.0.0.1:5433. The host check passes; the
 *     DDL lands in production.
 *   - `docker exec <container> psql ... CREATE/DROP DATABASE` and the network
 *     DSN were never proven to address the SAME PostgreSQL cluster. The old
 *     harness would happily DROP inside one cluster while the tests wrote to
 *     another.
 *   - `TEST_DB_CONTAINER` defaulted to the production container name, so a
 *     mistyped/absent variable silently selected production.
 *
 * RESULTING CONTRACT (enforced here, fail-closed)
 * -----------------------------------------------
 *  1. The source DSN comes from TEST_DATABASE_URL only. DATABASE_URL is never
 *     read as a source, and there is no `.env` fallback (this module performs
 *     no filesystem access at all).
 *  2. The destructive target must be named explicitly and completely:
 *     TEST_DB_CONTAINER, TEST_DB_COMPOSE_PROJECT, TEST_DB_COMPOSE_SERVICE.
 *     None of them have defaults.
 *  3. Both the source database and the generated clone must live in the
 *     approved nonproduction namespace (see APPROVED_DATABASE_NAME).
 *  4. Before ANY `CREATE DATABASE` / `DROP DATABASE` — including stale-clone
 *     cleanup — the target must pass every check in
 *     `attestNonProductionTarget()`, ending in exact equality between the
 *     cluster's `system_identifier` as seen over the network DSN and as seen
 *     through `docker exec`. That equality is what defeats the tunnel spoof:
 *     an SSH-forwarded production cluster has a different system identifier
 *     than the local test container.
 *
 * Every external interaction is injected (`deps`), so the whole contract is
 * testable without Docker, PostgreSQL, secrets, or production data.
 */

/** Error raised by every guard rejection. Carries a machine-readable `code`. */
export class GuardError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'GuardError'
    this.code = code
  }
}

/**
 * Databases that must never be a clone source or a clone target, regardless of
 * anything else. `eanhl` is this project's production database; the rest are
 * PostgreSQL/managed-service system databases.
 */
export const RESERVED_DATABASE_NAMES = new Set([
  'eanhl',
  'postgres',
  'template',
  'template0',
  'template1',
  'defaultdb',
  'rdsadmin',
  'cloudsqladmin',
  'azure_maintenance',
])

/**
 * The approved test/dev namespace. A database is eligible to be cloned FROM or
 * created AS only if its name matches this.
 *
 *   eanhl_test            eanhl_dev            eanhl_ci
 *   eanhl_scratch         eanhl_test_1234_mk3x2p1q
 *
 * Rejected: `eanhl`, `eanhl_prod`, `postgres`, `template0`, `Eanhl_Test`
 * (uppercase — PostgreSQL folds unquoted identifiers, so mixed case here is a
 * sign of confusion), anything not under the `eanhl_{test,dev,ci,scratch}` root.
 */
export const APPROVED_DATABASE_NAME = /^eanhl_(test|dev|ci|scratch)(?:_[a-z0-9]+)*$/

/** Segment tokens that mark an identity as production-ish. Never acceptable. */
export const PRODUCTION_MARKERS = new Set([
  'prod',
  'production',
  'live',
  'prd',
  'release',
  'main',
  'master',
  'primary',
  'public',
])

/** Segment tokens that mark a container/compose identity as explicitly nonproduction. */
export const NONPRODUCTION_MARKERS = new Set(['test', 'tests', 'dev', 'ci', 'scratch', 'verify'])

/**
 * Docker label the test container must carry. Set it in the test compose file
 * (see docker-compose.test.yml). A container without it is never a destructive
 * target, however it is named.
 */
export const NONPRODUCTION_LABEL = 'eanhl.nonproduction'

/** PostgreSQL's max identifier length (NAMEDATALEN - 1). */
const MAX_IDENTIFIER_LENGTH = 63

/** A cluster system identifier is a uint64 rendered as digits. */
const SYSTEM_IDENTIFIER = /^[0-9]{1,20}$/

/**
 * Accepted loopback hosts, compared against the BRACKET-STRIPPED hostname.
 * Node serialises `postgresql://u@[::1]/db` with `url.hostname === '[::1]'`.
 */
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])

/** Split an identity on the separators Docker/Compose use. */
function segments(name) {
  return name.split(/[-_.]/).filter(Boolean)
}

/**
 * Quote a PostgreSQL identifier for interpolation into DDL.
 *
 * Callers must already have run the name through
 * {@link assertApprovedDatabaseName}; this is the second line of defence, not
 * the first. It rejects anything that is not a plain lowercase identifier
 * rather than trying to escape it into safety.
 */
export function quoteIdentifier(name) {
  if (typeof name !== 'string' || !/^[a-z_][a-z0-9_]*$/.test(name)) {
    throw new GuardError(
      'unsafe_identifier',
      `refusing to quote unsafe SQL identifier: ${String(name)}`,
    )
  }
  if (name.length > MAX_IDENTIFIER_LENGTH) {
    throw new GuardError(
      'unsafe_identifier',
      `SQL identifier exceeds ${MAX_IDENTIFIER_LENGTH} bytes: ${name}`,
    )
  }
  return `"${name.replace(/"/g, '""')}"`
}

/**
 * Reject any database name outside the approved nonproduction namespace.
 *
 * @param {unknown} name
 * @param {'source'|'clone'} role  Only used to phrase the error.
 */
export function assertApprovedDatabaseName(name, role) {
  if (typeof name !== 'string' || name.length === 0) {
    throw new GuardError(
      'database_name_empty',
      `${role} database name is empty — refusing to proceed.`,
    )
  }
  if (name.length > MAX_IDENTIFIER_LENGTH) {
    throw new GuardError(
      'database_name_too_long',
      `${role} database name "${name}" exceeds ${MAX_IDENTIFIER_LENGTH} bytes.`,
    )
  }
  if (RESERVED_DATABASE_NAMES.has(name)) {
    throw new GuardError(
      'database_name_reserved',
      `${role} database "${name}" is reserved (production or a PostgreSQL system database). ` +
        `Verification must use a dedicated database in the approved namespace, e.g. "eanhl_test".`,
    )
  }
  if (!APPROVED_DATABASE_NAME.test(name)) {
    throw new GuardError(
      'database_name_outside_namespace',
      `${role} database "${name}" is outside the approved verification namespace ` +
        `(${APPROVED_DATABASE_NAME}). Approved examples: eanhl_test, eanhl_dev, eanhl_ci, eanhl_scratch.`,
    )
  }
  for (const seg of segments(name)) {
    if (PRODUCTION_MARKERS.has(seg)) {
      throw new GuardError(
        'database_name_production_marker',
        `${role} database "${name}" contains the production marker "${seg}".`,
      )
    }
  }
  return name
}

/**
 * Parse and validate TEST_DATABASE_URL.
 *
 * DATABASE_URL is deliberately not consulted: not as a source, not as a
 * fallback, not as a default. Nor is any `.env` file.
 */
export function parseTestDatabaseUrl(env) {
  const raw = env['TEST_DATABASE_URL']
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new GuardError(
      'test_database_url_missing',
      'TEST_DATABASE_URL is not set. DB-backed verification requires a dedicated nonproduction ' +
        'DSN; the application DATABASE_URL is never used as the source and there is no .env ' +
        'fallback. Export TEST_DATABASE_URL (see ops/README.md).',
    )
  }
  let url
  try {
    url = new URL(raw.trim())
  } catch {
    throw new GuardError('test_database_url_invalid', 'TEST_DATABASE_URL is not a valid URL.')
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new GuardError(
      'test_database_url_invalid',
      `TEST_DATABASE_URL protocol must be postgres:// or postgresql:// (got "${url.protocol}").`,
    )
  }
  const host = url.hostname
  // `URL.hostname` serialises an IPv6 host WITH brackets (`[::1]`), so compare
  // against the bracket-stripped form or the `::1` case never matches.
  const bareHost = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host
  // Loopback is necessary but NOT sufficient (an SSH tunnel forges it). It is
  // kept because the clone path is docker-exec-only against a local container;
  // the system-identifier equality check below is what actually proves identity.
  if (!LOOPBACK_HOSTS.has(bareHost)) {
    throw new GuardError(
      'test_database_url_not_loopback',
      `TEST_DATABASE_URL host is "${host}". The clone path runs through docker exec against a ` +
        `local container, so the DSN must address that container over loopback ` +
        `(${[...LOOPBACK_HOSTS].join(', ')}).`,
    )
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''))
  if (!database) {
    throw new GuardError(
      'test_database_url_invalid',
      'TEST_DATABASE_URL has no database in its path (expected .../eanhl_test).',
    )
  }
  const user = decodeURIComponent(url.username)
  if (!user) {
    throw new GuardError(
      'test_database_url_invalid',
      'TEST_DATABASE_URL has no username. The docker-exec side needs an explicit role.',
    )
  }
  return { url, database, user, host }
}

function requireEnv(env, key, hint) {
  const value = env[key]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new GuardError('target_identity_missing', `${key} is not set. ${hint}`)
  }
  return value.trim()
}

/**
 * Resolve the destructive target's identity from the environment.
 *
 * Every field is mandatory and has NO default — a missing variable must never
 * silently select the production container/project.
 */
export function resolveDestructiveTarget(env) {
  const container = requireEnv(
    env,
    'TEST_DB_CONTAINER',
    'Name the disposable PostgreSQL container explicitly; there is no default (a default would ' +
      'point at the production container).',
  )
  const project = requireEnv(
    env,
    'TEST_DB_COMPOSE_PROJECT',
    'Name the Docker Compose project of the test container explicitly (com.docker.compose.project).',
  )
  const service = requireEnv(
    env,
    'TEST_DB_COMPOSE_SERVICE',
    'Name the Docker Compose service of the test container explicitly (com.docker.compose.service).',
  )

  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(container)) {
    throw new GuardError(
      'target_identity_invalid',
      `TEST_DB_CONTAINER "${container}" is not a valid container name.`,
    )
  }
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(project)) {
    throw new GuardError(
      'target_identity_invalid',
      `TEST_DB_COMPOSE_PROJECT "${project}" is not a valid project name.`,
    )
  }
  if (!/^[a-z0-9][a-z0-9_.-]*$/.test(service)) {
    throw new GuardError(
      'target_identity_invalid',
      `TEST_DB_COMPOSE_SERVICE "${service}" is not a valid service name.`,
    )
  }

  // Explicit nonproduction identity: the name must positively declare itself a
  // test/dev/ci/scratch/verify identity, and must carry no production marker.
  for (const [label, value] of [
    ['TEST_DB_CONTAINER', container],
    ['TEST_DB_COMPOSE_PROJECT', project],
  ]) {
    const segs = segments(value.toLowerCase())
    for (const seg of segs) {
      if (PRODUCTION_MARKERS.has(seg)) {
        throw new GuardError(
          'target_identity_production',
          `${label} "${value}" contains the production marker "${seg}". Verification must never ` +
            `target production infrastructure.`,
        )
      }
    }
    if (!segs.some((seg) => NONPRODUCTION_MARKERS.has(seg))) {
      throw new GuardError(
        'target_identity_not_nonproduction',
        `${label} "${value}" does not declare itself nonproduction. It must contain one of: ` +
          `${[...NONPRODUCTION_MARKERS].join(', ')} (e.g. "eanhl-verify-test").`,
      )
    }
  }

  return { container, project, service }
}

/** Generate a disposable clone name, then validate it like any other name. */
export function generateCloneName({ pid, now }) {
  const name = `eanhl_test_${pid}_${now.toString(36)}`
  return assertApprovedDatabaseName(name, 'clone')
}

function readSystemIdentifier(raw, source) {
  if (typeof raw !== 'string') {
    throw new GuardError(
      'system_identifier_unreadable',
      `${source} system identifier query returned no output.`,
    )
  }
  const value = raw.trim()
  if (value === '') {
    throw new GuardError(
      'system_identifier_empty',
      `${source} system identifier query returned an empty result.`,
    )
  }
  if (!SYSTEM_IDENTIFIER.test(value)) {
    throw new GuardError(
      'system_identifier_malformed',
      `${source} system identifier is malformed (expected digits, got ${JSON.stringify(value.slice(0, 80))}).`,
    )
  }
  return value
}

/**
 * Prove that the configured destructive target is a local, explicitly
 * nonproduction PostgreSQL cluster, and that the network DSN reaches exactly
 * that cluster.
 *
 * Returns an attestation object. Throws {@link GuardError} on any failure —
 * including a failed command, unparseable output, or a mismatch. No destructive
 * SQL may be issued unless this resolves.
 *
 * @param {object} args
 * @param {Record<string,string|undefined>} args.env
 * @param {object} args.deps
 * @param {(args: string[]) => string} args.deps.dockerExec     Runs `docker <args>`, returns stdout, throws on failure.
 * @param {(dsn: string) => Promise<string>} args.deps.networkSystemIdentifier
 * @param {() => number} args.deps.now
 * @param {number} args.deps.pid
 */
export async function attestNonProductionTarget({ env, deps }) {
  // 1. TEST_DATABASE_URL — the only accepted source DSN.
  const dsn = parseTestDatabaseUrl(env)

  // 2. Namespaces: the source we clone FROM and the clone we will CREATE/DROP.
  assertApprovedDatabaseName(dsn.database, 'source')
  const cloneDatabase = generateCloneName({ pid: deps.pid, now: deps.now() })

  // 3. Explicit, defaultless destructive-target identity.
  const target = resolveDestructiveTarget(env)

  // 4. Inspect the configured container (fail closed on any command failure).
  let inspectRaw
  try {
    inspectRaw = deps.dockerExec([
      'inspect',
      '--type',
      'container',
      '--format',
      '{{json .}}',
      target.container,
    ])
  } catch (err) {
    throw new GuardError(
      'container_inspect_failed',
      `docker inspect failed for container "${target.container}" — cannot attest the target. ` +
        `Detail: ${err?.message ?? String(err)}`,
    )
  }
  let inspected
  try {
    const text = String(inspectRaw ?? '').trim()
    if (text === '') throw new Error('empty output')
    inspected = JSON.parse(text)
  } catch (err) {
    throw new GuardError(
      'container_inspect_unparseable',
      `docker inspect output for "${target.container}" was empty or not JSON. Detail: ${err?.message ?? String(err)}`,
    )
  }
  if (!inspected || typeof inspected !== 'object') {
    throw new GuardError(
      'container_inspect_unparseable',
      `docker inspect returned no container object.`,
    )
  }

  // 4a. The inspected container must be the one that was named (docker resolves
  //     name prefixes and IDs; an ambiguous match must not slip through).
  const inspectedName = String(inspected.Name ?? '').replace(/^\//, '')
  if (inspectedName !== target.container) {
    throw new GuardError(
      'container_identity_mismatch',
      `docker inspect resolved "${target.container}" to a different container "${inspectedName}".`,
    )
  }

  // 5. Exact Compose project + service labels, and the explicit nonproduction label.
  const labels = inspected.Config?.Labels
  if (!labels || typeof labels !== 'object') {
    throw new GuardError(
      'container_labels_missing',
      `container "${target.container}" carries no labels; the Compose project/service cannot be proven.`,
    )
  }
  const actualProject = labels['com.docker.compose.project']
  const actualService = labels['com.docker.compose.service']
  if (actualProject !== target.project) {
    throw new GuardError(
      'compose_project_mismatch',
      `container "${target.container}" has com.docker.compose.project=${JSON.stringify(actualProject ?? null)}, ` +
        `expected exactly "${target.project}".`,
    )
  }
  if (actualService !== target.service) {
    throw new GuardError(
      'compose_service_mismatch',
      `container "${target.container}" has com.docker.compose.service=${JSON.stringify(actualService ?? null)}, ` +
        `expected exactly "${target.service}".`,
    )
  }
  if (labels[NONPRODUCTION_LABEL] !== 'true') {
    throw new GuardError(
      'container_not_declared_nonproduction',
      `container "${target.container}" does not carry ${NONPRODUCTION_LABEL}="true". Only a container ` +
        `explicitly declared nonproduction may be a destructive target (see docker-compose.test.yml).`,
    )
  }

  // 6. Running, and PostgreSQL actually reachable inside it.
  if (inspected.State?.Running !== true) {
    throw new GuardError(
      'container_not_running',
      `container "${target.container}" is not running (State.Running=${JSON.stringify(inspected.State?.Running ?? null)}).`,
    )
  }
  try {
    deps.dockerExec(['exec', target.container, 'pg_isready', '-U', dsn.user])
  } catch (err) {
    throw new GuardError(
      'container_postgres_unreachable',
      `pg_isready failed inside "${target.container}" — PostgreSQL is not reachable there. ` +
        `Detail: ${err?.message ?? String(err)}`,
    )
  }

  // 7. Cluster identity over the network DSN.
  let networkRaw
  try {
    networkRaw = await deps.networkSystemIdentifier(env['TEST_DATABASE_URL'])
  } catch (err) {
    throw new GuardError(
      'system_identifier_unreadable',
      `could not read the cluster system identifier through TEST_DATABASE_URL. The verification role ` +
        `must be able to execute pg_control_system() (superuser or pg_monitor). ` +
        `Detail: ${err?.message ?? String(err)}`,
    )
  }
  const networkId = readSystemIdentifier(networkRaw, 'network (TEST_DATABASE_URL)')

  // 8. Cluster identity through docker exec into the container we will DDL.
  let dockerRaw
  try {
    dockerRaw = deps.dockerExec([
      'exec',
      target.container,
      'psql',
      '-U',
      dsn.user,
      '-d',
      dsn.database,
      '-tAX',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      'SELECT system_identifier::text FROM pg_control_system()',
    ])
  } catch (err) {
    throw new GuardError(
      'system_identifier_unreadable',
      `could not read the cluster system identifier through docker exec on "${target.container}". ` +
        `Detail: ${err?.message ?? String(err)}`,
    )
  }
  const dockerId = readSystemIdentifier(dockerRaw, `docker exec (${target.container})`)

  // 9. Exact equality. This is the check an SSH tunnel cannot satisfy: a
  //    forwarded remote cluster answering on 127.0.0.1 has a different
  //    system_identifier than the local container we are about to DDL.
  if (networkId !== dockerId) {
    throw new GuardError(
      'system_identifier_mismatch',
      `cluster mismatch: TEST_DATABASE_URL reaches system_identifier ${networkId}, but container ` +
        `"${target.container}" reports ${dockerId}. The DSN and the destructive target are DIFFERENT ` +
        `PostgreSQL clusters (a loopback address does not prove otherwise — an SSH tunnel forges it). ` +
        `Refusing to run any DDL.`,
    )
  }

  return {
    ...target,
    sourceDatabase: dsn.database,
    cloneDatabase,
    user: dsn.user,
    testDatabaseUrl: env['TEST_DATABASE_URL'].trim(),
    systemIdentifier: networkId,
  }
}
