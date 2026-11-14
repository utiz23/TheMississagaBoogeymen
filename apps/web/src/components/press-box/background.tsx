import type { ReactNode } from 'react'
import Link from 'next/link'
import { BACKGROUND_PARTS, BACKGROUND_PART_LABELS, type PressLevel } from '@eanhl/db/schema'
import type { BackgroundFact, BackgroundView } from '@eanhl/db/queries'
import { ADMIN_FIELD, ADMIN_LABEL } from '@/components/admin/admin-section'
import { AUTH_BUTTON_PRIMARY, AUTH_BUTTON_SECONDARY } from '@/components/auth/auth-panel'
import { formatDataDay } from '@/lib/format'
import {
  addBackgroundAction,
  confirmBackgroundAction,
  editBackgroundAction,
  rejectBackgroundAction,
  removeBackgroundAction,
} from '@/app/admin/press-box/actions'
import { Panel } from './dossier'

/**
 * The "Background" section of a Press Box dossier (task background-b1): facts about the person,
 * proposed ones first with Confirm / Edit / Reject, what teammates said about them (confirm only),
 * a form to add a fact, and the questions still open. Server components; every button is a plain
 * form to a server action in `actions.ts` that checks the admin and writes the change log. The
 * text of a source answer arrives here only when the answer is usable or joke: the query selects
 * nothing else, and this file shows nothing else.
 */

const PILL =
  'border border-border px-2 py-0.5 font-condensed text-[11px] font-bold uppercase tracking-[0.14em] text-fg-3 whitespace-nowrap'
const SMALL_BTN = `${AUTH_BUTTON_SECONDARY} px-2.5 py-1.5`
const SMALL_PRIMARY = `${AUTH_BUTTON_PRIMARY} px-2.5 py-1.5`
const ROW = 'flex flex-col gap-2 border-t border-border-subtle px-4 py-3 text-sm text-fg-2'

const Empty = ({ children }: { children: ReactNode }) => (
  <p className="border-t border-border-subtle px-4 py-3 text-sm text-fg-4">{children}</p>
)

const SubHead = ({ children, aside }: { children: ReactNode; aside?: ReactNode }) => (
  <div className="flex items-center justify-between gap-3 border-t border-border-subtle px-4 py-2.5">
    <h3 className="font-condensed text-[11px] font-semibold uppercase tracking-[0.2em] text-fg-4">
      {children}
    </h3>
    {aside}
  </div>
)

function Keys({ k, fact }: { k: string; fact?: number }) {
  return (
    <>
      <input type="hidden" name="key" value={k} />
      {fact !== undefined && <input type="hidden" name="fact" value={String(fact)} />}
    </>
  )
}

/** Where a fact came from, shown under it. An unusable or off-limits answer shows no text. */
function Source({ fact }: { fact: BackgroundFact }) {
  if (fact.source === 'admin') {
    return <p className="text-xs text-fg-5">Typed by {fact.createdBy}</p>
  }
  const a = fact.answer
  if (a === null)
    return <p className="text-xs text-fg-5">From an answer that is no longer stored.</p>
  const kind = a.kind === 'scrum' ? 'a scrum answer' : 'an interview answer'
  if (a.text === null || a.question === null) {
    return (
      <p className="text-xs text-fg-5">
        From {kind}. The answer is not used (unusable, off-limits or a test), so its text is not
        shown.
      </p>
    )
  }
  return (
    <div className="flex flex-col gap-0.5 border-l-2 border-border pl-3 text-xs text-fg-4">
      <span>
        From {kind}
        {a.usability === 'joke' && <span className={`${PILL} ml-2`}>joke</span>}
      </span>
      <span className="text-fg-5">asked: {a.question}</span>
      <span className="text-[13px] leading-relaxed text-fg-3">“{a.text}”</span>
    </div>
  )
}

function EditForm({
  k,
  fact,
  canConfirm,
}: {
  k: string
  fact: BackgroundFact
  canConfirm: boolean
}) {
  return (
    <details>
      <summary className={`${SMALL_BTN} cursor-pointer list-none`}>Edit</summary>
      <form
        action={editBackgroundAction}
        className="mt-2 flex max-w-[560px] flex-col gap-2 border border-border-subtle p-3"
      >
        <Keys k={k} fact={fact.id} />
        <label className="flex flex-col gap-1.5">
          <span className={ADMIN_LABEL}>Fact (400 characters)</span>
          <textarea
            name="text"
            required
            maxLength={400}
            rows={3}
            defaultValue={fact.text}
            className={ADMIN_FIELD}
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <button type="submit" className={SMALL_BTN}>
            Save
          </button>
          {canConfirm && (
            <button type="submit" name="confirm" value="1" className={SMALL_PRIMARY}>
              Save and confirm
            </button>
          )}
        </div>
      </form>
    </details>
  )
}

