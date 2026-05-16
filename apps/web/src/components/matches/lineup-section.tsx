import Image from 'next/image'
import Link from 'next/link'
import type { LineupRow, MatchLineups } from '@eanhl/db/queries'
import { SectionHeader } from '@/components/ui/section-header'
import { Panel } from '@/components/ui/panel'
import { PlayerSilhouette } from '@/components/home/player-card'

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
}

const POSITIONS: PositionKey[] = ['C', 'LW', 'RW', 'LD', 'RD', 'G']
type PositionKey = 'C' | 'LW' | 'RW' | 'LD' | 'RD' | 'G'
type Tier = 'Elite' | 'All Star' | 'Specialist'

export function LineupSection({ lineups, opponentLabel }: LineupSectionProps) {
  const bgm = lineups.bgm
  const opp = lineups.opponent
  if (bgm.length === 0 && opp.length === 0) return null

  const bgmByPos = bucketByPosition(bgm)
  const oppByPos = bucketByPosition(opp)
  const opponentAbbrev = abbreviateTeam(opponentLabel)

  return (
    <section className="space-y-3">
      <SectionHeader
        label="Lineup & Loadouts"
        subtitle="Pre-game scouting sheet · OCR-derived"
      />
      <SummaryBand
        bgm={bgm}
        opp={opp}
        opponentLabel={opponentLabel}
        opponentAbbrev={opponentAbbrev}
      />
      <div className="flex flex-col gap-2">
        {POSITIONS.map((pos) => (
          <LadderRow
            key={pos}
            position={pos}
            bgm={bgmByPos.get(pos) ?? null}
            opp={oppByPos.get(pos) ?? null}
          />
        ))}
      </div>
    </section>
  )
}

// ─── Summary band ───────────────────────────────────────────────────────────

