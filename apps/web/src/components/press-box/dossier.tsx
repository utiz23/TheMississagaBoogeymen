import type { ReactNode } from 'react'
import Link from 'next/link'
import { REL_LABELS, REPORTERS, REPORTER_IDS, type PressLevel } from '@eanhl/db/news'
import type { Dossier, DossierIndexRow } from '@eanhl/db/queries'
import { ADMIN_FIELD, ADMIN_LABEL } from '@/components/admin/admin-section'
import { AUTH_BUTTON_PRIMARY, AUTH_BUTTON_SECONDARY } from '@/components/auth/auth-panel'
import { formatClubDateTime, formatDataDay } from '@/lib/format'
import {
  addNicknameAction,
  dossierRelationshipAction,
  gmNoteAction,
  interviewAction,
  pressLevelAction,
  profileAction,
  removeNicknameAction,
} from '@/app/admin/press-box/actions'
import type { DossierPage } from '@/app/admin/press-box/dossier-data'
import { LEVEL_CLASS, LEVEL_SHORT, pointsText } from './level-style'

/**
 * The parts of a Press Box player dossier (design 3.2, the mock-up "Player dossier"). Server
 * components only; every button is a plain form to a server action in `actions.ts` that checks the
 * admin and writes the change log. Nothing here reads the database: the page passes the data, and
 * a "Leave me out" player's page passes an empty dossier (identity only).
 */

const LABEL = 'font-condensed text-[11px] font-semibold uppercase tracking-[0.2em] text-fg-4'
const PANEL = 'broadcast-panel'
const ROW =
  'flex items-center justify-between gap-3 border-t border-border-subtle px-4 py-2.5 text-sm text-fg-2'
const PILL =
  'border border-border px-2 py-0.5 font-condensed text-[11px] font-bold uppercase tracking-[0.14em] text-fg-3 whitespace-nowrap'
const BTN = `${AUTH_BUTTON_SECONDARY} px-3 py-2`
const SMALL_BTN = `${AUTH_BUTTON_SECONDARY} px-2.5 py-1.5`

export const LEVEL_WORD: Readonly<Record<PressLevel, string>> = {
  full: 'Full',
  easy: 'Go easy',
  out: 'Leave me out',
}

const ROLE_WORD = { player: 'Player', bench: 'Bench', coach: 'Coach' } as const