function Decision({
  k,
  fact,
  label,
  action,
  primary = false,
}: {
  k: string
  fact: BackgroundFact
  label: string
  action: (formData: FormData) => Promise<void>
  primary?: boolean
}) {
  return (
    <form action={action}>
      <Keys k={k} fact={fact.id} />
      <button type="submit" className={primary ? SMALL_PRIMARY : SMALL_BTN}>
        {label}
      </button>
    </form>
  )
}

function FactHead({ fact, showOwner }: { fact: BackgroundFact; showOwner: boolean }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <span className={PILL}>{BACKGROUND_PART_LABELS[fact.part]}</span>
      {fact.status === 'proposed' && <span className={PILL}>waiting</span>}
      {fact.subjectName !== null && !showOwner && (
        <span className="text-xs text-fg-4">about {fact.subjectName}</span>
      )}
      {showOwner && <span className="text-xs text-fg-4">said by {fact.ownerName}</span>}
    </div>
  )
}

/** A fact about this person that the admin decides on (own or from a teammate's answer). */
function FactRow({
  k,
  fact,
  fromTeammate,
}: {
  k: string
  fact: BackgroundFact
  fromTeammate: boolean
}) {
  const proposed = fact.status === 'proposed'
  const when = fact.reviewedAt ?? fact.createdAt
  return (
    <div className={ROW}>
      <FactHead fact={fact} showOwner={fromTeammate} />
      <p className="text-[15px] leading-relaxed text-fg-1">{fact.text}</p>
      <Source fact={fact} />
      {fact.status === 'confirmed' && fact.reviewedBy !== null && (
        <p className="text-xs text-fg-5">
          Confirmed by {fact.reviewedBy}, {formatDataDay(when)}
          {fact.editedBy !== null && fact.editedAt !== null
            ? ` · edited by ${fact.editedBy}, ${formatDataDay(fact.editedAt)}`
            : ''}
        </p>
      )}
      <div className="flex flex-wrap items-start gap-2">
        {proposed && (
          <Decision k={k} fact={fact} label="Confirm" action={confirmBackgroundAction} primary />
        )}
        {!fromTeammate && <EditForm k={k} fact={fact} canConfirm={proposed} />}
        {fromTeammate && (
          <Link
            prefetch
            href={`/admin/press-box/players/${fact.ownerKey}`}
            className={`${SMALL_BTN} no-underline`}
          >
            Edit on {fact.ownerName}’s page
          </Link>
        )}
        {proposed ? (
          <Decision k={k} fact={fact} label="Reject" action={rejectBackgroundAction} />
        ) : (
          <Decision k={k} fact={fact} label="Remove" action={removeBackgroundAction} />
        )}
      </div>
    </div>
  )
}

