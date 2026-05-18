import Image from 'next/image'
import Link from 'next/link'
import type { LineupRow, MatchLineupProvenance, MatchLineups } from '@eanhl/db/queries'
import type { GameMode } from '@eanhl/db'
import { SectionHeader } from '@/components/ui/section-header'
import { Panel } from '@/components/ui/panel'
import { PlayerSilhouette } from '@/components/home/player-card'
import { xFactorIconUrl } from '@/lib/xfactor-asset'
import { LineupLadder, type LineupLadderItem } from '@/components/matches/lineup-ladder'
import { LineupExpandPanel } from '@/components/matches/lineup-expand-panel'
import { ArchetypePillCompact } from '@/components/ui/archetype-pill'
import type { PlayerArchetype } from '@eanhl/db/schema'
import { colorForPosition } from '@/lib/position-colors'

/**
 * Lineup & Loadouts — position-matched ladder mirroring the in-game
 * pre-game scouting sheet. Per the Boogeymen Design System Lineup.html
 * "Concept B" handoff: BGM on the left, opponent on the right, a
 * center position-badge column gluing each matchup row.
 *
 * Each row is one of {C, LW, RW, LD, RD, G}. When either side didn't
 * dress a human at that position, the side renders as a CPU placeholder.
 * Goalies in this dataset are usually CPU on both sides.
 *
 * X-Factors render as small tier-colored chips (Elite=accent red, All
 * Star=neutral light, Specialist=neutral dim) rather than the 84-PNG
 * library — the chips read at a glance for the comparison-first goal of
 * this section. The PNG library stays available for the Action Tracker
 * cards and any future detail-view drill-down.
 */

interface LineupSectionProps {
  lineups: MatchLineups
  opponentLabel: string
  matchId: number
  gameMode: GameMode | null
  provenance: MatchLineupProvenance
}

const POSITIONS: PositionKey[] = ['C', 'LW', 'RW', 'LD', 'RD', 'G']
type PositionKey = 'C' | 'LW' | 'RW' | 'LD' | 'RD' | 'G'
type Tier = 'Elite' | 'All Star' | 'Specialist'

export function LineupSection({
  lineups,
  opponentLabel,
  matchId,
  gameMode,
  provenance,
}: LineupSectionProps) {
  const bgm = lineups.bgm
  const opp = lineups.opponent
  if (bgm.length === 0 && opp.length === 0) return null

  const bgmByPos = bucketByPosition(bgm)
  const oppByPos = bucketByPosition(opp)
  const opponentAbbrev = abbreviateTeam(opponentLabel)
  const modeLabel = gameMode ? `EASHL ${gameMode}` : 'EASHL 6s'

  return (
    <section className="space-y-3">
      <SectionHeader label="Lineup & Loadouts" subtitle="Pre-game scouting sheet" />
      <SummaryBand
        bgm={bgm}
        opp={opp}
        opponentLabel={opponentLabel}
        opponentAbbrev={opponentAbbrev}
        matchId={matchId}
        modeLabel={modeLabel}
      />
      <LineupLadder
        items={POSITIONS.map((pos) =>
          buildLadderItem(pos, bgmByPos.get(pos) ?? null, oppByPos.get(pos) ?? null),
        )}
      />
      <OcrProvenanceFooter provenance={provenance} />
    </section>
  )
}

// ─── OCR provenance footer ──────────────────────────────────────────────────

function OcrProvenanceFooter({ provenance }: { provenance: MatchLineupProvenance }) {
  if (provenance.capturedAt === null) return null
  const { capturedAt, sources, confidence } = provenance
  const earliest = capturedAt.earliest
  const latest = capturedAt.latest
  const sameInstant = earliest.getTime() === latest.getTime()
  const capturedLabel = sameInstant
    ? formatProvenanceTimestamp(earliest)
    : `${formatProvenanceTimestamp(earliest)} → ${formatProvenanceTimestamp(latest)}`
  const sourcesLabel = formatSourcesLabel(sources)
  const overall = (confidence.canonical + confidence.tiered + confidence.attribute) / 3
  const overallLabel = `${overallConfidenceWord(overall)} · ${overall.toFixed(2)}`
  const overallTone =
    overall >= 0.9
      ? 'text-[var(--color-win)]'
      : overall >= 0.6
        ? 'text-[var(--color-fg-2)]'
        : 'text-[var(--color-otl)]'

  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-3 border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
      <FootKV k="Captured" v={capturedLabel} />
      <FootKV k="Sources" v={sourcesLabel} />
      <div className="flex flex-col gap-[2px]">
        <span className="font-condensed text-[9px] font-semibold uppercase tracking-[0.22em] text-[var(--color-fg-6)]">
          Confidence
        </span>
        <span className={`font-condensed text-[11px] font-bold tracking-[0.04em] ${overallTone}`}>
          {overallLabel}
        </span>
      </div>
      <div className="ml-auto flex flex-wrap items-center gap-1.5">
        <SrcBadge
          label={`Canonical · ${formatPercent(confidence.canonical)}`}
          tone={confidence.canonical >= 0.9 ? 'ok' : 'warn'}
        />
        <SrcBadge
          label={`Tiered · ${formatPercent(confidence.tiered)}`}
          tone={confidence.tiered >= 0.9 ? 'ok' : 'warn'}
        />
        <SrcBadge
          label={`Attribute · ${formatPercent(confidence.attribute)}`}
          tone={confidence.attribute >= 0.9 ? 'ok' : 'warn'}
        />
      </div>
    </div>
  )
}

