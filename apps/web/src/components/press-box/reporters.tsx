import type { ReactNode } from 'react'
import Link from 'next/link'
import { LOCKED_RULES, REPORTERS, type ReporterId } from '@eanhl/db/news'
import {
  REPORTER_LIMITS,
  type ReporterBoardRow,
  type ReporterPreview,
  type ReporterRecord,
} from '@eanhl/db/queries'
import { ADMIN_FIELD, ADMIN_LABEL } from '@/components/admin/admin-section'
import { AUTH_BUTTON_PRIMARY, AUTH_BUTTON_SECONDARY } from '@/components/auth/auth-panel'
import { ReporterAvatar } from '@/components/news/reporter-avatar'
import { formatDataDay } from '@/lib/format'
import {
  previewReporterAction,
  reporterSwitchAction,
  resetReporterAction,
  saveReporterAction,
} from '@/app/admin/press-box/actions'
import {
  DISPOSITION_LABEL,
  characterLine,
  editorValues,
  type ReporterPage,
} from '@/app/admin/press-box/reporters-data'

/**
 * The Reporters pages (design section 3.5, task press-box-l4): the list of the nine, and one
 * reporter's page with the record, the character editor (bio, voice notes, catchphrases,
 * disposition), the locked rules (read only) and "Preview a sample line". Server components; every
 * button is a plain form to a server action in `actions.ts` that checks the admin, checks the text
 * and writes the change log. No client code.
 */

const PANEL = 'broadcast-panel'
const LABEL = 'font-condensed text-[11px] font-semibold uppercase tracking-[0.2em] text-fg-4'
const BTN = `${AUTH_BUTTON_SECONDARY} px-3 py-2`
const BTN_PRIMARY = `${AUTH_BUTTON_PRIMARY} px-3 py-2`
const PILL =
  'border px-2 py-0.5 font-condensed text-[11px] font-bold uppercase tracking-[0.14em] whitespace-nowrap'
const PILL_ON = `${PILL} border-border text-fg-3`
const PILL_OFF = `${PILL} border-accent-line bg-accent-soft text-accent-readable`
const PILL_EDITED = `${PILL} border-otl/60 text-otl`

const href = (id: ReporterId): string => `/admin/press-box/reporters/${id}`

/** The state pills of a reporter: on or off, and edited (with the character version). */
function StatePills({ row }: { row: Pick<ReporterBoardRow, 'enabled' | 'override'> }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <span className={row.enabled ? PILL_ON : PILL_OFF}>{row.enabled ? 'On' : 'Off'}</span>
      {row.override !== null && (
        <span className={PILL_EDITED}>Edited v{row.override.characterVersion}</span>
      )}
    </span>
  )
}

// ── The list ────────────────────────────────────────────────────────────────

