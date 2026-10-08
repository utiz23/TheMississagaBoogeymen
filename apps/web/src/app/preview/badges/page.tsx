import { notFound } from 'next/navigation'
import { BADGE_FAMILIES, BADGE_GROUPS, CARD_THEME_NAMES, CARD_THEME_ORDER } from '@eanhl/db/cards'
import { Badge } from '@/components/badges/badge'
import { BADGE_ICONS } from '@/components/badges/badge-icons'

/**
 * Dev-only badge icon gallery (operator icon polish, 2026-10-08): every family,
 * unlocked, in all 10 themes at the three sizes the site draws (detail 76,
 * card footer 34, locker row 28). Never served in production; deleted at the switch.
 * ?group=games limits it to one group.
 */
export default async function BadgeGalleryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  if (process.env.NODE_ENV === 'production') notFound()
  const sp = await searchParams
  const group = typeof sp.group === 'string' ? sp.group : null
  const families = BADGE_FAMILIES.filter((f) => group === null || f.group === group)
  return (
    <div className="space-y-6 font-condensed">
      <h1 className="text-sm font-bold uppercase tracking-[0.2em] text-zinc-400">
        Badge icons · all 10 themes · dev only
      </h1>
      <div className="overflow-x-auto">
        <table className="border-separate border-spacing-x-3 border-spacing-y-4">
          <thead>
            <tr>
              <th />
              {CARD_THEME_ORDER.map((t) => (
                <th
                  key={t}
                  className="text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500"
                >
                  {CARD_THEME_NAMES[t]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {families.map((f) => {
              const shape = BADGE_GROUPS.find((g) => g.id === f.group)?.shape ?? 'hex'
              const art = BADGE_ICONS[f.id]
              return (
                <tr key={f.id}>
                  <td className="whitespace-nowrap pr-2 text-xs font-bold uppercase tracking-[0.1em] text-zinc-300">
                    {f.short}
                    <div className="text-[10px] font-semibold text-zinc-500">
                      {art === undefined ? 'placeholder' : `scale ${String(art.scale)}`}
                    </div>
                  </td>
                  {CARD_THEME_ORDER.map((t) => (
                    <td key={t} className="text-center">
                      <div className="flex flex-col items-center gap-2">
                        <Badge familyId={f.id} shape={shape} theme={t} frame="single" size={76} />
                        <div className="flex items-end gap-2">
                          <Badge familyId={f.id} shape={shape} theme={t} frame="double" size={34} />
                          <Badge familyId={f.id} shape={shape} theme={t} frame="heavy" size={28} />
                        </div>
                      </div>
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
