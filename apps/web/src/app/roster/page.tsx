import type { Metadata } from 'next'
import {
  listGameTitles,
  getGameTitleBySlug,
  getEARoster,
  getRoster,
  getPlayerPositionEligibility,
} from '@eanhl/db/queries'
import { DepthChart } from '@/components/roster/depth-chart'
import type { DepthChartProps } from '@/components/roster/depth-chart'

export const metadata: Metadata = { title: 'Roster — Club Stats' }

export const revalidate = 3600

type SearchParams = Promise<Record<string, string | string[] | undefined>>

type RosterRow = Awaited<ReturnType<typeof getEARoster>>[number]
type EligRow = Awaited<ReturnType<typeof getPlayerPositionEligibility>>[number]

// ─── Game title resolution ────────────────────────────────────────────────────

async function resolveGameTitle(titleSlug: string | undefined) {
  try {
    if (titleSlug) {
      const found = await getGameTitleBySlug(titleSlug)
      if (found) return found
    }
    const all = await listGameTitles()
    return all[0] ?? null
  } catch {
    return null
  }
}

// ─── Position usage map ───────────────────────────────────────────────────────

// playerId → (rawPositionKey → gameCount)
function buildPositionUsage(
  eligRows: EligRow[],
  rosterRows: RosterRow[],
): Map<number, Map<string, number>> {
  const usage = new Map<number, Map<string, number>>()

  for (const row of eligRows) {
    if (!row.position) continue
    let m = usage.get(row.playerId)
    if (!m) {
      m = new Map()
      usage.set(row.playerId, m)
    }
    m.set(row.position, row.gameCount)
  }

  // Fallback: member-only players with no tracked match history
  // Assign virtual gameCount=1 at their declared players.position so they appear on the board
  for (const player of rosterRows) {
    if (!usage.has(player.playerId) && player.position) {
      usage.set(player.playerId, new Map([[player.position, 1]]))
    }
  }

  return usage
}

// ─── Sort comparators ─────────────────────────────────────────────────────────

const ALL_POSITIONS = ['leftWing', 'center', 'rightWing', 'defenseMen', 'goalie'] as const
type AnyPos = (typeof ALL_POSITIONS)[number]

const FORWARD_POSITIONS = ['leftWing', 'center', 'rightWing'] as const
type ForwardPos = (typeof FORWARD_POSITIONS)[number]

function byPositionUsage(
  pos: string,
  usage: Map<number, Map<string, number>>,
): (a: RosterRow, b: RosterRow) => number {
  return (a, b) => {
    const aC = usage.get(a.playerId)?.get(pos) ?? 0
    const bC = usage.get(b.playerId)?.get(pos) ?? 0
    if (bC !== aC) return bC - aC
    if (b.points !== a.points) return b.points - a.points
    if (b.gamesPlayed !== a.gamesPlayed) return b.gamesPlayed - a.gamesPlayed
    return a.gamertag.localeCompare(b.gamertag)
  }
}

function byGoalieUsage(
  usage: Map<number, Map<string, number>>,
): (a: RosterRow, b: RosterRow) => number {
  return (a, b) => {
    const aC = usage.get(a.playerId)?.get('goalie') ?? 0
    const bC = usage.get(b.playerId)?.get('goalie') ?? 0
    if (bC !== aC) return bC - aC
    if ((b.wins ?? 0) !== (a.wins ?? 0)) return (b.wins ?? 0) - (a.wins ?? 0)
    const svA = a.savePct !== null ? parseFloat(a.savePct) : 0
    const svB = b.savePct !== null ? parseFloat(b.savePct) : 0
    if (svB !== svA) return svB - svA
    const gaaA = a.gaa !== null ? parseFloat(a.gaa) : 999
    const gaaB = b.gaa !== null ? parseFloat(b.gaa) : 999
    return gaaA - gaaB
  }
}

// ─── Strongest position (all 5) ───────────────────────────────────────────────

function strongestOverallPos(
  playerId: number,
  usage: Map<number, Map<string, number>>,
): AnyPos | null {
  const m = usage.get(playerId)
  if (!m) return null
  let best: AnyPos | null = null
  let bestCount = 0
  for (const pos of ALL_POSITIONS) {
    const count = m.get(pos) ?? 0
    if (count > bestCount) {
      bestCount = count
      best = pos
    }
  }
  return best
}

// ─── Chart builder ────────────────────────────────────────────────────────────

