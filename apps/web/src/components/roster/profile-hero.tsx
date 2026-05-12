import Link from 'next/link'
import Image from 'next/image'
import type { CSSProperties, ReactNode } from 'react'
import type {
  PlayerProfileOverview,
  PlayerCareerSeasonRow,
  getPlayerGamertagHistory,
} from '@eanhl/db/queries'
import type { GameMode, PlayerArchetype } from '@eanhl/db'
import { PLAYER_ARCHETYPES } from '@eanhl/db'
import { NationalityFlag, PlatformIcon } from '@/components/player-meta-icons'
import { PortraitCard } from '@/components/roster/portrait-card'
import { ArchetypePillFlagship } from '@/components/ui/archetype-pill'
import { formatPosition, formatPositionFull } from '@/lib/format'
import './profile-hero.css'

function asArchetype(value: string | null): PlayerArchetype | null {
  if (value === null) return null
  return (PLAYER_ARCHETYPES as readonly string[]).includes(value)
    ? (value as PlayerArchetype)
    : null
}

type PlayerGamertagHistoryRow = Awaited<ReturnType<typeof getPlayerGamertagHistory>>[number]

interface PositionEntry {
  key: 'center' | 'leftWing' | 'rightWing' | 'defenseMen' | 'goalie'
  tag: string
  color: string
  gp: number
}

const POSITION_META: Record<PositionEntry['key'], { tag: string; colorVar: string }> = {
  center: { tag: 'C', colorVar: 'var(--pos-c)' },
  defenseMen: { tag: 'D', colorVar: 'var(--pos-d)' },
  rightWing: { tag: 'RW', colorVar: 'var(--pos-rw)' },
  goalie: { tag: 'G', colorVar: 'var(--pos-g)' },
  leftWing: { tag: 'LW', colorVar: 'var(--pos-lw)' },
}

/**
 * Color lookup for the displayed position string. Per docs/specs/position-colors.md:
 *   leftDefenseMen  → --pos-ld (#13dfc8)
 *   rightDefenseMen → --pos-rd (#ece335)
 *   defenseMen      → --pos-d  (alias of --pos-ld; LD is the default when L/R unknown)
 */
function colorForPosition(pos: string | null | undefined): string {
  if (pos === null || pos === undefined) return 'var(--color-fg-5)'
  if (pos === 'leftDefenseMen') return 'var(--pos-ld)'
  if (pos === 'rightDefenseMen') return 'var(--pos-rd)'
  if (pos in POSITION_META) return POSITION_META[pos as PositionEntry['key']].colorVar
  return 'var(--color-fg-5)'
}

function buildPositionEntries(
  season: PlayerProfileOverview['currentEaSeason'],
): PositionEntry[] {
  if (season === null) return []
  const raw: PositionEntry[] = (
    [
      { key: 'center' as const, gp: season.cGp },
      { key: 'leftWing' as const, gp: season.lwGp },
      { key: 'rightWing' as const, gp: season.rwGp },
      { key: 'defenseMen' as const, gp: season.dGp },
      { key: 'goalie' as const, gp: season.goalieGp },
    ] satisfies Array<{ key: PositionEntry['key']; gp: number }>
  )
    .filter((e) => e.gp > 0)
    .map((e) => ({
      key: e.key,
      tag: POSITION_META[e.key].tag,
      color: POSITION_META[e.key].colorVar,
      gp: e.gp,
    }))
  raw.sort((a, b) => b.gp - a.gp)
  return raw
}

function computeSkaterArchetype(
  goals: number,
  assists: number,
  hits: number,
  skaterGp: number,
  plusMinus: number,
): string | null {
  if (skaterGp < 5) return null
  const gPerGp = goals / skaterGp
  const aPerGp = assists / skaterGp
  const hPerGp = hits / skaterGp
  const ptsPerGp = gPerGp + aPerGp
  if (hPerGp >= 3 && ptsPerGp < 0.7) return 'Enforcer'
  if (goals > assists && gPerGp >= 0.35) return 'Sniper'
  if (assists > goals * 1.3 && aPerGp >= 0.3) return 'Playmaker'
  if (plusMinus > 0 && ptsPerGp >= 0.5) return 'Two-Way'
  return 'Balanced'
}

interface Props {
  overview: PlayerProfileOverview
  career: PlayerCareerSeasonRow[]
  history: PlayerGamertagHistoryRow[]
  selectedRole: 'skater' | 'goalie'
  hasSkaterData: boolean
  hasGoalieData: boolean
  gameMode: GameMode | null
}

