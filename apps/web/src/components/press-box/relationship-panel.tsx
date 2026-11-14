import { REL_LABELS, REPORTERS, type RelLevel, type ReporterId } from '@eanhl/db/news'
import { allowedLevels, type BoardCell, type BoardPlayer } from '@eanhl/db/queries'
import { ADMIN_FIELD, ADMIN_LABEL } from '@/components/admin/admin-section'
import { AUTH_BUTTON_PRIMARY, AUTH_BUTTON_SECONDARY } from '@/components/auth/auth-panel'
import { formatClubDateTime } from '@/lib/format'
import { relationshipAction } from '@/app/admin/press-box/actions'
import { LEVEL_TEXT, pointsText } from './level-style'

const BTN = `${AUTH_BUTTON_SECONDARY} px-3 py-2`

/**
 * The selected pair of the relationships board: what it is now, and the GM actions (cool down,
 * reset, freeze or unfreeze, pin a level with a reason, clear the pin). Each action is its own
 * form to `relationshipAction`, which checks the admin and writes the change log. Plain forms
 * (no client code). `cell` is null when the pair has no row (none).
 */
export function RelationshipPanel({
  player,
  reporter,
  cell,
}: {
  player: BoardPlayer
  reporter: ReporterId
  cell: BoardCell | null
}) {
  const level: RelLevel = cell?.level ?? 'neutral'
  const frozen = cell?.frozen === true
  const pinned = cell?.overrideLevel ?? null
  const hidden = (kind: string) => (
    <>
      <input type="hidden" name="playerId" value={player.playerId} />
      <input type="hidden" name="reporter" value={reporter} />
      <input type="hidden" name="kind" value={kind} />
    </>
  )
  const options = allowedLevels(reporter)

  return (
    <aside
      aria-label="Selected relationship"
      className="broadcast-panel flex flex-col gap-4 p-5 xl:max-w-[380px]"
    >
      <div>
        <div className="font-condensed text-[11px] font-semibold uppercase tracking-[0.2em] text-fg-4">
          Selected
        </div>
        <h2 className="mt-1 font-condensed text-3xl font-black uppercase leading-tight text-fg-1">
          {player.name} × {REPORTERS[reporter].name.split(' ').slice(-1)[0]}
        </h2>
        <p className="mt-1 text-sm text-fg-3">
          <span className={`font-semibold ${LEVEL_TEXT[level]}`}>{REL_LABELS[level]}</span>
          {cell !== null && <> · {pointsText(cell.points)} points</>}
          {cell !== null && <> · last event {formatClubDateTime(cell.lastEventAt)}</>}
          {frozen && ' · frozen'}
        </p>
      </div>

      <div className="border-t border-border-subtle pt-3 text-sm leading-relaxed text-fg-3">
        {cell === null ? (
          <p>No points yet. The writers see this pair as neutral.</p>
        ) : (
          <>
            {pinned !== null && (
              <p>
                Level pinned to <strong className="text-fg-1">{REL_LABELS[pinned]}</strong>
                {cell.overrideReason !== null && <> — “{cell.overrideReason}”</>}. The points alone
                would give {REL_LABELS[cell.pointsLevel]}.
              </p>
            )}
            <p>The writers see the level only, never the points.</p>
          </>
        )}
        {player.pressLevel === 'easy' && (
          <p className="mt-1 text-fg-4">
            Go easy: points are kept, but the feud side is never used for this player.
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <form action={relationshipAction}>
          {hidden('cooldown')}
          <button type="submit" disabled={frozen || cell === null} className={`${BTN} w-full`}>
            Cool down ½
          </button>
        </form>
        <form action={relationshipAction}>
          {hidden('reset')}
          <button type="submit" disabled={frozen || cell === null} className={`${BTN} w-full`}>
            Reset to 0
          </button>
        </form>
        <form action={relationshipAction}>
          {hidden(frozen ? 'unfreeze' : 'freeze')}
          <button type="submit" className={`${BTN} w-full`}>
            {frozen ? 'Unfreeze' : 'Freeze'}
          </button>
        </form>
        <form action={relationshipAction}>
          {hidden('level_clear')}
          <button type="submit" disabled={pinned === null} className={`${BTN} w-full`}>
            Clear pinned level
          </button>
        </form>
      </div>

      <form
        action={relationshipAction}
        className="flex flex-col gap-2 border-t border-border-subtle pt-3"
      >
        {hidden('level')}
        <label className="flex flex-col gap-1.5">
          <span className={ADMIN_LABEL}>Set level to</span>
          <select name="level" defaultValue={pinned ?? level} className={ADMIN_FIELD}>
            {options.map((l) => (
              <option key={l} value={l}>
                {REL_LABELS[l]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={ADMIN_LABEL}>Reason (for the change log)</span>
          <input
            name="reason"
            type="text"
            required
            maxLength={200}
            autoComplete="off"
            className={ADMIN_FIELD}
          />
        </label>
        <button type="submit" className={`${AUTH_BUTTON_PRIMARY} px-3 py-2`}>
          Set level
        </button>
        <p className="text-xs text-fg-5">
          Only levels inside this reporter&apos;s range are offered. Every change is logged.
        </p>
      </form>
    </aside>
  )
}
