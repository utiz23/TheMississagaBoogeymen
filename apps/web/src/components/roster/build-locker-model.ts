/**
 * Build Locker v2 view model (Build Locker v2.dc.html renderVals; spec Part 4).
 * Pure and type-only on the db package, so the page builds it on the server
 * (dates format once, in the operator's zone) and the client only renders.
 */
import type { PlayerBuild, PlayerBuilds } from '@eanhl/db/queries'

/** The game sheet's 23 attributes in the design's 5 groups (keys as stored). */
export const BUILD_ATTRIBUTE_GROUPS: readonly {
  name: string
  attrs: readonly { key: string; label: string }[]
}[] = [
  {
    name: 'Technique',
    attrs: [
      { key: 'wrist_shot_accuracy', label: 'Wrist Shot Acc' },
      { key: 'slap_shot_accuracy', label: 'Slap Shot Acc' },
      { key: 'speed', label: 'Speed' },
      { key: 'balance', label: 'Balance' },
      { key: 'agility', label: 'Agility' },
    ],
  },
  {
    name: 'Power',
    attrs: [
      { key: 'wrist_shot_power', label: 'Wrist Shot Pwr' },
      { key: 'slap_shot_power', label: 'Slap Shot Pwr' },
      { key: 'acceleration', label: 'Acceleration' },
      { key: 'puck_control', label: 'Puck Control' },
      { key: 'endurance', label: 'Endurance' },
    ],
  },
  {
    name: 'Playstyle',
    attrs: [
      { key: 'passing', label: 'Passing' },
      { key: 'offensive_awareness', label: 'Off. Awareness' },
      { key: 'body_checking', label: 'Body Checking' },
      { key: 'stick_checking', label: 'Stick Checking' },
      { key: 'defensive_awareness', label: 'Def. Awareness' },
    ],
  },
  {
    name: 'Tenacity',
    attrs: [
      { key: 'hand_eye', label: 'Hand-Eye' },
      { key: 'strength', label: 'Strength' },
      { key: 'durability', label: 'Durability' },
      { key: 'shot_blocking', label: 'Shot Blocking' },
    ],
  },
  {
    name: 'Tactics',
    attrs: [
      { key: 'deking', label: 'Deking' },
      { key: 'faceoffs', label: 'Faceoffs' },
      { key: 'discipline', label: 'Discipline' },
      { key: 'fighting_skill', label: 'Fighting Skill' },
    ],
  },
]

/** The operator's zone (docker-compose BACKUP_TZ default), as in the card locker. */
export const BUILD_LOCKER_TIME_ZONE = 'America/Edmonton'

export type XFactorTierName = 'Elite' | 'All Star' | 'Specialist'
type Sign = -1 | 0 | 1

export interface BuildTileView {
  /** Stored build class, for the client's archetype-pill lookup. */
  archetypeRaw: string | null
  arcName: string
  /** Neutral pill text when the build isn't one of the site's 11 archetypes. */
  arcInitials: string
  tag: string
  current: boolean
  xf: { abbr: string; title: string; tier: XFactorTierName | null }[]
  htwt: string
  hand: string
  gp: number
  record: string
}

export interface BuildAttrView {
  label: string
  v: string
  dTxt: string
  dSign: Sign
  /** Bar geometry in percent (design: base bar, then the change segment). */
  baseW: number
  segL: number
  segW: number
}

export interface BuildGroupView {
  name: string
  avg: string
  dTxt: string
  dSign: Sign
  attrs: BuildAttrView[]
}

export interface BuildDetailView {
  name: string
  meta: string
  note: string
  groups: BuildGroupView[]
}

export interface BuildLockerView {
  titleName: string
  count: number
  tiles: BuildTileView[]
  details: BuildDetailView[]
}

const DASH = '—'
const clamp = (n: number) => Math.min(100, Math.max(0, n))
const sign = (d: number): Sign => (d > 0 ? 1 : d < 0 ? -1 : 0)
const deltaText = (d: number) => (d > 0 ? `+${String(d)}` : d < 0 ? String(d) : '')

/** "Connor Mcdavid - Playmaker" → "Playmaker". */
function archetypeName(raw: string | null): string {
  if (raw === null) return 'Unknown build'
  const parts = raw.split(/\s+-\s+/)
  return (parts[parts.length - 1] ?? raw).trim()
}

