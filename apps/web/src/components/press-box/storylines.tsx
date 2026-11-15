import type { ReactNode } from 'react'
import { REPORTERS, REPORTER_IDS, type ReporterId } from '@eanhl/db/news'
import type {
  AdminTake,
  PinnedStoryline,
  PressRosterEntry,
  StoryStance,
  StorylineView,
} from '@eanhl/db/queries'
import { TAKE_SPREADS } from '@eanhl/db/schema'
import { ADMIN_FIELD, ADMIN_LABEL } from '@/components/admin/admin-section'
import { AUTH_BUTTON_PRIMARY, AUTH_BUTTON_SECONDARY } from '@/components/auth/auth-panel'
import { formatDataDay } from '@/lib/format'
import {
  addStanceAction,
  addTakeAction,
  closeStorylineAction,
  createStorylineAction,
  editStanceAction,
  editTakeAction,
  pinStorylineAction,
  removeStanceAction,
  removeTakeAction,
  unpinStorylineAction,
} from '@/app/admin/press-box/actions'
import { milestoneText } from '@/app/admin/press-box/form'
import type { Trends } from '@/app/admin/press-box/storylines-trends'

/**
 * The storylines page parts (design section 3.4): open storylines with each reporter's stance,
 * pin / unpin / close / new, the trends, the "writers get tonight" panel and the takes editor.
 * Server components; every button is a plain form to a server action in `actions.ts` that checks
 * the admin, checks the text and writes the change log. No client code.
 */

const PANEL = 'broadcast-panel'
const LABEL = 'font-condensed text-[11px] font-semibold uppercase tracking-[0.2em] text-fg-4'
const BTN = `${AUTH_BUTTON_SECONDARY} px-3 py-2`
const BTN_SMALL = `${AUTH_BUTTON_SECONDARY} px-2.5 py-1.5`
const BTN_PRIMARY = `${AUTH_BUTTON_PRIMARY} px-3 py-2`
const PILL =
  'border px-2 py-0.5 font-condensed text-[11px] font-bold uppercase tracking-[0.14em] whitespace-nowrap'

const surname = (id: ReporterId): string => REPORTERS[id].name

/** The reference the actions take: `s<id>` for a stored storyline, `t:<key>` for a thread without a row. */
const refOf = (s: StorylineView): string => s.ref
/** Stances are kept under the thread key (a thread) or the storyline id (a typed storyline). */
const stanceTargetOf = (s: StorylineView): string =>
  s.threadKey !== null ? `t:${s.threadKey}` : `s${String(s.id)}`

