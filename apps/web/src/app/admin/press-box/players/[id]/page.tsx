import { notFound } from 'next/navigation'
import { getBackgroundView, parseDossierKey } from '@eanhl/db/queries'
import { BackgroundPanel } from '@/components/press-box/background'
import {
  DossierRail,
  FormPanel,
  GmPanel,
  IdentityPanel,
  PressThinksPanel,
  ProfilePanel,
  QuotesPanel,
  RelationshipsPanel,
} from '@/components/press-box/dossier'
import { requireAdmin } from '@/lib/auth'
import { NOTICE_TEXT, noticeFromQuery } from '../../box-actions'
import { loadDossierPage } from '../../dossier-data'
import { dbReads } from '../../dossier-reads'

/**
 * One Press Box dossier (design 3.2, the mock-up "Player dossier"). Admin only. Reads existing
 * data; the AI profile and the interview are requests to the press service. A "Leave me out"
 * player's page is identity only.
 */
export default async function PressBoxDossierPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ notice?: string }>
}) {
  await requireAdmin()
  const [{ id }, q] = await Promise.all([params, searchParams])
  const key = parseDossierKey(id)
  if (key === null) notFound()
  const now = new Date()
  const page = await loadDossierPage(key, now, dbReads)
  if (page === null) notFound()
  // Background facts: the admin sees them for every person, "Leave me out" included (no writer does).
  const background = await getBackgroundView({
    key,
    name: page.dossier.identity.name,
    pressLevel: page.dossier.identity.pressLevel,
  })
  const { dossier: d } = page
  const notice = noticeFromQuery(q.notice)
  const out = d.identity.pressLevel === 'out'

  return (
    <div className="flex flex-col items-start gap-6 lg:flex-row">
      <DossierRail rows={page.index} activeKey={d.identity.key} />
      <main className="flex w-full min-w-0 flex-1 flex-col gap-6 lg:flex-[999_1_640px]">
        {notice !== null && (
          <p role="status" className="border border-border px-4 py-3 text-sm text-fg-2">
            {NOTICE_TEXT[notice]}
          </p>
        )}
        <IdentityPanel d={d} requests={page.requests} />
        <BackgroundPanel
          k={d.identity.key}
          name={d.identity.name}
          view={background}
          pressLevel={d.identity.pressLevel}
          isMember={d.identity.playerId !== null}
        />
        {!out && (
          <>
            <ProfilePanel d={d} requests={page.requests} now={now} />
            {d.identity.playerId !== null && (
              <FormPanel form={page.form} titleName={page.titleName} />
            )}
            <div className="grid gap-6 xl:grid-cols-2">
              <QuotesPanel d={d} />
              <PressThinksPanel d={d} />
            </div>
            <div className="grid gap-6 xl:grid-cols-2">
              <RelationshipsPanel d={d} />
              <GmPanel d={d} />
            </div>
          </>
        )}
      </main>
    </div>
  )
}
