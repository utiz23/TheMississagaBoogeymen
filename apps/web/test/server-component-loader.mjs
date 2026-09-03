/**
 * Node ESM hooks that make an App Router Server Component importable — and so
 * renderable — from a plain `node --test` run, with no Next.js server and no
 * database.
 *
 * Three jobs, and nothing else:
 *
 *   1. `.tsx` -> JS. Node's built-in type stripping handles `.ts` but not JSX,
 *      so `.tsx` is transpiled with the TypeScript compiler that already ships
 *      as a devDependency of this workspace. Types are erased, not checked —
 *      `pnpm --filter web typecheck` is what checks them.
 *   2. The `@/...` path alias from tsconfig, which Node does not know about.
 *   3. `next/*` subpaths that resolve only with an explicit `.js`.
 *
 * Plus one deliberate substitution: `@eanhl/db/queries` is redirected to
 * `./db-queries-stub.mjs`. That is what lets a test render a page under a
 * chosen database state — an EMPTY users table, in particular — and, more
 * usefully, assert which queries the page did and did not run.
 *
 * This is a test-only harness. It is not used by `next dev`, `next build`, or
 * anything that ships.
 */

import { pathToFileURL } from 'node:url'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

const HERE = path.dirname(new URL(import.meta.url).pathname)
const WEB_SRC = path.resolve(HERE, '../src')
const DB_QUERIES_STUB = pathToFileURL(path.join(HERE, 'db-queries-stub.mjs')).href

export async function resolve(specifier, context, next) {
  if (specifier === '@eanhl/db/queries') {
    return { url: DB_QUERIES_STUB, format: 'module', shortCircuit: true }
  }

  if (specifier.startsWith('@/')) {
    const base = pathToFileURL(path.join(WEB_SRC, specifier.slice(2))).href
    for (const ext of ['.tsx', '.ts']) {
      try {
        return await next(base + ext, context)
      } catch {
        // Try the next extension; if none resolve, fall through to the default
        // resolver so the error names the original specifier.
      }
    }
  }

  try {
    return await next(specifier, context)
  } catch (err) {
    // Extensionless specifiers: `./page` (TypeScript/Next style) and
    // `next/headers`, which resolves only as `next/headers.js` outside the
    // Next.js runtime.
    for (const ext of ['.tsx', '.ts', '.js']) {
      try {
        return await next(specifier + ext, context)
      } catch {
        // keep trying
      }
    }
    throw err
  }
}

export async function load(url, context, next) {
  if (url.endsWith('.tsx')) {
    const source = readFileSync(new URL(url), 'utf8')
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: {
        jsx: ts.JsxEmit.ReactJSX,
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
      fileName: url,
    })
    return { format: 'module', shortCircuit: true, source: outputText }
  }
  return next(url, context)
}
