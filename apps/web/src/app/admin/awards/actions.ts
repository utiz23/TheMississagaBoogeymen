'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import {
  createClubAward,
  deleteClubAward,
  listInvitablePlayers,
  listTitlesForAdmin,
  updateClubAward,
} from '@eanhl/db/queries'
import { requireAdmin } from '@/lib/auth'
import { parseAwardForm } from '@/lib/award-edit'

/** Trophy case editor actions (admin tools C3). Each re-checks admin. */

async function readForm(formData: FormData) {
  const [titles, members] = await Promise.all([listTitlesForAdmin(), listInvitablePlayers()])
  return parseAwardForm(
    (n) => {
      const v = formData.get(n)
      return typeof v === 'string' ? v : null
    },
    (n) => formData.getAll(n).filter((v): v is string => typeof v === 'string'),
    { titleIds: titles.map((t) => t.id), memberIds: members.map((m) => m.id) },
  )
}

function done(result: string): never {
  // Trophy cases show on player pages.
  revalidatePath('/roster', 'layout')
  redirect(`/admin/awards?result=${encodeURIComponent(result)}`)
}

export async function createAwardAction(formData: FormData): Promise<void> {
  await requireAdmin()
  const parsed = await readForm(formData)
  if (!parsed.ok) redirect(`/admin/awards?error=${encodeURIComponent(parsed.message)}`)
  await createClubAward(parsed.input)
  done('added')
}

export async function updateAwardAction(formData: FormData): Promise<void> {
  await requireAdmin()
  const id = Number(formData.get('awardId'))
  const parsed = await readForm(formData)
  if (!parsed.ok) redirect(`/admin/awards?error=${encodeURIComponent(parsed.message)}`)
  if (!Number.isInteger(id) || !(await updateClubAward(id, parsed.input))) {
    redirect('/admin/awards?error=That%20award%20no%20longer%20exists.')
  }
  done('saved')
}

export async function deleteAwardAction(formData: FormData): Promise<void> {
  await requireAdmin()
  const id = Number(formData.get('awardId'))
  if (Number.isInteger(id) && id > 0) await deleteClubAward(id)
  done('deleted')
}
