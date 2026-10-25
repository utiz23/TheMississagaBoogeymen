import test from 'node:test'
import assert from 'node:assert/strict'
import { parseProfileForm, pressLevelSetBy, withPressLevelChange } from './profile-edit.ts'

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

void test('a member sets their press level', () => {
  const r = parseProfileForm(form({ pressLevel: 'easy' }), false)
  assert.equal(r.ok, true)
  if (r.ok) assert.equal(r.patch.pressLevel, 'easy')
})

void test('an admin sets a press level too', () => {
  const r = parseProfileForm(form({ pressLevel: 'out' }), true)
  assert.equal(r.ok, true)
  if (r.ok) assert.equal(r.patch.pressLevel, 'out')
})

void test('an unknown press level is refused', () => {
  const r = parseProfileForm(form({ pressLevel: 'harsh' }), false)
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.errors.pressLevel, 'Choose a press level.')
})

void test('an empty press level is refused', () => {
  const r = parseProfileForm(form({ pressLevel: '' }), false)
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.errors.pressLevel, 'Choose a press level.')
})

void test('an absent press level leaves it unchanged', () => {
  const r = parseProfileForm(form({ playerName: 'Silky' }), false)
  assert.equal(r.ok, true)
  if (r.ok) {
    assert.equal('pressLevel' in r.patch, false)
    assert.equal('pressLevelSetBy' in r.patch, false)
  }
})

void test('press level is set by the admin only on another player', () => {
  assert.equal(pressLevelSetBy({ role: 'admin', playerId: 2 }, 5), 'admin')
  assert.equal(pressLevelSetBy({ role: 'admin', playerId: 5 }, 5), 'self')
  assert.equal(pressLevelSetBy({ role: 'admin', playerId: null }, 5), 'admin')
  assert.equal(pressLevelSetBy({ role: 'user', playerId: 5 }, 5), 'self')
})

void test('a save that keeps the press level leaves level and set-by out of the patch', () => {
  const patch = { bio: 'Hi', pressLevel: 'easy' as const }
  const out = withPressLevelChange(patch, 'easy', { role: 'user', playerId: 5 }, 5)
  assert.deepEqual(out, { bio: 'Hi' })
  const admin = withPressLevelChange(patch, 'easy', { role: 'admin', playerId: 2 }, 5)
  assert.deepEqual(admin, { bio: 'Hi' })
})

void test('a changed press level is stamped self for the player', () => {
  const out = withPressLevelChange({ pressLevel: 'out' }, 'full', { role: 'user', playerId: 5 }, 5)
  assert.deepEqual(out, { pressLevel: 'out', pressLevelSetBy: 'self' })
})

void test('a changed press level is stamped admin when an admin edits another player', () => {
  const out = withPressLevelChange(
    { pressLevel: 'easy' },
    'full',
    { role: 'admin', playerId: 2 },
    5,
  )
  assert.deepEqual(out, { pressLevel: 'easy', pressLevelSetBy: 'admin' })
})

void test('a patch without a press level stays without one', () => {
  const out = withPressLevelChange({ bio: 'x' }, 'full', { role: 'user', playerId: 5 }, 5)
  assert.deepEqual(out, { bio: 'x' })
})
