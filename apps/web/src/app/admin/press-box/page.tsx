import type { ReactNode } from 'react'
import Link from 'next/link'
import { REL_LABELS, REPORTERS, REPORTER_IDS } from '@eanhl/db/news'
import { ADMIN_FIELD, ADMIN_LABEL, ADMIN_TD, AdminSection } from '@/components/admin/admin-section'
import { AUTH_BUTTON_PRIMARY, AUTH_BUTTON_SECONDARY } from '@/components/auth/auth-panel'
import { LEVEL_TEXT, pointsText } from '@/components/press-box/level-style'
import { requireAdmin } from '@/lib/auth'
import { formatClubDateTime } from '@/lib/format'
import { NOTICE_TEXT, noticeFromQuery } from './box-actions'
import { milestoneText } from './form'
import { EXTRAS_STOP_SHARE, PRESS_SEEN_MAX_MS, loadOverview } from './overview-data'
import { runTestScrumAction, setHeatAction } from './actions'

const LABEL = 'font-condensed text-[11px] font-semibold uppercase tracking-[0.2em] text-fg-4'
const PANEL = 'broadcast-panel'
const ROW =
  'flex items-center justify-between gap-3 border-t border-border-subtle px-4 py-2.5 text-sm text-fg-2'
const KIND_VERB: Readonly<Record<string, string>> = {
  heat: 'set heat',
  testscrum: 'test scrum',
  relationship_cooldown: 'cooled down',
  relationship_reset: 'reset',
  relationship_freeze: 'froze',
  relationship_unfreeze: 'unfroze',
  relationship_level: 'pinned the level of',
  relationship_level_clear: 'cleared the pinned level of',
}
const PILL =
  'border border-border px-2 py-0.5 font-condensed text-[11px] font-bold uppercase tracking-[0.14em] text-fg-3'

const HEAT_LABEL = { cool: 'Cool', normal: 'Normal', hot: 'Hot' } as const

const storylineLabel = (key: string): string => {
  const [head = key, since] = key.split('@')
  const kind = head.split(':')[0]!.replace(/-/g, ' ')
  const text = kind.charAt(0).toUpperCase() + kind.slice(1)
  return since === undefined ? text : `${text} (since ${since.slice(5)})`
}

