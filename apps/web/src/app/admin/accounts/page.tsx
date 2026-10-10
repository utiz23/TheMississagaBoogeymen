import type { Metadata } from 'next'
import { listAccountInvites, listAccountUsers, listInvitablePlayers } from '@eanhl/db/queries'
import {
  ADMIN_SMALL_BUTTON,
  ADMIN_TD,
  ADMIN_TH,
  AdminHeading,
  AdminSection,
} from '@/components/admin/admin-section'
import { CreateInviteForm } from '@/components/auth/create-invite-form'
import { requireAdmin } from '@/lib/auth'
import { formatClubDateTime } from '@/lib/format'
import { revokeInviteAction, setUserDisabledAction } from './actions'

export const metadata: Metadata = { title: 'Member accounts' }
export const dynamic = 'force-dynamic'

const TH = ADMIN_TH
const TD = ADMIN_TD
const SMALL_BUTTON = ADMIN_SMALL_BUTTON
const Section = AdminSection

function inviteStatus(invite: {
  acceptedAt: Date | null
  revokedAt: Date | null
  expiresAt: Date
}): 'Used' | 'Cancelled' | 'Expired' | 'Open' {
  if (invite.acceptedAt) return 'Used'
  if (invite.revokedAt) return 'Cancelled'
  if (invite.expiresAt <= new Date()) return 'Expired'
  return 'Open'
}

/** Admin: invite teammates, see who has an account, disable an account. */
export default async function AdminAccountsPage() {
  const admin = await requireAdmin()
  const [users, invites, players] = await Promise.all([
    listAccountUsers(),
    listAccountInvites(),
    listInvitablePlayers(),
  ])
  const invitable = players.filter((p) => !p.isClaimed)

  return (
    <div className="mx-auto flex max-w-[960px] flex-col gap-6">
      <AdminHeading title="Member accounts" />

      <Section title="Invite a teammate">
        <p className="text-sm text-fg-3">
          Each link is for one player and works once. The teammate opens it and signs in with
          Discord; their account is then linked to that player.
        </p>
        {invitable.length > 0 ? (
          <CreateInviteForm players={invitable} />
        ) : (
          <p className="text-sm text-fg-4">Every team member already has an account.</p>
        )}
      </Section>

      <Section title="Members">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse">
            <thead>
              <tr>
                <th className={TH}>Discord name</th>
                <th className={TH}>Player</th>
                <th className={TH}>Role</th>
                <th className={TH}>Joined</th>
                <th className={TH}>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td className={TD}>
                    {u.name}
                    {u.disabledAt && (
                      <span className="ml-2 font-condensed text-xs font-bold uppercase tracking-[0.12em] text-accent-readable">
                        Disabled
                      </span>
                    )}
                  </td>
                  <td className={TD}>{u.gamertag ?? '—'}</td>
                  <td className={TD}>{u.role === 'admin' ? 'Admin' : 'Member'}</td>
                  <td className={TD}>{formatClubDateTime(u.createdAt)}</td>
                  <td className={`${TD} text-right`}>
                    {u.id !== admin.id && (
                      <form action={setUserDisabledAction}>
                        <input type="hidden" name="userId" value={u.id} />
                        <input type="hidden" name="disable" value={u.disabledAt ? '0' : '1'} />
                        <button type="submit" className={SMALL_BUTTON}>
                          {u.disabledAt ? 'Enable' : 'Disable'}
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-sm text-fg-4">
          Disabling signs that person out everywhere and stops them signing back in.
        </p>
      </Section>

      <Section title="Invite links">
        {invites.length === 0 ? (
          <p className="text-sm text-fg-4">No invites yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse">
              <thead>
                <tr>
                  <th className={TH}>Player</th>
                  <th className={TH}>Role</th>
                  <th className={TH}>Status</th>
                  <th className={TH}>Expires</th>
                  <th className={TH}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {invites.map((i) => {
                  const status = inviteStatus(i)
                  return (
                    <tr key={i.id}>
                      <td className={TD}>{i.claimedPlayerGamertag}</td>
                      <td className={TD}>{i.role === 'admin' ? 'Admin' : 'Member'}</td>
                      <td className={TD}>{status}</td>
                      <td className={TD}>{formatClubDateTime(i.expiresAt)}</td>
                      <td className={`${TD} text-right`}>
                        {status === 'Open' && (
                          <form action={revokeInviteAction}>
                            <input type="hidden" name="inviteId" value={i.id} />
                            <button type="submit" className={SMALL_BUTTON}>
                              Cancel link
                            </button>
                          </form>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  )
}
