/**
 * Installs ./server-component-loader.mjs for a `node --test` run.
 *
 *   node --import ./test/register-loader.mjs --test src/**\/*.test.ts
 *
 * Also supplies a placeholder DATABASE_URL. `@eanhl/db` throws at import time
 * without one; the render tests never open a connection (the loader redirects
 * `@eanhl/db/queries` to a stub) and postgres.js connects lazily, so this value
 * is never dialled. It points at a closed port so a mistake fails fast and
 * loudly instead of reaching a real database.
 */

import { register } from 'node:module'

process.env.DATABASE_URL ??= 'postgresql://render-test:unused@127.0.0.1:1/render-test'

register('./server-component-loader.mjs', import.meta.url)
