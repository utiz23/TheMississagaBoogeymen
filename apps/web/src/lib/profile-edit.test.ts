import test from 'node:test'
import assert from 'node:assert/strict'
import { parseProfileForm } from './profile-edit.ts'

const form = (values: Record<string, string>) => (name: string) => values[name] ?? null

void test('a member saves the four self fields, cleaned', () => {
  const r = parseProfileForm(
    form({
      playerName: '  Silky\n Joker ',
      jerseyNumber: '10',
      nationality: 'Canada',
      bio: ' Started as a goalie.\r\n\r\n\r\n\r\nNow a center. ',
    }),
    false,
  )
  assert.deepEqual(r, {
    ok: true,
    patch: {
      playerName: 'Silky Joker',
      jerseyNumber: 10,
      nationality: 'Canada',
      bio: 'Started as a goalie.\n\nNow a center.',
    },
  })
})

void test('empty fields clear to null (name falls back to the gamertag)', () => {
  const r = parseProfileForm(
    form({ playerName: ' ', jerseyNumber: '', nationality: '', bio: '' }),
    false,
  )
  assert.deepEqual(r, {
    ok: true,
    patch: { playerName: null, jerseyNumber: null, nationality: null, bio: null },
  })
})

void test('a member cannot set admin-only fields, even in a tampered form', () => {
  const r = parseProfileForm(
    form({ preferredPosition: 'goalie', archetype: 'sniper', clubRoleLabel: 'Captain' }),
    false,
  )
  assert.equal(r.ok, true)
  if (r.ok) {
    assert.equal('preferredPosition' in r.patch, false)
    assert.equal('archetype' in r.patch, false)
    assert.equal('clubRoleLabel' in r.patch, false)
  }
})

void test('out-of-range values are refused with a message per field', () => {
  const r = parseProfileForm(
    form({
      playerName: 'x'.repeat(25),
      jerseyNumber: '100',
      nationality: 'Mars',
      bio: 'y'.repeat(281),
    }),
    false,
  )
  assert.equal(r.ok, false)
  if (!r.ok) {
    assert.deepEqual(Object.keys(r.errors).sort(), [
      'bio',
      'jerseyNumber',
      'nationality',
      'playerName',
    ])
  }
  assert.equal(parseProfileForm(form({ jerseyNumber: '-1' }), false).ok, false)
  assert.equal(parseProfileForm(form({ jerseyNumber: '7.5' }), false).ok, false)
})

void test('an admin also sets position, archetype and club role', () => {
  const r = parseProfileForm(
    form({
      preferredPosition: 'leftDefenseMen',
      archetype: 'puckmover',
      clubRoleLabel: ' Captain ',
    }),
    true,
  )
  assert.equal(r.ok, true)
  if (r.ok) {
    assert.equal(r.patch.preferredPosition, 'leftDefenseMen')
    assert.equal(r.patch.archetype, 'puckmover')
    assert.equal(r.patch.clubRoleLabel, 'Captain')
  }
  assert.equal(parseProfileForm(form({ preferredPosition: 'striker' }), true).ok, false)
  assert.equal(parseProfileForm(form({ archetype: 'wizard' }), true).ok, false)
  const goalie = parseProfileForm(form({ preferredPosition: 'goalie', archetype: 'sniper' }), true)
  assert.equal(goalie.ok, false)
})