function AddForm({
  k,
  teammates,
  question,
  aboutTeammate,
  submit,
}: {
  k: string
  teammates: BackgroundView['teammates']
  /** Set when the form answers a bank question: the part is then the question's own. */
  question?: number
  aboutTeammate: boolean
  submit: string
}) {
  return (
    <form
      action={addBackgroundAction}
      className="flex max-w-[560px] flex-col gap-2 border border-border-subtle p-3"
    >
      <Keys k={k} />
      {question !== undefined && <input type="hidden" name="question" value={String(question)} />}
      {question === undefined && (
        <label className="flex flex-col gap-1.5">
          <span className={ADMIN_LABEL}>Part</span>
          <select name="part" required defaultValue="" className={ADMIN_FIELD}>
            <option value="" disabled>
              Choose a part
            </option>
            {BACKGROUND_PARTS.map((p) => (
              <option key={p} value={p}>
                {BACKGROUND_PART_LABELS[p]}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="flex flex-col gap-1.5">
        <span className={ADMIN_LABEL}>Fact (400 characters)</span>
        <textarea name="text" required maxLength={400} rows={3} className={ADMIN_FIELD} />
      </label>
      {teammates.length > 0 && (
        <label className="flex flex-col gap-1.5">
          <span className={ADMIN_LABEL}>
            {aboutTeammate
              ? 'About a teammate (optional)'
              : 'About a teammate (leave empty if not)'}
          </span>
          <select name="subject" defaultValue="" className={ADMIN_FIELD}>
            <option value="">Nobody else</option>
            {teammates.map((t) => (
              <option key={t.playerId} value={String(t.playerId)}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <button type="submit" className={`${AUTH_BUTTON_PRIMARY} self-start px-3 py-2`}>
        {submit}
      </button>
    </form>
  )
}

export function BackgroundPanel({
  k,
  name,
  view,
  pressLevel,
  isMember,
}: {
  /** The page key of the person (`12` or `u<id>`). */
  k: string
  name: string
  view: BackgroundView
  pressLevel: PressLevel | null
  isMember: boolean
}) {
  const proposed = view.facts.filter((f) => f.status === 'proposed')
  const confirmed = view.facts.filter((f) => f.status === 'confirmed')
  const rejected = view.facts.filter((f) => f.status === 'rejected')
  const out = pressLevel === 'out'
  const openCount = view.open.reduce((n, p) => n + p.questions.length, 0)
  return (
    <Panel
      title="Background"
      label="Background"
      aside={
        <span className="text-xs text-fg-5">
          {view.waiting} waiting · {confirmed.length} confirmed
        </span>
      }
    >
      <p className="border-t border-border-subtle px-4 py-2.5 text-xs text-fg-5">
        {out
          ? 'Leave me out: no writer and no profile reads these facts. You still see and edit them here.'
          : 'Only confirmed facts reach a writer (today: the AI profile). You decide what is true about a person.'}
      </p>

      {proposed.length > 0 && (
        <>
          <SubHead>Waiting for you · {proposed.length}</SubHead>
          {proposed.map((f) => (
            <FactRow key={f.id} k={k} fact={f} fromTeammate={false} />
          ))}
        </>
      )}

      <SubHead>Confirmed · {confirmed.length}</SubHead>
      {confirmed.length === 0 && <Empty>No confirmed facts yet.</Empty>}
      {BACKGROUND_PARTS.map((part) => {
        const inPart = confirmed.filter((f) => f.part === part)
        if (inPart.length === 0) return null
        return inPart.map((f) => <FactRow key={f.id} k={k} fact={f} fromTeammate={false} />)
      })}

      {isMember && (
        <>
          <SubHead>
            What teammates said about {name} · {view.fromTeammates.length}
          </SubHead>
          {view.fromTeammates.length === 0 && (
            <Empty>Nothing yet. Facts other players’ answers make about {name} show here.</Empty>
          )}
          {view.fromTeammates.map((f) => (
            <FactRow key={f.id} k={k} fact={f} fromTeammate />
          ))}
        </>
      )}

      <SubHead>Add a fact</SubHead>
      <div className="border-t border-border-subtle px-4 py-3">
        <AddForm
          k={k}
          teammates={isMember ? view.teammates : []}
          aboutTeammate={false}
          submit="Save fact"
        />
        <p className="mt-2 max-w-[560px] text-xs text-fg-5">
          A fact you type is confirmed at once. Hockey only, third person, one short sentence.
        </p>
      </div>

      <SubHead>Questions still open · {openCount}</SubHead>
      {out && <Empty>No questions are asked of a Leave me out player.</Empty>}
      {!out && view.open.length === 0 && <Empty>No open questions.</Empty>}
      {view.open.map((p) => (
        <details key={p.part} className="border-t border-border-subtle">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-2.5 text-sm text-fg-3 hover:text-fg-1">
            <span>{p.label}</span>
            <span className="text-xs text-fg-5">{p.questions.length} open</span>
          </summary>
          {p.questions.map((q) => (
            <details key={q.id} className="border-t border-border-subtle pl-4">
              <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2 text-sm text-fg-2 hover:text-fg-1">
                <span>{q.text}</span>
                {q.aboutTeammate && <span className={PILL}>about a teammate</span>}
              </summary>
              <div className="px-4 pb-3">
                <AddForm
                  k={k}
                  teammates={isMember ? view.teammates : []}
                  question={q.id}
                  aboutTeammate={q.aboutTeammate}
                  submit="Save the answer as a fact"
                />
              </div>
            </details>
          ))}
        </details>
      ))}

      {rejected.length > 0 && (
        <details className="border-t border-border-subtle">
          <summary className="cursor-pointer list-none px-4 py-2.5 text-xs text-fg-5 hover:text-fg-3">
            Rejected and removed · {rejected.length}
          </summary>
          {rejected.map((f) => (
            <div key={f.id} className={ROW}>
              <FactHead fact={f} showOwner={false} />
              <p className="text-[15px] leading-relaxed text-fg-4 line-through">{f.text}</p>
              {f.reviewedBy !== null && f.reviewedAt !== null && (
                <p className="text-xs text-fg-5">
                  Rejected by {f.reviewedBy}, {formatDataDay(f.reviewedAt)}
                </p>
              )}
            </div>
          ))}
        </details>
      )}
    </Panel>
  )
}
