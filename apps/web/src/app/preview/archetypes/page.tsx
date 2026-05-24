import type { Metadata } from 'next'
import {
  ArchetypePillCompact,
  ArchetypePillFeature,
  ArchetypePillFlagship,
} from '@/components/ui/archetype-pill'
import { DEFENSE_ARCHETYPES, FORWARD_ARCHETYPES, type PlayerArchetype } from '@eanhl/db/schema'

export const metadata: Metadata = { title: 'Archetype preview' }

function ShowcaseSection({
  title,
  archetypes,
}: {
  title: string
  archetypes: readonly PlayerArchetype[]
}) {
  return (
    <section className="space-y-6">
      <div className="space-y-2">
        <p className="font-condensed text-xs font-semibold uppercase tracking-[0.28em] text-zinc-500">
          {title}
        </p>
        <div className="h-px bg-zinc-800" />
      </div>

      <div className="space-y-8">
        <div className="space-y-3">
          <h2 className="font-condensed text-sm font-semibold uppercase tracking-[0.22em] text-zinc-300">
            Compact
          </h2>
          <div className="flex flex-wrap gap-3">
            {archetypes.map((archetype) => (
              <ArchetypePillCompact key={`compact-${archetype}`} archetype={archetype} />
            ))}
          </div>
        </div>

        <div className="space-y-3">
          <h2 className="font-condensed text-sm font-semibold uppercase tracking-[0.22em] text-zinc-300">
            Flagship
          </h2>
          <div className="grid gap-4 lg:grid-cols-2">
            {archetypes.map((archetype) => (
              <ArchetypePillFlagship key={`flagship-${archetype}`} archetype={archetype} />
            ))}
          </div>
        </div>

        <div className="space-y-3">
          <h2 className="font-condensed text-sm font-semibold uppercase tracking-[0.22em] text-zinc-300">
            Feature
          </h2>
          <div className="grid gap-5 xl:grid-cols-2">
            {archetypes.map((archetype) => (
              <ArchetypePillFeature key={`feature-${archetype}`} archetype={archetype} />
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}

export default function ArchetypesPreviewPage() {
  return (
    <>
      <style>{`
        body > header { display: none !important; }
        body > main { max-width: none !important; padding: 0 !important; margin: 0 !important; }
      `}</style>

      <div className="min-h-screen bg-[radial-gradient(circle_at_top,#1e293b_0%,#09090b_46%,#020617_100%)] text-zinc-100">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-12 px-6 py-10 md:px-10 xl:px-12">
          <header className="space-y-4 border-b border-zinc-800/80 pb-8">
            <p className="font-condensed text-xs font-semibold uppercase tracking-[0.32em] text-zinc-500">
              Temporary Preview
            </p>
            <div className="space-y-3">
              <h1 className="font-condensed text-4xl font-semibold uppercase tracking-[0.12em] text-zinc-100 md:text-5xl">
                Player Archetype Buttons
              </h1>
              <p className="max-w-3xl text-sm leading-6 text-zinc-400 md:text-base">
                All current skater archetypes, rendered in every live pill variant. This route is
                isolated on purpose so you can inspect the buttons without the rest of the site
                getting in the way.
              </p>
            </div>
          </header>

          <ShowcaseSection title="Forwards" archetypes={FORWARD_ARCHETYPES} />
          <ShowcaseSection title="Defensemen" archetypes={DEFENSE_ARCHETYPES} />
        </div>
      </div>
    </>
  )
}
