import type { Metadata } from 'next'
import type { CSSProperties } from 'react'
import { notFound } from 'next/navigation'
import {
  getMatchById,
  getPlayerMatchStats,
  getOpponentPlayerMatchStats,
  getOpponentClub,
  getMatchSeasonNumber,
  getMatchSeriesContext,
  getAdjacentMatches,
  getMatchPeriodSummaries,
  getMatchEvents,
  getMatchActionTrackerProvenance,
  getMatchLineups,
  getMatchLineupProvenance,
  getMatchFaceoffDots,
  getMatchFaceoffZoneSummaries,
  getSeasonPlayerMatchStats,
} from '@eanhl/db/queries'
import type { Match } from '@eanhl/db'
import { HeroCard } from '@/components/matches/hero-card'
import { GameTopBar } from '@/components/matches/game-top-bar'
import {
  GAME_SHEET_PANEL_ID,
  GameSheetModeProvider,
  GameSheetModeTabs,
  type GameSheetMode,
} from '@/components/matches/game-sheet-mode'
import { TopPerformers } from '@/components/matches/top-performers'
import { DtwGauge } from '@/components/matches/dtw-gauge'
import { TeamStats } from '@/components/matches/team-stats'
import { ContextFooter } from '@/components/matches/context-footer'
import { BoxScore } from '@/components/matches/box-score'
import { EventTimeline } from '@/components/matches/event-timeline'
import { ActionTrackerMap } from '@/components/matches/action-tracker-map'
import { LineupModule } from '@/components/matches/lineup/lineup-module'
import { LineupModuleFooter } from '@/components/matches/lineup/lineup-footer'
import { Panel } from '@/components/ui/panel'
import {
  buildAllTeamScores,
  applyLoadoutOverrides,
  buildBoxScore,
  buildLineupFromStats,
  buildPossessionEdge,
  buildTopPerformers,
  computeSeasonAvgs,
  attachSeasonAvgs,
  wentToOvertime,
} from '@/lib/match-recap'
import { resolveOpponentColors } from '@/lib/opponent-colors'
import { abbreviateTeamName } from '@/lib/format'

// Match data never changes once written — cache indefinitely
export const revalidate = false

interface Props {
  params: Promise<{ id: string }>
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id: idStr } = await params
  const id = parseInt(idStr, 10)
  if (isNaN(id)) return { title: 'Game Not Found — Club Stats' }
  try {
    const match = await getMatchById(id)
    if (!match) return { title: 'Game Not Found — Club Stats' }
    return { title: `vs ${match.opponentName} — Club Stats` }
  } catch {
    return { title: 'Game — Club Stats' }
  }
}

