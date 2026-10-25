// Label tuning evidence for the news desk fact system (Part C2): recomputes
// the team and player labels and the threads over the games of the backfill
// job sheets and prints the share of games (or lines) per label. Read-only;
// no database, no network; prints counts only (no names).
//   node apps/web/scripts/news-tuning.ts .superpowers/backfill-nhl26/jobs
//   node apps/web/scripts/news-tuning.ts <jobs dir> --buzz   (C3a.7: buzz levels;
//     the recomputed labels feed `planBuzz`; no milestones, records or AI
//     goalie labels on these old sheets, so historic shows 0)
// Caveats: the job sheets were built before C1/C2 and hold only the backfill
// nights' games (not the whole title), so each game is compared with the
// earlier games of the job set (the first games of each mode have no
// context); a player's position is the sheet's person position (EA's
// favourite), not the game's; ended-early follows the sheet rule.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  BUZZ_CUTOFFS,
  BUZZ_LEVELS,
  BUZZ_TARGET_SHARE,
  emptyPlayerExtras,
  planBuzz,
  type NewsGameFacts,
  type NewsGoal,
  type NewsPlayerLine,
  type NewsPerson,
} from '@eanhl/db/news'
import { newsPosition } from '../src/lib/news/build-facts.ts'
import { gameContext, teamNotes, type TitleGameInput } from '../src/lib/news/context.ts'
import {
  playerBests,
  playerFirsts,
  playerForm,
  playerNorm,
  playerStreaks,
  type PlayerGameInput,
} from '../src/lib/news/players.ts'
import { buildThreads, type ThreadTeamGame } from '../src/lib/news/threads.ts'

interface JobLine {
  playerId: number
  name: string
  isGoalie: boolean
  goals: number
  assists: number
  shots: number | null
  hits: number | null
}
interface JobGame {
  matchId: number
  night: string
  playedAt: string
  gameMode: '3s' | '6s' | null
  result: 'WIN' | 'LOSS' | 'OTL'
  scoreFor: number
  scoreAgainst: number
  opponentName: string
  team: {
    shotsFor: number
    shotsAgainst: number
    timeOnAttackSeconds: number | null
    ppGoals: number | null
    ppOpportunities: number | null
  } | null
  players: JobLine[]
  unnamedGoals?: number
  overtime?: boolean
  goals?: NewsGoal[] | null
  clockMeaning?: 'elapsed' | 'remaining' | null
}
interface JobPerson {
  playerId: number
  name: string
  position?: string | null
  pressLevel: 'full' | 'easy'
}

const TITLE = 1

function load(dir: string): { games: JobGame[]; people: Map<number, JobPerson> } {
  const byId = new Map<number, JobGame>()
  const people = new Map<number, JobPerson>()
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const job = JSON.parse(readFileSync(join(dir, f), 'utf8')) as {
      sheet: { facts: { games: JobGame[]; people: JobPerson[] } }
    }
    for (const g of job.sheet.facts.games) byId.set(g.matchId, g)
    for (const p of job.sheet.facts.people) people.set(p.playerId, p)
  }
  const games = [...byId.values()].sort(
    (a, b) => a.playedAt.localeCompare(b.playedAt) || a.matchId - b.matchId,
  )
  return { games, people }
}

function endedEarly(g: JobGame): boolean {
  if (g.team === null) return true
  const credited = g.players.reduce((n, p) => n + p.goals, 0) + (g.unnamedGoals ?? 0)
  return (
    g.scoreFor > credited ||
    (g.team.timeOnAttackSeconds !== null && g.team.timeOnAttackSeconds < 240) ||
    g.team.shotsFor + g.team.shotsAgainst < 10
  )
}

