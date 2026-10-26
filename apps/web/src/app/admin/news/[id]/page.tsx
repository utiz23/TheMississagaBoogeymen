import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { REPORTERS } from '@eanhl/db/news'
import { getAdminNewsItem } from '@eanhl/db/queries'
import { AdminSection } from '@/components/admin/admin-section'
import { ScoreChips } from '@/components/news/score-chips'
import { requireAdmin } from '@/lib/auth'
import { formatClubDateTime } from '@/lib/format'
import { parseAdminItemId, rulesVersionLabel } from '@/lib/news/admin-display'
import { dayKeyLabelWithWeekday, scoreChips, splitParagraphs } from '@/lib/news/display'

export const metadata: Metadata = { title: 'News item' }
export const dynamic = 'force-dynamic'

const DT = 'font-condensed text-[11px] font-semibold uppercase tracking-[0.18em] text-fg-4'
const DD = 'text-sm text-fg-1 break-words'

/**
 * Admin: one news item in full, test and deleted items included, so the
 * operator can read what a dry run wrote. Plain text only: no links in the
 * text, nothing rendered from the model's words.
 */
export default async function AdminNewsItemPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin()
  const { id: raw } = await params
  const id = parseAdminItemId(raw)
  if (id === null) notFound()
  const item = await getAdminNewsItem(id)
  if (item === null) notFound()

  const reporter = REPORTERS[item.reporter]
  const paragraphs = splitParagraphs(item.body)
  const states = [
    item.isTest ? 'Test' : 'Live',
    item.deletedAt !== null ? `Deleted ${formatClubDateTime(item.deletedAt) ?? ''}` : null,
  ].filter((s): s is string => s !== null)

  const rows: [string, string][] = [
    ['Kind', item.kind === 'article' ? 'Article' : 'Post'],
    ['Reporter', `${reporter.name}, ${reporter.outlet}`],
    ['Night', item.night !== null ? dayKeyLabelWithWeekday(item.night) : '—'],
    ['Week from', item.weekStart !== null ? dayKeyLabelWithWeekday(item.weekStart) : '—'],
    ['Written', formatClubDateTime(item.createdAt) ?? '—'],
    ['Rules version', rulesVersionLabel(item.rulesVersion)],
    ['State', states.join(' · ')],
    [
      'Discord',
      `${item.discordStatus} (attempts ${String(item.discordAttempts)})${
        item.discordDeletedAt !== null ? ' · message deleted' : ''
      }`,
    ],
    ['Last error', item.lastError ?? '—'],
    ['Reply to', item.replyTo !== null ? `item ${String(item.replyTo)}` : '—'],
    ['Mentions', item.mentions.length > 0 ? item.mentions.map((m) => m.name).join(', ') : 'none'],
  ]

  return (
    <div className="mx-auto flex max-w-[960px] flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <p className="font-condensed text-[11px] font-semibold uppercase tracking-[0.22em] text-fg-4">
          <Link prefetch href="/admin/news" className="hover:text-fg-1">
            ← News desk
          </Link>
        </p>
        <h1 className="font-condensed text-3xl font-black uppercase leading-none tracking-[0.04em] text-fg-1">
          News item {String(item.id)}
        </h1>
      </div>

      <AdminSection title="Details">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-[160px_1fr]">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className={DT}>{label}</dt>
              <dd className={DD}>{value}</dd>
            </div>
          ))}
        </dl>
        <ScoreChips chips={scoreChips(item.facts)} />
      </AdminSection>

      <AdminSection title={item.kind === 'article' ? 'Article' : 'Post'}>
        {item.headline !== null && (
          <h2 className="break-words font-condensed text-2xl font-black leading-tight text-fg-1">
            {item.headline}
          </h2>
        )}
        {item.dek !== null && <p className="break-words text-base text-fg-2">{item.dek}</p>}
        <div className="flex flex-col gap-3 text-sm leading-relaxed text-fg-2">
          {paragraphs.map((p, i) => (
            <p key={i} className="whitespace-pre-wrap break-words">
              {p}
            </p>
          ))}
        </div>
        {item.summary !== null && (
          <p className="border-t border-border-subtle pt-3 text-sm text-fg-3">
            <span className={DT}>Summary</span> <span className="break-words">{item.summary}</span>
          </p>
        )}
      </AdminSection>
    </div>
  )
}
