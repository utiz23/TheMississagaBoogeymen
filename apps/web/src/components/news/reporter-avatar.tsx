import { REPORTERS, type ReporterId } from '@eanhl/db/news'
import { initialsColor } from '@/lib/news/avatar-color'

/** A reporter's initials on their tint: a square badge (the site has no photos). */
export function ReporterAvatar({
  reporter,
  size = 'md',
}: {
  reporter: ReporterId
  size?: 'sm' | 'md' | 'lg'
}) {
  const r = REPORTERS[reporter]
  const dim =
    size === 'sm' ? 'h-7 w-7 text-[10px]' : size === 'lg' ? 'h-16 w-16 text-2xl' : 'h-9 w-9 text-xs'
  return (
    <span
      className={`${dim} inline-flex shrink-0 items-center justify-center font-condensed font-bold`}
      style={{ backgroundColor: r.tint, color: initialsColor(r.tint) }}
      aria-hidden
    >
      {r.initials}
    </span>
  )
}