function SummaryBand({
  bgm,
  opp,
  opponentLabel,
  opponentAbbrev,
}: {
  bgm: LineupRow[]
  opp: LineupRow[]
  opponentLabel: string
  opponentAbbrev: string
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
          VS
        </span>
        <span className="font-condensed text-[14px] font-bold tracking-[0.3em] text-[var(--color-fg-5)]">
          VS
        </span>
        <span className="font-condensed text-[9px] font-semibold uppercase tracking-[0.22em] text-[var(--color-fg-6)]">
          EASHL 6s
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
  const dressed = rows.length
  const xfactors = rows.reduce((acc, r) => acc + r.xFactors.length, 0)
  const tierCount = countTiers(rows)
  const captain = rows.find((r) => r.isCaptain && r.playerNumber !== null)
  const buildChips = summarizeBuilds(rows)
  const bgClass =
    side === 'opp'
      ? 'bg-[rgba(35,33,34,0.45)]'
      : ''
  const borderClass =
    side === 'bgm' ? 'md:border-r md:border-[var(--color-border)]' : ''
  return (
    <div
      className={`grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-3 px-5 py-4 ${bgClass} ${borderClass}`}
    >
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
          {sublabel} · {side === 'bgm' ? 'Home' : 'Away'}
        </div>
      </div>
      <div className="col-span-2 flex flex-wrap items-start gap-x-4 gap-y-2.5">
        <KV k="Dressed" v={`${String(dressed)} / 6`} />
        <KV k="X-Factors" v={String(xfactors)} accent={side === 'bgm'} />
        <KV k="Elite" v={String(tierCount.Elite)} />
        <KV k="All Star" v={String(tierCount['All Star'])} />
        <KV k="Specialist" v={String(tierCount.Specialist)} />
        <KV k="Captain" v={captain ? `#${String(captain.playerNumber)}` : '—'} />
      </div>
      {buildChips.length > 0 ? (
        <div className="col-span-2 flex flex-wrap gap-1.5">
          {buildChips.map((label, i) => (
            <BuildChip key={`${label}-${String(i)}`} label={label} isBgm={side === 'bgm'} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function KV({ k, v, accent }: { k: string; v: string; accent?: boolean }) {
  return (
    <div className="flex flex-col gap-[2px]">
      <span className="font-condensed text-[9px] font-semibold uppercase tracking-[0.2em] text-[var(--color-fg-5)]">
        {k}
      </span>
      <span
        className={`font-condensed text-[13px] font-extrabold tabular-nums ${
          accent === true ? 'text-[var(--color-accent)]' : 'text-[var(--color-fg-2)]'
        }`}
      >
        {v}
      </span>
    </div>
  )
}

function BuildChip({ label, isBgm }: { label: string; isBgm: boolean }) {
  return (
    <span
      className={`border bg-[var(--color-background)] px-2 py-[3px] font-condensed text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--color-fg-3)] ${
        isBgm
          ? 'border-[rgba(232,65,49,0.25)] bg-[rgba(232,65,49,0.04)] text-[var(--color-fg-2)]'
          : 'border-[var(--color-border)]'
      }`}
    >
      {label}
    </span>
  )
}

// ─── Ladder row ─────────────────────────────────────────────────────────────

function LadderRow({
  position,
  bgm,
  opp,
}: {
  position: PositionKey
  bgm: LineupRow | null
  opp: LineupRow | null
}) {
  const matchup = buildMatchupString(bgm, opp)
  return (
    <div className="grid grid-cols-1 items-stretch md:grid-cols-[1fr_96px_1fr]">
      {bgm ? (
        <PlayerCard row={bgm} side="bgm" />
      ) : (
        <CpuPlaceholderCard side="bgm" position={position} />
      )}
      <PositionBadge position={position} matchup={matchup} />
      {opp ? (
        <PlayerCard row={opp} side="opp" />
      ) : (
        <CpuPlaceholderCard side="opp" position={position} />
      )}
    </div>
  )
}

function PositionBadge({
  position,
  matchup,
}: {
  position: PositionKey
  matchup: string | null
}) {
  return (
    <div className="hidden flex-col items-center justify-center gap-1.5 border-y border-[var(--color-border)] bg-[var(--color-background)] py-2 md:flex">
      <span className="font-condensed text-[9px] font-semibold uppercase tracking-[0.22em] text-[var(--color-fg-6)]">
        Pos
      </span>
      <span className="font-condensed text-[24px] font-black uppercase tracking-[0.08em] text-[var(--color-fg-2)] tabular-nums">
        {position}
      </span>
      {matchup ? (
        <span className="flex items-center gap-1.5 font-condensed text-[8.5px] font-bold uppercase tracking-[0.18em] text-[var(--color-fg-5)]">
          {matchup}
        </span>
      ) : null}
    </div>
  )
}

// ─── Player card ────────────────────────────────────────────────────────────

function PlayerCard({ row, side }: { row: LineupRow; side: 'bgm' | 'opp' }) {
  const gamertag = row.player?.gamertag ?? row.gamertagSnapshot ?? '?'
  const persona = row.playerNamePersona ?? row.playerNameSnapshot ?? gamertag
  const buildLabel = formatBuild(row.buildClass)
  const buildRef = extractBuildRef(row.buildClass)
  const hwh = formatHWH(row.heightText, row.weightLbs, row.handedness)

  // BGM cards: jersey · avatar · info
  // Opp cards: info · avatar · jersey  (mirrored)
  if (side === 'bgm') {
    return (
      <div className="relative grid min-h-[96px] grid-cols-[64px_56px_1fr] items-center gap-3.5 border border-l-2 border-[var(--color-border)] border-l-[var(--color-accent)] bg-[var(--color-surface)] px-4 py-3.5">
        <Jersey number={row.playerNumber} isCaptain={row.isCaptain} side="bgm" />
        <Avatar side="bgm" />
        <PlayerInfo
          persona={persona}
          gamertag={gamertag}
          playerHref={row.player ? `/roster/${String(row.player.id)}` : null}
          buildLabel={buildLabel}
          buildRef={buildRef}
          hwh={hwh}
          xFactors={row.xFactors}
          align="left"
          isBgm
        />
      </div>
    )
  }
  return (
    <div className="relative grid min-h-[96px] grid-cols-[1fr_56px_64px] items-center gap-3.5 border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3.5">
      <PlayerInfo
        persona={persona}
        gamertag={gamertag}
        playerHref={row.player ? `/roster/${String(row.player.id)}` : null}
        buildLabel={buildLabel}
        buildRef={buildRef}
        hwh={hwh}
        xFactors={row.xFactors}
        align="right"
        isBgm={false}
      />
      <Avatar side="opp" />
      <Jersey number={row.playerNumber} isCaptain={row.isCaptain} side="opp" />
    </div>
  )
}

function CpuPlaceholderCard({
  side,
  position,
}: {
  side: 'bgm' | 'opp'
  position: PositionKey
}) {
  const align = side === 'bgm' ? 'text-left' : 'md:text-right'
  return (
    <div
      className="grid min-h-[96px] items-center border border-[var(--color-border)] px-4 py-3.5"
      style={{
        background:
          'repeating-linear-gradient(135deg, var(--color-surface) 0, var(--color-surface) 8px, var(--color-background) 8px, var(--color-background) 10px)',
        borderLeft: side === 'bgm' ? '2px solid var(--color-accent)' : undefined,
      }}
    >
      <div className={align}>
        <div className="flex items-baseline gap-2 font-condensed">
          <span className="text-[16px] font-extrabold uppercase tracking-[0.04em] text-[var(--color-fg-4)]">
            {position === 'G' ? 'CPU Goalie' : 'CPU'}
          </span>
          <span className="inline-block border border-dashed border-[var(--color-border)] px-2 py-[2px] text-[10px] font-bold uppercase tracking-[0.22em] text-[var(--color-fg-4)]">
            No human dressed
          </span>
        </div>
        <div className="mt-1 font-condensed text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--color-fg-5)]">
          EA AI · default loadout · no X-Factors
        </div>
      </div>
    </div>
  )
}

// ─── Card sub-pieces ────────────────────────────────────────────────────────

function Jersey({
  number,
  isCaptain,
  side,
}: {
  number: number | null
  isCaptain: boolean | null
  side: 'bgm' | 'opp'
}) {
  return (
    <div className="flex flex-col items-center gap-[2px]">
      <span className="font-condensed text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--color-fg-6)]">
        #
      </span>
      <span
        className={`font-condensed text-[44px] font-black leading-[0.85] tracking-[-0.02em] tabular-nums ${
          side === 'bgm'
            ? 'text-[var(--color-accent)] [text-shadow:0_0_14px_rgba(232,65,49,0.20)]'
            : 'text-[var(--color-fg-1)]'
        }`}
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

function Avatar({ side }: { side: 'bgm' | 'opp' }) {
  const bgmRing =
    'border-[rgba(232,65,49,0.20)] [background:radial-gradient(circle_at_top,rgba(232,65,49,0.16),transparent_55%),linear-gradient(180deg,rgba(50,48,49,0.9),rgba(26,24,25,1))]'
  const oppRing =
    'border-[rgba(110,107,108,0.40)] [background:radial-gradient(circle_at_top,rgba(255,255,255,0.04),transparent_55%),linear-gradient(180deg,rgba(50,48,49,0.9),rgba(26,24,25,1))]'
  return (
    <div
      className={`flex h-14 w-14 shrink-0 items-end justify-center overflow-hidden rounded-full border text-[var(--color-fg-6)] ${
        side === 'bgm' ? bgmRing : oppRing
      }`}
      aria-hidden
    >
      <PlayerSilhouette sizeClass="h-[50px] w-[50px]" />
    </div>
  )
}

function PlayerInfo({
  persona,
  gamertag,
  playerHref,
  buildLabel,
  buildRef,
  hwh,
  xFactors,
  align,
  isBgm,
}: {
  persona: string
  gamertag: string
  playerHref: string | null
  buildLabel: string
  buildRef: string | null
  hwh: string
  xFactors: LineupRow['xFactors']
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

  return (
    <div className={`min-w-0 ${textAlign}`}>
      <div className={`flex flex-wrap items-baseline gap-2 ${justify}`}>
        <span className="font-condensed text-[19px] font-black uppercase leading-none tracking-[0.04em] text-[var(--color-fg-1)]">
          {persona}
        </span>
        <span className="overflow-hidden truncate font-condensed text-[11px] font-semibold tracking-[0.02em]">
          {gamertagNode}
        </span>
      </div>
      <div className={`mt-2 flex flex-wrap items-center gap-2.5 ${justify}`}>
        <span
          className={`inline-flex items-center gap-2 border bg-[var(--color-background)] px-2.5 py-[3px] font-condensed text-[11px] font-bold uppercase tracking-[0.06em] text-[var(--color-fg-2)] ${
            isBgm ? 'border-[rgba(232,65,49,0.25)]' : 'border-[var(--color-border)]'
          }`}
        >
          {buildLabel}
          {buildRef ? (
            <span className="border-l border-[var(--color-border)] pl-2 font-condensed text-[9px] font-semibold uppercase tracking-[0.16em] text-[var(--color-fg-5)]">
              {buildRef}
            </span>
          ) : null}
        </span>
        {hwh ? (
          <span className="whitespace-nowrap font-condensed text-[10.5px] font-bold tracking-[0.06em] tabular-nums text-[var(--color-fg-4)]">
            {hwh}
          </span>
        ) : null}
      </div>
      {xFactors.length > 0 ? (
        <div className={`mt-2 flex flex-wrap gap-1.5 ${justify}`}>
          {xFactors.map((xf) => (
            <XFactorChip
              key={xf.slotIndex}
              name={prettyXFactorName(xf.canonicalName, xf.name)}
              tier={xf.tier as Tier | null}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function XFactorChip({ name, tier }: { name: string; tier: Tier | null }) {
  const tone = tierTone(tier)
  return (
    <span
      className={`inline-flex items-center gap-1.5 border px-2.5 py-[3px] font-condensed text-[10.5px] font-bold uppercase tracking-[0.08em] ${tone.cls}`}
      title={tier ? `${name} — ${tier}` : name}
    >
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${tone.dot}`} />
      {name}
    </span>
  )
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

function countTiers(rows: LineupRow[]): Record<Tier, number> {
  const acc: Record<Tier, number> = { Elite: 0, 'All Star': 0, Specialist: 0 }
  for (const r of rows) {
    for (const xf of r.xFactors) {
      if (xf.tier && xf.tier in acc) acc[xf.tier as Tier]++
    }
  }
  return acc
}

/**
 * Build-distribution chips for the summary band. We collapse the
 * `build_class` strings down to short human labels and count duplicates,
 * because lineups frequently have 2× of the same build type (e.g. two
 * PMD defencemen) — surfacing that count is what the summary band is for.
 */
function summarizeBuilds(rows: LineupRow[]): string[] {
  const counts = new Map<string, number>()
  for (const r of rows) {
    const label = abbreviatedBuildLabel(r.buildClass)
    if (!label) continue
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  return [...counts.entries()].map(([label, n]) => (n > 1 ? `${String(n)}× ${label}` : label))
}

function abbreviatedBuildLabel(buildClass: string | null): string {
  if (!buildClass) return ''
  // Strip "Reference Player - " prefix if present
  const tail = buildClass.includes(' - ') ? buildClass.split(' - ').slice(1).join(' - ') : buildClass
  const upper = tail.trim()
  // Common shortenings
  if (/puck moving defenseman/i.test(upper)) return 'PMD'
  if (/defensive defenseman/i.test(upper)) return 'Defensive D'
  if (/offensive defenseman/i.test(upper)) return 'Offensive D'
  if (/two-?way forward/i.test(upper)) return 'Two-Way Forward'
  if (/power\s*forward|powerforward|pwf/i.test(upper)) return 'Power Forward'
  if (/playmaker/i.test(upper)) return 'Playmaker'
  if (/sniper/i.test(upper)) return 'Sniper'
  if (/grinder/i.test(upper)) return 'Grinder'
  return upper
}

function formatBuild(buildClass: string | null): string {
  if (!buildClass) return 'Unknown build'
  return abbreviatedBuildLabel(buildClass) || buildClass.trim()
}

/**
 * Extract the reference player name from build strings like "Cole Caufield - SNP"
 * → "C. Caufield". Returns null when the string doesn't carry a reference.
 */
function extractBuildRef(buildClass: string | null): string | null {
  if (!buildClass) return null
  const dashIdx = buildClass.indexOf(' - ')
  if (dashIdx === -1) return null
  const refPart = buildClass.slice(0, dashIdx).trim()
  if (!refPart) return null
  // "Cole Caufield" → "C. Caufield"
  const parts = refPart.split(/\s+/)
  if (parts.length < 2) return refPart
  const first = parts[0] ?? ''
  const last = parts.slice(1).join(' ')
  return `${first.charAt(0)}. ${last}`
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

function buildMatchupString(bgm: LineupRow | null, opp: LineupRow | null): string | null {
  if (!bgm && !opp) return null
  const left = bgm ? matchupTag(bgm.buildClass) : 'CPU'
  const right = opp ? matchupTag(opp.buildClass) : 'CPU'
  return `${left} ↔ ${right}`
}

function matchupTag(buildClass: string | null): string {
  if (!buildClass) return '—'
  const short = abbreviatedBuildLabel(buildClass)
  // Compress to a very short tag for the position-badge corridor.
  if (/PMD/i.test(short)) return 'PMD'
  if (/Defensive D/i.test(short)) return 'DEF-D'
  if (/Offensive D/i.test(short)) return 'OFF-D'
  if (/Power Forward/i.test(short)) return 'PWR-F'
  if (/Two-?Way/i.test(short)) return '2-WAY'
  if (/Playmaker/i.test(short)) return 'P-MAKER'
  if (/Sniper/i.test(short)) return 'SNIPER'
  if (/Grinder/i.test(short)) return 'GRIND'
  return short.toUpperCase().slice(0, 8)
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
