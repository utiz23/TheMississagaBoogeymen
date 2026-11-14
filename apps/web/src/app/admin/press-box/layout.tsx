import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { AdminHeading } from '@/components/admin/admin-section'
import { PressBoxTabs } from '@/components/press-box/tabs'
import { requireAdmin } from '@/lib/auth'

export const metadata: Metadata = { title: 'Press Box' }
export const dynamic = 'force-dynamic'

/** Press Box shell: admin only (every page also checks), with the tab bar. */
export default async function PressBoxLayout({ children }: { children: ReactNode }) {
  await requireAdmin()
  return (
    <div className="mx-auto flex max-w-[1376px] flex-col gap-6">
      <AdminHeading title="Press Box" />
      <PressBoxTabs />
      {children}
    </div>
  )
}
