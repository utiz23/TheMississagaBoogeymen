import type { ReactNode } from 'react'
import Link from 'next/link'
import type {
  ProfileRecentFormSkater,
  ProfileRecentFormGoalie,
} from '@eanhl/db/queries'
import { SectionHeading } from '@/components/roster/section-heading'
import { formatMatchDate, formatRecord, formatScore } from '@/lib/format'

type MatchResult = 'WIN' | 'LOSS' | 'OTL' | 'DNF'

interface Props {
  recentForm: ProfileRecentFormSkater | ProfileRecentFormGoalie | null
  selectedRole: 'skater' | 'goalie'
}

export function RecentFormStrip({ recentForm, selectedRole }: Props) {
  if (!recentForm || recentForm.gamesAnalyzed === 0) return null

  return (
    <section id="form" className="space-y-4 scroll-mt-24">
      <SectionHeading
        title="Recent Form"
        subtitle={`Last ${recentForm.gamesAnalyzed.toString()} ${selectedRole} appearances · most recent first`}
      />

      <SurfaceCard>
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-500">
              Last {recentForm.gamesAnalyzed}
            </p>
            <ResultPips results={recentForm.recentResults as MatchResult[]} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <MiniStat
              label="Record"
              value={formatRecord(
                recentForm.record.wins,
                recentForm.record.losses,
                recentForm.record.otl,
              )}
            />
            {recentForm.role === 'skater' ? (
              <>
                <MiniStat
                  label="G / A"
                  value={`${recentForm.goals.toString()} / ${recentForm.assists.toString()}`}
                />
                <MiniStat label="+/-" value={formatSigned(recentForm.plusMinus)} />
              </>
            ) : (
              <>
                <MiniStat
                  label="SV%"
                  value={recentForm.savePct !== null ? `${recentForm.savePct.toFixed(1)}%` : '—'}
                />
                <MiniStat label="GA" value={recentForm.goalsAgainst.toString()} />
              </>
            )}
          </div>
          {recentForm.bestGame && (
            <div className="border-t border-zinc-800/60 pt-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-accent/60">
                Best Recent
              </p>
              <Link
                href={`/games/${recentForm.bestGame.matchId.toString()}`}
                className="mt-1.5 block font-condensed text-sm font-bold uppercase tracking-wide text-zinc-200 transition-colors hover:text-accent"
              >
                vs {recentForm.bestGame.opponentName}
              </Link>
              <p className="mt-0.5 text-xs text-zinc-600">
                {formatMatchDate(recentForm.bestGame.playedAt)} ·{' '}
                {formatScore(recentForm.bestGame.scoreFor, recentForm.bestGame.scoreAgainst)}
              </p>
              <p className="mt-1 text-xs text-zinc-400">
                {recentForm.role === 'goalie'
                  ? `${(recentForm.bestGame.saves ?? 0).toString()} saves, ${(recentForm.bestGame.goalsAgainst ?? 0).toString()} GA`
                  : `${recentForm.bestGame.goals.toString()} G · ${recentForm.bestGame.assists.toString()} A · ${(recentForm.bestGame.goals + recentForm.bestGame.assists).toString()} PTS`}
              </p>
            </div>
          )}
        </div>
      </SurfaceCard>
    </section>
  )
}

function SurfaceCard({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return <div className={`border border-zinc-800 bg-surface p-4 ${className}`}>{children}</div>
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-500">{label}</p>
      <p className="mt-1.5 font-condensed text-xl font-black text-zinc-100">{value}</p>
    </div>
  )
}

function ResultPips({ results }: { results: MatchResult[] }) {
  if (results.length === 0) return null
  return (
    <div className="flex items-center gap-1" aria-label="Recent results">
      {results.map((r, i) => {
        const color =
          r === 'WIN'
            ? 'bg-emerald-500'
            : r === 'LOSS'
              ? 'bg-rose-600'
              : r === 'OTL'
                ? 'bg-amber-500'
                : 'bg-zinc-600'
        return (
          <span
            key={i}
            className={`block h-2.5 w-2.5 rounded-sm ${color}`}
            aria-label={r}
            title={r}
          />
        )
      })}
    </div>
  )
}

function formatSigned(value: number): string {
  return value > 0 ? `+${value.toString()}` : value.toString()
}
