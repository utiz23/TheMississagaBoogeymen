import type { Metadata } from 'next'
import Link from 'next/link'
import { REPORTER_IDS, REPORTERS } from '@eanhl/db/news'
import { PressGuideNote, loadOwnProfileHref } from '@/components/news/press-guide-note'
import { guideSteps } from '@/lib/news/guide'
import { PRESS_LEVEL_OPTIONS } from '@/lib/profile-edit'

export const metadata: Metadata = { title: 'How to read the Press Room — Club Stats' }

// The own-profile link depends on who is signed in.
export const dynamic = 'force-dynamic'

export default async function PressGuidePage() {
  const profile = await loadOwnProfileHref()
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link
        prefetch
        href="/news"
        className="font-condensed text-xs font-bold uppercase tracking-widest text-fg-4 hover:text-fg-1"
      >
        ← Press Room
      </Link>
      <header className="border-b-2 border-accent pb-3">
        <h1 className="font-condensed text-3xl font-black uppercase tracking-wide text-fg-1 sm:text-4xl">
          How to read the Press Room
        </h1>
      </header>

      <ol className="list-decimal space-y-2 pl-5 text-fg-2">
        {guideSteps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>

      <section className="space-y-2">
        <h2 className="font-condensed text-xs font-semibold uppercase tracking-[0.28em] text-fg-4">
          The nine reporters
        </h2>
        <ul className="divide-y divide-border-subtle border-y border-border-subtle">
          {REPORTER_IDS.map((id) => (
            <li key={id} className="py-2 text-sm text-fg-2">
              <Link prefetch href={`/news/reporters/${REPORTERS[id].slug}`} className="text-fg-1">
                {REPORTERS[id].name}
              </Link>
              <span className="text-fg-4"> · {REPORTERS[id].outlet}</span>
              <span className="block">{REPORTERS[id].bio}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="font-condensed text-xs font-semibold uppercase tracking-[0.28em] text-fg-4">
          Your press level
        </h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-fg-2">
          {PRESS_LEVEL_OPTIONS.map((o) => (
            <li key={o.value}>{o.label}</li>
          ))}
        </ul>
        <p className="text-sm text-fg-3">
          {profile !== null ? (
            <>
              Change it on{' '}
              <Link prefetch href={profile} className="text-fg-1 underline">
                your player page
              </Link>{' '}
              with EDIT PROFILE.
            </>
          ) : (
            <>Sign in to change it. It is on your player page, under EDIT PROFILE.</>
          )}
        </p>
      </section>
      <PressGuideNote />
    </div>
  )
}
