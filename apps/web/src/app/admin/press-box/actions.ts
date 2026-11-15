'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { nightKey } from '@eanhl/db/news'
import {
  addBackgroundFactWithAudit,
  addGmNoteWithAudit,
  addNicknameWithAudit,
  addStanceWithAudit,
  addTakeWithAudit,
  applyRelationshipAction,
  closeStorylineWithAudit,
  createStorylineWithAudit,
  editStanceWithAudit,
  editTakeWithAudit,
  pinStorylineWithAudit,
  removeStanceWithAudit,
  removeTakeWithAudit,
  unpinStorylineWithAudit,
  decideBackgroundFactWithAudit,
  editBackgroundFactWithAudit,
  hasOpenPressBoxRequest,
  latestPressNight,
  queueInterviewRequest,
  queueReporterPreviewWithAudit,
  resetReporterCharacterWithAudit,
  saveReporterCharacterWithAudit,
  queuePressBoxRequest,
  queueProfileRequest,
  removeNicknameWithAudit,
  setBackgroundQuestionsWithAudit,
  setHeatWithAudit,
  setPressLevelWithAudit,
} from '@eanhl/db/queries'
import { requireAdmin } from '@/lib/auth'
import { setReporterEnabledAction } from '@/app/admin/news/actions'
import {
  addBackgroundBox,
  confirmBackgroundBox,
  editBackgroundBox,
  rejectBackgroundBox,
  removeBackgroundBox,
  type BackgroundActionDeps,
} from './background-box-actions'
import { setBackgroundQuestionsBox } from './background-switch-actions'
import {
  previewReporterBox,
  reporterOf,
  reporterSwitchBox,
  resetReporterBox,
  saveReporterBox,
  type ReporterActionDeps,
} from './reporter-box-actions'
import {
  addStanceBox,
  addTakeBox,
  closeStorylineBox,
  createStorylineBox,
  editStanceBox,
  editTakeBox,
  pinStorylineBox,
  removeStanceBox,
  removeTakeBox,
  unpinStorylineBox,
  type StorylineActionDeps,
} from './storyline-box-actions'
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

/** The background questions switch (task background-b2): admin only, logged, default off. */
export async function setBackgroundQuestionsAction(formData: FormData): Promise<void> {
  back(
    '/admin/press-box',
    (await setBackgroundQuestionsBox(formData, {
      requireAdmin: deps.requireAdmin,
      now: deps.now,
      setBackgroundQuestionsWithAudit,
    })) as ActionNotice,
  )
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

// ── Storylines, stances and takes (release L3) ──────────────────────────────

/** The same admin check as every Press Box action; the queries check the text and write the audit line. */
const storylineDeps: StorylineActionDeps = {
  requireAdmin: deps.requireAdmin,
  now: deps.now,
  createStorylineWithAudit,
  pinStorylineWithAudit,
  unpinStorylineWithAudit,
  closeStorylineWithAudit,
  addStanceWithAudit,
  editStanceWithAudit,
  removeStanceWithAudit,
  addTakeWithAudit,
  editTakeWithAudit,
  removeTakeWithAudit,
}

const STORYLINES = '/admin/press-box/storylines'

export async function createStorylineAction(formData: FormData): Promise<void> {
  back(STORYLINES, (await createStorylineBox(formData, storylineDeps)) as ActionNotice)
}

export async function pinStorylineAction(formData: FormData): Promise<void> {
  back(STORYLINES, (await pinStorylineBox(formData, storylineDeps)) as ActionNotice)
}

export async function unpinStorylineAction(formData: FormData): Promise<void> {
  back(STORYLINES, (await unpinStorylineBox(formData, storylineDeps)) as ActionNotice)
}

export async function closeStorylineAction(formData: FormData): Promise<void> {
  back(STORYLINES, (await closeStorylineBox(formData, storylineDeps)) as ActionNotice)
}

export async function addStanceAction(formData: FormData): Promise<void> {
  back(STORYLINES, (await addStanceBox(formData, storylineDeps)) as ActionNotice)
}

export async function editStanceAction(formData: FormData): Promise<void> {
  back(STORYLINES, (await editStanceBox(formData, storylineDeps)) as ActionNotice)
}

export async function removeStanceAction(formData: FormData): Promise<void> {
  back(STORYLINES, (await removeStanceBox(formData, storylineDeps)) as ActionNotice)
}

export async function addTakeAction(formData: FormData): Promise<void> {
  back(STORYLINES, (await addTakeBox(formData, storylineDeps)) as ActionNotice)
}

export async function editTakeAction(formData: FormData): Promise<void> {
  back(STORYLINES, (await editTakeBox(formData, storylineDeps)) as ActionNotice)
}

export async function removeTakeAction(formData: FormData): Promise<void> {
  back(STORYLINES, (await removeTakeBox(formData, storylineDeps)) as ActionNotice)
}

// ── Reporters (release L4) ──────────────────────────────────────────────────

/**
 * The same admin check as every Press Box action; the queries check the text and write the audit
 * line. The on/off switch is the existing one (`setReporterEnabledAction` of /admin/news): the
 * Reporters page reuses it, it does not add a second switch.
 */
const reporterDeps: ReporterActionDeps = {
  requireAdmin: deps.requireAdmin,
  now: deps.now,
  saveReporterCharacterWithAudit,
  resetReporterCharacterWithAudit,
  queueReporterPreviewWithAudit,
  setReporterEnabled: (reporter, enabled) => setReporterEnabledAction(reporter, enabled),
}

const REPORTERS_PATH = '/admin/press-box/reporters'

/** Back to the reporter's own page (or the list when the form named no reporter). */
function reporterBack(formData: FormData, notice: ActionNotice): never {
  const id = reporterOf(formData)
  back(id === null ? REPORTERS_PATH : `${REPORTERS_PATH}/${id}`, notice)
}

export async function saveReporterAction(formData: FormData): Promise<void> {
  reporterBack(formData, (await saveReporterBox(formData, reporterDeps)) as ActionNotice)
}

export async function resetReporterAction(formData: FormData): Promise<void> {
  reporterBack(formData, (await resetReporterBox(formData, reporterDeps)) as ActionNotice)
}

export async function previewReporterAction(formData: FormData): Promise<void> {
  reporterBack(formData, (await previewReporterBox(formData, reporterDeps)) as ActionNotice)
}

export async function reporterSwitchAction(formData: FormData): Promise<void> {
  reporterBack(formData, (await reporterSwitchBox(formData, reporterDeps)) as ActionNotice)
}
