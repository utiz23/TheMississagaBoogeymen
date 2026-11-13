/**
 * One-off: propose club-only badge ladders and simulate the season pace
 * (plan docs/superpowers/plans/2026-10-26-club-only-badges.md, Task 3; spec
 * docs/superpowers/specs/2026-10-26-club-only-badges-design.md). Read-only.
 *
 * node apps/worker/dist/__scripts__/card-ladder-sizing-2026-10.js [--season-games 300] [--ceiling-scale 1] [--ceiling <family>=<n> ...]
 *
 * Projection: each value × (season games / club games so far). Ceiling = the
 * best regular's projected value (goalie families: the best human), times the
 * scale, as a nice number of at least 30. Level L aims at ceiling × (L/30)².
 * Pace: values grow linearly over 48 weeks; prints the week each tier is reached.
 */
import { sql as dbSql, db } from '@eanhl/db'
import { sql } from 'drizzle-orm'
import {
  AI_GOALIE_LADDERS,
  BADGE_FAMILIES,
  BADGE_LADDERS,
  computeStanding,
  type BadgeFamilyId,
  type BadgeValues,
  type LadderSet,
} from '@eanhl/db/cards'
import { loadCardTitles, loadSeasonTotals } from '@eanhl/db/queries'

const WEEKS = 48
const LEVELS = 30
const AI_SIZED: readonly BadgeFamilyId[] = ['gg', 'gw', 'gsv', 'gso']

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(name)
  return i >= 0 ? Number(process.argv[i + 1]) : fallback
}

function overrides(): Map<BadgeFamilyId, number> {
  const out = new Map<BadgeFamilyId, number>()
  process.argv.forEach((a, i) => {
    if (a !== '--ceiling') return
    const [id, n] = (process.argv[i + 1] ?? '').split('=')
    out.set(id as BadgeFamilyId, Number(n))
  })
  return out
}

/** Step a threshold must be a multiple of (the spec's nice-number rules). */
function stepFor(t: number): number {
  return t < 100 ? 5 : t < 1000 ? 10 : 50
}

/** Largest value that may be a plain count for this ceiling (0 = none). */
function plainLimit(top: number): number {
  if (top >= 450) return 0
  return top <= 50 ? 30 : 12
}

function isNice(t: number, top: number): boolean {
  return t === top || t % stepFor(t) === 0 || (t <= plainLimit(top) && t >= 1)
}

/** Nice values below `top`, ascending. */
function niceBelow(top: number): number[] {
  const out: number[] = []
  for (let t = 1; t < top; t++) if (isNice(t, top)) out.push(t)
  return out
}

/**
 * A nice ceiling of at least 30 with room for 29 nice levels below it. Ceilings
 * from 51 to 99 have too few (plain counts stop at 12 there), so they round to
 * 50 or 100.
 */
function niceCeiling(x: number): number {
  let v = Math.max(LEVELS, x)
  if (v > 50 && v < 100) v = v < 75 ? 50 : 100
  const step = stepFor(v)
  let top = v <= 50 ? Math.round(v) : Math.round(v / step) * step
  while (niceBelow(top).length < LEVELS - 1) top += stepFor(top)
  return top
}

/** 30 strictly increasing nice thresholds ending at `top`. */
export function fitLadder(top: number): number[] {
  const nice = niceBelow(top)
  const ladder: number[] = []
  let from = 0
  for (let level = 1; level < LEVELS; level++) {
    const target = top * (level / LEVELS) ** 2
    // Leave one nice value for each remaining level below the top.
    const last = nice.length - (LEVELS - 1 - level) - 1
    let pick = from
    for (let i = from; i <= last; i++) {
      if (Math.abs((nice[i] ?? 0) - target) < Math.abs((nice[pick] ?? 0) - target)) pick = i
      if ((nice[i] ?? 0) > target) break
    }
    ladder.push(nice[pick] ?? 0)
    from = pick + 1
  }
  ladder.push(top)
  return ladder
}

function tierWeeks(values: BadgeValues, ladders: LadderSet): (number | null)[] {
  const weeks: (number | null)[] = [null, null, null, null]
  for (let w = 1; w <= WEEKS; w++) {
    const v = Object.fromEntries(
      Object.entries(values).map(([k, n]) => [k, ((n as number) * w) / WEEKS]),
    ) as BadgeValues
    const tier = computeStanding(v, ladders).tier
    for (let t = 2; t <= 5; t++) if (tier >= t && weeks[t - 2] === null) weeks[t - 2] = w
  }
  return weeks
}

