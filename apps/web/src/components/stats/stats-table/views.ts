import type { MetricMap } from './metrics.ts'

export interface ViewSpec {
  id: string
  label: string
  defaultSort: string
  /** Column keys in this view (the "All stats" view uses `groups` instead). */
  keys?: string[]
  groups?: { label: string; keys: string[] }[]
}

export interface Category {
  id: string
  label: string
  keys: string[]
  defaultSort: string
}

/** Tab per category, plus a leading grouped "All stats" view. */
export function buildViews(categories: Category[], allDefaultSort: string): ViewSpec[] {
  return [
    {
      id: 'all',
      label: 'All stats',
      defaultSort: allDefaultSort,
      groups: categories.map((c) => ({ label: c.label, keys: c.keys })),
    },
    ...categories.map((c) => ({
      id: c.id,
      label: c.label,
      defaultSort: c.defaultSort,
      keys: c.keys,
    })),
  ]
}

export const SKATER_CATEGORIES: Category[] = [
  {
    id: 'scoring',
    label: 'Scoring',
    keys: ['g', 'a', 'pts', 'pm', 'ppg', 'shg', 'gwg', 'hat'],
    defaultSort: 'pts',
  },
  {
    id: 'shooting',
    label: 'Shooting',
    keys: ['sog', 'satt', 'shp', 'sonp', 'gatt'],
    defaultSort: 'sog',
  },
  {
    id: 'passing',
    label: 'Passing',
    keys: ['pass', 'patt', 'passp', 'spass'],
    defaultSort: 'passp',
  },
  {
    id: 'possession',
    label: 'Possession',
    keys: ['poss', 'dka', 'dk', 'defl', 'gv', 'tagv'],
    defaultSort: 'tagv',
  },
  { id: 'faceoffs', label: 'Faceoffs', keys: ['fow', 'fol', 'fo'], defaultSort: 'fo' },
  {
    id: 'defense',
    label: 'Defense',
    keys: ['hits', 'bs', 'int', 'ta', 'pkzc'],
    defaultSort: 'hits',
  },
  {
    id: 'discipline',
    label: 'Discipline',
    keys: ['pim', 'pd', 'off', 'fht', 'fhtw'],
    defaultSort: 'pim',
  },
  {
    id: 'breakaways',
    label: 'Breakaways · PS',
    keys: ['brk', 'brkg', 'brkp', 'ps', 'psg', 'psp'],
    defaultSort: 'brkg',
  },
  { id: 'usage', label: 'Usage', keys: ['toigp'], defaultSort: 'toigp' },
]

export const GOALIE_CATEGORIES: Category[] = [
  { id: 'record', label: 'Record', keys: ['w', 'l', 'otl'], defaultSort: 'w' },
  {
    id: 'goaltending',
    label: 'Goaltending',
    keys: ['svp', 'gaa', 'so', 'sop'],
    defaultSort: 'svp',
  },
  { id: 'volume', label: 'Volume', keys: ['sa', 'sv', 'ga', 'dsv'], defaultSort: 'sv' },
  {
    id: 'breakaways',
    label: 'Breakaways · PS',
    keys: ['brks', 'brksv', 'brksvp', 'ps', 'psv', 'psvp'],
    defaultSort: 'brksvp',
  },
  { id: 'puck', label: 'Puck play', keys: ['pk', 'pkzc'], defaultSort: 'pk' },
  { id: 'usage', label: 'Usage', keys: ['toi', 'toigp'], defaultSort: 'toi' },
]

export const SKATER_VIEWS: ViewSpec[] = buildViews(SKATER_CATEGORIES, 'pts')
export const GOALIE_VIEWS: ViewSpec[] = buildViews(GOALIE_CATEGORIES, 'svp')

export interface ResolvedView {
  id: string
  label: string
  defaultSort: string
  groups: { label: string; keys: string[] }[]
  /** Flat, ordered column keys (GP is always rendered separately as the sticky column). */
  keys: string[]
}

/**
 * Drop expanded-only columns when the source has no expanded data, drop empty
 * groups, and return only views that still have at least one column. Unavailable
 * columns are removed, never rendered as zero.
 */
export function resolveViews<R>(
  views: ViewSpec[],
  metrics: MetricMap<R>,
  hasExpanded: boolean,
): ResolvedView[] {
  const usable = (k: string): boolean => {
    const m = metrics[k]
    return m !== undefined && (hasExpanded || m.expanded !== true)
  }
  const out: ResolvedView[] = []
  for (const v of views) {
    const groups = (v.groups ?? [{ label: v.label, keys: v.keys ?? [] }])
      .map((g) => ({ label: g.label, keys: g.keys.filter(usable) }))
      .filter((g) => g.keys.length > 0)
    const keys = groups.flatMap((g) => g.keys)
    const first = keys[0]
    if (first === undefined) continue
    const defaultSort = keys.includes(v.defaultSort) ? v.defaultSort : first
    out.push({ id: v.id, label: v.label, defaultSort, groups: v.groups ? groups : [], keys })
  }
  return out
}

/** Metric keys a view actually renders, including the sticky GP column. */
export function visibleKeysFor(view: ResolvedView): string[] {
  return ['gp', ...view.keys]
}
