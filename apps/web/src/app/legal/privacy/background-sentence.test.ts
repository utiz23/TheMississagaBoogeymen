import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// The privacy sentence for player background notes is a PROPOSAL (task background-b2): its wording
// is the operator's to approve. It sits in section 13 of the real source AND of the source draft
// (`apps/web/test/legal-http.test.ts` compares the two), word for word.
const SENTENCE =
  'Answers to background questions may be kept as short notes about your hockey history and your teammates; an admin checks them before the reporters use them, and you can ask to have them removed.'

const squash = (s: string): string => s.replace(/\s+/g, ' ')

void test('the proposed sentence is in the page source and in the source draft, in section 13', () => {
  const tsx = squash(
    readFileSync(new URL('../../../content/legal/privacy.tsx', import.meta.url), 'utf8'),
  )
  const draft = squash(
    readFileSync(
      new URL('../../../../../../docs/planning/privacy-policy-draft.md', import.meta.url),
      'utf8',
    ),
  )
  // The page source breaks lines inside JSX: compare on the words only.
  const words = SENTENCE.split(' ')
  assert.ok(tsx.includes(words.slice(0, 6).join(' ')), 'first words in privacy.tsx')
  assert.ok(draft.includes(SENTENCE), 'the whole sentence in the draft')
  const section13 = draft.slice(
    draft.indexOf('### 13. News posts written by an AI service'),
    draft.indexOf('### 14. Changes to this policy'),
  )
  assert.ok(section13.includes(SENTENCE), 'in section 13 of the draft')
  const jsx13 = tsx.slice(
    tsx.indexOf("heading: 'News posts written by an AI service'"),
    tsx.indexOf("heading: 'Changes to this policy'"),
  )
  assert.equal(
    squash(jsx13.replace(/<\/?[A-Za-z]+[^>]*>/g, ' ')).includes(SENTENCE),
    true,
    'the whole sentence in section 13 of privacy.tsx',
  )
})
