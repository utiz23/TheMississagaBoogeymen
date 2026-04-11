import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import * as schema from './schema/index.js'

const url = process.env.DATABASE_URL
if (!url) {
  throw new Error('DATABASE_URL environment variable is required')
}

/**
 * Low-level postgres.js connection.
 * Exported for cases that need raw SQL access (e.g. migrations, health checks).
 */
export const sql = postgres(url)

/**
 * Drizzle ORM instance with the full schema loaded.
 * Import this wherever database access is needed.
 */
export const db = drizzle(sql, { schema })

export type Database = typeof db
