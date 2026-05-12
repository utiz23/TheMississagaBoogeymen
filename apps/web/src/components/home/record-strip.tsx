import Image from 'next/image'
import type { ClubGameTitleStats, ClubSeasonalStats, ClubSeasonRank, MatchResult } from '@eanhl/db'
import './record-strip.css'

interface Props {
  /** EA-official seasonal record (W/L/OTL/GP). Optional. */
  officialRecord: ClubSeasonalStats | null
  /** Local aggregate — provides GF/GA. Optional. */
  localStats: ClubGameTitleStats | null
  /** Current EA season rank for the division chip + meta. Optional. */
  seasonRank: ClubSeasonRank | null
  /** Recent match results, newest first. The component looks at the first 10. */
  recentResults: { result: MatchResult; playedAt: Date }[]
  /** Title shown in the meta cluster (e.g. "NHL 26"). */
  gameTitleName: string
  /** Footer sheet identifier. */
  sheetCode?: string
  /** Team name shown in the identity tile. */
  teamName?: string
  /** 2-letter monogram for the crest fallback when no logo image is supplied. */
  teamMonogram?: string
  /** Optional logo path for the crest. Uses a monogram if absent. */
  logoSrc?: string
}

const TEAM_NAME_DEFAULT = 'Boogeymen'
const MONOGRAM_DEFAULT = 'BG'
const LOGO_DEFAULT = '/images/bgm-logo.png'

