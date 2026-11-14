import { FEUD_LABELS, REPORTERS } from '@eanhl/db/news'
import type { FeudRow } from '@eanhl/db/queries'
import { ADMIN_TD, ADMIN_TH, AdminSection } from '@/components/admin/admin-section'

/**
 * Admin only (the page calls requireAdmin first): the press feuds right now.
 * A player who insults a reporter adds feud points; points fade by half every
 * 7 days. At "feud" and above the night recap and the weekly column may tell
 * it as that reporter's view. `feuds` is null when the table cannot be read
 * (migration 0076 not applied yet).
 */
export function FeudsSection({ feuds }: { feuds: FeudRow[] | null }) {
  return (
    <AdminSection
      title="Press feuds (GM only)"
      description="Players who insulted a reporter, with the reporter's feud level. The points fade by half every 7 days. At feud level and above the recap and the weekly column may mention it as that reporter's view. Players at Go easy never show up in a story."
    >
      {feuds === null ? (
        <p className="text-sm text-fg-4">Feuds are not available yet (migration 0076).</p>
      ) : feuds.length === 0 ? (
        <p className="text-sm text-fg-4">No feuds right now.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] border-collapse">
            <thead>
              <tr>
                <th className={ADMIN_TH}>Player</th>
                <th className={ADMIN_TH}>Reporter</th>
                <th className={ADMIN_TH}>Level</th>
                <th className={ADMIN_TH}>Points</th>
              </tr>
            </thead>
            <tbody>
              {feuds.map((f) => (
                <tr key={`${String(f.playerId)}-${f.reporter}`}>
                  <td className={ADMIN_TD}>{f.name}</td>
                  <td className={ADMIN_TD}>{REPORTERS[f.reporter].name}</td>
                  <td className={ADMIN_TD}>{FEUD_LABELS[f.level]}</td>
                  <td className={ADMIN_TD}>{f.points.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AdminSection>
  )
}