function initials(name: string, max: number): string {
  return name
    .split(/[\s_-]+/)
    .filter((w) => w.length > 0)
    .map((w) => w.charAt(0))
    .join('')
    .slice(0, max)
    .toUpperCase()
}

function heightWeight(b: PlayerBuild): string {
  const parts = [b.heightText, b.weightLbs === null ? null : `${String(b.weightLbs)} lb`].filter(
    (p): p is string => p !== null && p !== '',
  )
  return parts.length > 0 ? parts.join(' · ') : DASH
}

function hand(raw: string | null): string {
  if (raw === null) return DASH
  if (/right/i.test(raw) || /^r$/i.test(raw.trim())) return 'Right'
  if (/left/i.test(raw) || /^l$/i.test(raw.trim())) return 'Left'
  return DASH
}

const record = (b: PlayerBuild) => `${String(b.wins)}–${String(b.losses)}–${String(b.otl)}`

function groupAverage(b: PlayerBuild, keys: readonly string[]): number | null {
  const vals = keys.map((k) => b.attributes[k]).filter((v): v is number => typeof v === 'number')
  return vals.length > 0 ? Math.round(vals.reduce((s, v) => s + v, 0) / vals.length) : null
}

function attrView(label: string, v: number | null, prev: number | null | undefined): BuildAttrView {
  if (v === null) return { label, v: DASH, dTxt: '', dSign: 0, baseW: 0, segL: 0, segW: 0 }
  const d = prev === null || prev === undefined ? 0 : v - prev
  const baseW = clamp(d > 0 ? v - d : v)
  return {
    label,
    v: String(v),
    dTxt: deltaText(d),
    dSign: sign(d),
    baseW,
    segL: baseW,
    segW: d === 0 ? 0 : Math.min(Math.abs(d), 100 - baseW),
  }
}

function detail(b: PlayerBuild, prev: PlayerBuild | null, when: string): BuildDetailView {
  return {
    name: archetypeName(b.archetype),
    meta: `${when} · ${String(b.gp)} GP · ${record(b)}`,
    note: prev === null ? '' : 'Δ vs previous build',
    groups: BUILD_ATTRIBUTE_GROUPS.map((g) => {
      const keys = g.attrs.map((a) => a.key)
      const avg = groupAverage(b, keys)
      const prevAvg = prev === null ? null : groupAverage(prev, keys)
      const gd = avg !== null && prevAvg !== null ? avg - prevAvg : 0
      return {
        name: g.name,
        avg: avg === null ? DASH : String(avg),
        dTxt: deltaText(gd),
        dSign: sign(gd),
        attrs: g.attrs.map((a) =>
          attrView(a.label, b.attributes[a.key] ?? null, prev?.attributes[a.key]),
        ),
      }
    }),
  }
}

export function buildLockerView(
  data: PlayerBuilds,
  timeZone = BUILD_LOCKER_TIME_ZONE,
): BuildLockerView {
  const fmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone })
  const { builds } = data
  const tiles: BuildTileView[] = []
  const details: BuildDetailView[] = []
  builds.forEach((b, i) => {
    const prev = builds[i + 1] ?? (i === builds.length - 1 ? data.older : null)
    const date = fmt.format(b.lastPlayed)
    tiles.push({
      archetypeRaw: b.archetype,
      arcName: archetypeName(b.archetype),
      arcInitials: b.archetype === null ? '?' : initials(archetypeName(b.archetype), 3),
      tag: i === 0 ? 'Current' : date,
      current: i === 0,
      xf: b.xFactors.map((x) => {
        const name = x.name.replace(/_/g, ' ')
        return {
          abbr: initials(name, 2),
          title: `${name} — ${x.tier ?? 'tier unknown'}`,
          tier: x.tier,
        }
      }),
      htwt: heightWeight(b),
      hand: hand(b.handedness),
      gp: b.gp,
      record: record(b),
    })
    details.push(detail(b, prev, i === 0 ? 'Current' : `Last used ${date}`))
  })
  return { titleName: data.gameTitleName, count: builds.length, tiles, details }
}
