import { REL_LABELS, REPORTERS } from '@eanhl/db/news'
import type { RelationshipRow } from '@eanhl/db/queries'
import { ADMIN_TD, ADMIN_TH, AdminSection } from '@/components/admin/admin-section'

/**
 * Admin only (the page calls requireAdmin first): the press relationships right now. One signed
 * scale per player and reporter, from open war to glazing. An insult moves it down; a compliment,
 * thanks, a strong answer or a big night in the reporter's taste moves it up. Points fade by half every
 * 7 days; each reporter has a disposition and a range (Father Rink never goes below neutral).
 * `rows` is null when the table cannot be read (migration 0078 not applied yet).
 */
export function RelationshipsSection({ rows }: { rows: RelationshipRow[] | null }) {
  return (
    <AdminSection
      title="Press relationships (GM only)"
      description="Where each reporter stands with a player, from open war to glazing. Insults move it down; thanks, a compliment, a strong answer or a big night in the reporter's taste move it up. The points fade by half every 7 days. Feud and open war, and fan and glazing, can show up in the recap and the weekly column as that reporter's view. Players at Go easy never get the feud side."
    >
      {rows === null ? (
        <p className="text-sm text-fg-4">Relationships are not available yet (migration 0078).</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-fg-4">No relationships off neutral right now.</p>
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
              {rows.map((f) => (
                <tr key={`${String(f.playerId)}-${f.reporter}`}>
                  <td className={ADMIN_TD}>{f.name}</td>
                  <td className={ADMIN_TD}>{REPORTERS[f.reporter].name}</td>
                  <td className={ADMIN_TD}>{REL_LABELS[f.level]}</td>
                  <td className={ADMIN_TD}>
                    {f.points > 0 ? '+' : ''}
                    {f.points.toFixed(1)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AdminSection>
  )
}