export function RecordStrip({
  officialRecord,
  localStats,
  seasonRank,
  recentResults,
  gameTitleName,
  sheetCode = 'BGM/REC/0001',
  teamName = TEAM_NAME_DEFAULT,
  teamMonogram = MONOGRAM_DEFAULT,
  logoSrc = LOGO_DEFAULT,
}: Props) {
  const wins = officialRecord?.wins ?? 0
  const losses = officialRecord?.losses ?? 0
  const otl = officialRecord?.otl ?? 0
  const gp = officialRecord?.gamesPlayed ?? wins + losses + otl

  const hasRecord = officialRecord !== null && gp > 0
  const winPct = hasRecord ? wins / gp : 0

  const goalsFor = localStats?.goalsFor ?? null
  const goalsAgainst = localStats?.goalsAgainst ?? null
  const goalDiff =
    goalsFor !== null && goalsAgainst !== null ? goalsFor - goalsAgainst : null

  // Dots render newest-first (left → right), matching the source feed which
  // is already newest-first. DNFs are counted as losses everywhere — both for
  // the Last-10 record string and the streak computation.
  const dots = recentResults.slice(0, 10)
  const last10 = dots
  const last10Wins = last10.filter((d) => d.result === 'WIN').length
  const last10Losses = last10.filter((d) => d.result === 'LOSS' || d.result === 'DNF').length
  const last10Otl = last10.filter((d) => d.result === 'OTL').length

  const streak = computeStreak(recentResults.slice(0, 10))

  const updatedAtIso = formatTimestamp(recentResults[0]?.playedAt)

  return (
    <section className="rs-frame">
      <header className="rs-head">
        <h2>
          <span className="accent">▌</span>Team Record · Season Ledger
        </h2>
        <span className="pulse">
          <i />
          Live
        </span>
        <div className="meta">
          <span>
            <b>{gameTitleName}</b>
          </span>
          {seasonRank?.divisionName ? (
            <>
              <span className="dot">·</span>
              <span>
                <b>{seasonRank.divisionName}</b>
              </span>
            </>
          ) : null}
          {updatedAtIso ? (
            <>
              <span className="dot">·</span>
              <span>
                Updated <b>{updatedAtIso}</b>
              </span>
            </>
          ) : null}
        </div>
      </header>

      <div className="rs-ticker" />

      <div className="rs-strip">
        {/* IDENTITY */}
        <div className="rs-identity">
          <div className="rs-crest">
            {logoSrc ? (
              <Image src={logoSrc} alt={teamName} width={44} height={44} />
            ) : (
              <span>{teamMonogram}</span>
            )}
          </div>
          <div className="rs-id-text">
            <span className="rs-id-name">{teamName}</span>
            <div className="rs-id-row">
              {seasonRank?.divisionName ? (
                <span className="chip">DIV · {seasonRank.divisionName}</span>
              ) : null}
              <span>
                <b>{String(gp)}</b> GP
              </span>
              {hasRecord ? (
                <>
                  <span className="sep">·</span>
                  <span>
                    {String(wins)}-{String(losses)}-{String(otl)}
                  </span>
                </>
              ) : null}
            </div>
          </div>
        </div>

        <div className="rs-div" />

        {/* W/L/OTL */}
        <div className="rs-record">
          <div className="col win">
            <span className="l">W</span>
            <span className="v">{String(wins)}</span>
          </div>
          <div className="col loss">
            <span className="l">L</span>
            <span className="v">{String(losses)}</span>
          </div>
          <div className="col otl">
            <span className="l">OTL</span>
            <span className="v">{String(otl)}</span>
          </div>
          <div
            className="rs-record-bar"
            style={{
              gridTemplateColumns: `${String(wins || 0)}fr ${String(losses || 0)}fr ${String(otl || 0)}fr`,
            }}
          >
            {wins > 0 && <i className="b1" />}
            {losses > 0 && <i className="b2" />}
            {otl > 0 && <i className="b3" />}
          </div>
          <div className="rs-record-bar-meta">
            <span>Composition</span>
            <span>{String(gp)} GP</span>
          </div>
        </div>

        <div className="rs-div" />

        {/* WIN % */}
        <div className="rs-cell rs-winpct">
          <span className="lbl">Win Pct</span>
          <div className="body">
            <div className="big">
              <span className="num">{hasRecord ? formatHockeyPct(winPct) : '—'}</span>
              <span className="pct-sym">{hasRecord ? `${(winPct * 100).toFixed(1)}%` : ''}</span>
            </div>
            <div className="gauge">
              <div
                className="fill"
                style={{ width: `${String((hasRecord ? winPct : 0) * 100)}%` }}
              />
            </div>
            <div className="scale">
              <span>0%</span>
              <span>50</span>
              <span>100%</span>
            </div>
          </div>
        </div>

        <div className="rs-div" />

        {/* GOAL DIFFERENTIAL */}
        <div className="rs-cell rs-diff">
          <span className="lbl">Goal Differential</span>
          <div className="body">
            <div className="row">
              <span className="gf">{goalsFor !== null ? String(goalsFor) : '—'}</span>
              <span className="sep">/</span>
              <span className="ga">{goalsAgainst !== null ? String(goalsAgainst) : '—'}</span>
              {goalDiff !== null ? (
                <span className={goalDiff < 0 ? 'delta neg' : 'delta'}>
                  {formatSignedInt(goalDiff)}
                </span>
              ) : null}
            </div>
            <div className="axis">
              <div className="track">
                {goalDiff !== null ? (
                  <div
                    className="marker"
                    style={{ left: `${String(markerPctFromDiff(goalDiff))}%` }}
                  />
                ) : null}
              </div>
            </div>
            <div className="axis-meta">
              <span>−50</span>
              <span>0</span>
              <span>+50</span>
            </div>
          </div>
        </div>

        <div className="rs-div" />

        {/* FORM / STREAK */}
        <div className="rs-cell rs-form">
          <span className="lbl">Form · Last 10</span>
          <div className="body">
            <div className="top">
              {streak.count > 0 ? (
                <span className={`streak ${streakClass(streak.kind)}`}>
                  <span className="n">{String(streak.count)}</span>
                  <span className="k">{streakLabel(streak.kind)}</span>
                </span>
              ) : null}
              <span className="last">
                <b>
                  {String(last10Wins)}-{String(last10Losses)}-{String(last10Otl)}
                </b>{' '}
                in last 10
              </span>
            </div>
            <div className="dots">
              {Array.from({ length: 10 }).map((_, i) => {
                const r = dots[i]
                if (!r) {
                  return <span key={i} className="d l" />
                }
                const cls = resultClass(r.result)
                return (
                  <span key={i} className={`d ${cls}`}>
                    {resultGlyph(r.result)}
                  </span>
                )
              })}
            </div>
            <div className="dots-meta">
              <span>← Most recent</span>
              <span>10 games ago →</span>
            </div>
          </div>
        </div>
      </div>

      <footer className="rs-foot">
        <span className="src">
          <span className="dot" />
          Source <b>EA Official · {gameTitleName} {teamName}</b>
        </span>
        <span>
          Sheet <b>{sheetCode}</b>
        </span>
      </footer>
    </section>
  )
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function computeStreak(
  results: { result: MatchResult }[],
): { kind: 'W' | 'L' | 'O'; count: number } {
  if (results.length === 0) return { kind: 'W', count: 0 }
  const first = results[0]
  if (!first) return { kind: 'W', count: 0 }
  const kind = streakKindFor(first.result)
  if (kind === null) return { kind: 'W', count: 0 }
  let count = 0
  for (const r of results) {
    if (streakKindFor(r.result) !== kind) break
    count += 1
  }
  return { kind, count }
}

function streakKindFor(r: MatchResult): 'W' | 'L' | 'O' | null {
  if (r === 'WIN') return 'W'
  if (r === 'LOSS') return 'L'
  if (r === 'OTL') return 'O'
  if (r === 'DNF') return 'L' // DNF is treated as a loss for streak purposes
  return null
}

function streakLabel(k: 'W' | 'L' | 'O'): string {
  if (k === 'W') return 'W Streak'
  if (k === 'L') return 'L Streak'
  return 'OT Streak'
}

function streakClass(k: 'W' | 'L' | 'O'): string {
  if (k === 'W') return ''
  if (k === 'L') return 'l'
  return 'o'
}

function resultClass(r: MatchResult): string {
  if (r === 'WIN') return 'w'
  if (r === 'OTL') return 'o'
  if (r === 'DNF') return 'dnf'
  return 'l'
}

function resultGlyph(r: MatchResult): string {
  if (r === 'WIN') return 'W'
  if (r === 'LOSS') return 'L'
  if (r === 'OTL') return 'O'
  return '·'
}

function formatHockeyPct(rate: number): string {
  return rate.toFixed(3).replace(/^0/, '')
}

function formatSignedInt(d: number): string {
  if (d > 0) return `+${String(d)}`
  return String(d)
}

function markerPctFromDiff(diff: number): number {
  // Map [-50, +50] → [0, 100]; clamped.
  const clamped = Math.max(-50, Math.min(50, diff))
  return ((clamped + 50) / 100) * 100
}

function formatTimestamp(d: Date | undefined): string | null {
  if (!d) return null
  const pad = (n: number) => String(n).padStart(2, '0')
  const yyyy = d.getFullYear()
  const mm = pad(d.getMonth() + 1)
  const dd = pad(d.getDate())
  const hh = pad(d.getHours())
  const min = pad(d.getMinutes())
  return `${String(yyyy)}-${mm}-${dd} ${hh}:${min}`
}
