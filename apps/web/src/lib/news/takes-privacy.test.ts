import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const SRC = new URL('../../', import.meta.url).pathname

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return files(p)
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : []
  })
}

/** GM takes are secrets: the pages and code that read or edit them live under /admin/news, the fact route and lib only. */
void test('reporter takes are read only by the admin area and the internal fact route', () => {
  const allowed = [
    `app${sep}admin${sep}news${sep}`,
    `lib${sep}news${sep}load-facts.ts`,
    `lib${sep}news${sep}takes-edit.ts`,
    `lib${sep}news${sep}quality.ts`,
  ]
  const needles = ['listAdminTakes', 'activeTakesForPlayers', 'updateAdminTake', 'TakesSection']
  const offenders: string[] = []
  for (const f of files(SRC)) {
    const rel = relative(SRC, f)
    if (allowed.some((a) => rel.startsWith(a))) continue
    const text = readFileSync(f, 'utf8')
    for (const n of needles) if (text.includes(n)) offenders.push(`${rel}: ${n}`)
  }
  assert.deepEqual(offenders, [])
})

void test('the admin news page asks for an admin before it reads any take', () => {
  const page = readFileSync(join(SRC, 'app/admin/news/page.tsx'), 'utf8')
  assert.ok(page.indexOf('await requireAdmin()') > -1)
  assert.ok(page.indexOf('await requireAdmin()') < page.indexOf('listAdminTakes()'))
  const actions = readFileSync(join(SRC, 'app/admin/news/actions.ts'), 'utf8')
  const save = actions.slice(actions.indexOf('export async function saveTakeAction'))
  assert.ok(save.indexOf('await requireAdmin()') < save.indexOf('updateAdminTake('))
})
