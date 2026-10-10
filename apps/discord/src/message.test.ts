import test from 'node:test'
import assert from 'node:assert/strict'
import type { DiscordGameResult } from '@eanhl/db/discord'
import { buildGameResultPayload, escapeMarkdown, resultLabel } from './message.ts'

const SITE = 'https://boogeymen.app'
const r: DiscordGameResult = {
  matchId: 900,
  result: 'WIN',
  overtime: false,
  scoreFor: 4,
  scoreAgainst: 2,
  opponentName: 'XYZ Hockey Club',
  gameTitleName: 'NHL 26',
  gameMode: '6s',
  playedAt: '2026-10-10T03:42:00.000Z',
  stars: [
    {
      rank: 1,
      gamertag: 'x_Sniper_x',
      kind: 'member',
      playerId: 7,
      score: 8.4,
      statLine: '2G 1A +2',
      teamAbbrev: null,
    },
    {
      rank: 2,
      gamertag: 'OppGuy',
      kind: 'opponent',
      playerId: null,
      score: 6.1,
      statLine: '1G 1A',
      teamAbbrev: 'XYZ',
    },
    {
      rank: 3,
      gamertag: '@everyone',
      kind: 'guest',
      playerId: 50,
      score: 5.25,
      statLine: '1A 4 HITS',
      teamAbbrev: null,
    },
  ],
  lineupCardCount: 6,
}

void test('labels', () => {
  assert.equal(resultLabel('WIN', false), 'WIN')
  assert.equal(resultLabel('WIN', true), 'WIN (OT)')
  assert.equal(resultLabel('LOSS', false), 'LOSS')
  assert.equal(resultLabel('OTL', true), 'OT LOSS')
  assert.equal(resultLabel('DNF', false), 'DNF')
})

void test('escapeMarkdown neutralises Discord formatting', () => {
  assert.equal(escapeMarkdown('x_Sniper_x'), 'x\\_Sniper\\_x')
  assert.equal(escapeMarkdown('[BGM] *Ace*'), '\\[BGM\\] \\*Ace\\*')
})

void test('win post: colour, title link, timestamp, three star lines, image, nobody pinged', () => {
  const p = buildGameResultPayload(r, { siteUrl: SITE, hasImage: true })
  const e = p.embeds[0]!
  assert.deepEqual(p.allowed_mentions, { parse: [] })
  assert.equal(e.color, 0x10b981)
  assert.equal(e.url, `${SITE}/games/900`)
  assert.equal(e.title, 'BGM 4 – 2 XYZ Hockey Club · WIN')
  assert.match(e.description, /NHL 26 · 6s · <t:1791603720:f>/)
  assert.match(
    e.description,
    /⭐ \*\*1st\*\* · \[x\\_Sniper\\_x\]\(https:\/\/boogeymen\.app\/roster\/7\) · \*\*8\.40\*\* · 2G 1A \+2/,
  )
  assert.match(e.description, /⭐ \*\*2nd\*\* · OppGuy \(XYZ\) · \*\*6\.10\*\*/)
  assert.match(e.description, /⭐ \*\*3rd\*\* · @everyone · \*\*5\.25\*\*/)
  assert.ok(!e.description.includes('/roster/50'))
  assert.match(e.description, /\[Full box score →\]\(https:\/\/boogeymen\.app\/games\/900\)/)
  // The image goes under the box (a plain attachment), where Discord shows it larger.
  assert.equal(e.image, undefined)
  assert.deepEqual(p.attachments, [{ id: 0, filename: 'cards.png' }])
})

void test('no image ⇒ no image field, no attachments', () => {
  const p = buildGameResultPayload(r, { siteUrl: SITE, hasImage: false })
  assert.equal(p.embeds[0]!.image, undefined)
  assert.equal(p.attachments, undefined)
})

void test('loss / OT loss / OT win colours and titles', () => {
  assert.equal(
    buildGameResultPayload({ ...r, result: 'LOSS' }, { siteUrl: SITE, hasImage: false }).embeds[0]!
      .color,
    0xe84131,
  )
  assert.equal(
    buildGameResultPayload({ ...r, result: 'OTL' }, { siteUrl: SITE, hasImage: false }).embeds[0]!
      .color,
    0xf59e0b,
  )
  assert.match(
    buildGameResultPayload({ ...r, overtime: true }, { siteUrl: SITE, hasImage: false }).embeds[0]!
      .title,
    / · WIN \(OT\)$/,
  )
})

void test('DNF: grey, no stars, says it ended early', () => {
  const p = buildGameResultPayload(
    { ...r, result: 'DNF', stars: [], lineupCardCount: 0 },
    { siteUrl: SITE, hasImage: false },
  )
  const e = p.embeds[0]!
  assert.equal(e.color, 0x3a3839)
  assert.ok(!e.description.includes('⭐'))
  assert.match(e.description, /Game ended early/)
})

void test('missing game mode is omitted, not printed as null', () => {
  const p = buildGameResultPayload({ ...r, gameMode: null }, { siteUrl: SITE, hasImage: false })
  assert.match(p.embeds[0]!.description, /^NHL 26 · <t:/)
})
