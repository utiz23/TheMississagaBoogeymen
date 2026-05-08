import { Panel } from '@/components/ui/panel'
import { BroadcastPanel } from '@/components/ui/broadcast-panel'
import { SectionHeader } from '@/components/ui/section-header'
import { ResultPill } from '@/components/ui/result-pill'
import { StatStrip } from '@/components/ui/stat-strip'

export const metadata = {
  title: 'Kitchen Sink — Boogeymen UI Primitives',
}

export default function KitchenSinkPage() {
  return (
    <main className="mx-auto max-w-screen-xl space-y-12 px-4 py-10">
      <header>
        <p className="font-condensed text-[10px] font-semibold uppercase tracking-[0.28em] text-zinc-500">
          Internal · Phase 1
        </p>
        <h1 className="mt-1 font-condensed text-3xl font-black uppercase tracking-[0.06em] text-zinc-50">
          Boogeymen UI Primitives
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-zinc-400">
          Visual verification harness for the design-system primitives. Compare each variant against{' '}
          <code className="rounded bg-zinc-900 px-1 py-0.5 text-zinc-300">
            docs/design/boogeymen-system/preview/*.html
          </code>
          . Removed at end of Phase 6.
        </p>
      </header>

      {/* Panel ------------------------------------------------------------- */}
      <section className="space-y-4">
        <SectionHeader label="Panel" />
        <div className="grid gap-4 sm:grid-cols-3">
          <Panel className="p-6">
            <p className="font-condensed text-xs uppercase tracking-widest text-zinc-500">
              tone=default
            </p>
            <p className="mt-2 text-sm text-zinc-200">Surface = #18181b</p>
          </Panel>
          <Panel tone="raised" className="p-6">
            <p className="font-condensed text-xs uppercase tracking-widest text-zinc-500">
              tone=raised
            </p>
            <p className="mt-2 text-sm text-zinc-200">Surface = #1f1f22</p>
          </Panel>
          <Panel hoverable className="p-6">
            <p className="font-condensed text-xs uppercase tracking-widest text-zinc-500">
              hoverable
            </p>
            <p className="mt-2 text-sm text-zinc-200">Hover me</p>
          </Panel>
        </div>
      </section>

      {/* BroadcastPanel ---------------------------------------------------- */}
      <section className="space-y-4">
        <SectionHeader label="BroadcastPanel" />
        <div className="grid gap-4 sm:grid-cols-2">
          <BroadcastPanel>
            <div className="p-6">
              <p className="font-condensed text-xs uppercase tracking-widest text-zinc-500">
                intensity=default
              </p>
              <p className="mt-2 text-sm text-zinc-200">Full glow + ticker</p>
            </div>
          </BroadcastPanel>
          <BroadcastPanel intensity="soft">
            <div className="p-6">
              <p className="font-condensed text-xs uppercase tracking-widest text-zinc-500">
                intensity=soft
              </p>
              <p className="mt-2 text-sm text-zinc-200">Dimmed glow + ticker</p>
            </div>
          </BroadcastPanel>
          <BroadcastPanel ticker={false}>
            <div className="p-6">
              <p className="font-condensed text-xs uppercase tracking-widest text-zinc-500">
                ticker=false
              </p>
              <p className="mt-2 text-sm text-zinc-200">Glow only, no top strip</p>
            </div>
          </BroadcastPanel>
        </div>
      </section>

      {/* SectionHeader ----------------------------------------------------- */}
      <section className="space-y-4">
        <SectionHeader label="SectionHeader" />
        <Panel className="space-y-6 p-6">
          <SectionHeader label="Latest Result" />
          <SectionHeader label="Scoring Leaders" cta={{ href: '/stats', label: 'All stats' }} />
          <SectionHeader label="Page Title (h1)" as="h1" />
          <SectionHeader
            label="Recent Form"
            subtitle="Last 15 skater appearances · most recent first"
          />
        </Panel>
      </section>

      {/* ResultPill -------------------------------------------------------- */}
      <section className="space-y-4">
        <SectionHeader label="ResultPill" />
        <Panel className="space-y-6 p-6">
          <div>
            <p className="mb-3 font-condensed text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-500">
              size=sm (chip · letter glyph)
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <ResultPill result="WIN" size="sm" />
              <ResultPill result="LOSS" size="sm" />
              <ResultPill result="OTL" size="sm" />
              <ResultPill result="DNF" size="sm" />
            </div>
          </div>
          <div>
            <p className="mb-3 font-condensed text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-500">
              size=md (pill · full word)
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <ResultPill result="WIN" size="md" />
              <ResultPill result="LOSS" size="md" />
              <ResultPill result="OTL" size="md" />
              <ResultPill result="DNF" size="md" />
            </div>
          </div>
        </Panel>
      </section>

      {/* StatStrip --------------------------------------------------------- */}
      <section className="space-y-4">
        <SectionHeader label="StatStrip" />
        <BroadcastPanel>
          <div className="space-y-6 p-6">
            <div>
              <p className="mb-3 font-condensed text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-500">
                Default density · with provenance
              </p>
              <StatStrip
                items={[
                  { label: 'GP', value: '22' },
                  { label: 'W', value: '14', accent: true },
                  { label: 'L', value: '6' },
                  { label: 'OTL', value: '2', dim: true },
                  { label: 'Win%', value: '70.0', accent: true },
                  { label: 'GF', value: '78' },
                  { label: 'GA', value: '52' },
                ]}
                provenance="EA official"
              />
            </div>
            <div>
              <p className="mb-3 font-condensed text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-500">
                Tight density · no provenance
              </p>
              <StatStrip
                density="tight"
                items={[
                  { label: 'G', value: '3' },
                  { label: 'A', value: '5' },
                  { label: 'PTS', value: '8', accent: true },
                  { label: '+/-', value: '+2' },
                  { label: 'SOG', value: '12' },
                ]}
              />
            </div>
            <div>
              <p className="mb-3 font-condensed text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-500">
                Em-dash placeholder for missing data
              </p>
              <StatStrip
                items={[
                  { label: 'FO%', value: '—', dim: true },
                  { label: 'TOA', value: '—', dim: true },
                  { label: 'BLK', value: '—', dim: true },
                ]}
                provenance="local · 6s only"
              />
            </div>
          </div>
        </BroadcastPanel>
      </section>
    </main>
  )
}
