import type { PlayerLoadoutSnapshotWithDetails } from '@eanhl/db/queries'
import { SectionHeader } from '@/components/ui/section-header'
import { Panel } from '@/components/ui/panel'

interface LoadoutHistoryStripProps {
  snapshots: PlayerLoadoutSnapshotWithDetails[]
}

const ATTRIBUTE_GROUPS: Record<string, string[]> = {
  Technique: ['wrist_shot_accuracy', 'slap_shot_accuracy', 'speed', 'balance', 'agility'],
  Power: ['wrist_shot_power', 'slap_shot_power', 'acceleration', 'puck_control', 'endurance'],
  Playstyle: [
    'passing',
    'offensive_awareness',
    'body_checking',
    'stick_checking',
    'defensive_awareness',
  ],
  Tenacity: ['hand_eye', 'strength', 'durability', 'shot_blocking'],
  Tactics: ['deking', 'faceoffs', 'discipline', 'fighting_skill'],
}

/**
 * Recent build snapshots from OCR'd loadout / lobby captures. Hidden until at
 * least one reviewed snapshot exists. Up to N=4 most-recent are shown side by
 * side with class, position, top X-factors, and per-group attribute averages.
 */
export function LoadoutHistoryStrip({ snapshots }: LoadoutHistoryStripProps) {
  if (snapshots.length === 0) return null

  const visible = snapshots.slice(0, 4)

  return (
    <section className="space-y-3">
      <SectionHeader label="Loadout History" subtitle="Build snapshots from OCR captures" />
      <Panel className="overflow-x-auto px-4 py-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {visible.map((snap) => (
            <Card key={snap.id} snap={snap} />
          ))}
        </div>
      </Panel>
    </section>
  )
}

function Card({ snap }: { snap: PlayerLoadoutSnapshotWithDetails }) {
  const captured = new Date(snap.capturedAt)
  const dateLabel = captured.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })

  // Group attribute values by their canonical group, computing means.
  const valueByKey = new Map<string, number>()
  for (const a of snap.attributes) {
    if (a.value !== null) valueByKey.set(a.attributeKey, a.value)
  }
  const groupAvgs: { group: string; avg: number | null }[] = Object.entries(ATTRIBUTE_GROUPS).map(
    ([group, keys]) => {
      const vals = keys.map((k) => valueByKey.get(k)).filter((v): v is number => typeof v === 'number')
      const avg = vals.length > 0 ? Math.round(vals.reduce((s, v) => s + v, 0) / vals.length) : null
      return { group, avg }
    },
  )

  return (
    <div className="flex flex-col gap-3 rounded-sm border border-zinc-800 bg-zinc-950/40 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-condensed text-xs font-bold uppercase tracking-widest text-accent">
          {snap.position ?? '—'}
        </span>
        <span className="font-condensed text-[10px] uppercase tracking-widest text-zinc-600">
          {dateLabel}
        </span>
      </div>

      <div>
        <div className="font-condensed text-sm font-bold uppercase tracking-wide text-zinc-100">
          {snap.buildClass ?? 'Unknown build'}
        </div>
        <div className="font-condensed text-[11px] uppercase tracking-wider text-zinc-500">
          {[snap.heightText, snap.weightLbs ? `${String(snap.weightLbs)} lbs` : null, snap.handedness]
            .filter(Boolean)
            .join(' · ') || '—'}
        </div>
        {snap.playerLevelNumber !== null ? (
          <div className="font-condensed text-[10px] uppercase tracking-widest text-zinc-600">
            Level {String(snap.playerLevelNumber)}
          </div>
        ) : null}
      </div>

      {snap.xFactors.length > 0 ? (
        <div>
          <div className="mb-1 font-condensed text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
            X-Factors
          </div>
          <ul className="flex flex-wrap gap-1">
            {snap.xFactors.map((xf) => (
              <li
                key={`${String(xf.loadoutSnapshotId)}-${String(xf.slotIndex)}`}
                className="rounded-sm border border-zinc-800 bg-zinc-900/60 px-2 py-0.5 font-condensed text-[10px] uppercase tracking-wider text-zinc-300"
              >
                {xf.xFactorName}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="border-t border-zinc-900 pt-2">
        <div className="mb-1 font-condensed text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
          Attribute Averages
        </div>
        <ul className="grid grid-cols-2 gap-x-3 gap-y-0.5">
          {groupAvgs.map(({ group, avg }) => (
            <li key={group} className="flex items-baseline justify-between font-condensed text-xs">
              <span className="uppercase tracking-wider text-zinc-400">{group}</span>
              <span className="tabular-nums text-zinc-200">{avg ?? '—'}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
