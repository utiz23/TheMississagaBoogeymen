import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import * as schema from './schema/index.js'

const url = process.env.DATABASE_URL
if (!url) {
  throw new Error('DATABASE_URL environment variable is required')
}

// In Next.js dev mode, Turbopack/webpack hot reloads re-evaluate modules but
// globalThis persists across those re-evaluations. Without this singleton,
// each hot reload creates a new connection pool without closing the old one,
// eventually exhausting Postgres max_connections.
const g = globalThis as typeof globalThis & { __eanhl_sql?: postgres.Sql }

export const sql = g.__eanhl_sql ?? postgres(url, { max: 10 })

if (process.env.NODE_ENV !== 'production') {
  g.__eanhl_sql = sql
}

export const db = drizzle(sql, { schema })

export type Database = typeof db
