import Link from 'next/link'
import { REPORTERS, REPORTER_IDS, type ReporterId } from '@eanhl/db/news'
import { listRelationshipBoard } from '@eanhl/db/queries'
import { LEVEL_CLASS, LEVEL_SHORT, pointsText } from '@/components/press-box/level-style'
import { RelationshipPanel } from '@/components/press-box/relationship-panel'
import { requireAdmin } from '@/lib/auth'
import { NOTICE_TEXT, noticeFromQuery, parseId } from '../box-actions'

const surname = (id: ReporterId): string => REPORTERS[id].name.split(' ').slice(-1)[0]!

/** Press Box relationships board (design section 3.3): players × reporters, a selected pair and the GM actions. */
export default async function PressBoxRelationshipsPage({
  searchParams,
}: {
  searchParams: Promise<{ player?: string; reporter?: string; notice?: string }>
}) {
  await requireAdmin()
  const now = new Date()
  const [q, board] = await Promise.all([searchParams, listRelationshipBoard(now)])
  const notice = noticeFromQuery(q.notice)
  const cells = new Map(board.cells.map((c) => [`${String(c.playerId)}:${c.reporter}`, c]))
  const playerId = parseId(q.player ?? null)
  const reporter = REPORTER_IDS.find((r) => r === q.reporter) ?? null
  const selected =
    playerId !== null && reporter !== null
      ? (board.players.find((p) => p.playerId === playerId) ?? null)
      : null

  return (
    <div className="flex flex-col gap-5">
      {notice !== null && (
        <p role="status" className="border border-border px-4 py-3 text-sm text-fg-2">
          {NOTICE_TEXT[notice]}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="font-condensed text-2xl font-bold uppercase tracking-[0.12em] text-fg-1">
          Relationships board
        </h2>
        <ul className="flex flex-wrap items-center gap-3 text-xs text-fg-3" aria-label="Legend">
          {(['neutral', 'simmering', 'feud', 'war', 'warm', 'fan', 'glazing'] as const).map((l) => (
            <li key={l} className="flex items-center gap-1.5">
              <span
                className={`inline-block border px-1.5 py-0.5 font-condensed font-bold uppercase ${LEVEL_CLASS[l]}`}
              >
                {LEVEL_SHORT[l]}
              </span>
              {l === 'neutral' ? 'none' : l === 'war' ? 'open war' : l}
            </li>
          ))}
          <li className="text-fg-5">
            P = level pinned · F = frozen · points fade by half every 7 days
          </li>
        </ul>
      </div>

      <div className="flex flex-col items-start gap-6 xl:flex-row">
        <section
          aria-label="Board"
          className="broadcast-panel w-full min-w-0 flex-1 overflow-x-auto xl:flex-[999_1_720px]"
        >
          <table className="w-full min-w-[980px] border-collapse">
            <thead>
              <tr>
                <th className="px-4 py-3 text-left font-condensed text-[11px] font-semibold uppercase tracking-[0.16em] text-fg-4">
                  Player
                </th>
                {REPORTER_IDS.map((id) => (
                  <th
                    key={id}
                    title={REPORTERS[id].name}
                    className="px-2 py-3 text-center font-condensed text-[11px] font-semibold uppercase tracking-[0.16em] text-fg-4"
                  >
                    {surname(id)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {board.players.map((p) => (
                <tr key={p.playerId}>
                  <td className="border-t border-border-subtle px-4 py-2 text-sm font-semibold text-fg-2">
                    {p.name}
                    {p.pressLevel === 'easy' && (
                      <span className="ml-2 text-xs font-normal text-fg-5">go easy</span>
                    )}
                  </td>
                  {REPORTER_IDS.map((id) => {
                    const cell = cells.get(`${String(p.playerId)}:${id}`) ?? null
                    const level = cell?.level ?? 'neutral'
                    const isSel = selected?.playerId === p.playerId && reporter === id
                    const label =
                      cell === null ||
                      (level === 'neutral' && !cell.frozen && cell.overrideLevel === null)
                        ? '—'
                        : `${LEVEL_SHORT[level]} ${pointsText(cell.points)}`
                    return (
                      <td
                        key={id}
                        className="border-t border-border-subtle px-1.5 py-1.5 text-center"
                      >
                        <Link
                          prefetch
                          href={`/admin/press-box/relationships?player=${String(p.playerId)}&reporter=${id}`}
                          aria-label={`${p.name} and ${REPORTERS[id].name}: ${label === '—' ? 'none' : label}`}
                          aria-current={isSel ? 'true' : undefined}
                          className={`inline-block min-w-[76px] border px-1 py-1.5 font-condensed text-xs font-bold uppercase tracking-[0.08em] ${LEVEL_CLASS[level]} ${
                            isSel ? 'outline outline-2 outline-offset-2 outline-fg-1' : ''
                          }`}
                        >
                          {label}
                          {cell?.overrideLevel != null && <sup className="ml-0.5">P</sup>}
                          {cell?.frozen === true && <sup className="ml-0.5">F</sup>}
                        </Link>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {selected !== null && reporter !== null ? (
          <RelationshipPanel
            player={selected}
            reporter={reporter}
            cell={cells.get(`${String(selected.playerId)}:${reporter}`) ?? null}
          />
        ) : (
          <aside className="broadcast-panel p-5 text-sm text-fg-4 xl:max-w-[380px]">
            Pick a cell to see the pair and change it. Every change is logged on the Overview.
          </aside>
        )}
      </div>
    </div>
  )
}
