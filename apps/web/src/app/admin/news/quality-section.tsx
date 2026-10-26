import { REPORTERS } from '@eanhl/db/news'
import { ADMIN_TD, ADMIN_TH, AdminSection } from '@/components/admin/admin-section'
import type { CountRow, QualityReport } from '@/lib/news/quality'

const pct = (share: number | null) => (share === null ? '—' : `${Math.round(share * 100)}%`)

function CountTable({ title, rows }: { title: string; rows: CountRow[] }) {
  return (
    <div className="min-w-[200px] flex-1">
      <h3 className="mb-1 font-condensed text-[11px] font-semibold uppercase tracking-[0.18em] text-fg-4">
        {title}
      </h3>
      {rows.length === 0 ? (
        <p className="text-sm text-fg-4">None.</p>
      ) : (
        <table className="w-full border-collapse">
          <tbody>
            {rows.slice(0, 12).map((r) => (
              <tr key={r.name}>
                <td className={ADMIN_TD}>{r.name}</td>
                <td className={`${ADMIN_TD} text-right`}>{r.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

/** Admin only: the last 30 days of real items, counted (spec §12.18-6). Shows no take text. */
export function QualitySection({ report }: { report: QualityReport }) {
  const bySignature = report.signatureUses.slice(0, 15)
  return (
    <AdminSection
      title="Quality, last 30 days"
      description="Real items only (no test items, no deleted ones). Use it to see habits: hedged wins, favourite words, who gets named, who gets a zero call-out."
    >
      <p className="text-sm text-fg-2">
        <strong className="text-fg-1">{report.items}</strong> items. Win posts with a caveat word (
        but, however, although ...):{' '}
        <strong className="text-fg-1">
          {report.winPosts.withCaveat} of {report.winPosts.total}
        </strong>{' '}
        ({pct(report.winPosts.share)}).
      </p>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] border-collapse">
          <thead>
            <tr>
              <th className={ADMIN_TH}>Reporter</th>
              <th className={ADMIN_TH}>Posts</th>
              <th className={ADMIN_TH}>Articles</th>
              <th className={ADMIN_TH}>Share</th>
            </tr>
          </thead>
          <tbody>
            {report.reporterMix.map((m) => (
              <tr key={m.reporter}>
                <td className={ADMIN_TD}>{REPORTERS[m.reporter].name}</td>
                <td className={ADMIN_TD}>{m.posts}</td>
                <td className={ADMIN_TD}>{m.articles}</td>
                <td className={ADMIN_TD}>{pct(m.share)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap gap-6">
        <CountTable title="Mentions per player" rows={report.mentionsPerPlayer} />
        <CountTable title="Zero call-outs per player" rows={report.zeroCallsPerPlayer} />
        <CountTable title="Takes used per player" rows={report.takesPerPlayer} />
      </div>

      <div>
        <h3 className="mb-1 font-condensed text-[11px] font-semibold uppercase tracking-[0.18em] text-fg-4">
          Signature words used (top 15)
        </h3>
        {bySignature.length === 0 ? (
          <p className="text-sm text-fg-4">None.</p>
        ) : (
          <p className="text-sm text-fg-2">
            {bySignature
              .map((s) => `${REPORTERS[s.reporter].name}: "${s.word}" ×${String(s.count)}`)
              .join(' · ')}
          </p>
        )}
      </div>
    </AdminSection>
  )
}
