/**
 * splitMentions: turns an item's text plus its mention list into text and
 * player-link parts. Longest names first, whole word, case-sensitive.
 *
 * Run: node --test apps/web/src/lib/news/mentions.test.ts
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import { splitMentions } from './mentions.ts'

const MENTIONS = [
  { name: 'Silky', playerId: 2 },
  { name: 'Silky Jr', playerId: 5 },
]

test('longest name wins: "Silky Jr" links to 5, the first "Silky" to 2', () => {
  assert.deepEqual(splitMentions('Silky set up Silky Jr.', MENTIONS), [
    { text: 'Silky', playerId: 2 },
    { text: ' set up ' },
    { text: 'Silky Jr', playerId: 5 },
    { text: '.' },
  ])
})

test('a name inside another word is not linked', () => {
  assert.deepEqual(splitMentions('Silkyness is a word.', MENTIONS), [
    { text: 'Silkyness is a word.' },
  ])
  assert.deepEqual(splitMentions('Not Silky.', [{ name: 'ilky', playerId: 9 }]), [
    { text: 'Not Silky.' },
  ])
})

test('matching is case-sensitive', () => {
  assert.deepEqual(splitMentions('silky was here', MENTIONS), [{ text: 'silky was here' }])
})

test('empty mentions give one text part', () => {
  assert.deepEqual(splitMentions('Nobody named.', []), [{ text: 'Nobody named.' }])
})

test('empty text gives no parts', () => {
  assert.deepEqual(splitMentions('', MENTIONS), [])
})

test('names with regex characters are matched literally', () => {
  assert.deepEqual(splitMentions('Go Mr. X.P now', [{ name: 'Mr. X.P', playerId: 7 }]), [
    { text: 'Go ' },
    { text: 'Mr. X.P', playerId: 7 },
    { text: ' now' },
  ])
})

test('a name at the start, the end and repeated', () => {
  assert.deepEqual(splitMentions('Silky and Silky', [{ name: 'Silky', playerId: 2 }]), [
    { text: 'Silky', playerId: 2 },
    { text: ' and ' },
    { text: 'Silky', playerId: 2 },
  ])
})

test("a possessive links the name: Silky's", () => {
  assert.deepEqual(splitMentions("Silky's goal", [{ name: 'Silky', playerId: 2 }]), [
    { text: 'Silky', playerId: 2 },
    { text: "'s goal" },
  ])
})

test('gamertags with symbols: boundary is "not a letter, digit or underscore"', () => {
  assert.deepEqual(splitMentions('xX_Dave_Xx scored', [{ name: 'Dave', playerId: 3 }]), [
    { text: 'xX_Dave_Xx scored' },
  ])
  assert.deepEqual(splitMentions('(Dave) scored', [{ name: 'Dave', playerId: 3 }]), [
    { text: '(' },
    { text: 'Dave', playerId: 3 },
    { text: ') scored' },
  ])
})