type Counts = Map<string, number>
const bump = (m: Counts, k: string, by = 1) => m.set(k, (m.get(k) ?? 0) + by)
function share(counts: Counts, total: number): string {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k} ${String(n)} (${((n / total) * 100).toFixed(1)}%)`)
    .join(', ')
}

function main(dir: string): void {
  const { games, people } = load(dir)
  const early = new Map(games.map((g) => [g.matchId, endedEarly(g)]))
  const inputs: TitleGameInput[] = games.map((g) => ({
    matchId: g.matchId,
    night: g.night,
    gameMode: g.gameMode,
    result: g.result,
    scoreFor: g.scoreFor,
    scoreAgainst: g.scoreAgainst,
    opponentName: g.opponentName,
    endedEarly: early.get(g.matchId)!,
  }))

  // ── Team context ──
  const result: Counts = new Map()
  const margin: Counts = new Map()
  const surprise: Counts = new Map()
  const notes: Counts = new Map()
  let warm = 0
  inputs.forEach((g, i) => {
    const prior = inputs.slice(0, i)
    const next = inputs[i + 1]
    const c = gameContext(g, prior, next === undefined || next.night !== g.night)
    bump(result, c.result)
    if (prior.filter((p) => p.gameMode === g.gameMode).length >= 10) {
      warm += 1
      bump(margin, c.margin)
      bump(surprise, c.surprise)
    }
    for (const n of [...c.night, ...teamNotes(g, prior)])
      bump(notes, n.replace(/\d+(st|nd|rd|th)?/g, 'N'))
  })
  console.log(
    `games: ${String(inputs.length)} (with 10+ earlier games of the mode: ${String(warm)})`,
  )
  console.log(`result:   ${share(result, inputs.length)}`)
  console.log(`margin:   ${share(margin, warm)}`)
  console.log(`surprise: ${share(surprise, warm)}`)
  console.log(`notes (per game): ${share(notes, inputs.length)}`)

  // ── Player facts ──
  const history = new Map<number, PlayerGameInput[]>()
  const labels: Record<string, Counts> = {}
  const bests: Counts = new Map()
  const firsts: Counts = new Map()
  const forms: Counts = new Map()
  const streaks: Counts = new Map()
  let lines = 0
  let withNorm = 0
  for (const g of games) {
    for (const jl of g.players) {
      const person = people.get(jl.playerId)
      const position = newsPosition(person?.position ?? null, jl.isGoalie)
      const line: NewsPlayerLine = {
        playerId: jl.playerId,
        name: jl.name,
        position,
        isGoalie: jl.isGoalie,
        goals: jl.goals,
        assists: jl.assists,
        points: jl.goals + jl.assists,
        shots: early.get(g.matchId) ? null : jl.shots,
        hits: early.get(g.matchId) ? null : jl.hits,
        pim: 0,
        saves: null,
        goalsAgainst: null,
        savePct: null,
        star: null,
        ...emptyPlayerExtras(),
      }
      const prior = history.get(jl.playerId) ?? []
      const game = { gameMode: g.gameMode, endedEarly: early.get(g.matchId)! }
      lines += 1
      const norm = playerNorm(line, game, TITLE, prior)
      if (norm !== null) {
        withNorm += 1
        for (const [k, v] of Object.entries(norm.labels)) bump((labels[k] ??= new Map()), v)
      }
      for (const b of playerBests(line, game, TITLE, prior)) bump(bests, b)
      for (const f of playerFirsts(line, TITLE, prior)) bump(firsts, f)
      const form = playerForm(line, norm, game, TITLE, prior)
      bump(forms, form ?? 'none')
      for (const s of playerStreaks(line, TITLE, prior)) {
        bump(streaks, `${s.kind} ${s.status}${s.games >= 5 ? ' (5+)' : ''}`)
      }
      prior.push({
        matchId: g.matchId,
        gameTitleId: TITLE,
        night: g.night,
        playedAt: g.playedAt,
        gameMode: g.gameMode,
        result: g.result,
        goals: jl.goals,
        assists: jl.assists,
        shots: jl.shots ?? 0,
        hits: jl.hits ?? 0,
        position,
        endedEarly: early.get(g.matchId)!,
      })
      history.set(jl.playerId, prior)
    }
  }
  console.log(`player lines: ${String(lines)} (with a norm: ${String(withNorm)})`)
  for (const [k, c] of Object.entries(labels)) console.log(`  ${k}: ${share(c, withNorm)}`)
  console.log(`  form: ${share(forms, lines)}`)
  console.log(`  bests (per line): ${share(bests, lines)}`)
  console.log(`  firsts (per line): ${share(firsts, lines)}`)
  console.log(`  streaks (per line): ${share(streaks, lines)}`)

  // ── Threads per night sheet ──
  const nights = [...new Set(games.map((g) => g.night))]
  const threadKinds: Counts = new Map()
  const openKeys = new Set<string>()
  let nightsWithOpen = 0
  const asThread = (g: JobGame): ThreadTeamGame => ({
    matchId: g.matchId,
    night: g.night,
    result: g.result,
    opponentName: g.opponentName.replace(/\s+/g, ' ').trim(),
    ppGoals: g.team?.ppGoals ?? null,
    ppOpportunities: g.team?.ppOpportunities ?? null,
    endedEarly: early.get(g.matchId)!,
  })
  for (const night of nights) {
    const sheet = games.filter((g) => g.night === night)
    const before = games.filter((g) => g.night < night)
    const sheetIds = new Set(sheet.map((g) => g.matchId))
    const named: NewsPerson[] = [
      ...new Set(sheet.flatMap((g) => g.players.map((p) => p.playerId))),
    ].map((id) => ({ playerId: id, name: people.get(id)?.name ?? '', pressLevel: 'full' }))
    const hist = new Map(
      [...history.entries()].map(([id, rows]) => [id, rows.filter((r) => r.night <= night)]),
    )
    const threads = buildThreads({
      prior: before.map(asThread),
      sheet: sheet.map(asThread),
      people: named,
      history: hist,
      gameTitleId: TITLE,
    })
    if (threads.some((t) => t.status === 'open')) nightsWithOpen += 1
    for (const t of threads) {
      bump(threadKinds, `${t.kind} ${t.status}`)
      if (t.status === 'open') openKeys.add(t.key)
    }
    void sheetIds
  }
  console.log(
    `threads over ${String(nights.length)} night sheets (nights with an open thread: ${String(nightsWithOpen)}; distinct open threads: ${String(openKeys.size)})`,
  )
  console.log(`  ${share(threadKinds, nights.length)} (share = per night sheet)`)
}

/** Buzz levels over the job games (C3a.7), and score quantiles for the target shares. */
function buzz(dir: string): void {
  const { games, people } = load(dir)
  const early = new Map(games.map((g) => [g.matchId, endedEarly(g)]))
  const inputs: TitleGameInput[] = games.map((g) => ({
    matchId: g.matchId,
    night: g.night,
    gameMode: g.gameMode,
    result: g.result,
    scoreFor: g.scoreFor,
    scoreAgainst: g.scoreAgainst,
    opponentName: g.opponentName,
    endedEarly: early.get(g.matchId)!,
  }))
  const history = new Map<number, PlayerGameInput[]>()
  const levels: Counts = new Map()
  const reasons: Counts = new Map()
  const scores: number[] = []
  let posts = 0
  let articles = 0
  games.forEach((g, i) => {
    const prior = inputs.slice(0, i)
    const next = inputs[i + 1]
    const input = inputs[i]!
    const context = gameContext(input, prior, next === undefined || next.night !== g.night)
    const lines: NewsPlayerLine[] = g.players.map((jl) => {
      const position = newsPosition(people.get(jl.playerId)?.position ?? null, jl.isGoalie)
      const line: NewsPlayerLine = {
        playerId: jl.playerId,
        name: jl.name,
        position,
        isGoalie: jl.isGoalie,
        goals: jl.goals,
        assists: jl.assists,
        points: jl.goals + jl.assists,
        shots: early.get(g.matchId) ? null : jl.shots,
        hits: early.get(g.matchId) ? null : jl.hits,
        pim: 0,
        saves: null,
        goalsAgainst: null,
        savePct: null,
        star: null,
        ...emptyPlayerExtras(),
      }
      const before = history.get(jl.playerId) ?? []
      const gameInfo = { gameMode: g.gameMode, endedEarly: early.get(g.matchId)! }
      const norm = playerNorm(line, gameInfo, TITLE, before)
      const full: NewsPlayerLine = {
        ...line,
        norm,
        bests: playerBests(line, gameInfo, TITLE, before),
        firsts: playerFirsts(line, TITLE, before),
        form: playerForm(line, norm, gameInfo, TITLE, before),
        streaks: playerStreaks(line, TITLE, before),
      }
      before.push({
        matchId: g.matchId,
        gameTitleId: TITLE,
        night: g.night,
        playedAt: g.playedAt,
        gameMode: g.gameMode,
        result: g.result,
        goals: jl.goals,
        assists: jl.assists,
        shots: jl.shots ?? 0,
        hits: jl.hits ?? 0,
        position,
        endedEarly: early.get(g.matchId)!,
      })
      history.set(jl.playerId, before)
      return full
    })
    const facts: NewsGameFacts = {
      matchId: g.matchId,
      night: g.night,
      playedAt: g.playedAt,
      gameTitleName: 'NHL 26',
      gameMode: g.gameMode,
      result: g.result,
      overtime: g.overtime === true,
      scoreFor: g.scoreFor,
      scoreAgainst: g.scoreAgainst,
      opponentName: g.opponentName,
      team: null,
      endedEarly: early.get(g.matchId)!,
      labels: null,
      patterns: [],
      periods: null,
      players: lines,
      aiGoalieInNet: false,
      aiGoalie: null,
      guestCount: 0,
      context,
      teamNotes: teamNotes(input, prior),
      headToHead: null,
      newRecords: [],
      chemistry: [],
      unnamedTeammates: 0,
      unnamedGoals: 0,
      unnamedAssists: 0,
      goals: g.goals ?? null,
      clockMeaning: g.clockMeaning ?? null,
    }
    const plan = planBuzz(facts, { milestones: [], threads: [] })
    bump(levels, plan.level)
    for (const r of new Set(plan.reasons.map((x) => x.replace(/^(player|note) .*/, '$1'))))
      bump(reasons, r)
    scores.push(plan.score)
    posts += plan.posts
    articles += plan.articles.length
  })
  const n = games.length
  console.log(
    `buzz over ${String(n)} games (cut-offs normal ${String(BUZZ_CUTOFFS.normal)}, big ${String(BUZZ_CUTOFFS.big)}, huge ${String(BUZZ_CUTOFFS.huge)}):`,
  )
  for (const level of BUZZ_LEVELS) {
    const k = levels.get(level) ?? 0
    console.log(
      `  ${level.padEnd(8)} ${String(k).padStart(3)}  ${((k / n) * 100).toFixed(1).padStart(5)}%  (target ${(BUZZ_TARGET_SHARE[level] * 100).toFixed(0)}%)`,
    )
  }
  console.log(
    `  posts per game ${(posts / n).toFixed(2)}; game articles per game ${(articles / n).toFixed(2)}`,
  )
  console.log(`  reasons (share of games): ${share(reasons, n)}`)
  const sorted = [...scores].sort((a, b) => a - b)
  const q = (share: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))]
  console.log(
    `  score quantiles for the targets: normal from ~${String(q(0.5))}, big from ~${String(q(0.8))}, huge from ~${String(q(0.95))}`,
  )
}

if (process.argv.includes('--buzz')) buzz(process.argv[2] ?? '.superpowers/backfill-nhl26/jobs')
else main(process.argv[2] ?? '.superpowers/backfill-nhl26/jobs')
