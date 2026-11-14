import { ComingSoon } from '@/components/press-box/coming-soon'
import { requireAdmin } from '@/lib/auth'

export default async function PressBoxStorylinesPage() {
  await requireAdmin()
  return (
    <ComingSoon
      title="Storylines and trends"
      release="L3"
      note="Open storylines, trends from the stats, pin and close, and the takes editor."
    />
  )
}
