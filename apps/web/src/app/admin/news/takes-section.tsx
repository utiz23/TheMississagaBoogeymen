import { REPORTERS, REPORTER_IDS } from '@eanhl/db/news'
import type { AdminTake } from '@eanhl/db/queries'
import { TAKE_SPREADS } from '@eanhl/db/schema'
import {
  ADMIN_FIELD,
  ADMIN_LABEL,
  ADMIN_SMALL_BUTTON,
  AdminSection,
} from '@/components/admin/admin-section'
import { saveTakeAction } from './actions'

/**
 * Admin only (the page calls requireAdmin first): the GM's reporter takes on
 * players (spec §12.19). Rendered nowhere else; the texts never leave /admin.
 */
export function TakesSection({ takes }: { takes: AdminTake[] }) {
  return (
    <AdminSection
      title="Reporter takes (GM only)"
      description="Private notes: a reporter's running take on a player. Players and visitors never see them; only the coverage shows them. Intensity softens (-1, -2) or hardens (+1, +2) a take. Switch a take off with Active. Add new takes with the seeding script."
    >
      {takes.length === 0 ? (
        <p className="text-sm text-fg-4">No takes yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {takes.map((t) => (
            <li key={t.id} className="border border-border-subtle">
              <details>
                <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm text-fg-2">
                  <strong className="text-fg-1">{t.playerName}</strong>
                  <span>{REPORTERS[t.reporter].name}</span>
                  <span className="text-fg-4">
                    {t.spread} · intensity{' '}
                    {t.intensity > 0 ? `+${String(t.intensity)}` : t.intensity}
                  </span>
                  <span className={t.active ? 'text-fg-1' : 'text-accent-readable'}>
                    {t.active ? 'Active' : 'Off'}
                  </span>
                </summary>
                <form action={saveTakeAction} className="flex flex-col gap-3 px-3 pb-3">
                  <input type="hidden" name="id" value={t.id} />
                  <label className="flex flex-col gap-1">
                    <span className={ADMIN_LABEL}>Take</span>
                    <textarea
                      name="take"
                      defaultValue={t.take}
                      required
                      maxLength={1000}
                      rows={4}
                      className={ADMIN_FIELD}
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className={ADMIN_LABEL}>Data angle (the evidence the reporters use)</span>
                    <textarea
                      name="dataAngle"
                      defaultValue={t.dataAngle ?? ''}
                      maxLength={500}
                      rows={2}
                      className={ADMIN_FIELD}
                    />
                  </label>
                  <div className="flex flex-wrap gap-4">
                    <label className="flex flex-col gap-1">
                      <span className={ADMIN_LABEL}>How many share it</span>
                      <select name="spread" defaultValue={t.spread} className={ADMIN_FIELD}>
                        {TAKE_SPREADS.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className={ADMIN_LABEL}>Defender</span>
                      <select
                        name="defender"
                        defaultValue={t.defender ?? ''}
                        className={ADMIN_FIELD}
                      >
                        <option value="">None</option>
                        {REPORTER_IDS.map((id) => (
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
                        defaultValue={t.intensity}
                        min={-2}
                        max={2}
                        step={1}
                        className={`${ADMIN_FIELD} w-24`}
                      />
                    </label>
                  </div>
                  <fieldset className="flex flex-col gap-1">
                    <legend className={ADMIN_LABEL}>
                      Critics (besides {REPORTERS[t.reporter].name})
                    </legend>
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                      {REPORTER_IDS.map((id) => (
                        <label key={id} className="flex items-center gap-1.5 text-sm text-fg-2">
                          <input
                            type="checkbox"
                            name="critics"
                            value={id}
                            defaultChecked={t.critics.includes(id)}
                          />
                          {REPORTERS[id].name}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <label className="flex items-center gap-2 text-sm text-fg-2">
                    <input type="checkbox" name="active" defaultChecked={t.active} />
                    Active
                  </label>
                  <div>
                    <button type="submit" className={ADMIN_SMALL_BUTTON}>
                      Save take
                    </button>
                  </div>
                </form>
              </details>
            </li>
          ))}
        </ul>
      )}
    </AdminSection>
  )
}
