/**
 * Real process boundaries for the verification-database session.
 *
 * Deliberately thin: every decision lives in test-db-guard.mjs /
 * test-db-session.mjs, which are driven by fakes in the safety suite. Nothing
 * here reads a `.env` file or consults DATABASE_URL.
 */

import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

/** Run `docker <args>`; return stdout. Throws on non-zero exit. */
export function dockerExec(args) {
  return execFileSync('docker', args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  })
}

/** Run `docker <args>` with stdout/stderr passed through (long-running copies). */
export function dockerExecInherit(args) {
  return execFileSync('docker', args, { stdio: ['ignore', 'inherit', 'inherit'] })
}

/**
 * Read the cluster's `system_identifier` over the network DSN.
 *
 * This must go over TCP through the DSN itself — that is the whole point: it is
 * what proves the DSN and the docker-exec target are the same cluster. There is
 * no `psql` on the host and no `postgres` dependency in @eanhl/worker, so the
 * driver is resolved from the workspace package that already depends on it
 * (@eanhl/db). No installation is performed.
 */
export function makeNetworkSystemIdentifier(repoRoot) {
  return async function networkSystemIdentifier(dsn) {
    const require_ = createRequire(path.join(repoRoot, 'packages/db/package.json'))
    let resolved
    try {
      resolved = require_.resolve('postgres')
    } catch (err) {
      throw new Error(
        `could not resolve the "postgres" driver from packages/db (run pnpm install): ${err?.message ?? String(err)}`,
      )
    }
    const mod = await import(pathToFileURL(resolved).href)
    const postgres = mod.default ?? mod
    const sql = postgres(dsn, {
      max: 1,
      connect_timeout: 10,
      idle_timeout: 5,
      prepare: false,
      onnotice: () => {},
    })
    try {
      const rows = await sql`SELECT system_identifier::text AS id FROM pg_control_system()`
      return rows[0]?.id ?? ''
    } finally {
      await sql.end({ timeout: 5 })
    }
  }
}
