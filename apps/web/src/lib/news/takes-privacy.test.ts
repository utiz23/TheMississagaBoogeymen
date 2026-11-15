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

/**
 * GM takes are secrets: the pages and code that read or edit them live under /admin/news, the Press
 * Box (the takes editor moved to /admin/press-box/storylines in release L3), the fact route and lib only.
 */
void test('reporter takes are read only by the admin area and the internal fact route', () => {
  const allowed = [
    `app${sep}admin${sep}news${sep}`,
    `app${sep}admin${sep}press-box${sep}`,
    `lib${sep}news${sep}load-facts.ts`,
    `lib${sep}news${sep}takes-edit.ts`,
    `lib${sep}news${sep}takes-save.ts`,
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
  // The takes editor moved: the old unlogged save action is gone, the news page only links to the new one.
  const actions = readFileSync(join(SRC, 'app/admin/news/actions.ts'), 'utf8')
  assert.ok(!actions.includes('saveTakeAction'))
  // The Press Box page asks for an admin before it reads any take, and so does every take action.
  const box = readFileSync(join(SRC, 'app/admin/press-box/storylines/page.tsx'), 'utf8')
  assert.ok(box.indexOf('await requireAdmin()') > -1)
  assert.ok(box.indexOf('await requireAdmin()') < box.indexOf('loadStorylinesPage('))
  const boxActions = readFileSync(join(SRC, 'app/admin/press-box/storyline-box-actions.ts'), 'utf8')
  for (const fn of ['addTakeBox', 'editTakeBox', 'removeTakeBox']) {
    const body = boxActions.slice(boxActions.indexOf(`export async function ${fn}(`))
    assert.ok(
      body.indexOf('await deps.requireAdmin()') <
        body.indexOf('deps.'.concat(fn.replace('Box', 'WithAudit'))),
      fn,
    )
  }
})