export default async function GameDetailPage({ params, searchParams }: Props) {
  const { id: idStr } = await params
  const queryParams = searchParams ? await searchParams : {}
  const id = parseInt(idStr, 10)
  if (isNaN(id)) notFound()

  let match: Match | null = null
  try {
    match = await getMatchById(id)
  } catch {
    return <ErrorState message="Unable to load match data right now." />
  }
  if (!match) notFound()

  // Capture into a const so TS narrowing carries through the closures below.
  const m = match
  // Fetch all secondary data in parallel; each can fail independently and the
  // section that needs it will simply hide. The hero + main page still render.
  const [
    playerStats,
    opponentPlayerStats,
    opponentClub,
    seasonNumber,
    seriesContext,
    adjacent,
    periodSummaries,
    matchEventRows,
    actionTrackerProvenance,
    lineups,
    lineupProvenance,
    faceoffDots,
    faceoffZones,
  ] = await Promise.all([
    safe(() => getPlayerMatchStats(m.id), []),
    safe(() => getOpponentPlayerMatchStats(m.id), []),
    safe(() => getOpponentClub(m.opponentClubId), null),
    safe(() => getMatchSeasonNumber(m.gameTitleId, m.playedAt), null),
    safe(() => getMatchSeriesContext(m.gameTitleId, m.opponentClubId, m.playedAt), null),
    safe(() => getAdjacentMatches(m.gameTitleId, m.playedAt), {
      previous: null,
      next: null,
    }),
    safe(() => getMatchPeriodSummaries(m.id), []),
    safe(() => getMatchEvents(m.id), []),
    safe(() => getMatchActionTrackerProvenance(m.id), { extractedAt: null, sources: [] }),
    safe(() => getMatchLineups(m.id), { bgm: [], opponent: [] }),
    safe(() => getMatchLineupProvenance(m.id), {
      capturedAt: null,
      sources: [],
      confidence: { canonical: 0, tiered: 0, attribute: 0 },
    }),
    safe(() => getMatchFaceoffDots(m.id), []),
    safe(() => getMatchFaceoffZoneSummaries(m.id), []),
  ])

  const opponentCrestAssetId = opponentClub?.crestAssetId ?? null
  const opponentCrestUseBaseAsset = opponentClub?.useBaseAsset ?? null
  const opponentPrimaryColor = opponentClub?.primaryColor ?? null

  // Opponent colour — resolved once server-side through the clash ladder
  // (BGM red is reserved; a raw brand hex never reaches a surface). Published
  // as the `--opp*` custom properties on the page root; see globals.css.
  const opponentColors = resolveOpponentColors({
    abbrev: abbreviateTeamName(m.opponentName),
    brandHex: m.oppColorHex ?? opponentClub?.primaryColor ?? null,
  })
  const opponentColorVars = {
    '--opp': opponentColors.base,
    '--opp-2': opponentColors.strong,
    '--opp-line': opponentColors.line,
    '--opp-soft': opponentColors.soft,
  } as CSSProperties

  // Season-to-date player history for the "vs season avg" delta on the
  // Three Stars cards. BGM-only — opponents have no profile / history.
  const bgmPlayerIds = playerStats.map((p) => p.playerId)
  const seasonRows = await safe(
    () => getSeasonPlayerMatchStats(m.gameTitleId, m.playedAt, bgmPlayerIds),
    [],
  )
  const seasonAvgs = computeSeasonAvgs(seasonRows)

  // ── View-model derivations ──────────────────────────────────────────────────
  // Three Stars sources position / jersey # / archetype from the pre-game
  // loadout OCR first, falling back to EA position + manual profile data.
  const playerStatsForStars = applyLoadoutOverrides(playerStats, lineups.bgm)
  const opponentStatsForStars = applyLoadoutOverrides(opponentPlayerStats, lineups.opponent)

  // Lineup & Loadouts source: use the OCR loadout snapshots when present;
  // otherwise fall back to the box score so we still show who dressed and
  // where (jersey # + archetype for BGM), rendered in the lean variant.
  const hasOcrLineups = lineups.bgm.length > 0 || lineups.opponent.length > 0
  const lineupVariant: 'ocr' | 'boxScore' = hasOcrLineups ? 'ocr' : 'boxScore'
  const lineupData = hasOcrLineups
    ? lineups
    : {
        bgm: buildLineupFromStats(playerStats, 'bgm', m.playedAt),
        opponent: buildLineupFromStats(opponentPlayerStats, 'opp', m.playedAt),
      }

  const topPerformers = attachSeasonAvgs(
    buildTopPerformers(match, playerStatsForStars, opponentStatsForStars),
    seasonAvgs,
  )
  const allTeamScores = buildAllTeamScores(match, playerStatsForStars, opponentStatsForStars)
  const possessionEdge = buildPossessionEdge(match, periodSummaries)
  const boxScore = buildBoxScore(match, playerStats, opponentPlayerStats, periodSummaries)

  // OT is derived — no schema column. OCR period rows past regulation cover
  // reviewed matches; player TOI beyond 3600s covers the EA-only path.
  const overtime = wentToOvertime(
    match,
    periodSummaries,
    [...playerStats, ...opponentPlayerStats].map((p) => p.toiSeconds),
  )

  const heroMeta = {
    seasonNumber,
    meetingNumber: seriesContext?.meetingNumber ?? null,
    series: seriesContext?.series ?? null,
  }
  const listQuery = gamesListQuery(queryParams)
  const gamesHref = `/games${listQuery ? `?${listQuery}` : ''}`

  // LOADOUTS | STATS mode — seeded from the optional ?view= deep link; the
  // client control mirrors changes back via history.replaceState.
  const initialMode: GameSheetMode = queryParams.view === 'stats' ? 'stats' : 'loadouts'

  return (
    <div className="space-y-4" style={opponentColorVars}>
      {/* 1. Top bar */}
      <GameTopBar gamesHref={gamesHref} adjacent={adjacent} listQuery={listQuery} />

      {/* 2. Scoreboard hero */}
      <HeroCard
        match={match}
        opponentCrestAssetId={opponentCrestAssetId}
        opponentCrestUseBaseAsset={opponentCrestUseBaseAsset}
        overtime={overtime}
        meta={heroMeta}
      />

      <GameSheetModeProvider initialMode={initialMode}>
        {/* 3. LOADOUTS | STATS sub-nav — client mode context; the lineup
              module consumes it from Phase 4. */}
        <GameSheetModeTabs />

        {/* 4. Main grid — main column (3/4) + rail (1/4); the rail stacks after
              the main column below lg. */}
        <div className="grid items-start gap-4 lg:grid-cols-4">
          <div id={GAME_SHEET_PANEL_ID} className="min-w-0 space-y-4 lg:col-span-3">
            {/* Lineup · Scouting — one roster at a time (BGM|OPP switch), rows
              trail X-Factors or stat columns per the LOADOUTS|STATS mode. Rich
              when OCR snapshots exist; lean box-score fallback otherwise. */}
            <LineupModule
              lineups={lineupData}
              variant={lineupVariant}
              bgmStats={playerStats}
              oppStats={opponentPlayerStats}
              scores={allTeamScores}
              opponentName={match.opponentName}
              opponentAbbrev={abbreviateTeamName(match.opponentName)}
              opponentCrestAssetId={opponentCrestAssetId}
              opponentCrestUseBaseAsset={opponentCrestUseBaseAsset}
            >
              <LineupModuleFooter
                lineups={lineupData}
                variant={lineupVariant}
                provenance={lineupProvenance}
              />
            </LineupModule>

            {/* OCR-derived event timeline — story-mode scoresheet with running
              score, lead-change banners, and GWG highlight. The real score is
              passed in so a partial event set can never present itself as the
              final. */}
            <EventTimeline
              events={matchEventRows}
              opponentLabel={match.opponentName}
              scoreFor={match.scoreFor}
              scoreAgainst={match.scoreAgainst}
            />
          </div>

          <div className="min-w-0 space-y-4">
            <TopPerformers
              performers={topPerformers}
              allTeamScores={allTeamScores}
              opponentLabel={match.opponentName}
            />

            {/* Deserve-to-win — arc gauge over the weighted possession model;
                self-collapses when the match has neither shots nor hits. */}
            {possessionEdge !== null ? (
              <DtwGauge
                edge={possessionEdge}
                opponentName={match.opponentName}
                scoreFor={match.scoreFor}
                scoreAgainst={match.scoreAgainst}
              />
            ) : null}

            {/* OCR-derived per-period box score (hidden until reviewed). */}
            <BoxScore rows={periodSummaries} opponentLabel={match.opponentName} />

            <TeamStats rows={boxScore} opponentName={match.opponentName} />
          </div>
        </div>
      </GameSheetModeProvider>

      {/* 5. Full-width action tracker (rink-coordinate spatial extraction +
            all-type event card list mirroring the in-game post-game Action
            Tracker; hosts the Faceoff Map as a separate view-mode). */}
      <ActionTrackerMap
        events={matchEventRows}
        opponentLabel={match.opponentName}
        opponentColor={opponentPrimaryColor}
        bgmWasHome={match.bgmWasHome}
        bgmColor={match.bgmColorHex}
        oppColor={match.oppColorHex}
        faceoffDots={faceoffDots}
        faceoffZones={faceoffZones}
        provenance={actionTrackerProvenance}
      />

      {/* 6. Context footer (lowest priority — first to cut if scope shrinks) */}
      <ContextFooter previous={adjacent.previous} next={adjacent.next} />
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function gamesListQuery(params: Record<string, string | string[] | undefined>): string {
  const qs = new URLSearchParams()
  for (const key of ['title', 'mode', 'result', 'opponent', 'page']) {
    const value = params[key]
    if (typeof value === 'string' && value.trim()) qs.set(key, value)
  }
  return qs.toString()
}

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn()
  } catch {
    return fallback
  }
}

function ErrorState({ message }: { message: string }) {
  return (
    <Panel className="flex min-h-[12rem] items-center justify-center">
      <p className="font-condensed text-sm uppercase tracking-wider text-zinc-500">{message}</p>
    </Panel>
  )
}