function Panel({
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
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
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

function RefForm({
  action,
  refValue,
  label,
  children,
  name = 'ref',
}: {
  action: (formData: FormData) => Promise<void>
  refValue: string
  label: string
  children: ReactNode
  name?: string
}) {
  return (
    <form action={action}>
      <input type="hidden" name={name} value={refValue} />
      <button type="submit" className={BTN} aria-label={label}>
        {children}
      </button>
    </form>
  )
}

// ── Storylines ──────────────────────────────────────────────────────────────

function StanceRow({ stance }: { stance: StoryStance }) {
  return (
    <li className="flex flex-col gap-1 py-1.5 text-sm text-fg-2">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="min-w-[8.5rem] font-condensed font-bold tracking-[0.06em] text-fg-1">
          {surname(stance.reporter)}
        </span>
        <span className="min-w-0 flex-1 basis-60">“{stance.stance}”</span>
        <span className="text-xs text-fg-5">
          {stance.night ?? formatDataDay(stance.at)}
          {stance.itemId === null && ' · typed by the admin'}
        </span>
      </div>
      <details className="text-xs">
        <summary className="cursor-pointer list-none text-fg-5 hover:text-fg-2">
          Edit or remove
        </summary>
        <div className="mt-2 flex flex-col gap-2">
          <form action={editStanceAction} className="flex flex-col gap-2">
            <input type="hidden" name="stance" value={stance.id} />
            <label className="flex flex-col gap-1">
              <span className={ADMIN_LABEL}>Stance (hockey only, no digits; checked on save)</span>
              <textarea
                name="text"
                defaultValue={stance.stance}
                required
                maxLength={400}
                rows={2}
                className={ADMIN_FIELD}
              />
            </label>
            <div>
              <button type="submit" className={BTN_PRIMARY}>
                Save stance
              </button>
            </div>
          </form>
          <form action={removeStanceAction}>
            <input type="hidden" name="stance" value={stance.id} />
            <button type="submit" className={BTN_SMALL}>
              Remove this stance
            </button>
          </form>
        </div>
      </details>
    </li>
  )
}

function AddStanceForm({ target }: { target: string }) {
  return (
    <details className="text-sm">
      <summary className="cursor-pointer list-none text-xs text-fg-4 hover:text-fg-1">
        + Add a stance
      </summary>
      <form action={addStanceAction} className="mt-2 flex flex-wrap items-end gap-3">
        <input type="hidden" name="target" value={target} />
        <label className="flex flex-col gap-1">
          <span className={ADMIN_LABEL}>Reporter</span>
          <select name="reporter" className={ADMIN_FIELD} defaultValue="quill">
            {REPORTER_IDS.map((id) => (
              <option key={id} value={id}>
                {REPORTERS[id].name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-[16rem] flex-1 flex-col gap-1">
          <span className={ADMIN_LABEL}>Stance (hockey only, no digits)</span>
          <input
            type="text"
            name="text"
            required
            maxLength={400}
            className={ADMIN_FIELD}
            autoComplete="off"
          />
        </label>
        <button type="submit" className={BTN_PRIMARY}>
          Save stance
        </button>
      </form>
    </details>
  )
}

function StorylineCard({ s, ready }: { s: StorylineView; ready: boolean }) {
  const newest = [...s.stances].reverse()
  const shown = newest.slice(0, 6)
  const older = newest.slice(6)
  return (
    <article
      aria-label={s.title}
      className={`border-t border-border-subtle px-4 py-4 ${s.pinned ? 'shadow-[inset_3px_0_0_var(--color-accent)]' : ''}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-condensed text-xl font-bold uppercase tracking-[0.04em] text-fg-1">
          {s.title}
        </h3>
        <div className="flex flex-wrap items-center gap-2">
          {s.pinned && (
            <span className={`${PILL} border-accent text-accent-readable`}>
              Pinned · suggested angle
            </span>
          )}
          {ready && (
            <>
              {s.pinned ? (
                <RefForm
                  action={unpinStorylineAction}
                  refValue={refOf(s)}
                  label={`Unpin ${s.title}`}
                >
                  Unpin
                </RefForm>
              ) : (
                <RefForm action={pinStorylineAction} refValue={refOf(s)} label={`Pin ${s.title}`}>
                  Pin
                </RefForm>
              )}
              <RefForm action={closeStorylineAction} refValue={refOf(s)} label={`Close ${s.title}`}>
                Close
              </RefForm>
            </>
          )}
        </div>
      </div>
      <p className="mb-2 mt-1 text-xs text-fg-4">
        {s.source === 'thread' ? 'reporter thread' : 'typed on this page'} · opened{' '}
        {formatDataDay(s.openedAt)}
        {s.lastMovedAt !== null && <> · last moved {formatDataDay(s.lastMovedAt)}</>}
        {s.playerName !== null && <> · player: {s.playerName}</>}
        {s.threadKey !== null && <> · key {s.threadKey}</>}
      </p>
      {s.angle !== '' && (
        <p className="mb-2 text-sm text-fg-2">
          <span className={ADMIN_LABEL}>Suggested angle </span>
          {s.angle}
        </p>
      )}
      {s.stances.length === 0 ? (
        <p className="text-sm text-fg-4">No stances yet.</p>
      ) : (
        <ul className="divide-y divide-border-subtle">
          {shown.map((st) => (
            <StanceRow key={st.id} stance={st} />
          ))}
        </ul>
      )}
      {older.length > 0 && (
        <details className="mt-1">
          <summary className="cursor-pointer list-none text-xs text-fg-5 hover:text-fg-2">
            {older.length} older {older.length === 1 ? 'stance' : 'stances'}
          </summary>
          <ul className="divide-y divide-border-subtle">
            {older.map((st) => (
              <StanceRow key={st.id} stance={st} />
            ))}
          </ul>
        </details>
      )}
      <div className="mt-2">
        <AddStanceForm target={stanceTargetOf(s)} />
      </div>
    </article>
  )
}

export function StorylinesPanel({
  open,
  closedCount,
  ready,
}: {
  open: StorylineView[]
  closedCount: number
  ready: boolean
}) {
  const stances = open.reduce((n, s) => n + s.stances.length, 0)
  return (
    <Panel
      title={`Open storylines · ${String(stances)} ${stances === 1 ? 'stance' : 'stances'}`}
      aside={
        ready ? (
          <details className="relative">
            <summary className={`${BTN} cursor-pointer list-none`}>+ New storyline</summary>
            <form
              action={createStorylineAction}
              className="mt-3 flex min-w-[min(22rem,80vw)] flex-col gap-3 border border-border-subtle bg-surface p-4 md:absolute md:right-0 md:z-10"
            >
              <label className="flex flex-col gap-1">
                <span className={ADMIN_LABEL}>Title (1 to 80 characters, no digits)</span>
                <input
                  type="text"
                  name="title"
                  required
                  maxLength={80}
                  className={ADMIN_FIELD}
                  autoComplete="off"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className={ADMIN_LABEL}>
                  Suggested angle (optional, up to 300, no digits)
                </span>
                <textarea name="angle" maxLength={300} rows={3} className={ADMIN_FIELD} />
              </label>
              <p className="text-xs text-fg-5">
                Hockey only. Checked on save: no crude words or slurs, no digit, no player on Leave
                me out.
              </p>
              <div>
                <button type="submit" className={BTN_PRIMARY}>
                  Open storyline
                </button>
              </div>
            </form>
          </details>
        ) : undefined
      }
    >
      {!ready && (
        <Empty>
          The storyline table is not on this database yet (migration 0085). Reporter threads and the
          takes editor below still work after it is applied.
        </Empty>
      )}
      {ready && open.length === 0 && (
        <Empty>
          No open storylines. Reporter threads show here once a reporter takes a stance.
        </Empty>
      )}
      {open.map((s) => (
        <StorylineCard key={s.ref} s={s} ready={ready} />
      ))}
      {closedCount > 0 && (
        <p className="border-t border-border-subtle px-4 py-3 text-xs text-fg-5">
          {closedCount} closed {closedCount === 1 ? 'storyline is' : 'storylines are'} hidden. No
          writer reads a closed storyline.
        </p>
      )}
    </Panel>
  )
}

// ── Trends and the pinned panel ─────────────────────────────────────────────

const TrendRow = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-border-subtle px-4 py-2.5 text-sm text-fg-2">
    <span>{label}</span>
    <span className="text-right text-fg-1">{children}</span>
  </div>
)

export function TrendsPanel({ trends: t }: { trends: Trends }) {
  return (
    <Panel title="Trends · from the data">
      <TrendRow label="Point streaks">
        {t.streaks.length === 0 ? '—' : t.streaks.map((n) => `${n.name} · ${n.text}`).join('; ')}
      </TrendRow>
      <TrendRow label="Slumps">
        {t.slumps.length === 0 ? '—' : t.slumps.map((n) => `${n.name} · ${n.text}`).join('; ')}
      </TrendRow>
      <TrendRow label="Milestones in reach">
        {t.milestones.length === 0
          ? '—'
          : t.milestones.map((m) => `${m.name}: ${milestoneText(m)}`).join('; ')}
      </TrendRow>
      <TrendRow label="Most quoted (30 days)">
        {t.mostQuoted === null ? '—' : `${t.mostQuoted.name} · ${String(t.mostQuoted.quotes)}`}
      </TrendRow>
      <TrendRow label="Most insulted reporter">
        {t.mostInsulted === null
          ? '—'
          : `${t.mostInsulted.name} · ${String(t.mostInsulted.pairs)} ${t.mostInsulted.pairs === 1 ? 'feud' : 'feuds'}`}
      </TrendRow>
      <TrendRow label="Quiet in the press (30 days)">
        {t.quiet.length === 0
          ? '—'
          : `${t.quiet.slice(0, 5).join(', ')}${t.quiet.length > 5 ? ` and ${String(t.quiet.length - 5)} more` : ''}`}
      </TrendRow>
      <p className="border-t border-border-subtle px-4 py-3 text-xs text-fg-5">
        Streaks, slumps and milestones use the news desk&apos;s own rules on the current title.
        Counts come from scrum and interview answers; nothing is stored.
      </p>
    </Panel>
  )
}

export function PinnedPanel({ pinned }: { pinned: PinnedStoryline | null }) {
  return (
    <Panel title="Writers get tonight">
      <div className="border-t border-border-subtle px-4 py-4 text-sm leading-relaxed text-fg-2">
        {pinned === null ? (
          <p>
            Nothing is pinned. The writers get no suggested angle. Pin one storyline and they get it
            as a suggestion for the next recap and scrums. One pin at a time.
          </p>
        ) : (
          <>
            <p>
              Pinned: <b className="text-fg-1">{pinned.title}</b>
              {pinned.angle !== '' && <> — {pinned.angle}</>}
            </p>
            <p className="mt-2 text-xs text-fg-4">
              A suggestion for the next recap and scrums, beside the confirmed background, the GM
              notes and the Club Finals moments (it replaces none of them). {pinned.stances.length}{' '}
              {pinned.stances.length === 1 ? 'stance goes' : 'stances go'} with it. Pinning another
              storyline replaces this one.
            </p>
          </>
        )}
      </div>
    </Panel>
  )
}

// ── Takes editor ────────────────────────────────────────────────────────────

interface TakeDefaults {
  take: string
  spread: string
  critics: ReporterId[]
  defender: ReporterId | null
  dataAngle: string
  intensity: number
  active: boolean
}

function TakeFields({ d, holder }: { d: TakeDefaults; holder?: ReporterId }) {
  return (
    <>
      <label className="flex flex-col gap-1">
        <span className={ADMIN_LABEL}>Take (hockey only; checked on save)</span>
        <textarea
          name="take"
          defaultValue={d.take}
          required
          maxLength={1000}
          rows={3}
          className={ADMIN_FIELD}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className={ADMIN_LABEL}>Data angle (the evidence the reporters use)</span>
        <textarea
          name="dataAngle"
          defaultValue={d.dataAngle}
          maxLength={500}
          rows={2}
          className={ADMIN_FIELD}
        />
      </label>
      <div className="flex flex-wrap gap-4">
        <label className="flex flex-col gap-1">
          <span className={ADMIN_LABEL}>How many share it</span>
          <select name="spread" defaultValue={d.spread} className={ADMIN_FIELD}>
            {TAKE_SPREADS.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={ADMIN_LABEL}>Defender</span>
          <select name="defender" defaultValue={d.defender ?? ''} className={ADMIN_FIELD}>
            <option value="">None</option>
            {REPORTER_IDS.filter((id) => id !== holder).map((id) => (
              <option key={id} value={id}>
                {REPORTERS[id].name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={ADMIN_LABEL}>Intensity (-2 to +2)</span>
          <input
            type="number"
            name="intensity"
            defaultValue={d.intensity}
            min={-2}
            max={2}
            step={1}
            className={`${ADMIN_FIELD} w-24`}
          />
        </label>
      </div>
      <fieldset className="flex flex-col gap-1">
        <legend className={ADMIN_LABEL}>Critics</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {REPORTER_IDS.map((id) => (
            <label key={id} className="flex items-center gap-1.5 text-sm text-fg-2">
              <input
                type="checkbox"
                name="critics"
                value={id}
                defaultChecked={d.critics.includes(id)}
              />
              {REPORTERS[id].name}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="flex items-center gap-2 text-sm text-fg-2">
        <input type="checkbox" name="active" defaultChecked={d.active} />
        Active (the writers may use it)
      </label>
    </>
  )
}

const NEW_TAKE: TakeDefaults = {
  take: '',
  spread: 'some',
  critics: [],
  defender: null,
  dataAngle: '',
  intensity: 0,
  active: true,
}

export function TakesEditor({
  takes,
  roster,
}: {
  takes: AdminTake[]
  roster: readonly PressRosterEntry[]
}) {
  const level = new Map(roster.map((r) => [r.playerId, r.pressLevel]))
  const candidates = roster.filter((r) => r.pressLevel !== 'out')
  return (
    <Panel
      title={`Takes & stances · editor · ${String(takes.length)} ${takes.length === 1 ? 'take' : 'takes'}`}
    >
      <div className="border-t border-border-subtle px-4 py-3 text-xs text-fg-4">
        Private notes: a reporter&apos;s running take on a player. Players and visitors never see
        them; the writers read the active ones. Every save is checked (no crude words or slurs, no
        player on Leave me out) and written to the change log. Stances are edited under their
        storyline above.
      </div>
      <details className="border-t border-border-subtle">
        <summary className="cursor-pointer list-none px-4 py-3 text-sm text-fg-2 hover:text-fg-1">
          + Add a take
        </summary>
        <form action={addTakeAction} className="flex flex-col gap-3 px-4 pb-4">
          <div className="flex flex-wrap gap-4">
            <label className="flex flex-col gap-1">
              <span className={ADMIN_LABEL}>Reporter</span>
              <select name="reporter" defaultValue="quill" className={ADMIN_FIELD}>
                {REPORTER_IDS.map((id) => (
                  <option key={id} value={id}>
                    {REPORTERS[id].name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className={ADMIN_LABEL}>About</span>
              <select
                name="playerId"
                className={ADMIN_FIELD}
                defaultValue={candidates[0]?.playerId}
              >
                {candidates.map((p) => (
                  <option key={p.playerId} value={p.playerId}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <TakeFields d={NEW_TAKE} />
          <div>
            <button type="submit" className={BTN_PRIMARY}>
              Save take
            </button>
          </div>
        </form>
      </details>
      {takes.length === 0 ? (
        <Empty>No takes yet.</Empty>
      ) : (
        <ul>
          {takes.map((t) => (
            <li key={t.id} className="border-t border-border-subtle">
              <details>
                <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm text-fg-2 hover:text-fg-1">
                  <strong className="text-fg-1">{t.playerName}</strong>
                  <span>{REPORTERS[t.reporter].name}</span>
                  <span className="text-fg-4">
                    {t.spread} · intensity{' '}
                    {t.intensity > 0 ? `+${String(t.intensity)}` : t.intensity}
                  </span>
                  <span className={t.active ? 'text-win' : 'text-accent-readable'}>
                    {t.active ? 'Active' : 'Off'}
                  </span>
                  {level.get(t.playerId) === 'out' && (
                    <span className="text-xs text-fg-5">Leave me out: never used</span>
                  )}
                </summary>
                <div className="flex flex-col gap-3 px-4 pb-4">
                  <form action={editTakeAction} className="flex flex-col gap-3">
                    <input type="hidden" name="id" value={t.id} />
                    <TakeFields
                      holder={t.reporter}
                      d={{
                        take: t.take,
                        spread: t.spread,
                        critics: t.critics,
                        defender: t.defender,
                        dataAngle: t.dataAngle ?? '',
                        intensity: t.intensity,
                        active: t.active,
                      }}
                    />
                    <div>
                      <button type="submit" className={BTN_PRIMARY}>
                        Save take
                      </button>
                    </div>
                  </form>
                  <details>
                    <summary className={`${BTN_SMALL} cursor-pointer list-none`}>Remove</summary>
                    <form
                      action={removeTakeAction}
                      className="mt-2 flex flex-col items-start gap-2"
                    >
                      <input type="hidden" name="id" value={t.id} />
                      <span className="text-xs text-fg-3">
                        Remove this take for good? The change log keeps who removed it, not the
                        text. To keep it but stop the writers using it, untick Active instead.
                      </span>
                      <button type="submit" className={BTN_SMALL}>
                        Yes, remove it
                      </button>
                    </form>
                  </details>
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