function FootKV({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex flex-col gap-[2px]">
      <span className="font-condensed text-[9px] font-semibold uppercase tracking-[0.22em] text-[var(--color-fg-6)]">
        {k}
      </span>
      <span className="font-condensed text-[11px] font-bold tracking-[0.04em] text-[var(--color-fg-3)]">
        {v}
      </span>
    </div>
  )
}

function SrcBadge({ label, tone }: { label: string; tone: 'ok' | 'warn' }) {
  const cls =
    tone === 'ok'
      ? 'border-[var(--color-win-border)] bg-[var(--color-win-bg)] text-[var(--color-win)]'
      : 'border-[var(--color-otl-border)] bg-[var(--color-otl-bg)] text-[var(--color-otl)]'
  return (
    <span
      className={`inline-flex items-center gap-1.5 border px-2 py-[2px] font-condensed text-[9.5px] font-bold uppercase tracking-[0.18em] ${cls}`}
    >
      {label}
    </span>
  )
}

function formatProvenanceTimestamp(d: Date): string {
  // Match the mockup's style: "12 Mar 2026 · 21:08 EST"-ish but use the
  // browser's local zone — the visitor's clock is what they read against.
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const SCREEN_TYPE_LABELS: Readonly<Record<string, string>> = {
  pre_game_lobby: 'Pre-game lobby',
  pre_game_lobby_state_2: 'Pre-game lobby',
  player_loadout_view: 'Loadout view',
}

function formatSourcesLabel(sources: MatchLineupProvenance['sources']): string {
  if (sources.length === 0) return '—'
  const names = new Set<string>()
  for (const s of sources) names.add(SCREEN_TYPE_LABELS[s.screenType] ?? s.screenType)
  return [...names].join(' + ')
}

function overallConfidenceWord(score: number): string {
  if (score >= 0.9) return 'High'
  if (score >= 0.7) return 'Solid'
  if (score >= 0.5) return 'Partial'
  return 'Low'
}

function formatPercent(n: number): string {
  return `${Math.round(n * 100)}%`
}

// ─── Summary band ───────────────────────────────────────────────────────────

function SummaryBand({
  bgm,
  opp,
  opponentLabel,
  opponentAbbrev,
  matchId,
  modeLabel,
}: {
  bgm: LineupRow[]
  opp: LineupRow[]
  opponentLabel: string
  opponentAbbrev: string
  matchId: number
  modeLabel: string
}) {
  return (
    <div className="grid grid-cols-1 border border-[var(--color-border)] bg-[var(--color-surface)] md:grid-cols-[1fr_96px_1fr]">
      <SummarySide
        side="bgm"
        name="Mississauga Boogeymen"
        sublabel="BGM"
        rows={bgm}
        crestLogo="/images/bgm-logo.png"
      />
      <div className="hidden flex-col items-center justify-center gap-1.5 border-x border-[var(--color-border)] bg-[var(--color-background)] px-1.5 py-3 md:flex">
        <span className="font-condensed text-[9px] font-semibold uppercase tracking-[0.22em] text-[var(--color-fg-6)]">
          Game
        </span>
        <span className="font-condensed text-[18px] font-black leading-none tabular-nums text-[var(--color-fg-1)]">
          {matchId}
        </span>
        <span className="mt-0.5 font-condensed text-[14px] font-bold tracking-[0.3em] text-[var(--color-fg-5)]">
          VS
        </span>
        <span className="font-condensed text-[9px] font-semibold uppercase tracking-[0.22em] text-[var(--color-fg-6)]">
          {modeLabel}
        </span>
      </div>
      <SummarySide
        side="opp"
        name={opponentLabel}
        sublabel={opponentAbbrev}
        rows={opp}
        crestLogo={null}
      />
    </div>
  )
}

function SummarySide({
  side,
  name,
  sublabel,
  rows,
  crestLogo,
}: {
  side: 'bgm' | 'opp'
  name: string
  sublabel: string
  rows: LineupRow[]
  crestLogo: string | null
}) {
  const skaters = rows.filter((r) => r.position !== 'G')
  const dressed = skaters.length
  const captain = rows.find((r) => r.isCaptain && r.playerNumber !== null)
  const goalieRow = rows.find((r) => r.position === 'G')
  const goalieLabel =
    goalieRow && goalieRow.playerNumber !== null ? `#${String(goalieRow.playerNumber)}` : 'CPU'
  const buildChips = summarizeBuilds(rows)
  const bgClass = side === 'opp' ? 'bg-[rgba(35,33,34,0.45)]' : ''
  const borderClass = side === 'bgm' ? 'md:border-r md:border-[var(--color-border)]' : ''
  // Mirror layout: BGM crest on left + content right; OPP crest on right +
  // content left, with text-right + justify-end so the right edge anchors.
  const gridCols = side === 'opp' ? 'grid-cols-[1fr_auto]' : 'grid-cols-[auto_1fr]'
  const justifyClass = side === 'opp' ? 'justify-end' : ''
  const sideAlign = side === 'opp' ? 'text-right' : ''
  return (
    <div
      className={`grid ${gridCols} items-center gap-x-4 gap-y-3 px-5 py-4 ${sideAlign} ${bgClass} ${borderClass}`}
    >
      {side === 'opp' ? (
        <>
          <div>
            <div className="font-condensed text-[18px] font-black uppercase leading-tight tracking-[0.1em] text-[var(--color-fg-1)]">
              {name}
            </div>
            <div className="mt-1 font-condensed text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--color-fg-5)]">
              {sublabel} · Away
            </div>
          </div>
          <div className="flex h-11 w-11 items-center justify-center rounded-full border border-[var(--color-border)] bg-black/30">
            {crestLogo ? (
              <Image src={crestLogo} alt={sublabel} width={32} height={32} />
            ) : (
              <span className="font-condensed text-[14px] font-black tracking-[0.06em] text-[var(--color-fg-3)]">
                {sublabel}
              </span>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="flex h-11 w-11 items-center justify-center rounded-full border border-[var(--color-border)] bg-black/30">
            {crestLogo ? (
              <Image src={crestLogo} alt={sublabel} width={32} height={32} />
            ) : (
              <span className="font-condensed text-[14px] font-black tracking-[0.06em] text-[var(--color-fg-3)]">
                {sublabel}
              </span>
            )}
          </div>
          <div>
            <div className="font-condensed text-[18px] font-black uppercase leading-tight tracking-[0.1em] text-[var(--color-fg-1)]">
              {name}
            </div>
            <div className="mt-1 font-condensed text-[10px] font-semibold uppercase tracking-[0.22em] text-[var(--color-fg-5)]">
              {sublabel} · Home
            </div>
          </div>
        </>
      )}
      <div className={`col-span-2 flex flex-wrap items-start gap-x-4 gap-y-2.5 ${justifyClass}`}>
        <DressedKV count={dressed} />
        <KV k="Goalie" v={goalieLabel} dim={goalieLabel === 'CPU'} />
        <KV k="Room Leader" v={captain ? `#${String(captain.playerNumber)}` : '—'} />
      </div>
      {buildChips.length > 0 ? (
        <div className={`col-span-2 flex flex-wrap items-center gap-2 ${justifyClass}`}>
          {buildChips.map((chip) => (
            <SummaryBuildChipView key={chip.key} chip={chip} isBgm={side === 'bgm'} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function KV({ k, v, accent, dim }: { k: string; v: string; accent?: boolean; dim?: boolean }) {
  const tone =
    accent === true
      ? 'text-[var(--color-accent)]'
      : dim === true
        ? 'text-[var(--color-fg-4)]'
        : 'text-[var(--color-fg-2)]'
  return (
    <div className="flex flex-col gap-[2px]">
      <span className="font-condensed text-[9px] font-semibold uppercase tracking-[0.2em] text-[var(--color-fg-5)]">
        {k}
      </span>
      <span className={`font-condensed text-[13px] font-extrabold tabular-nums ${tone}`}>{v}</span>
    </div>
  )
}

/** Dressed N/6 — the "/6" is dimmed against the EASHL 6v6 baseline. */
function DressedKV({ count }: { count: number }) {
  return (
    <div className="flex flex-col gap-[2px]">
      <span className="font-condensed text-[9px] font-semibold uppercase tracking-[0.2em] text-[var(--color-fg-5)]">
        Dressed
      </span>
      <span className="font-condensed text-[13px] font-extrabold tabular-nums text-[var(--color-fg-2)]">
        {count}
        <span className="text-[var(--color-fg-5)]">/6</span>
      </span>
    </div>
  )
}

/**
 * Map a canonical build label (e.g. "Power Forward", "Puck Moving Defenseman")
 * to the `PlayerArchetype` enum used by the shared `ArchetypePill` component.
 * Returns null when the build doesn't map — caller falls back to a plain text
 * chip so we never lose the information entirely.
 */
function buildToArchetype(build: string): PlayerArchetype | null {
  switch (build) {
    case 'Playmaker':
      return 'playmaker'
    case 'Sniper':
      return 'sniper'
    case 'Power Forward':
      return 'power-forward'
    case 'Grinder':
      return 'grinder'
    case 'Two-Way Forward':
      return 'two-way-fwd'
    case 'Puck Moving Defenseman':
      return 'puckmover'
    case 'Defensive Defenseman':
      return 'defensive-d'
    case 'Offensive Defenseman':
      return 'offensive-d'
    default:
      return null
  }
}

/**
 * Summary-band chip — wraps `BuildArchetype` and prepends a `2×` style
 * multiplier when the bare build has been collapsed.
 */
function SummaryBuildChipView({ chip, isBgm }: { chip: SummaryBuildChip; isBgm: boolean }) {
  const prefix = chip.count > 1 ? `${String(chip.count)}× ` : ''
  return (
    <span className="inline-flex items-center gap-1">
      {prefix ? (
        <span className="font-condensed text-[10px] font-bold tabular-nums text-[var(--color-fg-3)]">
          {prefix}
        </span>
      ) : null}
      {/* Summary-band chips never show the reference-player suffix — the
          archetype pill alone is enough at this density. The ref name only
          appears inside the drill-down build block. */}
      <BuildArchetype label={chip.build} ref_={null} isBgm={isBgm} />
    </span>
  )
}

/**
 * Compact archetype pill + optional reference-player label. Mirrors the
 * roster-page treatment but adds a small "ref" line when the build is a
 * reference build like "Cole Caufield - Sniper". Falls back to a plain
 * text chip when the build doesn't map to a known archetype.
 */
function BuildArchetype({
  label,
  ref_,
  isBgm,
}: {
  label: string
  ref_: string | null
  isBgm: boolean
}) {
  const archetype = buildToArchetype(label)
  if (archetype) {
    return (
      <span className="inline-flex items-center gap-2">
        <ArchetypePillCompact archetype={archetype} />
        {ref_ ? (
          <span className="font-condensed text-[9px] font-semibold uppercase tracking-[0.16em] text-[var(--color-fg-5)]">
            {ref_}
          </span>
        ) : null}
      </span>
    )
  }
  // Unknown build — keep the previous bordered chip so we never lose the info.
  return (
    <span
      className={`inline-flex items-center gap-2 border bg-[var(--color-background)] px-2.5 py-[3px] font-condensed text-[11px] font-bold uppercase tracking-[0.06em] text-[var(--color-fg-2)] ${
        isBgm ? 'border-[rgba(232,65,49,0.25)]' : 'border-[var(--color-border)]'
      }`}
    >
      {label}
      {ref_ ? (
        <span className="border-l border-[var(--color-border)] pl-2 font-condensed text-[9px] font-semibold uppercase tracking-[0.16em] text-[var(--color-fg-5)]">
          {ref_}
        </span>
      ) : null}
    </span>
  )
}

// ─── Ladder row ─────────────────────────────────────────────────────────────

/**
 * Pre-render the JSX for a single ladder slot, packaged as a `LineupLadderItem`
 * for the client wrapper to consume. Returning JSX from the server (rather
 * than rendering the row inline) keeps the open-state lifted to the parent
 * client wrapper — only one row can be expanded at a time.
 */
function buildLadderItem(
  position: PositionKey,
  bgm: LineupRow | null,
  opp: LineupRow | null,
): LineupLadderItem {
  // Defensive guard: even with the DB-layer junk filter, a row with no
  // build, no jersey, AND no X-Factors is almost certainly OCR noise that
  // slipped through. Force the CPU placeholder so the section never has
  // to render a half-empty card.
  const bgmRow = bgm && isRenderable(bgm) ? bgm : null
  const oppRow = opp && isRenderable(opp) ? opp : null
  // Goalie rows are CPU on both sides for every match observed so far —
  // there's nothing to drill into. Skip the expand wiring entirely.
  const expandable = position !== 'G' && (bgmRow !== null || oppRow !== null)

  const bgmCard = bgmRow ? (
    <PlayerCard row={bgmRow} side="bgm" />
  ) : (
    <CpuPlaceholderCard side="bgm" position={position} />
  )
  const oppCard = oppRow ? (
    <PlayerCard row={oppRow} side="opp" />
  ) : (
    <CpuPlaceholderCard side="opp" position={position} />
  )
  const positionBadge = <PositionBadge position={position} />
  // Mobile-only counterpart: the desktop badge is hidden on <md, so the
  // position letter would otherwise disappear on phone widths. This strip
  // keeps it as an anchor above each row.
  const mobileMatchupStrip = <MobileMatchupStrip position={position} />

  const expandPanel = (
    <LineupExpandPanel
      bgm={bgmRow}
      opp={oppRow}
      position={position}
      bgmRef={bgmRow ? splitBuild(bgmRow).ref : null}
      oppRef={oppRow ? splitBuild(oppRow).ref : null}
    />
  )

  return {
    position,
    bgmCard,
    oppCard,
    positionBadge,
    mobileMatchupStrip,
    expandPanel,
    expandable,
  }
}

const JUNK_GAMERTAG_TOKENS = new Set(['away', 'home', 'cpu', '?', '(unknown)'])

function isRenderable(row: LineupRow): boolean {
  const tag = (row.gamertagSnapshot ?? '').trim()
  if (!tag || JUNK_GAMERTAG_TOKENS.has(tag.toLowerCase())) return false
  const hasBuild = row.buildClass !== null || row.buildClassCanonical !== null
  const hasNumber = row.playerNumber !== null
  const hasXFactors = row.xFactors.length > 0
  return hasBuild || hasNumber || hasXFactors
}

function MobileMatchupStrip({ position }: { position: PositionKey }) {
  const color = colorForPosition(position)
  return (
    <div
      className="flex items-center justify-center gap-2 border-y px-3 py-1.5 md:hidden"
      style={{
        background: `color-mix(in srgb, ${color} 10%, transparent)`,
        borderColor: `color-mix(in srgb, ${color} 40%, transparent)`,
      }}
    >
      <span
        className="font-condensed text-[14px] font-black uppercase tracking-[0.08em] tabular-nums"
        style={{ color }}
      >
        {position}
      </span>
    </div>
  )
}

function PositionBadge({ position }: { position: PositionKey }) {
  const color = colorForPosition(position)
  return (
    <div
      className="hidden flex-col items-center justify-center gap-1.5 border-y py-2 md:flex"
      style={{
        background: `color-mix(in srgb, ${color} 10%, transparent)`,
        borderColor: `color-mix(in srgb, ${color} 40%, transparent)`,
      }}
    >
      <span className="font-condensed text-[9px] font-semibold uppercase tracking-[0.22em] text-[var(--color-fg-6)]">
        Pos
      </span>
      <span
        className="font-condensed text-[24px] font-black uppercase tracking-[0.08em] tabular-nums"
        style={{ color }}
      >
        {position}
      </span>
    </div>
  )
}

// ─── Player card ────────────────────────────────────────────────────────────

function PlayerCard({ row, side }: { row: LineupRow; side: 'bgm' | 'opp' }) {
  const gamertag = row.player?.gamertag ?? row.gamertagSnapshot ?? '?'
  // Persona = the lobby-state-2 in-game name ("M. Rantanen"). We deliberately
  // don't fall back to `playerNameSnapshot` (the loadout-view title bar
  // gives the long-form "Mikko Rantanen", which is inconsistent with the
  // rest of the page); show the gamertag instead when persona is missing.
  const persona = row.playerNamePersona ?? gamertag
  const { build: buildLabel, ref: buildRef } = splitBuild(row)
  const hwh = formatHWH(row.heightText, row.weightLbs, row.handedness)
  // Platform comes from EA's per-player `client_platform` field (verified
  // authoritative). `getMatchLineups` overlays it onto every row when the
  // EA payload has a value for that player. Falls back to null when EA has
  // no row for this slot (no icon rendered, no visual noise).
  const platform = resolvePlatform(row.platform)
  const sharedClass =
    'group relative grid min-h-[96px] items-center gap-3.5 border bg-[var(--color-surface)] px-4 py-3.5 transition-colors hover:bg-[var(--color-surface-raised)] hover:border-[#514e4f]'

  // BGM cards: jersey | avatar | info | xf-stack-right
  // Opp cards: xf-stack-left | info | avatar | jersey  (mirrored)
  if (side === 'bgm') {
    return (
      <div
        className={`${sharedClass} grid-cols-[64px_56px_1fr_auto] border-l-2 border-[var(--color-border)] border-l-[var(--color-accent)]`}
      >
        <Jersey number={row.playerNumber} isCaptain={row.isCaptain} side="bgm" />
        <Avatar side="bgm" />
        <PlayerInfo
          persona={persona}
          gamertag={gamertag}
          playerHref={row.player ? `/roster/${String(row.player.id)}` : null}
          platform={platform}
          buildLabel={buildLabel}
          buildRef={buildRef}
          hwh={hwh}
          align="left"
          isBgm
        />
        <XFactorStack xFactors={row.xFactors} />
      </div>
    )
  }
  return (
    <div className={`${sharedClass} grid-cols-[auto_1fr_56px_64px] border-r-2 border-[var(--color-border)] border-r-[var(--color-accent)]`}>
      <XFactorStack xFactors={row.xFactors} />
      <PlayerInfo
        persona={persona}
        gamertag={gamertag}
        playerHref={row.player ? `/roster/${String(row.player.id)}` : null}
        platform={platform}
        buildLabel={buildLabel}
        buildRef={buildRef}
        hwh={hwh}
        align="right"
        isBgm={false}
      />
      <Avatar side="opp" />
      <Jersey number={row.playerNumber} isCaptain={row.isCaptain} side="opp" />
    </div>
  )
}

/**
 * Horizontal row of 3 X-Factor icons (44px). Sits opposite the jersey + portrait
 * on every player card. Names move to the drill-down panel — the icon alone
 * communicates identity at a glance and the hover tooltip carries the name +
 * tier for accessibility. When `canonicalName` or `tier` is null we fall back
 * to a small colored dot (tier-tinted when tier is known, otherwise neutral).
 */
function XFactorStack({ xFactors }: { xFactors: LineupRow['xFactors'] }) {
  if (xFactors.length === 0) {
    return <span className="w-6" aria-hidden />
  }
  return (
    <div className="flex flex-row items-center justify-center gap-2">
      {xFactors.map((xf) => {
        const displayName = prettyXFactorName(xf.canonicalName, xf.name)
        const tier = xf.tier as Tier | null
        const iconUrl = xFactorIconUrl(xf.canonicalName, tier)
        const title = tier ? `${displayName} — ${tier}` : displayName
        if (iconUrl) {
          return (
            <Image
              key={xf.slotIndex}
              src={iconUrl}
              alt={title}
              title={title}
              width={44}
              height={44}
              className="h-11 w-11 shrink-0"
            />
          )
        }
        const tone = tierTone(tier)
        return (
          <span
            key={xf.slotIndex}
            title={title}
            className={`flex h-11 w-11 items-center justify-center rounded-full border ${tone.cls}`}
            aria-label={title}
          >
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${tone.dot}`} />
          </span>
        )
      })}
    </div>
  )
}

function CpuPlaceholderCard({ side, position }: { side: 'bgm' | 'opp'; position: PositionKey }) {
  const hatchBackground =
    'repeating-linear-gradient(135deg, var(--color-surface) 0, var(--color-surface) 8px, var(--color-background) 8px, var(--color-background) 10px)'
  const personaLabel = position === 'G' ? 'CPU Goalie' : 'CPU'
  const subline = 'EA AI · default loadout · no X-Factors'
  const sharedClass =
    'relative grid min-h-[96px] items-center gap-3.5 border bg-[var(--color-surface)] px-4 py-3.5'

  if (side === 'bgm') {
    return (
      <div
        className={`${sharedClass} grid-cols-[64px_56px_1fr] border-l-2 border-[var(--color-border)] border-l-[var(--color-accent)]`}
        style={{ background: hatchBackground }}
      >
        <Jersey number={null} isCaptain={null} side="bgm" cpu />
        <Avatar side="bgm" cpu />
        <CpuInfo personaLabel={personaLabel} subline={subline} align="left" />
      </div>
    )
  }
  return (
    <div
      className={`${sharedClass} grid-cols-[1fr_56px_64px] border-r-2 border-[var(--color-border)] border-r-[var(--color-accent)]`}
      style={{ background: hatchBackground }}
    >
      <CpuInfo personaLabel={personaLabel} subline={subline} align="right" />
      <Avatar side="opp" cpu />
      <Jersey number={null} isCaptain={null} side="opp" cpu />
    </div>
  )
}

function CpuInfo({
  personaLabel,
  subline,
  align,
}: {
  personaLabel: string
  subline: string
  align: 'left' | 'right'
}) {
  const justify = align === 'right' ? 'justify-end' : ''
  const textAlign = align === 'right' ? 'text-right' : ''
  return (
    <div className={`min-w-0 ${textAlign}`}>
      <div className={`flex flex-wrap items-baseline gap-2 ${justify}`}>
        <span className="font-condensed text-[16px] font-extrabold uppercase leading-none tracking-[0.04em] text-[var(--color-fg-4)]">
          {personaLabel}
        </span>
        <span className="inline-block border border-dashed border-[var(--color-border)] px-2 py-[2px] font-condensed text-[10px] font-bold uppercase tracking-[0.22em] text-[var(--color-fg-4)]">
          No human dressed
        </span>
      </div>
      <div
        className={`mt-2 flex flex-wrap items-center gap-2.5 font-condensed text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--color-fg-5)] ${justify}`}
      >
        {subline}
      </div>
    </div>
  )
}

// ─── Card sub-pieces ────────────────────────────────────────────────────────

function Jersey({
  number,
  isCaptain,
  side,
  cpu,
}: {
  number: number | null
  isCaptain: boolean | null
  side: 'bgm' | 'opp'
  cpu?: boolean
}) {
  const numTone = cpu
    ? 'text-[var(--color-fg-5)]'
    : side === 'bgm'
      ? 'text-[var(--color-accent)] [text-shadow:0_0_14px_rgba(232,65,49,0.20)]'
      : 'text-[var(--color-fg-1)]'
  return (
    <div className="flex flex-col items-center gap-[2px]">
      <span className="font-condensed text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--color-fg-6)]">
        #
      </span>
      <span
        className={`font-condensed text-[44px] font-black leading-[0.85] tracking-[-0.02em] tabular-nums ${numTone}`}
      >
        {number ?? '—'}
      </span>
      {isCaptain ? (
        <span className="mt-1 inline-block border border-[rgba(232,65,49,0.4)] bg-[rgba(232,65,49,0.10)] px-1.5 py-[1px] font-condensed text-[9px] font-extrabold uppercase tracking-[0.2em] text-[var(--color-accent)]">
          C
        </span>
      ) : null}
    </div>
  )
}

function Avatar({ side, cpu }: { side: 'bgm' | 'opp'; cpu?: boolean }) {
  const bgmRing =
    'border-[rgba(232,65,49,0.20)] [background:radial-gradient(circle_at_top,rgba(232,65,49,0.16),transparent_55%),linear-gradient(180deg,rgba(50,48,49,0.9),rgba(26,24,25,1))]'
  const oppRing =
    'border-[rgba(110,107,108,0.40)] [background:radial-gradient(circle_at_top,rgba(255,255,255,0.04),transparent_55%),linear-gradient(180deg,rgba(50,48,49,0.9),rgba(26,24,25,1))]'
  const cpuRing = 'border-[var(--color-border)] bg-[rgba(35,33,34,0.4)]'
  return (
    <div
      className={`flex h-14 w-14 shrink-0 items-end justify-center overflow-hidden rounded-full border text-[var(--color-fg-6)] ${
        cpu ? cpuRing : side === 'bgm' ? bgmRing : oppRing
      }`}
      aria-hidden
    >
      <PlayerSilhouette sizeClass={`h-[50px] w-[50px] ${cpu ? 'opacity-40' : ''}`} />
    </div>
  )
}

function PlayerInfo({
  persona,
  gamertag,
  playerHref,
  platform,
  buildLabel,
  buildRef,
  hwh,
  align,
  isBgm,
}: {
  persona: string
  gamertag: string
  playerHref: string | null
  platform: PlatformInfo | null
  buildLabel: string
  buildRef: string | null
  hwh: string
  align: 'left' | 'right'
  isBgm: boolean
}) {
  const justify = align === 'right' ? 'justify-end' : ''
  const textAlign = align === 'right' ? 'text-right' : ''
  const gamertagNode = playerHref ? (
    <Link href={playerHref} className="text-[var(--color-fg-3)] hover:text-[var(--color-accent)]">
      {gamertag}
    </Link>
  ) : (
    <span className="text-[var(--color-fg-3)]" title="Unresolved gamertag">
      {gamertag}
    </span>
  )

  const personaSpan = (
    <span
      className="font-condensed text-[19px] font-black uppercase leading-none tracking-[0.04em] text-[var(--color-fg-1)]"
      title="In-game character name (NHL player skin assigned to this lineup slot)"
    >
      {persona}
    </span>
  )
  const tagSpan = (
    <span className="min-w-[80px] overflow-hidden truncate font-condensed text-[11px] font-semibold tracking-[0.02em]">
      {align === 'right' ? (
        <>
          {platform ? <PlatformBadge platform={platform} side="left" /> : null}
          {gamertagNode}
        </>
      ) : (
        <>
          {gamertagNode}
          {platform ? <PlatformBadge platform={platform} /> : null}
        </>
      )}
    </span>
  )

  return (
    <div className={`min-w-0 ${textAlign}`}>
      <div className={`flex flex-wrap items-baseline gap-2 ${justify}`}>
        {align === 'right' ? (
          <>
            {tagSpan}
            {personaSpan}
          </>
        ) : (
          <>
            {personaSpan}
            {tagSpan}
          </>
        )}
      </div>
      <div className={`mt-2 flex flex-wrap items-center gap-2.5 ${justify}`}>
        {/* Per design: the player card omits the reference-player name. The
            archetype pill alone is enough; the full "Cole Caufield - Sniper"
            string reads only in the drill-down panel. */}
        <BuildArchetype label={buildLabel} ref_={null} isBgm={isBgm} />
        {hwh ? (
          <span className="whitespace-nowrap font-condensed text-[10.5px] font-bold tracking-[0.06em] tabular-nums text-[var(--color-fg-4)]">
            {hwh}
          </span>
        ) : null}
      </div>
    </div>
  )
}

/**
 * Platform indicator next to a gamertag. Uses the official-brand SVG logos
 * stored at `apps/web/public/assets/platforms/{xbox|playstation}.svg` (the
 * same files copied from `docs/branding/logos/platforms/`). The asset
 * family is picked from `resolvePlatform()` so this component never sees
 * the raw EA code (`xbsx`, etc.) directly.
 */
function PlatformBadge({
  platform,
  side = 'right',
}: {
  platform: PlatformInfo
  /** Which side of the sibling gamertag this badge sits on. `right` → ml-1.5 (default, BGM). `left` → mr-1.5 (opp mirror). */
  side?: 'left' | 'right'
}) {
  const src = `/assets/platforms/${platform.family}.svg`
  const marginClass = side === 'left' ? 'mr-1.5' : 'ml-1.5'
  return (
    <span
      className={`${marginClass} inline-flex items-center align-[-2px]`}
      title={platform.label}
    >
      <Image
        src={src}
        alt={platform.label}
        width={12}
        height={12}
        className="h-3 w-3 shrink-0"
        aria-hidden
      />
    </span>
  )
}

/**
 * Map raw platform strings to a display label + the asset family on disk.
 * EA's API uses codes like `xbsx` (Xbox Series X|S) / `ps5` (PS5); the OCR
 * (when wired) is expected to emit "Xbox" / "PlayStation" form. Both flow
 * through this single normalizer.
 */
const PLATFORM_LOOKUP: Readonly<Record<string, { label: string; family: 'xbox' | 'playstation' }>> =
  {
    // EA API codes
    xbsx: { label: 'Xbox', family: 'xbox' },
    xbox1: { label: 'Xbox', family: 'xbox' },
    ps5: { label: 'PS5', family: 'playstation' },
    ps4: { label: 'PS4', family: 'playstation' },
    // Human-readable forms (OCR or hand-entered)
    xbox: { label: 'Xbox', family: 'xbox' },
    playstation: { label: 'PlayStation', family: 'playstation' },
  }

interface PlatformInfo {
  label: string
  family: 'xbox' | 'playstation'
}

function resolvePlatform(raw: string | null): PlatformInfo | null {
  if (!raw) return null
  const key = raw.trim().toLowerCase()
  if (!key) return null
  return PLATFORM_LOOKUP[key] ?? null
}

// ─── Pure helpers ───────────────────────────────────────────────────────────

function bucketByPosition(rows: LineupRow[]): Map<PositionKey, LineupRow> {
  const map = new Map<PositionKey, LineupRow>()
  for (const r of rows) {
    if (!r.position) continue
    if (POSITIONS.includes(r.position as PositionKey) && !map.has(r.position as PositionKey)) {
      map.set(r.position as PositionKey, r)
    }
  }
  return map
}

/**
 * Build-distribution chips for the summary band. Two flavours:
 *   - Reference build (per player): render the `ArchetypePillCompact` + ref name.
 *   - Bare build: collapse duplicates and prefix with the count (`2× PMD`).
 *
 * Returned as structured items so the renderer can use the shared
 * `ArchetypePillCompact` when the build maps to a known archetype, and fall
 * back to a plain text chip when it doesn't.
 */
interface SummaryBuildChip {
  /** Stable key for React. */
  key: string
  /** The build (e.g. "Sniper"). NULL when the build can't be parsed. */
  build: string
  /** Reference player name when present (e.g. "C. Caufield"). NULL otherwise. */
  ref: string | null
  /** Multiplier for bare-build collapsing. Always 1 for ref builds. */
  count: number
}

function summarizeBuilds(rows: LineupRow[]): SummaryBuildChip[] {
  const bareCounts = new Map<string, number>()
  const refChips: SummaryBuildChip[] = []
  // Preserve canonical hockey order C/LW/RW/LD/RD/G — the input is already sorted.
  for (const r of rows) {
    const { build, ref } = splitBuild(r)
    if (!build || build === 'Unknown build') continue
    if (ref) {
      refChips.push({ key: `ref:${ref}:${build}`, build, ref, count: 1 })
    } else {
      bareCounts.set(build, (bareCounts.get(build) ?? 0) + 1)
    }
  }
  const bareChips: SummaryBuildChip[] = [...bareCounts.entries()].map(([build, count]) => ({
    key: `bare:${build}`,
    build,
    ref: null,
    count,
  }))
  return [...refChips, ...bareChips]
}

/**
 * Split a row's build into `{ build, ref }` using the canonical column when
 * available. Falls back to the raw `build_class` value (verbatim, no
 * normalization) so junk-but-present strings still surface during the
 * transitional period before every match has been consolidated.
 */
function splitBuild(row: LineupRow): { build: string; ref: string | null } {
  const source = row.buildClassCanonical ?? row.buildClass
  if (!source) return { build: 'Unknown build', ref: null }
  const dashIdx = source.indexOf(' - ')
  if (dashIdx === -1) return { build: source.trim(), ref: null }
  const refPart = source.slice(0, dashIdx).trim()
  const buildPart = source.slice(dashIdx + 3).trim()
  if (!refPart || !buildPart) return { build: source.trim(), ref: null }
  // "Cole Caufield" → "C. Caufield"
  const parts = refPart.split(/\s+/)
  const refDisplay =
    parts.length >= 2 ? `${parts[0]!.charAt(0)}. ${parts.slice(1).join(' ')}` : refPart
  return { build: buildPart, ref: refDisplay }
}

function formatHWH(
  height: string | null,
  weightLbs: number | null,
  handedness: string | null,
): string {
  const parts: string[] = []
  if (height) parts.push(height)
  if (weightLbs !== null) parts.push(`${String(weightLbs)} lb`)
  if (handedness) parts.push(handedness.charAt(0).toUpperCase())
  return parts.join(' · ')
}

function prettyXFactorName(canonical: string | null, raw: string): string {
  if (canonical) return canonical.replace(/_/g, ' ').replace(/Plus$/, '+')
  return raw
}

function tierTone(tier: Tier | null): { cls: string; dot: string } {
  switch (tier) {
    case 'Elite':
      return {
        cls: 'border-[rgba(232,65,49,0.40)] bg-[rgba(232,65,49,0.10)] text-[var(--color-fg-1)]',
        dot: 'bg-[var(--color-accent)] [box-shadow:0_0_8px_rgba(232,65,49,0.6)]',
      }
    case 'All Star':
      return {
        cls: 'border-[rgba(235,235,235,0.30)] bg-[rgba(235,235,235,0.04)] text-[var(--color-fg-2)]',
        dot: 'bg-[var(--color-fg-2)]',
      }
    case 'Specialist':
      return {
        cls: 'border-[rgba(110,107,108,0.40)] bg-[rgba(235,235,235,0.02)] text-[var(--color-fg-4)]',
        dot: 'bg-[var(--color-fg-4)]',
      }
    default:
      return {
        cls: 'border-[var(--color-border)] bg-[var(--color-background)] text-[var(--color-fg-4)]',
        dot: 'bg-[var(--color-fg-5)]',
      }
  }
}

function abbreviateTeam(label: string): string {
  // Take leading initials of up to 3 words.
  const words = label.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return 'OPP'
  if (words.length === 1) return words[0]!.slice(0, 3).toUpperCase()
  return words
    .slice(0, 3)
    .map((w) => w.charAt(0).toUpperCase())
    .join('')
}