async function main(): Promise<void> {
  const seasonGames = arg('--season-games', 300)
  const scale = arg('--ceiling-scale', 1)
  const fixed = overrides()
  const title = (await loadCardTitles()).find((t) => t.slug === 'nhl27')
  if (title === undefined) throw new Error('no nhl27 card title')
  const totals: Map<number, BadgeValues> =
    (await loadSeasonTotals([title.id])).get(title.id) ?? new Map()
  const people = (await db.execute(sql`
    SELECT p.id, p.gamertag, p.ai_goalie_side IS NOT NULL AS ai,
      (SELECT count(DISTINCT s.match_id)::int FROM player_match_stats s
        JOIN matches m ON m.id = s.match_id
        WHERE s.player_id = p.id AND m.game_title_id = ${title.id}) AS games
    FROM players p`)) as unknown as { id: number; gamertag: string; ai: boolean; games: number }[]
  const [{ n: clubGames } = { n: 0 }] = (await db.execute(
    sql`SELECT count(*)::int AS n FROM matches WHERE game_title_id = ${title.id}`,
  )) as unknown as { n: number }[]
  const factor = seasonGames / clubGames
  const who = new Map(people.map((p) => [p.id, p]))

  const projected = [...totals.entries()].map(([id, v]) => ({
    ...(who.get(id) ?? { id, gamertag: `#${String(id)}`, ai: false, games: 0 }),
    values: Object.fromEntries(Object.entries(v).map(([k, n]) => [k, n * factor])) as BadgeValues,
  }))
  const regulars = projected.filter((p) => !p.ai && p.games >= clubGames / 2)
  const humans = projected.filter((p) => !p.ai)
  const ais = projected.filter((p) => p.ai)

  const ceilingFrom = (pool: typeof projected, id: BadgeFamilyId) =>
    fixed.get(id) ?? niceCeiling(Math.max(0, ...pool.map((p) => p.values[id])) * scale)

  const ladders = Object.fromEntries(
    BADGE_FAMILIES.map((f) => [
      f.id,
      fitLadder(ceilingFrom(f.group === 'goalie' ? humans : regulars, f.id)),
    ]),
  ) as Record<BadgeFamilyId, number[]>
  const aiLadders = {
    ...ladders,
    ...Object.fromEntries(AI_SIZED.map((id) => [id, fitLadder(ceilingFrom(ais, id))])),
  } as Record<BadgeFamilyId, number[]>

  console.log(
    `NHL 27 club games so far: ${String(clubGames)}; season: ${String(seasonGames)}; factor ${factor.toFixed(2)}; ceiling scale ${String(scale)}`,
  )
  console.log(
    '\n| Badge | Old L30 | New L30 | Levels 1–10 | Level 20 |\n| --- | ---: | ---: | --- | ---: |',
  )
  for (const f of BADGE_FAMILIES) {
    const l = ladders[f.id]
    console.log(
      `| ${f.name} | ${String(BADGE_LADDERS[f.id][29])} | ${String(l[29])} | ${l.slice(0, 10).join(' ')} | ${String(l[19])} |`,
    )
  }
  console.log(
    '\nAI goalies:\n| Badge | Old L30 | New L30 | Levels 1–10 | Level 20 |\n| --- | ---: | ---: | --- | ---: |',
  )
  for (const id of AI_SIZED) {
    const l = aiLadders[id]
    console.log(
      `| ${id} | ${String(AI_GOALIE_LADDERS[id][29])} | ${String(l[29])} | ${l.slice(0, 10).join(' ')} | ${String(l[19])} |`,
    )
  }

  console.log(
    '\n| Player | Club games so far | Projected games | T2 | T3 | T4 | T5 |\n| --- | ---: | ---: | --: | --: | --: | --: |',
  )
  for (const p of projected.filter((x) => x.games >= 10).sort((a, b) => b.games - a.games)) {
    const w = tierWeeks(p.values, p.ai ? aiLadders : ladders)
    console.log(
      `| ${p.gamertag}${p.ai ? ' (AI)' : ''} | ${String(p.games)} | ${String(Math.round(p.games * factor))} | ${w.map((x) => (x === null ? '–' : String(x))).join(' | ')} |`,
    )
  }
  console.log(
    '\nJSON',
    JSON.stringify({ ladders, ai: Object.fromEntries(AI_SIZED.map((id) => [id, aiLadders[id]])) }),
  )
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    process.stderr.write(
      `card-ladder-sizing: ${err instanceof Error ? err.message : String(err)}\n`,
    )
    process.exit(1)
  })
  .finally(() => {
    void dbSql.end()
  })
