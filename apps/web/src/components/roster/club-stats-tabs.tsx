'use client'

import { useState } from 'react'
import type { ReactNode } from 'react'
import { Panel } from '@/components/ui/panel'
import { SectionHeader } from '@/components/ui/section-header'

interface SeasonRow {
  gameTitleId: number
  gameTitleName: string
  favoritePosition: string | null

  gamesPlayed: number
  gamesCompleted: number
  gamesCompletedFc: number
  playerQuitDisc: number

  skaterGp: number
  lwGp: number
  rwGp: number
  cGp: number
  dGp: number

  skaterWins: number
  skaterLosses: number
  skaterOtl: number
  skaterWinnerByDnf: number
  skaterWinPct: number
  skaterDnf: number

  goals: number
  assists: number
  points: number
  pointsPerGame: string | null
  powerPlayGoals: number
  shortHandedGoals: number
  gameWinningGoals: number
  hatTricks: number
  plusMinus: number
  pim: number
  prevGoals: number
  prevAssists: number

  shots: number
  shotPct: string | null
  shotsPerGame: string | null
  shotAttempts: number
  shotOnNetPct: string | null
  breakaways: number
  breakawayGoals: number
  breakawayPct: string | null

  passes: number
  passAttempts: number
  passPct: string | null
  interceptions: number
  dekes: number
  dekesMade: number
  deflections: number
  saucerPasses: number
  screenChances: number
  screenGoals: number
  possessionSeconds: number
  xfactorZoneUsed: number

  hits: number
  hitsPerGame: string | null
  fights: number
  fightsWon: number
  blockedShots: number
  pkClearZone: number
  offsides: number
  offsidesPerGame: string | null
  penaltiesDrawn: number
  takeaways: number
  giveaways: number

  faceoffTotal: number
  faceoffWins: number
  faceoffLosses: number
  faceoffPct: string | null
  penaltyShotAttempts: number
  penaltyShotGoals: number
  penaltyShotPct: string | null
  toiSeconds: number | null
}

interface Tab {
  key: 'overview' | 'scoring' | 'playmaking' | 'defense' | 'faceoffs'
  label: string
}

const TABS: Tab[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'scoring', label: 'Scoring' },
  { key: 'playmaking', label: 'Playmaking' },
  { key: 'defense', label: 'Defense' },
  { key: 'faceoffs', label: 'Faceoffs' },
]

function formatRecord(w: number, l: number, otl: number) {
  return `${w.toString()}-${l.toString()}-${otl.toString()}`
}

function formatPossession(seconds: number) {
  if (seconds <= 0) return '—'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return h > 0 ? `${h.toString()}h ${m.toString()}m` : `${m.toString()}m`
}

function StatItem({ label, value }: { label: string; value: ReactNode }) {
  return (
    <Panel className="px-3 py-2">
      <div className="font-condensed text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-500">
        {label}
      </div>
      <div className="mt-1 font-condensed text-lg font-bold tabular-nums text-zinc-100">
        {value}
      </div>
    </Panel>
  )
}

function StatGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">{children}</div>
}