function buildChart(
  rosterRows: RosterRow[],
  usage: Map<number, Map<string, number>>,
): DepthChartProps {
  // ── Pass 1: global unique placement across all 5 positions ────────────────

  const fwdPass1: Record<ForwardPos, RosterRow[]> = { leftWing: [], center: [], rightWing: [] }
  const defPass1: RosterRow[] = []
  const goaliePass1: RosterRow[] = []
  const pass1Assigned = new Set<number>()

  for (const pos of ALL_POSITIONS) {
    const comparator = pos === 'goalie' ? byGoalieUsage(usage) : byPositionUsage(pos, usage)
    const candidates = rosterRows
      .filter((p) => strongestOverallPos(p.playerId, usage) === pos)
      .sort(comparator)

    for (const player of candidates) {
      if (pass1Assigned.has(player.playerId)) continue
      if (pos === 'leftWing' || pos === 'center' || pos === 'rightWing') {
        fwdPass1[pos].push(player)
      } else if (pos === 'defenseMen') {
        defPass1.push(player)
      } else {
        goaliePass1.push(player)
      }
      pass1Assigned.add(player.playerId)
    }
  }

  // ── Pass 2: fill remaining forward slots with reused players ──────────────

  const fwdSlots: Record<ForwardPos, (RosterRow | null)[]> = {
    leftWing: [...fwdPass1.leftWing],
    center: [...fwdPass1.center],
    rightWing: [...fwdPass1.rightWing],
  }

  for (const pos of FORWARD_POSITIONS) {
    if (fwdSlots[pos].length > 4) fwdSlots[pos] = fwdSlots[pos].slice(0, 4)

    const alreadyInColumn = new Set(
      (fwdSlots[pos].filter(Boolean) as RosterRow[]).map((p) => p.playerId),
    )

    if (fwdSlots[pos].length < 4) {
      const reusable = rosterRows
        .filter((p) => (usage.get(p.playerId)?.get(pos) ?? 0) > 0)
        .sort(byPositionUsage(pos, usage))

      for (const player of reusable) {
        if (fwdSlots[pos].length >= 4) break
        if (alreadyInColumn.has(player.playerId)) continue
        fwdSlots[pos].push(player)
        alreadyInColumn.add(player.playerId)
      }
    }

    while (fwdSlots[pos].length < 4) fwdSlots[pos].push(null)
  }

  const forwards = Array.from({ length: 4 }, (_, i) => ({
    lw: fwdSlots.leftWing[i] ?? null,
    c: fwdSlots.center[i] ?? null,
    rw: fwdSlots.rightWing[i] ?? null,
  }))

  // ── Pass 2: fill remaining defense slots with reused players ──────────────

  const defSlots: (RosterRow | null)[] = defPass1.slice(0, 6)
  const alreadyInDef = new Set((defSlots.filter(Boolean) as RosterRow[]).map((p) => p.playerId))

  if (defSlots.length < 6) {
    const reusable = rosterRows
      .filter((p) => (usage.get(p.playerId)?.get('defenseMen') ?? 0) > 0)
      .sort(byPositionUsage('defenseMen', usage))

    for (const player of reusable) {
      if (defSlots.length >= 6) break
      if (alreadyInDef.has(player.playerId)) continue
      defSlots.push(player)
      alreadyInDef.add(player.playerId)
    }
  }

  while (defSlots.length < 6) defSlots.push(null)

  const defense = Array.from({ length: 3 }, (_, i) => ({
    ld: defSlots[i * 2] ?? null,
    rd: defSlots[i * 2 + 1] ?? null,
  }))

  // ── Pass 2: fill remaining goalie slots with reused players ───────────────

  const goalieSlots: (RosterRow | null)[] = goaliePass1.slice(0, 5)
  const alreadyInGoalie = new Set(
    (goalieSlots.filter(Boolean) as RosterRow[]).map((p) => p.playerId),
  )

  if (goalieSlots.length < 5) {
    const reusable = rosterRows
      .filter((p) => (usage.get(p.playerId)?.get('goalie') ?? 0) > 0)
      .sort(byGoalieUsage(usage))

    for (const player of reusable) {
      if (goalieSlots.length >= 5) break
      if (alreadyInGoalie.has(player.playerId)) continue
      goalieSlots.push(player)
      alreadyInGoalie.add(player.playerId)
    }
  }

  while (goalieSlots.length < 5) goalieSlots.push(null)

  return { forwards, defense, goalies: goalieSlots }
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function RosterPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams
  const titleSlug = typeof params.title === 'string' ? params.title : undefined
  const gameTitle = await resolveGameTitle(titleSlug)

  if (!gameTitle) {
    return <EmptyState message="No game titles are configured yet." />
  }

  let rosterRows: RosterRow[] = []
  let eligibilityRows: EligRow[] = []

  try {
    const [eaRows, localRows, eligRows] = await Promise.all([
      getEARoster(gameTitle.id),
      getRoster(gameTitle.id),
      getPlayerPositionEligibility(gameTitle.id),
    ])
    // Supplement EA rows with players who have local tracked data but no EA season stats
    const eaIds = new Set(eaRows.map((r) => r.playerId))
    rosterRows = [...eaRows, ...(localRows.filter((r) => !eaIds.has(r.playerId)) as RosterRow[])]
    eligibilityRows = eligRows
  } catch {
    return <EmptyState message="Unable to load roster data right now." />
  }

  if (rosterRows.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader gameTitle={gameTitle} />
        <EmptyState message={`No player stats recorded for ${gameTitle.name} yet.`} />
      </div>
    )
  }

  const usage = buildPositionUsage(eligibilityRows, rosterRows)
  const chart = buildChart(rosterRows, usage)

  return (
    <div className="space-y-6">
      <PageHeader gameTitle={gameTitle} />
      <DepthChart {...chart} />
    </div>
  )
}

// ─── Page header ──────────────────────────────────────────────────────────────

function PageHeader({ gameTitle }: { gameTitle: { name: string } }) {
  return (
    <div className="flex items-baseline gap-3">
      <h1 className="font-condensed text-2xl font-semibold uppercase tracking-wide text-zinc-50">
        Roster
      </h1>
      <span className="text-sm text-zinc-500">{gameTitle.name}</span>
      <span className="text-xs text-zinc-600">EA season totals</span>
    </div>
  )
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex min-h-[12rem] items-center justify-center border border-zinc-800 bg-surface">
      <p className="text-sm text-zinc-500">{message}</p>
    </div>
  )
}