export function ProfileHero({
  overview,
  career,
  history,
  selectedRole,
  hasSkaterData,
  hasGoalieData,
  gameMode,
}: Props) {
  const { player, currentEaSeason } = overview
  const positionEntries = buildPositionEntries(currentEaSeason)
  const positionTotal = positionEntries.reduce((s, e) => s + e.gp, 0)
  const positionMaxGp = positionEntries.length > 0 ? Math.max(...positionEntries.map((e) => e.gp)) : 0

  const displayPosition =
    player.preferredPosition ?? currentEaSeason?.favoritePosition ?? player.position
  const positionTag = displayPosition ? formatPosition(displayPosition) : null
  const positionFull = displayPosition ? formatPositionFull(displayPosition) : null
  const positionColor = colorForPosition(displayPosition)

  // Manually-assigned archetype always wins over the stat-derived heuristic.
  const manualArchetype = asArchetype(player.archetype)
  const archetypeLabel =
    manualArchetype === null && selectedRole === 'skater' && currentEaSeason !== null && currentEaSeason.skaterGp > 0
      ? computeSkaterArchetype(
          currentEaSeason.goals,
          currentEaSeason.assists,
          currentEaSeason.hits,
          currentEaSeason.skaterGp,
          currentEaSeason.plusMinus,
        )
      : null

  const currentGamertag = player.gamertag.toLowerCase()
  const aka = Array.from(
    new Set(history.filter((h) => h.gamertag.toLowerCase() !== currentGamertag).map((h) => h.gamertag)),
  )

  // Display name: prefer the manually-set in-game name, fall back to gamertag.
  const displayName = player.playerName ?? player.gamertag

  const showRoleSelector = hasSkaterData && hasGoalieData
  const aggregate = aggregateCareer(career, selectedRole)

  // Career range subtitle ("NHL 22-26 · sum")
  const careerGameTitles = career
    .map((c) => c.gameTitleName)
    .filter((n): n is string => n !== null && n !== undefined)
  const careerRange = careerGameTitles.length > 0
    ? careerGameTitles.length === 1
      ? `${careerGameTitles[0]} · sum`
      : `${careerGameTitles[careerGameTitles.length - 1]}–${careerGameTitles[0]} · sum`
    : 'Career · sum'

  // Pad jersey for the BGM-NNNN ID
  const jerseyForId = player.jerseyNumber !== null
    ? player.jerseyNumber.toString().padStart(4, '0')
    : null

  // Portrait card mini-stats (skater shows G/A/PTS/.PG; goalie shows GP/W/SV%/GAA)
  const portraitStats = buildPortraitStats(currentEaSeason, selectedRole)
  const portraitRecord = buildPortraitRecord(currentEaSeason, selectedRole)

  // Last 10 games — filtered by role, aggregated from trendGames
  const last10 = aggregateLast10(overview.trendGames, selectedRole)

  return (
    <div className="ph-root">
      <section className="ph-hero">
        <CornerRegMarks />

        <div className="ph-ticker" />

        <div className="ph-body">
          {/* ── Col 1 — Portrait Monolith ────────────────────────────── */}
          <div className="ph-col-portrait">
            <PortraitCard>
              <div className="ph-pc-jersey">
                <span className="num">
                  {player.jerseyNumber !== null ? player.jerseyNumber.toString() : '—'}
                </span>
                {positionTag !== null && (
                  <span
                    className="pos-pill"
                    style={
                      {
                        borderColor: `color-mix(in srgb, ${positionColor} 40%, transparent)`,
                        background: `color-mix(in srgb, ${positionColor} 10%, transparent)`,
                        color: positionColor,
                      } as CSSProperties
                    }
                  >
                    {positionTag}
                  </span>
                )}
                {portraitRecord && (
                  <>
                    <span className="rec">{portraitRecord.rec}</span>
                    <span className="pct">{portraitRecord.pct}</span>
                  </>
                )}
              </div>

              <div className="ph-pc-portrait">
                <svg
                  className="silh"
                  viewBox="0 0 100 110"
                  fill="currentColor"
                  preserveAspectRatio="xMidYMax meet"
                  aria-hidden
                >
                  <circle cx="50" cy="32" r="21" />
                  <path d="M 8 110 Q 8 66 50 66 Q 92 66 92 110 Z" />
                </svg>
                <div className="scan" />
              </div>

              <div className="ph-pc-name">
                <span className="ph-pc-platform" aria-hidden>
                  <PlatformIcon platform={currentEaSeason?.clientPlatform ?? null} />
                </span>
                <span className="gamertag" title={displayName}>
                  {displayName}
                </span>
              </div>

              <div className="ph-pc-stats">
                {portraitStats.map((s) => (
                  <div key={s.label} className={`s ${s.lead === true ? 'lead' : ''}`.trim()}>
                    <span className="l">{s.label}</span>
                    <span className="v">{s.value}</span>
                  </div>
                ))}
              </div>

              <div className="ph-pc-identity">
                <div className="cell">
                  {player.nationality !== null ? (
                    <span className="ph-flag-2x">
                      <NationalityFlag code={player.nationality} />
                    </span>
                  ) : null}
                </div>
                <div className="cell">
                  <Image
                    src="/images/bgm-logo.png"
                    alt="BGM"
                    width={56}
                    height={56}
                    className="opacity-90"
                    style={{ width: 56, height: 56, objectFit: 'contain' }}
                  />
                </div>
                <div className="cell" aria-hidden />
              </div>
            </PortraitCard>
          </div>

          {/* ── Col 2 — Identity ─────────────────────────────────────── */}
          <div className="ph-col-id">
            <div className="ph-eyebrow">
              <span className="label">
                Player · {selectedRole === 'goalie' ? 'Goalie' : 'Skater'}
              </span>
              <span className="rule" aria-hidden />
              {jerseyForId !== null && (
                <span className="id-no">
                  ID <b>BGM-{jerseyForId}</b>
                </span>
              )}
            </div>

            <div className="ph-nameplate">
              <h1 className="gamertag">{displayName}</h1>
              {aka.length > 0 && (
                <div className="ph-aka">
                  <span className="also">
                    <em>aka</em>
                    {aka.join(', ')}
                  </span>
                </div>
              )}
            </div>

            <div className="ph-pills">
              {positionFull !== null && (
                <span
                  className="ph-pill pos"
                  style={{ '--pos': positionColor } as CSSProperties}
                >
                  <span className="swatch" style={{ background: positionColor }} aria-hidden />
                  {positionFull}
                </span>
              )}
              {manualArchetype === null && archetypeLabel !== null && (
                <span className="ph-pill role">
                  <span className="dot" aria-hidden />
                  {archetypeLabel}
                </span>
              )}
              {manualArchetype !== null && (
                <ArchetypePillFlagship archetype={manualArchetype} />
              )}
              {player.nationality !== null && (
                <span className="ph-pill flag">
                  <span className="flag-icon" aria-hidden>
                    <NationalityFlag code={player.nationality} />
                  </span>
                  {player.nationality}
                </span>
              )}
              <span className="ph-pill gt">
                <span className="gt-icon" aria-hidden>
                  <PlatformIcon platform={currentEaSeason?.clientPlatform ?? null} />
                </span>
                {player.gamertag}
              </span>
            </div>

            <div className="ph-bottom">
              {player.bio !== null && (
                <div className="ph-bio">
                  <p>{player.bio}</p>
                </div>
              )}

              {showRoleSelector && (
                <div className="ph-role-tabs" role="tablist" aria-label="Role">
                  <RoleTab role="skater" active={selectedRole === 'skater'} gameMode={gameMode}>
                    <SkaterIcon />
                    Skater
                  </RoleTab>
                  <RoleTab role="goalie" active={selectedRole === 'goalie'} gameMode={gameMode}>
                    <GoalieIcon />
                    Goalie
                  </RoleTab>
                </div>
              )}
            </div>
          </div>

          {/* ── Col 3 — Stat Ledger ──────────────────────────────────── */}
          <aside className="ph-col-ledger">
            <LedgerBlock
              title="Last 10 Games"
              src={`${last10.gp.toString()} GP · per-game`}
            >
              {last10.gp > 0 ? (
                selectedRole === 'skater' ? (
                  <SkaterLedger
                    gp={last10.gp}
                    g={(last10 as Last10Skater).g}
                    a={(last10 as Last10Skater).a}
                    pts={(last10 as Last10Skater).pts}
                    plusMinus={(last10 as Last10Skater).plusMinus}
                  />
                ) : (
                  <GoalieLedger
                    gp={last10.gp}
                    w={(last10 as Last10Goalie).w}
                    l={(last10 as Last10Goalie).l}
                    otl={(last10 as Last10Goalie).otl}
                    savePct={(last10 as Last10Goalie).savePct}
                    gaa={(last10 as Last10Goalie).gaa}
                    so={(last10 as Last10Goalie).so}
                  />
                )
              ) : (
                <p className="ph-ledger-empty">No recent games tracked.</p>
              )}
            </LedgerBlock>

            <LedgerBlock
              title="This Season"
              src={
                currentEaSeason !== null && currentEaSeason.gameTitleName !== null
                  ? `${currentEaSeason.gameTitleName} · EA totals`
                  : 'EA totals'
              }
            >
              {currentEaSeason !== null ? (
                selectedRole === 'skater' ? (
                  <SkaterLedger
                    gp={currentEaSeason.skaterGp}
                    g={currentEaSeason.goals}
                    a={currentEaSeason.assists}
                    pts={currentEaSeason.points}
                    plusMinus={currentEaSeason.plusMinus}
                  />
                ) : (
                  <GoalieLedger
                    gp={currentEaSeason.goalieGp}
                    w={currentEaSeason.goalieWins ?? 0}
                    l={currentEaSeason.goalieLosses ?? 0}
                    otl={currentEaSeason.goalieOtl ?? 0}
                    savePct={currentEaSeason.goalieSavePct}
                    gaa={currentEaSeason.goalieGaa}
                    so={currentEaSeason.goalieShutouts ?? 0}
                  />
                )
              ) : (
                <p className="ph-ledger-empty">No current-season data yet.</p>
              )}
            </LedgerBlock>

            <LedgerBlock title="Career Totals" src={careerRange}>
              {aggregate.gp > 0 ? (
                selectedRole === 'skater' ? (
                  <SkaterLedger
                    gp={(aggregate as SkaterAggregate).gp}
                    g={(aggregate as SkaterAggregate).g}
                    a={(aggregate as SkaterAggregate).a}
                    pts={(aggregate as SkaterAggregate).pts}
                    plusMinus={(aggregate as SkaterAggregate).plusMinus}
                  />
                ) : (
                  <GoalieLedger
                    gp={(aggregate as GoalieAggregate).gp}
                    w={(aggregate as GoalieAggregate).w}
                    l={(aggregate as GoalieAggregate).l}
                    otl={(aggregate as GoalieAggregate).otl}
                    savePct={(aggregate as GoalieAggregate).savePct}
                    gaa={(aggregate as GoalieAggregate).gaa}
                    so={(aggregate as GoalieAggregate).so}
                  />
                )
              ) : (
                <p className="ph-ledger-empty">No career data yet.</p>
              )}
            </LedgerBlock>

            {positionEntries.length > 0 && (
              <div className="ph-position-block">
                <div className="head">
                  <h3>
                    <b>▌</b>Position History
                  </h3>
                  <span className="total">
                    <b>{positionTotal.toString()}</b> GP charted
                  </span>
                </div>
                <div className="ph-pos-bars">
                  {positionEntries.map((e) => {
                    const widthPct = positionMaxGp > 0 ? (e.gp / positionMaxGp) * 100 : 0
                    const sharePct = positionTotal > 0
                      ? Math.round((e.gp / positionTotal) * 100)
                      : 0
                    return (
                      <div
                        key={e.key}
                        className="ph-pos-bar"
                        style={{ '--c': e.color } as CSSProperties}
                      >
                        <span className="tag" style={{ color: e.color }}>
                          {e.tag}
                        </span>
                        <span className="track" aria-hidden>
                          <span className="fill" style={{ width: `${widthPct.toFixed(1)}%` }} />
                        </span>
                        <span className="gp">
                          {e.gp.toString()}
                          <em>{sharePct}%</em>
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </aside>
        </div>

        <footer className="ph-foot">
          <span>
            Source <b>EA NHL</b>
          </span>
          <span className="center">— Boogeymen Roster Card —</span>
          <span className="right">
            {jerseyForId !== null ? (
              <>
                Sheet <b>BGM/PRO/{jerseyForId}</b>
              </>
            ) : (
              <>
                Sheet <b>BGM/PRO</b>
              </>
            )}
          </span>
        </footer>
      </section>
    </div>
  )
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function CornerRegMarks() {
  return (
    <>
      <span className="ph-reg tl" aria-hidden>
        <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2">
          <path d="M0 4 V0 H4" />
          <circle cx="7" cy="7" r="1.5" fill="currentColor" />
        </svg>
      </span>
      <span className="ph-reg tr" aria-hidden>
        <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2">
          <path d="M14 4 V0 H10" />
          <circle cx="7" cy="7" r="1.5" fill="currentColor" />
        </svg>
      </span>
      <span className="ph-reg bl" aria-hidden>
        <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2">
          <path d="M0 10 V14 H4" />
          <circle cx="7" cy="7" r="1.5" fill="currentColor" />
        </svg>
      </span>
      <span className="ph-reg br" aria-hidden>
        <svg viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2">
          <path d="M14 10 V14 H10" />
          <circle cx="7" cy="7" r="1.5" fill="currentColor" />
        </svg>
      </span>
    </>
  )
}

function RoleTab({
  role,
  active,
  gameMode,
  children,
}: {
  role: 'skater' | 'goalie'
  active: boolean
  gameMode: GameMode | null
  children: ReactNode
}) {
  const params = new URLSearchParams()
  params.set('role', role)
  if (gameMode !== null) params.set('mode', gameMode)
  return (
    <Link
      href={`?${params.toString()}`}
      className="ph-role-tab"
      aria-selected={active}
      role="tab"
    >
      {children}
    </Link>
  )
}

function SkaterIcon() {
  return (
    <svg className="ico" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M7.6,3,5.1,4.6l4,6.3,1.8-2.8L7.6,3m8.8,0L7.5,17H2v4H8.5L19,4.6,16.4,3M15,14.6l-1.8,2.8L15.5,21H22V17H16.5Z" />
    </svg>
  )
}

function GoalieIcon() {
  return (
    <svg className="ico" viewBox="0 0 60 60" fill="currentColor" aria-hidden>
      <path d="M53.498,15.712l-3.288-6.18c-0.5-0.94-1.339-1.631-2.363-1.943c-0.968-0.297-1.98-0.207-2.881,0.223c-2.27-1.97-4.857-3.445-7.706-4.393C36.975,1.489,35.325,0,33.318,0h-7c-2.042,0-3.712,1.543-3.952,3.522c-2.613,0.91-5.002,2.268-7.12,4.05c-0.017-0.009-0.03-0.022-0.047-0.031c-1.949-1.037-4.374-0.294-5.41,1.653l-3.288,6.18c-0.868,1.632-0.474,3.591,0.818,4.796c-0.23,1.286-0.354,2.571-0.354,3.83v9.676c0,2.565,0.838,4.875,2.717,7.49c1.1,1.53,2.576,1.998,3.763,2.374c1.407,0.445,2.16,0.737,2.569,2.012c0.289,0.901,0.397,1.93,0.331,3.142c-0.054,1.014-0.017,4.549,2.759,7.488c2.378,2.518,6.03,3.802,10.864,3.818c4.828-0.017,8.48-1.301,10.858-3.818c2.775-2.939,2.813-6.475,2.758-7.489c-0.065-1.211,0.043-2.239,0.332-3.141c0.409-1.274,1.162-1.566,2.569-2.012c1.187-0.376,2.663-0.844,3.764-2.375c1.878-2.614,2.716-4.924,2.716-7.489V24c0-1.129-0.118-2.294-0.309-3.467C53.97,19.331,54.373,17.355,53.498,15.712z M47.263,9.502c0.513,0.156,0.933,0.501,1.182,0.97l3.288,6.18c0.454,0.855,0.224,1.893-0.498,2.485l-0.189,0.121l-0.139,0.099c-0.47,0.248-1.009,0.3-1.522,0.144c-0.255-0.078-0.487-0.203-0.687-0.366c-0.032-0.026-0.058-0.059-0.088-0.087c-0.064-0.06-0.13-0.118-0.186-0.186c-0.083-0.101-0.158-0.211-0.222-0.331l-3.287-6.178c-0.006-0.011-0.009-0.024-0.014-0.035c-0.042-0.082-0.073-0.166-0.102-0.251c-0.031-0.1-0.056-0.207-0.075-0.324l-0.026-0.115c-0.006-0.019-0.003-0.039-0.008-0.059c-0.059-0.769,0.329-1.538,1.052-1.922C46.208,9.396,46.749,9.345,47.263,9.502z M34.847,43h-3.882v-9h6.839l2.602,3.644l-1.896,2.768C37.226,42.178,36.061,43,34.847,43z M25.318,43c-0.198,0-0.398-0.021-0.598-0.06c-1.4-0.274-2.797-1.435-3.578-2.506l-0.004-0.006l-1.716-2.535L22.776,34h6.188v9H25.318z M13.912,29.911c-0.62-0.851-0.947-1.857-0.947-2.911v-5.624c0-0.585,0.057-1.114,0.174-1.613c0.029-0.036,0.059-0.071,0.087-0.108c0.116-0.155,0.223-0.318,0.318-0.493c0.006-0.011,0.014-0.02,0.02-0.031l0.763-1.434c0.631-0.499,1.346-0.64,1.769-0.681l2.238,4.128C19.396,23.487,21.746,25,24.318,25h4.646v7h-6.646c-0.291,0-0.567,0.127-0.758,0.348l-3.324,3.857L13.912,29.911z M41.553,17l-1.145,3.317C39.668,21.947,38.033,23,36.243,23h-5.278v-6H41.553z M28.965,17v6h-4.646c-1.79,0-3.425-1.053-4.195-2.745L18.36,17H28.965z M41.609,35.887l-2.477-3.468C38.944,32.156,38.642,32,38.318,32h-7.354v-7h5.278c2.572,0,4.922-1.513,6.021-3.941L43.668,17h0.322c0.394,0.196,1.976,1.245,1.976,5.376V28c0,1.054-0.327,2.061-0.964,2.935L41.609,35.887z M26.318,2h7c1.103,0,2,0.897,2,2c0,0.54-0.218,1.03-0.567,1.39l-0.012,0.009c-0.286,0.29-0.64,0.482-1.025,0.56C33.586,5.986,33.454,6,33.318,6h-7c-0.2,0-0.392-0.037-0.577-0.095c-0.025-0.008-0.049-0.014-0.074-0.023c-0.577-0.208-1.05-0.689-1.271-1.374c-0.03-0.112-0.048-0.228-0.057-0.346l-0.017-0.206C24.347,2.874,25.231,2,26.318,2z M22.63,5.545c0.073,0.174,0.171,0.335,0.267,0.496c0.007,0.012,0.013,0.025,0.02,0.037c0.081,0.132,0.171,0.255,0.267,0.377c0.049,0.063,0.099,0.123,0.151,0.183c0.087,0.098,0.174,0.194,0.27,0.284c0.093,0.087,0.192,0.164,0.293,0.242c0.095,0.073,0.189,0.146,0.29,0.21c0.159,0.101,0.324,0.192,0.497,0.27c0.074,0.033,0.151,0.06,0.227,0.089c0.152,0.058,0.308,0.106,0.467,0.145c0.073,0.018,0.145,0.037,0.22,0.05C25.834,7.971,26.073,8,26.318,8h7c0.266,0,0.527-0.028,0.782-0.079c0.102-0.02,0.196-0.059,0.295-0.087c0.147-0.042,0.296-0.078,0.437-0.136c0.131-0.054,0.25-0.127,0.373-0.193c0.098-0.053,0.199-0.097,0.292-0.159c0.15-0.098,0.284-0.214,0.419-0.33c0.05-0.043,0.107-0.076,0.155-0.122c0.558-0.357,0.959-0.806,1.21-1.355c2.167,0.801,4.161,1.946,5.948,3.416c-0.512,0.822-0.695,1.815-0.535,2.781c0.006,0.074,0.025,0.147,0.035,0.221c0.012,0.054,0.012,0.11,0.026,0.164c0.005,0.029,0.015,0.053,0.02,0.081c0.032,0.158,0.066,0.315,0.118,0.47c0.068,0.217,0.15,0.424,0.253,0.619l0.91,1.71h-1.102h-0.001H16.682c-0.005,0-0.01,0.002-0.015,0.002H16.52c-0.032-0.003-0.333-0.019-0.781,0.039l1.111-2.088l0,0l0.001-0.001c0.137-0.258,0.238-0.527,0.315-0.802c0.01-0.041,0.021-0.089,0.035-0.155c0.026-0.113,0.044-0.223,0.061-0.331c0.019-0.126,0.033-0.252,0.039-0.379c0.001-0.024,0.003-0.04,0.004-0.066c0.003-0.127,0.003-0.255-0.005-0.384c0-0.003-0.001-0.007-0.001-0.01c-0.007-0.1-0.018-0.199-0.032-0.3c-0.003-0.019-0.003-0.036-0.006-0.055c-0.017-0.104-0.038-0.207-0.063-0.309c-0.005-0.022-0.013-0.042-0.018-0.064c-0.016-0.064-0.019-0.128-0.039-0.192c-0.012-0.039-0.033-0.072-0.046-0.11c-0.002-0.007-0.004-0.015-0.006-0.022c-0.022-0.064-0.049-0.128-0.085-0.209c-0.007-0.018-0.018-0.033-0.026-0.051c-0.077-0.182-0.163-0.358-0.265-0.525c-0.006-0.01-0.01-0.023-0.017-0.033C18.481,7.488,20.47,6.346,22.63,5.545z M8.267,16.313l3.288-6.18c0.359-0.676,1.054-1.061,1.771-1.061c0.315,0,0.637,0.075,0.935,0.233c0.102,0.054,0.195,0.12,0.284,0.189l0.097,0.086c0.223,0.198,0.395,0.446,0.514,0.736L15.2,10.42c0.023,0.068,0.039,0.137,0.056,0.206c0.013,0.053,0.024,0.104,0.032,0.15c0.009,0.062,0.015,0.123,0.019,0.182c0.004,0.065,0.004,0.131,0.001,0.218c-0.002,0.042-0.002,0.084-0.009,0.139c-0.009,0.077-0.027,0.154-0.04,0.213l-0.03,0.136c-0.036,0.117-0.08,0.233-0.141,0.347l-3.288,6.18c-0.045,0.084-0.101,0.158-0.156,0.233c-0.043,0.056-0.089,0.112-0.146,0.173c-0.003,0.004-0.004,0.009-0.007,0.013c-0.13,0.139-0.275,0.256-0.434,0.351c-0.029,0.017-0.054,0.04-0.084,0.055h-0.001c-0.568,0.3-1.273,0.321-1.891-0.012l-0.215-0.14C8.07,18.289,7.793,17.204,8.267,16.313z M40.649,53h-21.33c-0.012,0-0.022,0.006-0.034,0.007c-0.362-0.702-0.588-1.391-0.728-2.007h22.762c0.02,0,0.037-0.01,0.057-0.012C41.236,51.606,41.011,52.296,40.649,53z M20.764,55h18.401c-1.996,1.971-5.083,2.986-9.198,3C25.847,57.986,22.76,56.971,20.764,55z M50.965,33.676c0,2.12-0.722,4.07-2.34,6.322c-0.714,0.992-1.654,1.29-2.744,1.635c-1.393,0.441-3.126,0.99-3.869,3.308c-0.365,1.139-0.504,2.401-0.425,3.86c0.003,0.059,0.006,0.149,0.007,0.255C41.504,49.029,41.416,49,41.318,49H18.336c0.001-0.08,0.003-0.15,0.006-0.198c0.08-1.46-0.059-2.723-0.424-3.861c-0.743-2.317-2.477-2.866-3.869-3.308c-1.09-0.345-2.03-0.643-2.743-1.634c-1.619-2.253-2.341-4.203-2.341-6.323V24c0-0.934,0.071-1.884,0.212-2.84c0.032,0.007,0.065,0.007,0.097,0.013c0.153,0.029,0.306,0.05,0.46,0.061c0.053,0.004,0.106,0.008,0.159,0.01c0.044,0.001,0.089,0.008,0.133,0.008c0.105,0,0.209-0.013,0.314-0.021c0.054-0.004,0.107-0.004,0.16-0.011c0.162-0.019,0.322-0.05,0.48-0.089c-0.002,0.084-0.015,0.16-0.015,0.245V27c0,1.479,0.46,2.894,1.314,4.066l7.23,10.521C20.654,43.162,22.862,45,25.318,45h9.528c0.314,0,0.615-0.03,0.904-0.087c1.345-0.261,2.419-1.084,3.27-1.986c0.429-0.454,0.807-0.927,1.124-1.362l0.105-0.153l2.208-3.205c0.014-0.02,0.018-0.043,0.03-0.063l4.148-6.056c0.87-1.195,1.33-2.609,1.33-4.089v-5.624c0-0.489-0.026-0.936-0.063-1.364c0.04,0.024,0.081,0.045,0.121,0.067c0.044,0.024,0.09,0.045,0.134,0.067c0.184,0.093,0.374,0.172,0.569,0.236c0.025,0.008,0.047,0.022,0.073,0.03c0.016,0.005,0.032,0.007,0.048,0.011c0.093,0.027,0.188,0.047,0.283,0.067c0.077,0.017,0.153,0.035,0.231,0.047c0.086,0.013,0.173,0.02,0.26,0.028c0.089,0.008,0.178,0.016,0.266,0.018c0.029,0.001,0.057,0.006,0.086,0.006c0.059,0,0.118-0.008,0.177-0.011c0.076-0.003,0.152-0.006,0.227-0.014c0.078-0.008,0.156-0.021,0.233-0.034c0.062-0.01,0.125-0.014,0.187-0.027c0.111,0.845,0.167,1.681,0.167,2.495v9.679H50.965z" />
    </svg>
  )
}

function LedgerBlock({
  title,
  src,
  children,
}: {
  title: string
  src: string
  children: ReactNode
}) {
  return (
    <div className="ph-ledger-block">
      <div className="ph-ledger-head">
        <h3>
          <b>▌</b>
          {title}
        </h3>
        <span className="src">{src}</span>
      </div>
      {children}
    </div>
  )
}

function SkaterLedger({
  gp,
  g,
  a,
  pts,
  plusMinus,
}: {
  gp: number
  g: number
  a: number
  pts: number
  plusMinus: number
}) {
  const pmClass = plusMinus > 0 ? 'pos' : plusMinus < 0 ? 'neg' : ''
  const pmText =
    plusMinus > 0
      ? `+${plusMinus.toString()}`
      : plusMinus < 0
        ? plusMinus.toString()
        : '0'
  return (
    <div className="ph-ledger-grid cols-5">
      <Stat label="GP" value={gp.toString()} />
      <Stat label="G" value={g.toString()} />
      <Stat label="A" value={a.toString()} />
      <Stat label="PTS" value={pts.toString()} lead />
      <Stat label="+/–" value={pmText} valueClass={pmClass} />
    </div>
  )
}

function GoalieLedger({
  gp,
  w,
  l,
  otl,
  savePct,
  gaa,
  so,
}: {
  gp: number
  w: number
  l: number
  otl: number
  savePct: string | null
  gaa: string | null
  so: number
}) {
  const record = `${w.toString()}-${l.toString()}-${otl.toString()}`
  return (
    <div className="ph-ledger-grid cols-5 dense">
      <Stat label="GP" value={gp.toString()} />
      <Stat label="REC" value={record} />
      <Stat label="SV%" value={savePct ?? '—'} lead />
      <Stat label="GAA" value={gaa ?? '—'} />
      <Stat label="SO" value={so.toString()} />
    </div>
  )
}

function Stat({
  label,
  value,
  lead = false,
  valueClass = '',
}: {
  label: string
  value: string
  lead?: boolean
  valueClass?: string
}) {
  return (
    <div className={`stat${lead ? ' lead' : ''}`}>
      <span className="l">{label}</span>
      <span className={`v ${valueClass}`.trim()}>{value}</span>
    </div>
  )
}

// ─── Portrait card data builders ────────────────────────────────────────────

interface PortraitStat {
  label: string
  value: string
  lead?: boolean
}

function buildPortraitStats(
  season: PlayerProfileOverview['currentEaSeason'],
  role: 'skater' | 'goalie',
): PortraitStat[] {
  if (season === null) {
    if (role === 'goalie') {
      return [
        { label: 'GP', value: '—' },
        { label: 'W', value: '—' },
        { label: 'SO', value: '—' },
        { label: 'SV%', value: '—' },
      ]
    }
    return [
      { label: 'GP', value: '—' },
      { label: 'G', value: '—' },
      { label: 'A', value: '—' },
      { label: 'PTS', value: '—', lead: true },
    ]
  }
  if (role === 'skater') {
    return [
      { label: 'GP', value: season.skaterGp.toString() },
      { label: 'G', value: season.goals.toString() },
      { label: 'A', value: season.assists.toString() },
      { label: 'PTS', value: season.points.toString(), lead: true },
    ]
  }
  // goalie — no `lead` (keeps SV% at default 22px so "92.30" fits the cell)
  return [
    { label: 'GP', value: season.goalieGp.toString() },
    { label: 'W', value: (season.goalieWins ?? 0).toString() },
    { label: 'SO', value: (season.goalieShutouts ?? 0).toString() },
    {
      label: 'SV%',
      value: season.goalieSavePct ?? '—',
    },
  ]
}

function buildPortraitRecord(
  season: PlayerProfileOverview['currentEaSeason'],
  role: 'skater' | 'goalie',
): { rec: string; pct: string } | null {
  if (season === null) return null
  if (role === 'skater') {
    if (season.skaterGp === 0) return null
    const rec = `${season.skaterWins.toString()}-${season.skaterLosses.toString()}-${season.skaterOtl.toString()}`
    return { rec, pct: `${season.skaterWinPct.toString()}% Win` }
  }
  if (season.goalieGp === 0) return null
  const rec = `${(season.goalieWins ?? 0).toString()}-${(season.goalieLosses ?? 0).toString()}-${(season.goalieOtl ?? 0).toString()}`
  return { rec, pct: season.goalieSavePct !== null ? `${season.goalieSavePct}% SV` : '— SV' }
}

// ─── Last-10-games aggregate ────────────────────────────────────────────────

interface Last10Skater {
  role: 'skater'
  gp: number
  g: number
  a: number
  pts: number
  plusMinus: number
}
interface Last10Goalie {
  role: 'goalie'
  gp: number
  w: number
  l: number
  otl: number
  so: number
  savePct: string | null
  gaa: string | null
}
type Last10 = Last10Skater | Last10Goalie

function aggregateLast10(
  trendGames: PlayerProfileOverview['trendGames'],
  role: 'skater' | 'goalie',
): Last10 {
  const games = trendGames.filter((g) => g.isGoalie === (role === 'goalie')).slice(0, 10)
  if (role === 'skater') {
    const sum = games.reduce(
      (acc, g) => ({
        gp: acc.gp + 1,
        g: acc.g + g.goals,
        a: acc.a + g.assists,
        pts: acc.pts + g.goals + g.assists,
        plusMinus: acc.plusMinus + g.plusMinus,
      }),
      { gp: 0, g: 0, a: 0, pts: 0, plusMinus: 0 },
    )
    return { role, ...sum }
  }
  // goalie
  const totals = games.reduce(
    (acc, g) => ({
      gp: acc.gp + 1,
      w: acc.w + (g.result === 'WIN' ? 1 : 0),
      l: acc.l + (g.result === 'LOSS' ? 1 : 0),
      otl: acc.otl + (g.result === 'OTL' ? 1 : 0),
      so: acc.so + ((g.goalsAgainst ?? 0) === 0 && g.result === 'WIN' ? 1 : 0),
      saves: acc.saves + (g.saves ?? 0),
      ga: acc.ga + (g.goalsAgainst ?? 0),
    }),
    { gp: 0, w: 0, l: 0, otl: 0, so: 0, saves: 0, ga: 0 },
  )
  const shots = totals.saves + totals.ga
  const savePct = shots > 0 ? ((totals.saves / shots) * 100).toFixed(1) : null
  // GAA approximation: avg GA per game (assumes one full goalie game = 60 min)
  const gaa = totals.gp > 0 ? (totals.ga / totals.gp).toFixed(2) : null
  return {
    role,
    gp: totals.gp,
    w: totals.w,
    l: totals.l,
    otl: totals.otl,
    so: totals.so,
    savePct,
    gaa,
  }
}

// ─── Career aggregate (unchanged from original) ─────────────────────────────

interface SkaterAggregate {
  gp: number
  g: number
  a: number
  pts: number
  plusMinus: number
  shots: number
  hits: number
  pim: number
  shtPct: string | null
}
interface GoalieAggregate {
  gp: number
  w: number
  l: number
  otl: number
  so: number
  savePct: string | null
  gaa: string | null
}

type CareerAggregate = SkaterAggregate | GoalieAggregate

function aggregateCareer(
  rows: PlayerCareerSeasonRow[],
  role: 'skater' | 'goalie',
): CareerAggregate {
  if (role === 'skater') {
    const filtered = rows.filter((r) => r.skaterGp > 0)
    const sum = filtered.reduce(
      (acc, r) => ({
        gp: acc.gp + r.skaterGp,
        g: acc.g + r.goals,
        a: acc.a + r.assists,
        pts: acc.pts + r.points,
        plusMinus: acc.plusMinus + r.plusMinus,
        shots: acc.shots + r.shots,
        hits: acc.hits + r.hits,
        pim: acc.pim + r.pim,
      }),
      { gp: 0, g: 0, a: 0, pts: 0, plusMinus: 0, shots: 0, hits: 0, pim: 0 },
    )
    const sht = sum.shots > 0 ? `${((sum.g / sum.shots) * 100).toFixed(1)}%` : null
    return { ...sum, shtPct: sht }
  }
  const filtered = rows.filter((r) => r.goalieGp > 0)
  const sum = filtered.reduce(
    (acc, r) => ({
      gp: acc.gp + r.goalieGp,
      w: acc.w + (r.wins ?? 0),
      l: acc.l + (r.losses ?? 0),
      otl: acc.otl + (r.otl ?? 0),
      so: acc.so + (r.shutouts ?? 0),
    }),
    { gp: 0, w: 0, l: 0, otl: 0, so: 0 },
  )
  return { ...sum, savePct: null, gaa: null }
}