export function ReportersGrid({ rows, ready }: { rows: ReporterBoardRow[]; ready: boolean }) {
  return (
    <section className="flex flex-col gap-4" aria-label="The desk">
      {!ready && (
        <p role="status" className="border border-border px-4 py-3 text-sm text-fg-3">
          Migration 0087 is not applied yet, so the characters cannot be edited. The writers use the
          code characters.
        </p>
      )}
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {rows.map((row) => {
          const r = REPORTERS[row.id]
          return (
            <li key={row.id} className={PANEL}>
              <Link
                prefetch
                href={href(row.id)}
                className="flex h-full flex-col gap-3 px-4 py-4 hover:bg-surface-2"
              >
                <span className="flex items-center gap-3">
                  <ReporterAvatar reporter={row.id} size="md" />
                  <span className="flex min-w-0 flex-col">
                    <span className="font-condensed text-lg font-black uppercase tracking-[0.06em] text-fg-1">
                      {r.name}
                    </span>
                    <span className="truncate text-xs text-fg-4">{r.outlet}</span>
                  </span>
                </span>
                <StatePills row={row} />
                <dl className="grid grid-cols-2 gap-2 text-sm text-fg-2">
                  <div>
                    <dt className={LABEL}>Posts · this month</dt>
                    <dd className="font-condensed text-2xl font-black text-fg-1">
                      {row.postsMonth}
                    </dd>
                  </div>
                  <div>
                    <dt className={LABEL}>Feuds</dt>
                    <dd className="font-condensed text-2xl font-black text-fg-1">{row.feuds}</dd>
                  </div>
                </dl>
                <span className="mt-auto text-xs text-fg-4">Open the character editor →</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

// ── One reporter ────────────────────────────────────────────────────────────

export function ReporterRail({ rail, current }: { rail: ReporterBoardRow[]; current: ReporterId }) {
  return (
    <aside className={`${PANEL} w-full xl:w-[260px] xl:shrink-0`} aria-label="Reporters">
      <p className={`${LABEL} px-4 py-3.5`}>The desk · {rail.length}</p>
      <ul>
        {rail.map((row) => (
          <li key={row.id} className="border-t border-border-subtle">
            <Link
              prefetch
              href={href(row.id)}
              aria-current={row.id === current ? 'page' : undefined}
              className={`flex items-center justify-between gap-3 px-4 py-2.5 text-sm ${
                row.id === current
                  ? 'bg-surface-2 text-fg-1 shadow-[inset_3px_0_0_var(--color-accent)]'
                  : 'text-fg-2 hover:text-fg-1'
              }`}
            >
              <span>{REPORTERS[row.id].name}</span>
              <StatePills row={row} />
            </Link>
          </li>
        ))}
      </ul>
    </aside>
  )
}

export function ReporterHeader({ page }: { page: ReporterPage }) {
  const r = REPORTERS[page.id]
  return (
    <section className={`${PANEL} flex flex-wrap items-center gap-5 p-5`} aria-label="Reporter">
      <ReporterAvatar reporter={page.id} size="lg" />
      <div className="min-w-0 flex-1 basis-64">
        <h2 className="font-condensed text-3xl font-black uppercase leading-none tracking-[0.04em] text-fg-1 sm:text-4xl">
          {r.name}
        </h2>
        <p className="mt-1 text-sm text-fg-3">
          {r.outlet} · {characterLine(page.override, formatDataDay)}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <form action={reporterSwitchAction}>
          <input type="hidden" name="reporter" value={page.id} />
          <input type="hidden" name="enabled" value="1" />
          <button
            type="submit"
            aria-pressed={page.enabled}
            disabled={page.enabled}
            className={page.enabled ? BTN_PRIMARY : BTN}
          >
            On
          </button>
        </form>
        <form action={reporterSwitchAction}>
          <input type="hidden" name="reporter" value={page.id} />
          <input type="hidden" name="enabled" value="0" />
          <button
            type="submit"
            aria-pressed={!page.enabled}
            disabled={!page.enabled}
            className={!page.enabled ? BTN_PRIMARY : BTN}
          >
            Off
          </button>
        </form>
      </div>
    </section>
  )
}

function Stat({ label, value, note }: { label: string; value: ReactNode; note?: string }) {
  return (
    <div className="px-5 py-4">
      <dt className={LABEL}>{label}</dt>
      <dd className="font-condensed text-3xl font-black text-fg-1">{value}</dd>
      {note !== undefined && <p className="text-xs text-fg-5">{note}</p>}
    </div>
  )
}

export function RecordStrip({ record }: { record: ReporterRecord }) {
  return (
    <section className={PANEL} aria-label="Record">
      <dl className="grid grid-cols-2 divide-border-subtle md:grid-cols-4 md:divide-x">
        <Stat
          label="Posts · this month"
          value={record.postsMonth}
          note={`${String(record.articlesMonth)} articles`}
        />
        <Stat
          label="Scrum questions"
          value={record.scrumAnswers}
          note={`${String(record.interviewAnswers)} interview questions`}
        />
        <Stat
          label="Relationships"
          value={record.feuds}
          note={`feuds now · ${String(record.fans)} fans · ${String(record.pairs)} pairs`}
        />
        <Stat label="Quotes drawn" value={record.quotesDrawn} note="usable and joke answers" />
      </dl>
      <p className="border-t border-border-subtle px-5 py-3 text-xs text-fg-5">
        Written with:{' '}
        {record.byVersion.length === 0
          ? 'no items yet'
          : record.byVersion
              .map(
                (v) =>
                  `${v.version === null ? 'before versions' : `version ${String(v.version)}`} · ${String(v.items)} items`,
              )
              .join(' · ')}
        . Counts only: no answer or post text is read here.
      </p>
    </section>
  )
}

export function CharacterEditor({ page }: { page: ReporterPage }) {
  const v = editorValues(page)
  const next = (page.override?.characterVersion ?? 0) + 1
  const def = REPORTERS[page.id].disposition
  return (
    <section className={`${PANEL} flex flex-col gap-4 p-5`} aria-label="Character editor">
      <h2 className={LABEL}>Character · the writers use this version</h2>
      {!page.ready && (
        <p role="status" className="border border-border px-4 py-3 text-sm text-fg-3">
          Migration 0087 is not applied yet, so nothing can be saved. The text below is the code
          default.
        </p>
      )}
      <form action={saveReporterAction} className="flex flex-col gap-4">
        <input type="hidden" name="reporter" value={page.id} />
        <label className="flex flex-col gap-1.5">
          <span className={ADMIN_LABEL}>
            Bio · up to {REPORTER_LIMITS.bio} characters, no digits
          </span>
          <textarea
            name="bio"
            rows={4}
            required
            maxLength={REPORTER_LIMITS.bio}
            defaultValue={v.bio}
            className={ADMIN_FIELD}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={ADMIN_LABEL}>
            Voice notes · how the reporter writes · up to {REPORTER_LIMITS.voice} characters
          </span>
          <textarea
            name="voiceNotes"
            rows={14}
            required
            maxLength={REPORTER_LIMITS.voice}
            defaultValue={v.voiceNotes}
            className={ADMIN_FIELD}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={ADMIN_LABEL}>
            Catchphrases · one per line · {REPORTER_LIMITS.catchphrasesMin} to{' '}
            {REPORTER_LIMITS.catchphrasesMax}, up to {REPORTER_LIMITS.catchphraseChars} characters
          </span>
          <textarea
            name="catchphrases"
            rows={8}
            required
            defaultValue={v.catchphrases}
            className={ADMIN_FIELD}
          />
        </label>
        <label className="flex max-w-md flex-col gap-1.5">
          <span className={ADMIN_LABEL}>Disposition · homer to critic</span>
          <select name="disposition" defaultValue={v.disposition} className={ADMIN_FIELD}>
            <option value="default">Default ({DISPOSITION_LABEL[String(def)]})</option>
            {(['2', '1', '0', '-1', '-2'] as const).map((d) => (
              <option key={d} value={d}>
                {DISPOSITION_LABEL[d]}
              </option>
            ))}
          </select>
          <span className="text-xs text-fg-5">
            A homer takes bigger up-steps and smaller down-steps on the relationship scale; a critic
            the reverse.
          </span>
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className={BTN_PRIMARY} disabled={!page.ready}>
            Save · version {next}
          </button>
          <span className="text-xs text-fg-5">
            Checked on save: no crude words, no Leave me out names, no text that changes the rules.
            Fields you leave as the default keep following the code.
          </span>
        </div>
      </form>
      <div className="flex flex-wrap items-center gap-3 border-t border-border-subtle pt-4">
        <details className="text-sm text-fg-3">
          <summary className={`${BTN} cursor-pointer list-none`}>Reset to default</summary>
          <form action={resetReporterAction} className="mt-3 flex flex-col gap-2">
            <input type="hidden" name="reporter" value={page.id} />
            <p className="max-w-md text-xs text-fg-4">
              This drops every edit of {REPORTERS[page.id].name}: bio, voice notes, catchphrases and
              disposition go back to the code. The character version still goes up by one.
            </p>
            <div>
              <button type="submit" className={BTN_PRIMARY} disabled={!page.ready}>
                Yes, reset {REPORTERS[page.id].name}
              </button>
            </div>
          </form>
        </details>
      </div>
    </section>
  )
}

const waiting = (p: ReporterPreview): boolean => p.status === 'pending' || p.status === 'running'

export function PreviewPanel({ page }: { page: ReporterPage }) {
  const p = page.preview
  const stamp = (d: Date | null): string =>
    d === null
      ? ''
      : d.toLocaleString('en-CA', {
          timeZone: 'America/Edmonton',
          hour12: false,
          dateStyle: 'medium',
          timeStyle: 'short',
        })
  return (
    <section className={`${PANEL} flex flex-col gap-3 p-5`} aria-label="Sample line">
      <h2 className={LABEL}>Preview a sample line</h2>
      <p className="text-xs text-fg-5">
        One short AI line, about $0.01, counted in the monthly spend. It uses the character as
        saved: save your edit first. It is never posted and has no real facts.
      </p>
      <form action={previewReporterAction} className="flex flex-wrap items-center gap-3">
        <input type="hidden" name="reporter" value={page.id} />
        <button type="submit" className={BTN} disabled={!page.ready || (p !== null && waiting(p))}>
          Preview a sample line
        </button>
      </form>
      {p === null && <p className="text-sm text-fg-4">No sample line yet.</p>}
      {p !== null && waiting(p) && (
        <p role="status" className="text-sm text-fg-3">
          Waiting for the press service (asked {stamp(p.requestedAt)}). Reload in a minute.
        </p>
      )}
      {p?.status === 'done' && (
        <figure className="flex flex-col gap-1 border-l-2 border-accent pl-4">
          <blockquote className="text-base text-fg-1">“{p.result ?? ''}”</blockquote>
          <figcaption className="text-xs text-fg-5">
            Sample, written {stamp(p.handledAt)}. Not posted. Not a fact.
          </figcaption>
        </figure>
      )}
      {p?.status === 'failed' && (
        <p role="status" className="text-sm text-fg-3">
          No line this time ({stamp(p.handledAt ?? p.requestedAt)}): {p.result ?? 'it failed'}
        </p>
      )}
    </section>
  )
}

export function LockedRules() {
  return (
    <section className={`${PANEL} p-5`} aria-label="Locked rules">
      <h2 className={LABEL}>Locked · always apply, not editable here</h2>
      <p className="mt-2 text-xs text-fg-5">
        These are in code. Every writer prompt adds them after the character text, so no edit above
        can change or remove them.
      </p>
      <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-fg-3">
        {LOCKED_RULES.map((rule) => (
          <li key={rule}>{rule}</li>
        ))}
      </ul>
    </section>
  )
}
