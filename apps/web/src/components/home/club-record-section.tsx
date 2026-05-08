import type { ClubGameTitleStats, ClubSeasonalStats, GameMode } from '@eanhl/db'
import { SectionHeader } from '@/components/ui/section-header'
import { Panel } from '@/components/ui/panel'
import { StatStrip, type StatStripItem } from '@/components/ui/stat-strip'
import { RecordModeFilter } from './record-mode-filter'

/** Win% as "78.3". Returns "—" when no games played. */
function winPctValue(wins: number, losses: number, otl: number): string {
  const total = wins + losses + otl
  if (total === 0) return '—'
  return ((wins / total) * 100).toFixed(1)
}

interface ClubRecordSectionProps {
  gameMode: GameMode | null
  titleSlug: string | undefined
  /** EA-official seasonal record for the all-modes view. Null when not yet fetched / unavailable. */
  officialRecord: ClubSeasonalStats | null
  /** Local aggregate; used for GF/GA in all-modes view, and as the full source for mode-filtered views. */
  localStats: ClubGameTitleStats | null
}

/**
 * CLUB RECORD strip — section header (with mode filter on the right) + a
 * StatStrip rendering W / L / OTL / Win% / GP / GF / GA.
 *
 * Three variants based on (gameMode, officialRecord, localStats):
 * - all-modes + EA-official available: WIN/L/OTL/Win%/GP from official, GF/GA from local. Provenance: "EA official".
 * - all-modes + EA-official unavailable: empty state with optional local GF/GA. Provenance: "Official record not yet available".
 * - mode-filtered: full strip from local aggregate. Provenance: "local · {mode} only".
 */
export function ClubRecordSection({
  gameMode,
  titleSlug,
  officialRecord,
  localStats,
}: ClubRecordSectionProps) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <SectionHeader label="Club Record" />
        <RecordModeFilter titleSlug={titleSlug} activeMode={gameMode} />
      </div>

      {gameMode === null ? (
        officialRecord !== null ? (
          <RecordStrip officialRecord={officialRecord} localStats={localStats} />
        ) : (
          <UnavailableRecordStrip localStats={localStats} />
        )
      ) : localStats !== null && localStats.gamesPlayed > 0 ? (
        <LocalModeRecordStrip stats={localStats} gameMode={gameMode} />
      ) : (
        <Panel className="flex items-center justify-center py-5">
          <p className="text-sm text-zinc-500">No {gameMode} games recorded yet.</p>
        </Panel>
      )}
    </section>
  )
}

function RecordStrip({
  officialRecord,
  localStats,
}: {
  officialRecord: ClubSeasonalStats
  localStats: ClubGameTitleStats | null
}) {
  const items: StatStripItem[] = [
    { label: 'W', value: officialRecord.wins.toString(), accent: true },
    { label: 'L', value: officialRecord.losses.toString() },
    { label: 'OTL', value: officialRecord.otl.toString(), dim: officialRecord.otl === 0 },
    {
      label: 'Win%',
      value: winPctValue(officialRecord.wins, officialRecord.losses, officialRecord.otl),
      accent: true,
    },
    { label: 'GP', value: officialRecord.gamesPlayed.toString() },
  ]

  if (localStats !== null && localStats.gamesPlayed > 0) {
    items.push(
      { label: 'GF', value: localStats.goalsFor.toString() },
      { label: 'GA', value: localStats.goalsAgainst.toString() },
    )
  }

  if (officialRecord.rankingPoints !== null) {
    items.push({ label: 'Pts', value: officialRecord.rankingPoints.toString() })
  }

  return (
    <Panel className="px-5 py-4">
      <StatStrip items={items} provenance="EA official" />
    </Panel>
  )
}

function UnavailableRecordStrip({ localStats }: { localStats: ClubGameTitleStats | null }) {
  const items: StatStripItem[] = []
  if (localStats !== null && localStats.gamesPlayed > 0) {
    items.push(
      { label: 'GF', value: localStats.goalsFor.toString(), dim: true },
      { label: 'GA', value: localStats.goalsAgainst.toString(), dim: true },
      { label: 'Ingested GP', value: localStats.gamesPlayed.toString(), dim: true },
    )
  }

  return (
    <Panel className="px-5 py-4">
      <p className="font-condensed text-sm uppercase tracking-wider text-zinc-500">
        Official record not yet available
      </p>
      {items.length > 0 ? <StatStrip className="mt-3" items={items} /> : null}
    </Panel>
  )
}

function LocalModeRecordStrip({
  stats,
  gameMode,
}: {
  stats: ClubGameTitleStats
  gameMode: GameMode
}) {
  const items: StatStripItem[] = [
    { label: 'W', value: stats.wins.toString(), accent: true },
    { label: 'L', value: stats.losses.toString() },
    { label: 'OTL', value: stats.otl.toString(), dim: stats.otl === 0 },
    {
      label: 'Win%',
      value: winPctValue(stats.wins, stats.losses, stats.otl),
      accent: true,
    },
    { label: 'GP', value: stats.gamesPlayed.toString() },
    { label: 'GF', value: stats.goalsFor.toString() },
    { label: 'GA', value: stats.goalsAgainst.toString() },
  ]

  return (
    <Panel className="px-5 py-4">
      <StatStrip items={items} provenance={`local · ${gameMode} only`} />
    </Panel>
  )
}
