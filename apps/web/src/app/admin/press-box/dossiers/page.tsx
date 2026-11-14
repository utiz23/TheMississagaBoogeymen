import { ComingSoon } from '@/components/press-box/coming-soon'
import { requireAdmin } from '@/lib/auth'

export default async function PressBoxDossiersPage() {
  await requireAdmin()
  return (
    <ComingSoon
      title="Player dossiers"
      release="L2"
      note="What the press knows about each player: form, quotes, takes, relationships and an AI profile on demand."
    />
  )
}
