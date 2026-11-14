/**
 * Player background rules, SQL shapes and migration 0082 (task background-b1). No database.
 *   pnpm --filter @eanhl/db build
 *   node --test packages/db/dist/queries/__tests__/press-background.test.js
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PgDialect, getTableConfig } from 'drizzle-orm/pg-core'
import {
  BACKGROUND_PARTS,
  BACKGROUND_PART_LABELS,
  PRESS_BOX_AUDIT_KINDS,
  newsBackgroundFacts,
  newsBackgroundQuestions,
} from '../../schema/index.js'

process.env.DATABASE_URL = 'postgresql://news-test:unused@127.0.0.1:1/unused'

const q = await import('../press-background.js')
const dialect = new PgDialect()
const flat = (s: string) => s.replace(/\s+/g, ' ')
const text = (s: Parameters<typeof dialect.sqlToQuery>[0]) => flat(dialect.sqlToQuery(s).sql)
const AT = new Date('2026-11-14T12:00:00Z')

// ── Pure rules ───────────────────────────────────────────────────────────────

void test('fact text: one short paragraph, 1 to 400 characters', () => {
  assert.equal(
    q.normalizeFactText('  Joined   in\nthe first season  '),
    'Joined in the first season',
  )
  assert.equal(q.normalizeFactText('   '), null)
  assert.equal(q.normalizeFactText(''), null)
  assert.equal(q.normalizeFactText('a'.repeat(400)), 'a'.repeat(400))
  assert.equal(q.normalizeFactText('a'.repeat(401)), null)
})

void test('bank question: the name goes where {name} is', () => {
  assert.equal(
    q.questionText("Has {name}'s role changed since {name} first arrived?", 'Silky'),
    "Has Silky's role changed since Silky first arrived?",
  )
  assert.equal(q.questionText('No placeholder here', 'Silky'), 'No placeholder here')
})

void test('fact actions: confirm and reject need a proposed fact, remove a confirmed one, edit never a rejected one', () => {
  assert.equal(q.canApply('confirm', 'proposed'), true)
  assert.equal(q.canApply('confirm', 'confirmed'), false)
  assert.equal(q.canApply('confirm', 'rejected'), false)
  assert.equal(q.canApply('reject', 'proposed'), true)
  assert.equal(q.canApply('reject', 'confirmed'), false)
  assert.equal(q.canApply('delete', 'confirmed'), true)
  assert.equal(q.canApply('delete', 'proposed'), false)
  assert.equal(q.canApply('delete', 'rejected'), false)
  assert.equal(q.FACT_ACTION_TO.confirm, 'confirmed')
  assert.equal(q.FACT_ACTION_TO.reject, 'rejected')
  assert.equal(q.FACT_ACTION_TO.delete, 'rejected', 'delete is soft: the row stays, rejected')
  assert.equal(q.canEdit('proposed'), true)
  assert.equal(q.canEdit('confirmed'), true)
  assert.equal(q.canEdit('rejected'), false)
})

void test('source answer: the text only for a usable or joke answer, whatever the row holds', () => {
  const CANARY = 'CANARY-UNUSABLE-TEXT'
  const mk = (usability: 'usable' | 'joke' | 'unusable' | null) => ({
    answer_kind: 'scrum' as const,
    answer_usability: usability,
    answer_question: CANARY,
    answer_text: CANARY,
  })
  assert.equal(q.shapeSourceAnswer(mk('usable'))!.text, CANARY)
  assert.equal(q.shapeSourceAnswer(mk('joke'))!.usability, 'joke')
  for (const hidden of [mk('unusable'), mk(null)]) {
    const out = q.shapeSourceAnswer(hidden)!
    assert.equal(out.text, null)
    assert.equal(out.question, null)
    assert.equal(JSON.stringify(out).includes(CANARY), false)
  }
  assert.equal(
    q.shapeSourceAnswer({
      answer_kind: null,
      answer_usability: null,
      answer_question: null,
      answer_text: null,
    }),
    null,
    'a fact the admin typed has no source answer',
  )
})

void test('facts list: proposed first, then confirmed, then rejected; newest first inside each', () => {
  const f = (id: number, status: 'proposed' | 'confirmed' | 'rejected', day: number) =>
    q.factFromRow({
      id,
      part: 'career',
      text: `fact ${String(id)}`,
      status,
      source: 'admin',
      created_by: 'x',
      created_at: new Date(AT.getTime() + day * 86_400_000),
      reviewed_by: null,
      reviewed_at: null,
      edited_by: null,
      edited_at: null,
      player_id: 1,
      discord_user_id: null,
      owner_name: 'A',
      subject_player_id: null,
      subject_name: null,
      question_id: null,
      answer_kind: null,
      answer_usability: null,
      answer_question: null,
      answer_text: null,
    })
  const order = q
    .sortFacts([
      f(1, 'confirmed', 0),
      f(2, 'rejected', 5),
      f(3, 'proposed', 0),
      f(4, 'proposed', 2),
      f(5, 'confirmed', 3),
    ])
    .map((x) => x.id)
  assert.deepEqual(order, [4, 3, 5, 1, 2])
})

void test('open questions are grouped by part in the worksheet order, with the name in each', () => {
  const rows = [
    { id: 9, part: 'room' as const, question: 'Who does {name} sit with?', about_teammate: true },
    {
      id: 2,
      part: 'identity' as const,
      question: 'What should reporters call {name}?',
      about_teammate: false,
    },
    { id: 3, part: 'identity' as const, question: 'Is {name} loud?', about_teammate: false },
  ]
  const g = q.groupOpenQuestions(rows, 'Silky')
  assert.deepEqual(
    g.map((p) => p.part),
    ['identity', 'room'],
  )
  assert.equal(g[0]!.label, BACKGROUND_PART_LABELS.identity)
  assert.deepEqual(
    g[0]!.questions.map((x) => x.text),
    ['What should reporters call Silky?', 'Is Silky loud?'],
  )
  assert.equal(g[1]!.questions[0]!.aboutTeammate, true)
})

// ── What a writer may read: confirmed facts only ─────────────────────────────

void test('writer SQL: confirmed only, nothing for "Leave me out" (owner or subject), no other status', () => {
  for (const key of [{ playerId: 4 }, { discordUserId: '123456789012345678' }]) {
    const s = text(q.confirmedBackgroundSql(key))
    assert.match(s, /where f\.status = 'confirmed'/)
    assert.match(s, /coalesce\(opp\.press_level, 'full'\) <> 'out'/)
    assert.match(s, /coalesce\(spp\.press_level, 'full'\) <> 'out'/)
    assert.doesNotMatch(s, /proposed|rejected/)
    // No answer text, no question text: a background fact is a statement, not a quote.
    assert.doesNotMatch(s, /\.answer\b|\.question\b/)
  }
  const bench = text(q.confirmedBackgroundSql({ discordUserId: '123456789012345678' }))
  assert.match(bench, /f\.player_id is null and f\.discord_user_id = \$1/)
  assert.match(bench, /\(false and not/, 'a bench person has no "what teammates said"')
})

void test('writer rows: whatever rows are handed over, only a confirmed, non-out fact comes out', () => {
  const row = (over: Record<string, unknown>) => ({
    scope: 'own' as const,
    part: 'career' as const,
    text: 'ok',
    status: 'confirmed' as const,
    owner_level: 'full' as const,
    subject_level: null,
    has_subject: false,
    ...over,
  })
  const out = q.pickWriterBackground(
    [
      row({ text: 'CONFIRMED-OWN' }),
      row({ text: 'CANARY-PROPOSED', status: 'proposed' }),
      row({ text: 'CANARY-REJECTED', status: 'rejected' }),
      row({ text: 'CANARY-OWNER-OUT', owner_level: 'out' }),
      row({
        text: 'CANARY-SUBJECT-OUT',
        scope: 'teammate',
        has_subject: true,
        subject_level: 'out',
      }),
      // An own fact that names a teammate is not offered under its owner.
      row({ text: 'CANARY-NAMES-OTHER', has_subject: true, subject_level: 'full' }),
      row({
        text: 'CONFIRMED-TEAM',
        scope: 'teammate',
        part: 'room',
        has_subject: true,
        subject_level: 'full',
      }),
    ],
    'full',
  )
  assert.deepEqual(out, {
    own: [{ part: 'career', text: 'CONFIRMED-OWN' }],
    fromTeammates: [{ part: 'room', text: 'CONFIRMED-TEAM' }],
  })
  assert.equal(JSON.stringify(out).includes('CANARY'), false)
  // "Go easy" is shown (the no-criticism rule works on the text); "Leave me out" gets nothing.
  assert.equal(q.pickWriterBackground([row({})], 'easy').own.length, 1)
  assert.deepEqual(q.pickWriterBackground([row({})], 'out'), { own: [], fromTeammates: [] })
})

void test('the profile material reads background through the confirmed-only query, and not at all for "Leave me out"', () => {
  const src = readFileSync(new URL('../press-box-dossiers.js', import.meta.url), 'utf8')
  const body = src.slice(src.indexOf('export async function getProfileMaterial'))
  const outAt = body.indexOf("if (identity.pressLevel === 'out')")
  const readAt = body.indexOf('getConfirmedBackground(key, identity.pressLevel)')
  assert.ok(outAt > 0 && readAt > outAt, 'the "out" return comes before any background read')
  assert.doesNotMatch(src, /from news_background_facts/, 'dossier file never reads facts by itself')
  const bg = readFileSync(new URL('../press-background.js', import.meta.url), 'utf8')
  const fn = bg.slice(bg.indexOf('export async function getConfirmedBackground'))
  assert.match(fn.slice(0, 400), /if \(pressLevel === 'out'\)\s+return/)
})

// ── What the admin sees: answer text only when usable or joke ────────────────

void test("fact SQL selects a source answer's question and text only through the usable/joke case, and leaves test rows out", () => {
  for (const sqlQuery of [
    q.ownFactsSql({ playerId: 4 }),
    q.ownFactsSql({ discordUserId: '123456789012345678' }),
    q.teammateFactsSql(4),
  ]) {
    const s = text(sqlQuery)
    assert.match(
      s,
      /when sa\.usability in \('usable', 'joke'\) and not sa\.is_test then sa\.answer/,
    )
    assert.match(
      s,
      /when ia\.usability in \('usable', 'joke'\) and not ia\.is_test then ia\.answer/,
    )
    // Every reference to an answer or question column sits right after "then ".
    for (const m of s.matchAll(/\b(sa|ia)\.(answer|question)\b/g)) {
      assert.equal(s.slice(m.index - 5, m.index), 'then ', `${m[0]} is outside the usability case`)
    }
    assert.match(s, /coalesce\(sa\.usability, ia\.usability\) as answer_usability/)
  }
  const own = text(q.ownFactsSql({ playerId: 4 }))
  assert.match(own, /where f\.player_id = \$1/)
  const mates = text(q.teammateFactsSql(4))
  assert.match(mates, /f\.subject_player_id = \$1 and f\.status <> 'rejected'/)
  assert.match(mates, /f\.player_id <> \$2/)
  const bench = text(q.ownFactsSql({ discordUserId: '123456789012345678' }))
  assert.match(bench, /f\.player_id is null and f\.discord_user_id = \$1/)
})

void test('open questions: active ones for this person (or everyone) with no fact of theirs, of any status, on it', () => {
  const member = text(q.openQuestionsSql({ playerId: 4 }))
  assert.match(member, /where q\.active and \(q\.player_id is null or q\.player_id = \$1\)/)
  assert.match(
    member,
    /not exists \( select 1 from news_background_facts f where f\.question_id = q\.id and f\.player_id = \$2 \)/,
  )
  assert.doesNotMatch(member, /status/, 'a rejected fact keeps its question closed')
  const bench = text(q.openQuestionsSql({ discordUserId: '123456789012345678' }))
  assert.match(bench, /where q\.active and q\.player_id is null/)
})

void test('the overview line reads names and counts only', () => {
  const s = text(q.waitingBackgroundSql())
  assert.match(s, /where f\.status = 'proposed'/)
  assert.doesNotMatch(s, /f\.text|\.answer\b|\.question\b/)
})

// ── Actions: admin audit in the same transaction ─────────────────────────────

void test('each change runs in one transaction and writes its audit line there; the line never holds the fact text', () => {
  const src = readFileSync(new URL('../press-background.js', import.meta.url), 'utf8')
  for (const fn of [
    'addBackgroundFactWithAudit',
    'decideBackgroundFactWithAudit',
    'editBackgroundFactWithAudit',
  ]) {
    const start = src.indexOf(`export async function ${fn}`)
    assert.ok(start > 0, fn)
    const rest = src.slice(start + 10)
    const next = rest.search(/\nexport |\nasync function |\ninterface |\nconst AUDIT/)
    const body = src.slice(start, next < 0 ? undefined : start + 10 + next)
    assert.match(body, /db\.transaction\(async \(tx\)/, fn)
    assert.match(body, /await writeAudit\(\s*tx,/, fn)
    // The summary strings are built from ids, parts and names only.
    const summaries = [...body.matchAll(/const summary = `([^`]*)`/g)].map((m) => m[1]!)
    assert.ok(summaries.length > 0, fn)
    for (const s of summaries) assert.doesNotMatch(s, /\$\{[^}]*\btext\b[^}]*\}/, `${fn}: ${s}`)
  }
  for (const k of [
    'background_add',
    'background_confirm',
    'background_edit',
    'background_reject',
    'background_delete',
  ]) {
    assert.ok((PRESS_BOX_AUDIT_KINDS as readonly string[]).includes(k), k)
  }
  // An admin-typed fact is confirmed at once by the admin; nothing else inserts a confirmed fact.
  assert.equal([...src.matchAll(/insert into news_background_facts/g)].length, 1)
  assert.match(src, /'confirmed', 'admin', \$\{args\.actor\.name\}/)
})

// ── Schema and migration 0082 ────────────────────────────────────────────────

void test('schema: parts, statuses and the review check match the migration', () => {
  assert.equal(BACKGROUND_PARTS.length, 9)
  for (const p of BACKGROUND_PARTS) assert.ok(BACKGROUND_PART_LABELS[p].length > 3, p)
  const facts = getTableConfig(newsBackgroundFacts)
  assert.equal(facts.name, 'news_background_facts')
  assert.ok(facts.checks.some((c) => c.name === 'news_background_facts_review_check'))
  const qs = getTableConfig(newsBackgroundQuestions)
  assert.ok(qs.indexes.some((i) => i.config.name === 'news_background_questions_generic_uniq'))
})

const SQL_FILE = readFileSync(
  new URL('../../../migrations/0082_player_background.sql', import.meta.url),
  'utf8',
)

void test('migration 0082: idempotent, rollback and deploy order in the header, nothing destructive in the body', () => {
  const [header, body] = SQL_FILE.split('\nBEGIN;') as [string, string]
  assert.match(header, /ROLLBACK/)
  assert.match(header, /DROP TABLE IF EXISTS "news_background_facts"/)
  assert.match(header, /DROP TABLE IF EXISTS "news_background_questions"/)
  assert.match(header, /DEPLOY ORDER/)
  assert.match(body, /CREATE TABLE IF NOT EXISTS "news_background_questions"/)
  assert.match(body, /CREATE TABLE IF NOT EXISTS "news_background_facts"/)
  assert.match(body, /"news_background_facts_review_check"/)
  assert.match(body, /CHECK \("status" <> 'confirmed' OR/)
  assert.match(body, /CREATE UNIQUE INDEX IF NOT EXISTS "news_background_questions_generic_uniq"/)
  assert.equal(
    [...body.matchAll(/ON CONFLICT DO NOTHING/g)].length,
    2,
    'both seed inserts skip repeats',
  )
  assert.doesNotMatch(body, /DROP TABLE|DROP COLUMN|DELETE FROM|TRUNCATE|UPDATE /)
})

/** The seed rows: generic `(part, question, about, order)` and specific `(part, question, player, tag, about, order)`. */
function seedRows() {
  const [, body] = SQL_FILE.split('\nBEGIN;') as [string, string]
  const [genericBlock, specificBlock] = body.split('-- Player-specific questions') as [
    string,
    string,
  ]
  const parse = (block: string): string[][] =>
    [...block.matchAll(/^ {2}\((.*)\),?$/gm)].map((m) => {
      const cells: string[] = []
      const re = /'((?:[^']|'')*)'|(true|false|\d+)/g
      let c: RegExpExecArray | null
      while ((c = re.exec(m[1]!)) !== null)
        cells.push(c[1] !== undefined ? c[1].replace(/''/g, "'") : c[2]!)
      return cells
    })
  return { generic: parse(genericBlock), specific: parse(specificBlock) }
}

