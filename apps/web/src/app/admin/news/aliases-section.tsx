import type { PlayerAlias, PressRosterEntry } from '@eanhl/db/queries'
import {
  ADMIN_SMALL_BUTTON,
  ADMIN_TD,
  ADMIN_TH,
  AdminSection,
} from '@/components/admin/admin-section'
import { AliasForm } from './alias-form'
import { deleteAliasAction } from './actions'

/**
 * Admin only (the page calls requireAdmin first): the GM's nickname list. The
 * reporters use it to know who a nickname means. Rendered nowhere else.
 */
export function AliasesSection({
  aliases,
  roster,
}: {
  aliases: PlayerAlias[]
  roster: PressRosterEntry[]
}) {
  return (
    <AdminSection
      title="Nicknames (GM only)"
      description="Private list: a nickname and the player it means. Reporters and the /gm notes use it to know who a nickname is. Players and visitors never see it. A nickname is saved in lowercase. One nickname belongs to one player."
    >
      {aliases.length === 0 ? (
        <p className="text-sm text-fg-4">No nicknames yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] border-collapse">
            <thead>
              <tr>
                <th className={ADMIN_TH}>Nickname</th>
                <th className={ADMIN_TH}>Player</th>
                <th className={ADMIN_TH}>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {aliases.map((a) => (
                <tr key={a.alias}>
                  <td className={ADMIN_TD}>{a.alias}</td>
                  <td className={ADMIN_TD}>{a.name}</td>
                  <td className={`${ADMIN_TD} text-right`}>
                    <form action={deleteAliasAction.bind(null, a.alias)}>
                      <button
                        type="submit"
                        className={ADMIN_SMALL_BUTTON}
                        aria-label={`Delete nickname ${a.alias}`}
                      >
                        Delete
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <AliasForm players={roster.map((p) => ({ playerId: p.playerId, name: p.name }))} />
    </AdminSection>
  )
}
