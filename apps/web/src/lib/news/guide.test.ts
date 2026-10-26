import test from 'node:test'
import assert from 'node:assert/strict'
import { GUIDE_PATH, guideSteps, ownProfileHref } from './guide.ts'

void test('own profile link: the member path when known, else the numeric path, null when signed out', () => {
  const paths = new Map([[2, '/roster/silkyjoker85']])
  assert.equal(ownProfileHref(2, paths), '/roster/silkyjoker85')
  assert.equal(ownProfileHref(9, paths), '/roster/9')
  assert.equal(ownProfileHref(9, null), '/roster/9')
  assert.equal(ownProfileHref(null, paths), null)
})

void test('the guide says the reporters are made up and where the press level is set', () => {
  assert.equal(GUIDE_PATH, '/news/guide')
  const text = guideSteps.join(' ')
  assert.match(text, /made up/i)
  assert.match(text, /EDIT PROFILE/)
  assert.match(text, /Press coverage/)
})
