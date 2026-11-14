'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { nightKey } from '@eanhl/db/news'
import {
  applyRelationshipAction,
  hasOpenPressBoxRequest,
  latestPressNight,
  queuePressBoxRequest,
  setHeatWithAudit,
} from '@eanhl/db/queries'
import { requireAdmin } from '@/lib/auth'
import {
  parseId,
  relationshipBox,
  runTestScrumBox,
  setHeatBox,
  type ActionNotice,
  type PressBoxActionDeps,
} from './box-actions'

/**
 * Press Box server actions. Each one calls `requireAdmin` first (a Server Action is reachable by
 * its id), through `box-actions.ts`; every change writes its audit line in the same transaction
 * (`@eanhl/db/queries` press-box). The result goes back to the page as a fixed notice code.
 */
const deps: PressBoxActionDeps = {
  requireAdmin: async () => {
    const user = await requireAdmin()
    return { playerId: user.playerId, name: user.gamertag ?? user.name }
  },
  now: () => new Date(),
  setHeatWithAudit,
  // Tonight = the night of the newest game within 6 h, else the night of now (as `/gm heat`).
  tonight: async (now) =>
    (await latestPressNight(new Date(now.getTime() - 6 * 3_600_000))) ?? nightKey(now),
  hasOpenTestScrum: () => hasOpenPressBoxRequest('testscrum'),
  queueTestScrum: ({ actor, now }) => queuePressBoxRequest({ kind: 'testscrum', actor, now }),
  applyRelationshipAction,
}

function back(path: string, notice: ActionNotice, extra: string = ''): never {
  revalidatePath('/admin/press-box', 'layout')
  const sep = path.includes('?') ? '&' : '?'
  redirect(`${path}${sep}notice=${notice.code}${extra}`)
}

export async function setHeatAction(formData: FormData): Promise<void> {
  back('/admin/press-box', await setHeatBox(formData, deps))
}

export async function runTestScrumAction(): Promise<void> {
  back('/admin/press-box', await runTestScrumBox(deps))
}

export async function relationshipAction(formData: FormData): Promise<void> {
  const notice = await relationshipBox(formData, deps)
  const player = parseId(
    typeof formData.get('playerId') === 'string' ? (formData.get('playerId') as string) : null,
  )
  const reporter = formData.get('reporter')
  const keep =
    player !== null && typeof reporter === 'string' && /^[a-z]{3,12}$/.test(reporter)
      ? `&player=${String(player)}&reporter=${reporter}`
      : ''
  back('/admin/press-box/relationships', notice, keep)
}
