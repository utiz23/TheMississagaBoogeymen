/**
 * Loading skeleton for the game sheet. Mirrors the real layout in `page.tsx`
 * (top bar → hero → mode tabs → 3/4 main + 1/4 rail → full-width tracker) so
 * the page does not jump when the 15-query `Promise.all` resolves.
 *
 * Deliberately shows only the modules that render for essentially every match:
 * the rail's box score is OCR-gated (~2/199 matches pass the review gate) and
 * self-collapses, so promising one here would be a skeleton for something that
 * usually never arrives.
 */
export default function GameDetailLoading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading game sheet">
      {/* 1. Top bar — ALL GAMES + PREV/NEXT chips */}
      <div className="flex items-center justify-between gap-4">
        <Pulse className="h-3 w-24" />
        <div className="flex gap-3">
          <Pulse className="h-3 w-20" />
          <Pulse className="h-3 w-20" />
        </div>
      </div>

      {/* 2. Scoreboard hero — header strip, score row, series footer */}
      <div className="broadcast-panel-strong overflow-hidden">
        <div className="ticker-strip" />
        <div className="flex items-center justify-between border-b border-border-subtle px-4 py-2.5 sm:px-5">
          <Pulse className="h-3 w-44" />
          <Pulse className="h-3 w-16" />
        </div>
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 px-4 py-5 sm:px-5">
          <div className="flex items-center gap-3">
            <Pulse className="size-11 rounded-full" />
            <div className="min-w-0 space-y-2">
              <Pulse className="h-5 w-32" />
              <Pulse className="h-2.5 w-12" />
            </div>
          </div>
          <Pulse className="h-9 w-24" />
          <div className="flex items-center justify-end gap-3">
            <div className="min-w-0 space-y-2 text-right">
              <Pulse className="ml-auto h-5 w-32" />
              <Pulse className="ml-auto h-2.5 w-12" />
            </div>
            <Pulse className="size-11 rounded-full" />
          </div>
        </div>
      </div>

      {/* 3. LOADOUTS | STATS sub-nav */}
      <div className="flex gap-5 border-b border-border">
        <Pulse className="h-3 w-20" />
        <Pulse className="h-3 w-14" />
      </div>

      {/* 4. Main grid — main column (3/4) + rail (1/4), rail stacks below lg */}
      <div className="grid items-start gap-4 lg:grid-cols-4">
        <div className="min-w-0 space-y-4 lg:col-span-3">
          {/* Lineup module — header + team switch, then six position rows */}
          <Section>
            <div className="flex items-center justify-between gap-4 px-3.5 pb-3 pt-3">
              <Pulse className="h-4 w-40" />
              <Pulse className="h-6 w-28" />
            </div>
            <div className="space-y-px border-t border-border-subtle">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-3.5 py-2.5">
                  <Pulse className="size-5" />
                  <Pulse className="size-8 rounded-full" />
                  <Pulse className="h-4 flex-1" />
                  <Pulse className="hidden h-4 w-24 sm:block" />
                </div>
              ))}
            </div>
          </Section>

          {/* Event timeline */}
          <Section>
            <div className="space-y-3 p-3.5">
              <Pulse className="h-4 w-36" />
              {Array.from({ length: 4 }).map((_, i) => (
                <Pulse key={i} className="h-12 w-full" />
              ))}
            </div>
          </Section>
        </div>

        {/* Rail — Top Performers → DtW gauge → Team Stats */}
        <div className="min-w-0 space-y-4">
          <Section>
            <div className="space-y-2.5 p-3.5">
              <Pulse className="h-4 w-32" />
              {Array.from({ length: 3 }).map((_, i) => (
                <Pulse key={i} className="h-9 w-full" />
              ))}
            </div>
          </Section>
          <Section>
            <div className="space-y-3 p-3.5">
              <Pulse className="h-4 w-28" />
              <Pulse className="mx-auto h-[152px] w-full max-w-[240px]" />
            </div>
          </Section>
          <Section>
            <div className="space-y-2.5 p-3.5">
              <Pulse className="h-4 w-24" />
              {Array.from({ length: 8 }).map((_, i) => (
                <Pulse key={i} className="h-5 w-full" />
              ))}
            </div>
          </Section>
        </div>
      </div>

      {/* 5. Full-width action tracker — rink + synced event list */}
      <Section>
        <div className="space-y-3 p-3.5">
          <Pulse className="h-4 w-40" />
          <div className="grid gap-3 xl:grid-cols-[3fr_2fr]">
            <Pulse className="h-[280px] w-full" />
            <Pulse className="hidden h-[280px] w-full xl:block" />
          </div>
        </div>
      </Section>
    </div>
  )
}

function Section({ children }: { children: React.ReactNode }) {
  return <div className="border border-border bg-surface">{children}</div>
}

function Pulse({ className }: { className: string }) {
  return <div className={`animate-pulse bg-surface-raised ${className}`} />
}
