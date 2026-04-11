// Database package public API.
// Consumer packages import from '@eanhl/db' (client + schema) or
// '@eanhl/db/queries' (query functions, once implemented in Phase 2/3).

export { db, sql } from './client.js'
export type { Database } from './client.js'
export * from './schema/index.js'
