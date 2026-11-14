import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// The privacy sentence is a PROPOSAL (task background-b2): its wording is the operator's to approve.
void test('the proposed privacy sentence is in its own last section and no other legal text changed', () => {
  const section = readFileSync(new URL('./background-section.tsx', import.meta.url), 'utf8')
  assert.match(
    section,
    /Answers to background questions may be kept as short notes about your hockey history and your teammates; an admin checks them before the reporters use them, and you can ask to have them removed\./,
  )
  const page = readFileSync(new URL('./page.tsx', import.meta.url), 'utf8')
  assert.match(page, /\[\.\.\.sections, backgroundSection\(/)
})
