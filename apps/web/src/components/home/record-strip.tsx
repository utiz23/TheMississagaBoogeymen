import Image from 'next/image'
import type { ClubGameTitleStats, ClubSeasonalStats, ClubSeasonRank, MatchResult } from '@eanhl/db'
import './record-strip.css'
import './record-strip-compact.css'
import { formatClubDateTime, formatRecord } from '@/lib/format'

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
  const goalDiff = goalsFor !== null && goalsAgainst !== null ? goalsFor - goalsAgainst : null

  // Dots render newest-first (left → right), matching the source feed which
  // is already newest-first. DNFs are counted as losses everywhere — both for
  // the Last-10 record string and the streak computation.
  const dots = recentResults.slice(0, 10)
  const last10 = dots
  const last10Wins = last10.filter((d) => d.result === 'WIN').length
  const last10Losses = last10.filter((d) => d.result === 'LOSS' || d.result === 'DNF').length
  const last10Otl = last10.filter((d) => d.result === 'OTL').length

  const streak = computeStreak(recentResults.slice(0, 10))

  const lastGameAt = formatClubDateTime(recentResults[0]?.playedAt)
  const divisionName = seasonRank?.divisionName ?? null

  return (
    <section className="rs-frame">
      {/* Phone (≤720px) header — the compact face below replaces .rs-head. */}
      <header className="rs-m-head">
        <h2>
          <span className="accent" aria-hidden="true">
            ▌
          </span>
          Team Record
        </h2>
        <span className="rs-m-live">
          <b>{gameTitleName}</b>
          <span className="sep" aria-hidden="true">
            ·
          </span>
          <span className="pulse">
            <i aria-hidden="true" />
            Live
          </span>
        </span>
      </header>

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
          {lastGameAt ? (
            <>
              <span className="dot">·</span>
              <span>
                Last game <b>{lastGameAt}</b>
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
                  <span>{formatRecord(wins, losses, otl)}</span>
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
                <b>{formatRecord(last10Wins, last10Losses, last10Otl)}</b>{' '}
                {dots.length >= 10 ? 'in last 10' : `in ${String(dots.length)} games`}
              </span>
            </div>
            <div className="dots">
              {Array.from({ length: 10 }).map((_, i) => {
                const r = dots[i]
                if (!r) {
                  // Not played yet (fewer than 10 games) — a neutral slot, not a loss.
                  return <span key={i} className="d empty" />
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

      {/* PHONE (≤720px) — compact face. Everything the strip above shows that
          the face hides (win-pct gauge, GF/GA with the differential axis,
          division chip, last game time) sits in the native DETAILS expander. */}
      <div className="rs-m">
        <div className="rs-m-id">
          <div className="rs-m-crest">
            {logoSrc ? (
              <Image src={logoSrc} alt={teamName} width={36} height={36} />
            ) : (
              <span>{teamMonogram}</span>
            )}
          </div>
          <div className="rs-m-id-text">
            <span className="name">{teamName}</span>
            <span className="sub">
              {divisionName ? `${divisionName} · ` : null}
              <b>{String(gp)}</b> GP
            </span>
          </div>
          <div className="rs-m-rec">
            <span
              className="nums"
              role="img"
              aria-label={`${String(wins)} wins, ${String(losses)} losses, ${String(otl)} overtime losses`}
            >
              <span className="w">{String(wins)}</span>
              <span className="dash">–</span>
              <span className="l">{String(losses)}</span>
              <span className="dash">–</span>
              <span className="o">{String(otl)}</span>
            </span>
            <span className="cap">W · L · OTL</span>
          </div>
        </div>

        <div className="rs-m-comp-wrap">
          <div
            className="rs-m-comp"
            role="img"
            aria-label={`Composition: ${String(wins)} wins, ${String(losses)} losses, ${String(otl)} overtime losses`}
            style={{
              gridTemplateColumns: [wins, losses, otl]
                .filter((n) => n > 0)
                .map((n) => `${String(n)}fr`)
                .join(' '),
            }}
          >
            {wins > 0 && <i className="b1" />}
            {losses > 0 && <i className="b2" />}
            {otl > 0 && <i className="b3" />}
          </div>
        </div>

        <div className="rs-m-kpis">
          <div className="kpi">
            <span className="k">Win Pct</span>
            <span className="v">{hasRecord ? formatHockeyPct(winPct) : '—'}</span>
          </div>
          <div className="kpi">
            <span className="k">Goal Diff</span>
            <span className={`v ${goalDiff === null ? '' : signClass(goalDiff)}`}>
              {goalDiff !== null ? formatSignedInt(goalDiff) : '—'}
            </span>
          </div>
          <div className="kpi">
            <span className="k">Streak</span>
            <span className={`v ${streak.count > 0 ? streakTone(streak.kind) : ''}`}>
              {streak.count > 0 ? `${streakShort(streak.kind)}${String(streak.count)}` : '—'}
            </span>
          </div>
        </div>

        <div className="rs-m-form">
          <div className="top">
            <span>Form · Last 10</span>
            <span>
              <b>{formatRecord(last10Wins, last10Losses, last10Otl)}</b>
              {dots.length < 10 ? ` in ${String(dots.length)} games` : null}
            </span>
          </div>
          <div
            className="tiles"
            role="img"
            aria-label={`Last ${String(dots.length)} results, most recent first: ${dots.map((d) => d.result).join(', ')}`}
          >
            {Array.from({ length: 10 }).map((_, i) => {
              const r = dots[i]
              if (!r) return <span key={i} className="t empty" />
              return (
                <span key={i} className={`t ${resultClass(r.result)}`}>
                  {resultGlyph(r.result)}
                </span>
              )
            })}
          </div>
          <div className="meta">
            <span>← Most recent</span>
            <span>10 ago</span>
          </div>
        </div>

        <details className="rs-m-details">
          <summary>
            <span className="when-closed">Details</span>
            <span className="when-open">Hide details</span>
            <svg
              viewBox="0 0 24 24"
              width="18"
              height="18"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </summary>
          <div className="body">
            <div className="gauge-block">
              <div className="row">
                <span className="k">Win Pct</span>
                <span className="v">{hasRecord ? `${(winPct * 100).toFixed(1)}%` : '—'}</span>
              </div>
              <div
                className="bar"
                role="img"
                aria-label={
                  hasRecord
                    ? `Win percentage ${(winPct * 100).toFixed(1)} percent`
                    : 'Win percentage unavailable'
                }
              >
                <span
                  className="fill"
                  style={{ width: `${String((hasRecord ? winPct : 0) * 100)}%` }}
                />
                <span className="mid" />
              </div>
              <div className="scale">
                <span>0%</span>
                <span>50</span>
                <span>100%</span>
              </div>
            </div>

            <div className="gauge-block">
              <div className="row">
                <span className="k">GF / GA</span>
                <span className="v">
                  {goalsFor !== null ? String(goalsFor) : '—'} /{' '}
                  {goalsAgainst !== null ? String(goalsAgainst) : '—'}
                </span>
              </div>
              <div
                className="bar"
                role="img"
                aria-label={
                  goalDiff !== null
                    ? `Goal differential ${formatSignedInt(goalDiff)} on a scale of minus 50 to plus 50`
                    : 'Goal differential unavailable'
                }
              >
                <span className="mid" />
                {goalDiff !== null ? (
                  <span
                    className={`marker ${signClass(goalDiff)}`}
                    style={{ left: `${String(markerPctFromDiff(goalDiff))}%` }}
                  />
                ) : null}
              </div>
              <div className="scale">
                <span>−50</span>
                <span>0</span>
                <span>+50</span>
              </div>
            </div>

            {divisionName || lastGameAt ? (
              <div className="facts">
                {divisionName ? (
                  <div className="row">
                    <span className="k">Division</span>
                    <span className="chip">DIV · {divisionName}</span>
                  </div>
                ) : null}
                {lastGameAt ? (
                  <div className="row">
                    <span className="k">Last game</span>
                    <span className="v">{lastGameAt}</span>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </details>
      </div>

      <footer className="rs-foot">
        <span className="src">
          <span className="dot" />
          Source{' '}
          <b>
            EA Official
            <span className="rs-foot-ctx">
              {' '}
              · {gameTitleName} {teamName}
            </span>
          </b>
        </span>
      </footer>
    </section>
  )
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function computeStreak(results: { result: MatchResult }[]): {
  kind: 'W' | 'L' | 'O'
  count: number
} {
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

/** Compact streak text, e.g. "L3" / "W2" / "OT1". */
function streakShort(k: 'W' | 'L' | 'O'): string {
  return k === 'O' ? 'OT' : k
}

function streakTone(k: 'W' | 'L' | 'O'): string {
  if (k === 'W') return 'pos'
  if (k === 'L') return 'neg'
  return 'otl'
}

function signClass(d: number): string {
  if (d > 0) return 'pos'
  if (d < 0) return 'neg'
  return ''
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
