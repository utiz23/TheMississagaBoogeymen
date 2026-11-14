import { ComingSoon } from '@/components/press-box/coming-soon'
import { requireAdmin } from '@/lib/auth'

export default async function PressBoxReportersPage() {
  await requireAdmin()
  return (
    <ComingSoon
      title="Reporters"
      release="L4"
      note="Each reporter's character, record and on/off switch, with editable bio, voice notes and catchphrases."
    />
  )
}