void test('seed: questions only, no duplicate, no header fact, only the 9 parts', () => {
  const { generic, specific } = seedRows()
  assert.ok(generic.length >= 90 && generic.length <= 110, `generic ${String(generic.length)}`)
  assert.ok(specific.length >= 200, `specific ${String(specific.length)}`)
  const parts = new Set<string>(BACKGROUND_PARTS)
  const gSeen = new Set<string>()
  for (const [part, question] of generic) {
    assert.ok(parts.has(part!), part)
    assert.ok(!gSeen.has(question!), `duplicate generic question: ${question}`)
    gSeen.add(question!)
  }
  const sSeen = new Set<string>()
  for (const [part, question, player] of specific) {
    assert.ok(parts.has(part!), part)
    const k = `${player!}|${question!}`
    assert.ok(!sSeen.has(k), `duplicate player question: ${k}`)
    sSeen.add(k)
    assert.ok(!gSeen.has(question!), `a player question repeats a generic one: ${question}`)
  }
  const players = new Set(specific.map((r) => r[2]))
  assert.deepEqual(
    [...players].sort((a, b) => Number(a) - Number(b)),
    ['1', '2', '3', '5', '6', '8', '10', '11', '12', '13'],
  )
  const all = [...generic, ...specific].map((r) => r[1]!)
  for (const question of all) {
    assert.ok(question.length > 10 && question.endsWith('?'), question)
    // The person's name, never a pronoun; no backtick-quoted header value (jersey, nickname, team role).
    assert.doesNotMatch(question, /\b(he|his|him|himself|she|her)\b/i, question)
    assert.doesNotMatch(question, /`/, question)
    assert.doesNotMatch(
      question,
      /USA|Canada|Captain|Assistant Captain|Rookie|Goon|Plug|Veteran|Top-six/,
      question,
    )
  }
  // The jersey, nickname and team-role questions are written once, without the value.
  assert.ok(
    all.includes(
      "Does {name}'s jersey number mean anything, or is it just the number {name} landed on?",
    ),
  )
  assert.equal(all.filter((x) => /jersey number|number \{name\} landed/.test(x)).length, 1)
  // About-teammate flags: the "who" questions are flagged; the self questions are not.
  const flag = new Map(generic.map((r) => [r[1]!, r[2]!]))
  assert.equal(flag.get("Which teammate seems to understand {name}'s game immediately?"), 'true')
  assert.equal(flag.get('Does {name} have any visible bench habits?'), 'false')
})

void test('seed: each player-specific insert joins players on the id and the gamertag, so no row lands on the wrong person', () => {
  const [, body] = SQL_FILE.split('\nBEGIN;') as [string, string]
  assert.match(
    body,
    /JOIN "players" p ON p\."id" = v\."player_id" AND lower\(p\."gamertag"\) = lower\(v\."gamertag"\)/,
  )
})