export function Panel({
  title,
  aside,
  children,
  label,
}: {
  title: string
  aside?: ReactNode
  children: ReactNode
  label?: string
}) {
  return (
    <section className={PANEL} aria-label={label ?? title}>
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

/** "3 days ago" / "today", in whole days. */
export function ageText(at: Date | null, now: Date): string {
  if (at === null) return '—'
  const days = Math.floor((now.getTime() - at.getTime()) / 86_400_000)
  return days <= 0 ? 'today' : days === 1 ? '1 day ago' : `${String(days)} days ago`
}

const reporterName = (r: keyof typeof REPORTERS | null): string =>
  r === null ? 'the reporter' : REPORTERS[r].name

// ── The member list beside a dossier ────────────────────────────────────────

export function DossierRail({
  rows,
  activeKey,
}: {
  rows: readonly DossierIndexRow[]
  activeKey: string
}) {
  const members = rows.filter((r) => r.role === 'player')
  const others = rows.filter((r) => r.role !== 'player')
  const item = (r: DossierIndexRow) => {
    const active = r.key === activeKey
    const out = r.pressLevel === 'out'
    return (
      <Link
        key={r.key}
        prefetch
        href={`/admin/press-box/players/${r.key}`}
        aria-current={active ? 'page' : undefined}
        className={`flex items-center justify-between gap-3 border-t border-border-subtle px-4 py-2.5 text-sm ${
          active
            ? 'text-fg-1 shadow-[inset_3px_0_0_var(--color-accent)]'
            : out
              ? 'text-fg-5'
              : 'text-fg-3 hover:text-fg-1'
        }`}
      >
        <span className="truncate">{r.name}</span>
        {r.role !== 'player' ? (
          <span className={PILL}>{ROLE_WORD[r.role]}</span>
        ) : r.pressLevel !== 'full' && r.pressLevel !== null ? (
          <span className={PILL}>{r.pressLevel === 'out' ? 'Out' : 'Easy'}</span>
        ) : null}
      </Link>
    )
  }
  return (
    <aside className={`${PANEL} w-full lg:max-w-[280px] lg:flex-[1_1_240px]`} aria-label="People">
      <div className="px-4 py-3.5">
        <Link prefetch href="/admin/press-box/players" className={`${LABEL} hover:text-fg-1`}>
          Members · {members.length}
        </Link>
      </div>
      {members.map(item)}
      {others.length > 0 && (
        <>
          <div className="border-t border-border-subtle px-4 py-3">
            <span className={LABEL}>Bench and coach · {others.length}</span>
          </div>
          {others.map(item)}
        </>
      )}
    </aside>
  )
}

// ── Identity and actions ─────────────────────────────────────────────────────

function Hidden({ k }: { k: string }) {
  return <input type="hidden" name="key" value={k} />
}

export function IdentityPanel({ d, requests }: { d: Dossier; requests: DossierPage['requests'] }) {
  const id = d.identity
  const out = id.pressLevel === 'out'
  const member = id.playerId !== null
  const interviewOpen = requests.some(
    (r) => r.kind === 'interview' && (r.status === 'pending' || r.status === 'running'),
  )
  return (
    <section className={`${PANEL} flex flex-col gap-5 p-6`} aria-label="Identity">
      <div className="flex flex-wrap items-center gap-6">
        <div
          aria-hidden="true"
          className="h-[72px] w-[72px] shrink-0 rounded-full border border-border-subtle bg-surface-raised"
        />
        <div className="min-w-[260px] flex-1">
          <h1 className="font-condensed text-5xl font-black uppercase leading-none tracking-[0.02em] text-fg-1">
            {id.name}
          </h1>
          <p className="mt-2 text-sm text-fg-3">
            {id.gamertag !== null && <>{id.gamertag} · </>}
            {member ? `player ${String(id.playerId)}` : ROLE_WORD[id.role].toLowerCase()}
            {' · '}Discord {id.discordLinked ? 'linked' : 'not linked'}
            {' · '}nicknames: {id.aliases.length === 0 ? 'none' : id.aliases.join(', ')}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {id.pressLevel !== null && (
              <span className={PILL}>
                Press: {LEVEL_WORD[id.pressLevel].toLowerCase()}
                {id.pressLevelSetBy !== null &&
                  ` (set by ${id.pressLevelSetBy === 'self' ? 'the player' : 'the admin'})`}
              </span>
            )}
            <span className={PILL}>{ROLE_WORD[id.role]}</span>
          </div>
        </div>
        {member && (
          <form action={pressLevelAction} className="flex flex-wrap items-center gap-2">
            <Hidden k={id.key} />
            <label htmlFor="press-level" className={ADMIN_LABEL}>
              Press level
            </label>
            <select
              id="press-level"
              name="level"
              defaultValue={id.pressLevel ?? 'full'}
              className={`${ADMIN_FIELD} w-auto`}
            >
              <option value="full">Full</option>
              <option value="easy">Go easy</option>
              <option value="out">Leave me out</option>
            </select>
            <button type="submit" className={BTN}>
              Set for them
            </button>
          </form>
        )}
      </div>

      {out ? (
        <p className="border-t border-border-subtle pt-4 text-sm text-fg-3">
          Leave me out: this page shows identity only. No profile, quotes, takes or notes are read
          or written for this player, and no interview is offered.
        </p>
      ) : (
        <div className="flex flex-wrap items-start gap-3 border-t border-border-subtle pt-4">
          {member && (
            <details className="group">
              <summary className={`${BTN} cursor-pointer list-none`}>+ Nickname</summary>
              <div className="mt-2 flex min-w-[260px] flex-col gap-3 border border-border-subtle p-3">
                <form action={addNicknameAction} className="flex flex-col gap-2">
                  <Hidden k={id.key} />
                  <label className="flex flex-col gap-1.5">
                    <span className={ADMIN_LABEL}>New nickname</span>
                    <input
                      name="nickname"
                      type="text"
                      required
                      minLength={2}
                      maxLength={24}
                      autoComplete="off"
                      className={ADMIN_FIELD}
                    />
                  </label>
                  <button type="submit" className={`${AUTH_BUTTON_PRIMARY} px-3 py-2`}>
                    Add nickname
                  </button>
                </form>
                {id.aliases.length > 0 && (
                  <ul className="flex flex-col gap-1.5" aria-label="Current nicknames">
                    {id.aliases.map((a) => (
                      <li
                        key={a}
                        className="flex items-center justify-between gap-3 text-sm text-fg-2"
                      >
                        <span>{a}</span>
                        <form action={removeNicknameAction}>
                          <Hidden k={id.key} />
                          <input type="hidden" name="nickname" value={a} />
                          <button
                            type="submit"
                            className={SMALL_BTN}
                            aria-label={`Remove nickname ${a}`}
                          >
                            Remove
                          </button>
                        </form>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </details>
          )}
          {member && (
            <details className="group">
              <summary className={`${BTN} cursor-pointer list-none`}>GM note</summary>
              <form
                action={gmNoteAction}
                className="mt-2 flex min-w-[300px] flex-col gap-2 border border-border-subtle p-3"
              >
                <Hidden k={id.key} />
                <label className="flex flex-col gap-1.5">
                  <span className={ADMIN_LABEL}>Note for tonight (500 characters)</span>
                  <textarea name="note" required maxLength={500} rows={3} className={ADMIN_FIELD} />
                </label>
                <button type="submit" className={`${AUTH_BUTTON_PRIMARY} px-3 py-2`}>
                  Save note
                </button>
                <p className="max-w-[320px] text-xs text-fg-5">
                  Same as /gm note: the writers may use it as a true event of tonight. Not for Go
                  easy players.
                </p>
              </form>
            </details>
          )}
          <details className="group">
            <summary className={`${AUTH_BUTTON_PRIMARY} cursor-pointer list-none px-3 py-2`}>
              Start interview
            </summary>
            <form
              action={interviewAction}
              className="mt-2 flex min-w-[300px] flex-col gap-2 border border-border-subtle p-3"
            >
              <Hidden k={id.key} />
              <label className="flex flex-col gap-1.5">
                <span className={ADMIN_LABEL}>Reporter</span>
                <select name="reporter" defaultValue="" className={ADMIN_FIELD}>
                  <option value="">The press service chooses</option>
                  {REPORTER_IDS.map((r) => (
                    <option key={r} value={r}>
                      {REPORTERS[r].name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1.5">
                <span className={ADMIN_LABEL}>Topic (optional)</span>
                <input
                  name="topic"
                  type="text"
                  maxLength={300}
                  autoComplete="off"
                  className={ADMIN_FIELD}
                />
              </label>
              <button
                type="submit"
                disabled={interviewOpen}
                className={`${AUTH_BUTTON_PRIMARY} px-3 py-2`}
              >
                {interviewOpen ? 'Waiting for the press service' : 'Offer the interview'}
              </button>
              <p className="max-w-[320px] text-xs text-fg-5">
                Same as /gm interview: the offer is posted in the press channel and stays open for
                30 minutes. Needs a linked Discord account.
              </p>
            </form>
          </details>
        </div>
      )}
    </section>
  )
}

// ── The AI profile ──────────────────────────────────────────────────────────

export function ProfilePanel({
  d,
  requests,
  now,
}: {
  d: Dossier
  requests: DossierPage['requests']
  now: Date
}) {
  const out = d.identity.pressLevel === 'out'
  const waiting = requests.some(
    (r) => r.kind === 'profile' && (r.status === 'pending' || r.status === 'running'),
  )
  const last = requests.find((r) => r.kind === 'profile')
  const p = d.profile
  return (
    <section className={`${PANEL} px-6 py-5`} aria-label="Profile">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className={LABEL}>How the press sees them · AI profile</h2>
        {!out && (
          <form action={profileAction} className="flex flex-wrap items-center gap-3">
            <Hidden k={d.identity.key} />
            <span className="text-xs text-fg-5">
              {p === null
                ? 'not written yet'
                : `written ${formatDataDay(p.writtenAt)} · cost about $${p.costUsd.toFixed(2)} · rules ${p.rulesVersion}`}
              {' · '}2 AI requests (one writes, one checks the rules), about $0.05 together
            </span>
            <button type="submit" disabled={waiting} className={BTN}>
              {waiting ? 'Waiting for the press service' : p === null ? 'Write' : 'Refresh'}
            </button>
          </form>
        )}
      </div>
      {out ? (
        <p className="mt-3 text-sm text-fg-4">Leave me out: no profile is written.</p>
      ) : p === null ? (
        <p className="mt-3 text-sm text-fg-4">
          No profile yet. Press Write: the press service makes 2 AI requests (one writes, one checks
          the rules), about $0.05 together, with the desk&apos;s writing rules (hockey only, no
          crude words, no quotes
          {d.identity.pressLevel === 'easy' ? ', no criticism for Go easy' : ''}) and stores the
          text here.
        </p>
      ) : (
        <p className="mt-3 max-w-[880px] text-base leading-relaxed text-fg-2">{p.text}</p>
      )}
      {last !== undefined && last.status !== 'pending' && last.status !== 'running' && !out && (
        <p className="mt-3 text-xs text-fg-4">
          Last request ({formatClubDateTime(last.at)}):{' '}
          <strong className="text-fg-2">{last.status}</strong>
          {last.result !== null && ` — ${last.result}`}
        </p>
      )}
      {p !== null && !out && (
        <p className="mt-2 text-xs text-fg-5">Age: {ageText(p.writtenAt, now)}.</p>
      )}
    </section>
  )
}

// ── Form ────────────────────────────────────────────────────────────────────

export function FormPanel({
  form,
  titleName,
}: {
  form: DossierPage['form']
  titleName: string | null
}) {
  if (form === null) {
    return (
      <Panel title="Form">
        <Empty>No games on record for this person.</Empty>
      </Panel>
    )
  }
  const title = titleName ?? 'this title'
  const next = form.next[0] ?? null
  const cell = (label: string, value: ReactNode, last = false) => (
    <div className={`px-5 py-4 ${last ? '' : 'sm:border-r sm:border-border-subtle'}`}>
      <div className={LABEL}>{label}</div>
      <div className="font-condensed text-4xl font-black tabular-nums text-fg-1">{value}</div>
    </div>
  )
  return (
    <section className={PANEL} aria-label="Form">
      <div className="grid sm:grid-cols-4">
        {cell(`Goals · ${title}`, form.goals)}
        {cell('Assists', form.assists)}
        {cell('GP', form.games)}
        <div className="px-5 py-4">
          <div className={LABEL}>Next milestone</div>
          <div className="mt-1.5 font-condensed text-2xl font-black text-fg-1">
            {next === null ? '—' : next.text}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-border-subtle px-5 py-3 text-sm text-fg-3">
        <span>
          Last {form.recent.length}:{' '}
          {form.recent.map((g, i) => (
            <span key={`${g.night}-${String(i)}`} className="mr-2 whitespace-nowrap">
              {g.result === 'WIN'
                ? 'W'
                : g.result === 'OTL'
                  ? 'OTL'
                  : g.result === 'DNF'
                    ? 'DNF'
                    : 'L'}{' '}
              {g.goals}G {g.assists}A{i < form.recent.length - 1 ? ',' : ''}
            </span>
          ))}
        </span>
        {form.trend !== null && (
          <span
            className={
              form.trend.direction === 'hot'
                ? 'font-semibold text-win'
                : 'font-semibold text-accent-readable'
            }
          >
            {form.trend.direction === 'hot' ? '▲' : '▼'} {form.trend.text}
          </span>
        )}
        {form.next.slice(1).map((m) => (
          <span key={m.stat} className="text-fg-4">
            {m.text}
          </span>
        ))}
      </div>
    </section>
  )
}

// ── In their own words ──────────────────────────────────────────────────────

export function QuotesPanel({ d }: { d: Dossier }) {
  const { counts } = d
  return (
    <Panel
      title="In their own words"
      aside={
        <span className="text-xs text-fg-5">
          {counts.usable} usable · {counts.joke} joke · {counts.unusable} not used
        </span>
      }
    >
      {d.quotes.length === 0 && <Empty>No usable or joke answers yet.</Empty>}
      {d.quotes.map((q) => (
        <div key={q.id} className="border-t border-border-subtle px-4 py-3">
          <p className="text-[15px] leading-relaxed text-fg-1">“{q.text}”</p>
          <p className="mt-1 text-xs text-fg-4">
            to {reporterName(q.reporter)} · {q.source}
            {q.usability === 'joke' && <span className={`${PILL} ml-2`}>joke</span>}
            {' · '}
            {formatDataDay(q.at)}
          </p>
          <p className="mt-0.5 text-xs text-fg-5">asked: {q.question}</p>
        </div>
      ))}
      <p className="border-t border-border-subtle px-4 py-2.5 text-xs text-fg-5">
        Unusable and off-limits answers show as counts only, never their text.
      </p>
    </Panel>
  )
}

// ── What the press thinks ───────────────────────────────────────────────────

const storylineLabel = (key: string): string => {
  const [head = key, since] = key.split('@')
  const kind = head.split(':')[0]!.replace(/-/g, ' ')
  const text = kind.charAt(0).toUpperCase() + kind.slice(1)
  return since === undefined ? text : `${text} (since ${since.slice(5)})`
}

export function PressThinksPanel({ d }: { d: Dossier }) {
  const takes = d.takes.filter((t) => t.active)
  return (
    <Panel
      title="What the press thinks"
      aside={<span className="text-xs text-fg-5">read only here · editing comes in L3</span>}
    >
      {takes.length === 0 && d.stances.length === 0 && <Empty>No takes or stances.</Empty>}
      {takes.map((t) => (
        <div key={`t${String(t.id)}`} className={ROW}>
          <span>
            <strong className="text-fg-1">{reporterName(t.reporter)}</strong> · {t.take}
          </span>
          <span className={PILL}>take</span>
        </div>
      ))}
      {d.stances.map((s, i) => (
        <div key={`s${String(i)}`} className={ROW}>
          <span>
            <strong className="text-fg-1">{reporterName(s.reporter)}</strong> · {s.stance}
          </span>
          <span className="whitespace-nowrap text-xs text-fg-5">{storylineLabel(s.threadKey)}</span>
        </div>
      ))}
    </Panel>
  )
}

// ── Relationships ───────────────────────────────────────────────────────────

export function RelationshipsPanel({ d }: { d: Dossier }) {
  const playerId = d.identity.playerId
  const cells = new Map(d.relationships.map((c) => [c.reporter, c]))
  const shown = REPORTER_IDS.filter((r) => cells.has(r))
  return (
    <Panel
      title="Relationships"
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
      {playerId === null && <Empty>Bench people and coaches have no relationships.</Empty>}
      {playerId !== null && shown.length === 0 && (
        <Empty>Every reporter is neutral about this player.</Empty>
      )}
      {playerId !== null &&
        shown.map((r) => {
          const c = cells.get(r)!
          return (
            <div key={r} className={ROW}>
              <Link
                prefetch
                href={`/admin/press-box/relationships?player=${String(playerId)}&reporter=${r}`}
                className="hover:text-fg-1"
              >
                {REPORTERS[r].name}
              </Link>
              <span className="flex items-center gap-2">
                <span
                  className={`border px-2 py-0.5 font-condensed text-[11px] font-bold uppercase tracking-[0.14em] ${LEVEL_CLASS[c.level]}`}
                >
                  {REL_LABELS[c.level] ?? LEVEL_SHORT[c.level]} · {pointsText(c.points)}
                  {c.overrideLevel !== null && ' · pinned'}
                  {c.frozen && ' · frozen'}
                </span>
                <form action={dossierRelationshipAction}>
                  <Hidden k={d.identity.key} />
                  <input type="hidden" name="playerId" value={playerId} />
                  <input type="hidden" name="reporter" value={r} />
                  <input type="hidden" name="kind" value="cooldown" />
                  <button type="submit" disabled={c.frozen} className={SMALL_BTN}>
                    Cool down
                  </button>
                </form>
              </span>
            </div>
          )
        })}
    </Panel>
  )
}

// ── GM notes, asks, interviews, scrums ──────────────────────────────────────

export function GmPanel({ d }: { d: Dossier }) {
  const empty = d.notes.length + d.asks.length + d.interviews.length === 0 && d.scrums.count === 0
  return (
    <Panel title="GM notes · asks · interviews">
      {empty && <Empty>Nothing yet.</Empty>}
      {d.notes.map((n) => (
        <div key={`n${String(n.id)}`} className={ROW}>
          <span>Note: “{n.note}”</span>
          <span className="whitespace-nowrap text-xs text-fg-4">
            {n.night.slice(5)} · {n.status}
          </span>
        </div>
      ))}
      {d.asks.map((a) => (
        <div key={`a${String(a.id)}`} className={ROW}>
          <span>
            Ask{a.reporter === null ? '' : ` (${reporterName(a.reporter)})`}: “{a.question}”
          </span>
          <span className="whitespace-nowrap text-xs text-fg-4">
            {a.night.slice(5)} · {a.status}
          </span>
        </div>
      ))}
      {d.interviews.map((i) => (
        <div key={`i${String(i.id)}`} className={ROW}>
          <span>
            Interview · {reporterName(i.reporter)} · {i.answers} answers · {i.status}
          </span>
          {i.articleSlug !== null ? (
            <Link
              prefetch
              href={`/news/${i.articleSlug}`}
              className="text-xs text-fg-3 hover:text-fg-1"
            >
              article →
            </Link>
          ) : (
            <span className="text-xs text-fg-5">article: {i.articleStatus}</span>
          )}
        </div>
      ))}
      {d.scrums.count > 0 && (
        <div className={ROW}>
          <span>
            Scrums · {d.scrums.count}
            {d.scrums.lastNight !== null && ` · last: night ${d.scrums.lastNight.slice(5)}`}
          </span>
          <span className="text-xs text-fg-4">{d.scrums.usableAnswers} usable answers</span>
        </div>
      )}
    </Panel>
  )
}

// ── The index ───────────────────────────────────────────────────────────────

export function DossierIndexTable({ rows, now }: { rows: readonly DossierIndexRow[]; now: Date }) {
  const th =
    'px-4 py-3 text-left font-condensed text-[11px] font-semibold uppercase tracking-[0.16em] text-fg-4'
  const td = 'border-t border-border-subtle px-4 py-2.5 text-sm text-fg-2'
  return (
    <section className={`${PANEL} overflow-x-auto`} aria-label="People">
      <table className="w-full min-w-[820px] border-collapse">
        <thead>
          <tr>
            <th className={th}>Person</th>
            <th className={th}>Role</th>
            <th className={th}>Press level</th>
            <th className={`${th} text-right`}>Relationships</th>
            <th className={`${th} text-right`}>Quotes</th>
            <th className={th}>Last scrum or interview</th>
            <th className={th}>Profile</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td className={td}>
                <Link
                  prefetch
                  href={`/admin/press-box/players/${r.key}`}
                  className="font-semibold text-fg-1 hover:text-accent-readable"
                >
                  {r.name}
                </Link>
                {r.gamertag !== null && r.gamertag !== r.name && (
                  <span className="ml-2 text-xs text-fg-5">{r.gamertag}</span>
                )}
              </td>
              <td className={td}>{ROLE_WORD[r.role]}</td>
              <td className={td}>{r.pressLevel === null ? '—' : LEVEL_WORD[r.pressLevel]}</td>
              <td className={`${td} text-right tabular-nums`}>
                {r.pressLevel === 'out' ? '—' : r.relationships}
              </td>
              <td className={`${td} text-right tabular-nums`}>
                {r.pressLevel === 'out' ? '—' : r.quotes}
              </td>
              <td className={td}>
                {r.pressLevel === 'out'
                  ? '—'
                  : r.lastTalkedAt === null
                    ? 'never'
                    : formatDataDay(r.lastTalkedAt)}
              </td>
              <td className={td}>
                {r.pressLevel === 'out'
                  ? '—'
                  : r.profileWrittenAt === null
                    ? 'none'
                    : ageText(r.profileWrittenAt, now)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