/** Strips Discord mention markup from the press service's private result line. */
const plainResult = (text: string): string => text.replace(/<[#@]!?\d+>/g, 'the test channel')

function Card({
  title,
  aside,
  children,
}: {
  title: string
  aside?: ReactNode
  children: ReactNode
}) {
  return (
    <section className={PANEL} aria-label={title}>
      <div className="flex items-center justify-between gap-3 px-4 py-3.5">
        <h2 className={LABEL}>{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  )
}

const Empty = ({ children }: { children: ReactNode }) => (
  <p className="border-t border-border-subtle px-4 py-3 text-sm text-fg-4">{children}</p>
)

/** Press Box overview: the state of the game (design section 3.1). Admin only; read only except heat and the test scrum. */
export default async function PressBoxOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string }>
}) {
  await requireAdmin()
  const now = new Date()
  const [{ notice: noticeRaw }, d] = await Promise.all([searchParams, loadOverview(now)])
  const notice = noticeFromQuery(noticeRaw)
  const on = REPORTER_IDS.length - d.disabled.length
  const seen = d.settings.pressSeenAt
  const alive = seen !== null && now.getTime() - seen.getTime() < PRESS_SEEN_MAX_MS
  const stopAt = d.limit * EXTRAS_STOP_SHARE
  const pct = Math.min(100, (d.spent / d.limit) * 100)
  const lastRequest = d.requests[0]
  const monthName = new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' }).format(now)

  return (
    <div className="flex flex-col gap-6">
      {notice !== null && (
        <p role="status" className="border border-border px-4 py-3 text-sm text-fg-2">
          {NOTICE_TEXT[notice]}
        </p>
      )}

      <section
        aria-label="Press switches"
        className={`${PANEL} grid md:grid-cols-2 xl:grid-cols-4`}
      >
        <div className="flex flex-col gap-2 border-b border-border-subtle px-5 py-5 xl:border-b-0 xl:border-r">
          <div className={LABEL}>Mode</div>
          <div className="flex items-baseline gap-3">
            <span className="font-condensed text-4xl font-black uppercase text-fg-1">
              {d.settings.pressMode === null ? '—' : d.settings.pressMode}
            </span>
            <span className={alive ? 'text-sm text-win' : 'text-sm text-accent-readable'}>
              {seen === null ? 'press service not seen yet' : alive ? 'running' : 'not seen lately'}
            </span>
          </div>
          <p className="text-xs text-fg-4">
            {d.settings.pressMode === 'live'
              ? 'posts in the game channel'
              : 'posts in the test channel'}
            {' · '}switching the mode is an ops step (read only here)
            {seen !== null && ` · last seen ${formatClubDateTime(seen) ?? ''}`}
          </p>
        </div>

        <div className="flex flex-col gap-2 border-b border-border-subtle px-5 py-5 xl:border-b-0 xl:border-r">
          <div className={LABEL}>Heat</div>
          <form action={setHeatAction} className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-2">
              {(['cool', 'normal', 'hot'] as const).map((h) => (
                <button
                  key={h}
                  type="submit"
                  name="heat"
                  value={h}
                  aria-pressed={d.heat.heat === h}
                  className={`${d.heat.heat === h ? AUTH_BUTTON_PRIMARY : AUTH_BUTTON_SECONDARY} px-3 py-2`}
                >
                  {HEAT_LABEL[h]}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2">
              <span className={ADMIN_LABEL}>Applies to</span>
              <select name="scope" defaultValue={d.heat.scope} className={`${ADMIN_FIELD} w-auto`}>
                <option value="night">Tonight</option>
                <option value="next">The next scrum</option>
              </select>
            </label>
          </form>
          <p className="text-xs text-fg-4">
            now: {HEAT_LABEL[d.heat.heat]} ·{' '}
            {d.heat.scope === 'next' ? 'next scrum only' : 'tonight'}
            {d.heat.expired && ' (the last night heat ran out)'}
          </p>
        </div>

        <div className="flex flex-col gap-2 border-b border-border-subtle px-5 py-5 md:border-b-0 xl:border-r">
          <div className={LABEL}>Reporters</div>
          <div className="flex items-baseline gap-2">
            <span className="font-condensed text-4xl font-black text-fg-1">{on}</span>
            <span className="text-fg-4">/ {REPORTER_IDS.length} on</span>
          </div>
          <Link prefetch href="/admin/news" className="text-xs text-fg-3 hover:text-fg-1">
            manage on the News desk page →
          </Link>
        </div>

        <div className="flex flex-col gap-2 px-5 py-5">
          <div className={LABEL}>Spend · {monthName}</div>
          <div className="flex items-baseline gap-2">
            <span className="font-condensed text-4xl font-black text-fg-1">
              ${d.spent.toFixed(2)}
            </span>
            <span className="text-fg-4">/ ${d.limit.toFixed(0)}</span>
          </div>
          <div
            className="relative h-1.5 bg-border-subtle"
            role="img"
            aria-label={`${pct.toFixed(0)} percent of the monthly limit; scrums and interviews stop at 80 percent`}
          >
            <div className="h-1.5 bg-accent" style={{ width: `${pct}%` }} />
            <div
              className="absolute -top-1 h-3.5 w-px bg-fg-3"
              style={{ left: `${EXTRAS_STOP_SHARE * 100}%` }}
            />
          </div>
          <p className="text-xs text-fg-4">scrums and interviews stop at ${stopAt.toFixed(0)}</p>
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <form action={runTestScrumAction}>
          <button type="submit" className={`${AUTH_BUTTON_PRIMARY} px-4 py-2.5`}>
            Run a free test scrum
          </button>
        </form>
        <span className="text-xs text-fg-4">
          posts in the test channel only · no AI cost · the press service starts it within a minute
        </span>
      </div>
      {lastRequest !== undefined && (
        <p className="text-xs text-fg-4">
          Last test scrum request ({formatClubDateTime(lastRequest.requestedAt)},{' '}
          {lastRequest.requestedBy}): <strong className="text-fg-2">{lastRequest.status}</strong>
          {lastRequest.result !== null && ` — ${plainResult(lastRequest.result).split('\n')[0]}`}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card
          title="Now"
          aside={<span className={PILL}>{d.now.scrums.length + d.now.interviews.length} open</span>}
        >
          {d.now.scrums.length + d.now.interviews.length + d.now.asks.length === 0 && (
            <Empty>No open scrums or interviews.</Empty>
          )}
          {d.now.scrums.map((s) => (
            <div key={`s${String(s.id)}`} className={ROW}>
              <span>
                Scrum · night {s.night.slice(5)}
                {s.isTest && <span className={`${PILL} ml-2`}>test</span>}
              </span>
              <span className="text-xs text-fg-4">
                {REPORTERS[s.reporter].name} · {s.done}/{s.people} done
              </span>
            </div>
          ))}
          {d.now.interviews.map((i) => (
            <div key={`i${String(i.id)}`} className={ROW}>
              <span>Interview · {i.name}</span>
              <span className="text-xs text-fg-4">
                {REPORTERS[i.reporter].name} · {i.status === 'offered' ? 'offered' : 'running'}
              </span>
            </div>
          ))}
          {d.now.asks.map((a) => (
            <div key={`a${String(a.id)}`} className={`${ROW} text-fg-4`}>
              <span>GM ask waiting · {a.name}</span>
              <span className="text-xs">
                {a.reporter === null ? 'any reporter' : REPORTERS[a.reporter].name}
              </span>
            </div>
          ))}
        </Card>

        <Card
          title="Top relationships"
          aside={
            <Link
              prefetch
              href="/admin/press-box/relationships"
              className="text-xs text-fg-3 hover:text-fg-1"
            >
              board →
            </Link>
          }
        >
          {d.relationships.length === 0 && <Empty>Everything is neutral right now.</Empty>}
          {d.relationships.map((r) => (
            <Link
              key={`${String(r.playerId)}-${r.reporter}`}
              prefetch
              href={`/admin/press-box/relationships?player=${String(r.playerId)}&reporter=${r.reporter}`}
              className={`${ROW} hover:bg-surface-raised`}
            >
              <span>
                {r.name} × {REPORTERS[r.reporter].name}
              </span>
              <span className={`${PILL} ${LEVEL_TEXT[r.level]}`}>
                {REL_LABELS[r.level]} {pointsText(r.points)}
              </span>
            </Link>
          ))}
        </Card>

        <Card
          title="Storylines"
          aside={<span className="text-xs text-fg-5">read only until L3</span>}
        >
          {d.storylines.length === 0 && <Empty>No stances in the last 14 days.</Empty>}
          {d.storylines.map((s) => (
            <div key={s.threadKey} className={ROW}>
              <span>{storylineLabel(s.threadKey)}</span>
              <span className="text-xs text-fg-4">
                {s.stances} {s.stances === 1 ? 'stance' : 'stances'}
              </span>
            </div>
          ))}
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Hot / cold · recent form">
          {d.form.hot.length + d.form.cold.length === 0 && (
            <Empty>Nobody stands out right now.</Empty>
          )}
          {d.form.hot.slice(0, 3).map((n) => (
            <div key={`h${String(n.playerId)}`} className={ROW}>
              <span>{n.name}</span>
              <span className="text-sm font-semibold text-win">▲ {n.text}</span>
            </div>
          ))}
          {d.form.cold.slice(0, 3).map((n) => (
            <div key={`c${String(n.playerId)}`} className={ROW}>
              <span>{n.name}</span>
              <span className="text-sm font-semibold text-accent-readable">▼ {n.text}</span>
            </div>
          ))}
        </Card>
        <Card title="Milestones in reach">
          {d.milestones.length === 0 && <Empty>No milestone within 3.</Empty>}
          {d.milestones.map((m) => (
            <div key={`${String(m.playerId)}-${m.stat}`} className={ROW}>
              <span>{m.name}</span>
              <span className="font-condensed text-lg font-black text-fg-1">
                {milestoneText(m)}
              </span>
            </div>
          ))}
        </Card>
      </div>

      <AdminSection
        title="Change log · Press Box"
        description="The last 20 changes made on this page: who, when, what."
      >
        {d.audit.length === 0 ? (
          <p className="text-sm text-fg-4">No changes yet.</p>
        ) : (
          <ul className="flex flex-col">
            {d.audit.map((a) => (
              <li
                key={a.id}
                className={`${ADMIN_TD} flex flex-wrap items-baseline justify-between gap-x-4`}
              >
                <span>
                  <strong className="text-fg-1">{a.actorName}</strong> {KIND_VERB[a.kind] ?? a.kind}{' '}
                  · {a.target} · {a.summary}
                </span>
                <span className="whitespace-nowrap text-xs text-fg-5">
                  {formatClubDateTime(a.at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </AdminSection>
    </div>
  )
}
