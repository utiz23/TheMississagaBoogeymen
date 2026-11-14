import { AdminSection } from '@/components/admin/admin-section'

/** A Press Box tab that a later release builds (the design's L2 to L4). */
export function ComingSoon({
  title,
  release,
  note,
}: {
  title: string
  release: string
  note: string
}) {
  return (
    <AdminSection title={title} description={note}>
      <p className="text-sm text-fg-3">
        Coming soon ({release}). Until then the reporters and the press service work as before.
      </p>
    </AdminSection>
  )
}