export function ClubStatsTabs({ season }: { season: SeasonRow }) {
  const [active, setActive] = useState<Tab['key']>('overview')

  return (
    <section className="space-y-4">
      <SectionHeader
        label="Club Stats"
        subtitle={`EA-reported full season totals · ${season.gameTitleName}`}
      />

      <div className="flex flex-wrap gap-1 border-b border-zinc-800">
        {TABS.map((t) => {
          const isActive = t.key === active
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => {
                setActive(t.key)
              }}
              className={[
                'border-b-2 px-3 py-2 font-condensed text-xs font-bold uppercase tracking-[0.18em] transition-colors',
                isActive
                  ? 'border-accent text-accent'
                  : 'border-transparent text-zinc-500 hover:text-zinc-300',
              ].join(' ')}
            >
              {t.label}
            </button>
          )
        })}
      </div>

      {active === 'overview' && (
        <StatGrid>
          <StatItem label="Games Played" value={season.gamesPlayed} />
          <StatItem label="Games Completed" value={season.gamesCompleted} />
          <StatItem label="Forced Completions" value={season.gamesCompletedFc} />
          <StatItem
            label="Record"
            value={formatRecord(season.skaterWins, season.skaterLosses, season.skaterOtl)}
          />
          <StatItem label="Wins" value={season.skaterWins} />
          <StatItem label="Losses" value={season.skaterLosses} />
          <StatItem label="OTL" value={season.skaterOtl} />
          <StatItem label="Win %" value={`${season.skaterWinPct.toString()}%`} />
          <StatItem label="Wins by DNF" value={season.skaterWinnerByDnf} />
          <StatItem label="DNF" value={season.skaterDnf} />
          <StatItem label="Quit Disconnects" value={season.playerQuitDisc} />
          <StatItem label="Favorite Position" value={season.favoritePosition ?? '—'} />
          <StatItem label="LW Games" value={season.lwGp} />
          <StatItem label="C Games" value={season.cGp} />
          <StatItem label="RW Games" value={season.rwGp} />
          <StatItem label="D Games" value={season.dGp} />
        </StatGrid>
      )}

      {active === 'scoring' && (
        <StatGrid>
          <StatItem label="Goals" value={season.goals} />
          <StatItem label="Assists" value={season.assists} />
          <StatItem label="Points" value={season.points} />
          <StatItem label="Points/GP" value={season.pointsPerGame ?? '—'} />
          <StatItem label="PPG" value={season.powerPlayGoals} />
          <StatItem label="SHG" value={season.shortHandedGoals} />
          <StatItem label="GWG" value={season.gameWinningGoals} />
          <StatItem label="Hat Tricks" value={season.hatTricks} />
          <StatItem label="Shots" value={season.shots} />
          <StatItem label="Shots/GP" value={season.shotsPerGame ?? '—'} />
          <StatItem label="Shot Attempts" value={season.shotAttempts} />
          <StatItem
            label="Shot on Net %"
            value={season.shotOnNetPct !== null ? `${season.shotOnNetPct}%` : '—'}
          />
          <StatItem
            label="Shooting %"
            value={season.shotPct !== null ? `${season.shotPct}%` : '—'}
          />
          <StatItem label="Breakaways" value={season.breakaways} />
          <StatItem label="Breakaway Goals" value={season.breakawayGoals} />
          <StatItem
            label="Breakaway %"
            value={season.breakawayPct !== null ? `${season.breakawayPct}%` : '—'}
          />
        </StatGrid>
      )}

      {active === 'playmaking' && (
        <StatGrid>
          <StatItem label="Passes" value={season.passes} />
          <StatItem label="Pass Attempts" value={season.passAttempts} />
          <StatItem
            label="Passing %"
            value={season.passPct !== null ? `${season.passPct}%` : '—'}
          />
          <StatItem label="Interceptions" value={season.interceptions} />
          <StatItem label="Dekes" value={season.dekes} />
          <StatItem label="Dekes Made" value={season.dekesMade} />
          <StatItem label="Deflections" value={season.deflections} />
          <StatItem label="Saucer Passes" value={season.saucerPasses} />
          <StatItem label="Screen Chances" value={season.screenChances} />
          <StatItem label="Screen Goals" value={season.screenGoals} />
          <StatItem label="Possession Time" value={formatPossession(season.possessionSeconds)} />
          <StatItem label="X-Factor Used" value={season.xfactorZoneUsed} />
        </StatGrid>
      )}

      {active === 'defense' && (
        <StatGrid>
          <StatItem label="Hits" value={season.hits} />
          <StatItem label="Hits/GP" value={season.hitsPerGame ?? '—'} />
          <StatItem label="Fights" value={season.fights} />
          <StatItem label="Fights Won" value={season.fightsWon} />
          <StatItem label="Blocked Shots" value={season.blockedShots} />
          <StatItem label="Giveaways" value={season.giveaways} />
          <StatItem label="Takeaways" value={season.takeaways} />
          <StatItem label="PK Clear Zone" value={season.pkClearZone} />
          <StatItem label="Offsides" value={season.offsides} />
          <StatItem label="Offsides/GP" value={season.offsidesPerGame ?? '—'} />
          <StatItem label="PIM" value={season.pim} />
          <StatItem label="Penalties Drawn" value={season.penaltiesDrawn} />
        </StatGrid>
      )}

      {active === 'faceoffs' && (
        <StatGrid>
          <StatItem label="FO Taken" value={season.faceoffTotal} />
          <StatItem label="FO Won" value={season.faceoffWins} />
          <StatItem label="FO Lost" value={season.faceoffLosses} />
          <StatItem
            label="FO %"
            value={season.faceoffPct !== null ? `${season.faceoffPct}%` : '—'}
          />
          <StatItem label="Pen Shot Attempts" value={season.penaltyShotAttempts} />
          <StatItem label="Pen Shot Goals" value={season.penaltyShotGoals} />
          <StatItem
            label="Pen Shot %"
            value={season.penaltyShotPct !== null ? `${season.penaltyShotPct}%` : '—'}
          />
          <StatItem
            label="Time on Ice"
            value={season.toiSeconds !== null ? formatPossession(season.toiSeconds) : '—'}
          />
          <StatItem
            label="+/-"
            value={
              season.plusMinus >= 0
                ? `+${season.plusMinus.toString()}`
                : season.plusMinus.toString()
            }
          />
          <StatItem label="Prev Season G" value={season.prevGoals} />
          <StatItem label="Prev Season A" value={season.prevAssists} />
        </StatGrid>
      )}
    </section>
  )
}
