import test from 'node:test'
import assert from 'node:assert/strict'
import { parseTakeEdit } from './takes-edit.ts'

function form(entries: [string, string][]): FormData {
  const f = new FormData()
  for (const [k, v] of entries) f.append(k, v)
  return f
}

const GOOD: [string, string][] = [
  ['id', '7'],
  ['take', '  INVENTED take text.  '],
  ['spread', 'a few'],
  ['critics', 'voss'],
  ['critics', 'barlow'],
  ['defender', 'quill'],
  ['dataAngle', ' Invented angle. '],
  ['intensity', '-1'],
  ['active', 'on'],
]

void test('a valid edit is trimmed and typed', () => {
  const r = parseTakeEdit(form(GOOD))
  assert.deepEqual(r, {
    ok: true,
    id: 7,
    edit: {
      take: 'INVENTED take text.',
      spread: 'a few',
      critics: ['voss', 'barlow'],
      defender: 'quill',
      dataAngle: 'Invented angle.',
      intensity: -1,
      active: true,
    },
  })
})

void test('empty defender and data angle become null; an unchecked box is inactive', () => {
  const r = parseTakeEdit(
    form(GOOD.filter(([k]) => k !== 'active' && k !== 'defender' && k !== 'dataAngle')),
  )
  assert.ok(r.ok)
  assert.equal(r.edit.defender, null)
  assert.equal(r.edit.dataAngle, null)
  assert.equal(r.edit.active, false)
})

void test('bad input is refused with a reason', () => {
  const bad = (name: string, value: string | null) => {
    const entries = GOOD.filter(([k]) => k !== name)
    if (value !== null) entries.push([name, value])
    return parseTakeEdit(form(entries))
  }
  assert.equal(bad('id', 'x').ok, false)
  assert.equal(bad('id', '0').ok, false)
  assert.equal(bad('take', '   ').ok, false)
  assert.equal(bad('take', 'x'.repeat(1001)).ok, false)
  assert.equal(bad('spread', 'everyone').ok, false)
  assert.equal(bad('intensity', '3').ok, false)
  assert.equal(bad('intensity', '-3').ok, false)
  assert.equal(bad('intensity', '1.5').ok, false)
  assert.equal(bad('defender', 'nobody').ok, false)
  assert.equal(bad('dataAngle', 'y'.repeat(501)).ok, false)
  // A critic that is not a reporter; a defender who is also a critic.
  assert.equal(parseTakeEdit(form([...GOOD, ['critics', 'nobody']])).ok, false)
  assert.equal(parseTakeEdit(form([...GOOD, ['critics', 'quill']])).ok, false)
})
