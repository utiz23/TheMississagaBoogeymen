'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { nightKey } from '@eanhl/db/news'
import {
  addBackgroundFactWithAudit,
  addGmNoteWithAudit,
  addNicknameWithAudit,
  applyRelationshipAction,
  decideBackgroundFactWithAudit,
  editBackgroundFactWithAudit,
  hasOpenPressBoxRequest,
  latestPressNight,
  queueInterviewRequest,
  queuePressBoxRequest,
  queueProfileRequest,
  removeNicknameWithAudit,
  setHeatWithAudit,
  setPressLevelWithAudit,
} from '@eanhl/db/queries'
import { requireAdmin } from '@/lib/auth'
import {
  addBackgroundBox,
  confirmBackgroundBox,
  editBackgroundBox,
  rejectBackgroundBox,
  removeBackgroundBox,
  type BackgroundActionDeps,
} from './background-box-actions'
import {
  addNicknameBox,
  gmNoteBox,
  interviewBox,
  pressLevelBox,
  profileBox,
  removeNicknameBox,
  type DossierActionDeps,
} from './dossier-box-actions'
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

// ── Player dossiers (release L2) ────────────────────────────────────────────

/** The same admin check and the same night rule as the overview actions. */
const dossierDeps: DossierActionDeps = {
  requireAdmin: deps.requireAdmin,
  now: deps.now,
  tonight: deps.tonight,
  setPressLevelWithAudit,
  addNicknameWithAudit,
  removeNicknameWithAudit,
  addGmNoteWithAudit,
  queueProfileRequest,
  queueInterviewRequest,
}

/** Back to the dossier the form came from (the key is checked again: only a member id or `u<id>`). */
function backToDossier(
  formData: FormData,
  notice: ActionNotice | { ok: boolean; code: string },
): never {
  const raw = formData.get('key')
  const key = typeof raw === 'string' && /^(?:[1-9]\d{0,9}|u\d{17,20})$/.test(raw) ? raw : null
  back(
    key === null ? '/admin/press-box/players' : `/admin/press-box/players/${key}`,
    notice as ActionNotice,
  )
}

export async function pressLevelAction(formData: FormData): Promise<void> {
  backToDossier(formData, await pressLevelBox(formData, dossierDeps))
}

export async function addNicknameAction(formData: FormData): Promise<void> {
  backToDossier(formData, await addNicknameBox(formData, dossierDeps))
}

export async function removeNicknameAction(formData: FormData): Promise<void> {
  backToDossier(formData, await removeNicknameBox(formData, dossierDeps))
}

export async function gmNoteAction(formData: FormData): Promise<void> {
  backToDossier(formData, await gmNoteBox(formData, dossierDeps))
}

export async function profileAction(formData: FormData): Promise<void> {
  backToDossier(formData, await profileBox(formData, dossierDeps))
}

export async function interviewAction(formData: FormData): Promise<void> {
  backToDossier(formData, await interviewBox(formData, dossierDeps))
}

/** Cool down a relationship from a dossier: the same rule and audit line as the board, then back here. */
export async function dossierRelationshipAction(formData: FormData): Promise<void> {
  backToDossier(formData, await relationshipBox(formData, deps))
}

// ── Player background (task background-b1) ──────────────────────────────────

/** The same admin check as every Press Box action; the queries write the audit line themselves. */
const backgroundDeps: BackgroundActionDeps = {
  requireAdmin: deps.requireAdmin,
  now: deps.now,
  addBackgroundFactWithAudit,
  decideBackgroundFactWithAudit,
  editBackgroundFactWithAudit,
}

export async function addBackgroundAction(formData: FormData): Promise<void> {
  backToDossier(formData, await addBackgroundBox(formData, backgroundDeps))
}

export async function confirmBackgroundAction(formData: FormData): Promise<void> {
  backToDossier(formData, await confirmBackgroundBox(formData, backgroundDeps))
}

export async function rejectBackgroundAction(formData: FormData): Promise<void> {
  backToDossier(formData, await rejectBackgroundBox(formData, backgroundDeps))
}

export async function removeBackgroundAction(formData: FormData): Promise<void> {
  backToDossier(formData, await removeBackgroundBox(formData, backgroundDeps))
}

export async function editBackgroundAction(formData: FormData): Promise<void> {
  backToDossier(formData, await editBackgroundBox(formData, backgroundDeps))
}
