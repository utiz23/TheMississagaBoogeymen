import { redirect } from 'next/navigation'
import { requireAdmin } from '@/lib/auth'

/** The dossiers moved to /admin/press-box/players (release L2); the old address keeps working. */
export default async function PressBoxDossiersPage() {
  await requireAdmin()
  redirect('/admin/press-box/players')
}
