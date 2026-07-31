import type { MatchLineupProvenance, MatchLineups } from '@eanhl/db/queries'
import {
  OcrProvenanceFooter,
  type ProvenanceBadge,
  confidenceTone,
  confidenceWord,
  formatProvenancePercent,
} from '@/components/matches/ocr-provenance-footer'
import { computeLineupConfidence } from '@/lib/lineup-confidence'

// Provenance strip below the lineup module. Server-rendered and passed into
// the client module as children. Lifted from the donor lineup-section
// (deleted in Phase 11): OCR variant shows the blended confidence readout,
// box-score variant an honest "loadouts not captured" note.

const LINEUP_CONFIDENCE_TOOLTIP =
  'Blended completeness score — the share of expected lineup fields the OCR recovered. Not a per-field OCR certainty.'

const SCREEN_TYPE_LABELS: Readonly<Record<string, string>> = {
  pre_game_lobby: 'Pre-game lobby',
  pre_game_lobby_state_2: 'Pre-game lobby',
  player_loadout_view: 'Loadout view',
}

export function LineupModuleFooter({
  lineups,
  provenance,
  variant,
}: {
  lineups: MatchLineups
  provenance: MatchLineupProvenance
  variant: 'ocr' | 'boxScore'
}) {
  if (variant === 'boxScore') {
    return (
      <div className="flex items-center gap-2 border border-border bg-surface px-4 py-2.5">
        <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-fg-5" aria-hidden />
        <span className="font-condensed text-[11px] font-semibold uppercase tracking-[0.14em] text-fg-3">
          Lineup from box score · pre-game loadouts not captured for this match
        </span>
      </div>
    )
  }

  const c = computeLineupConfidence(lineups)
  // Drop buckets with no denominator (e.g. Tier/X-Factor when no X-Factors
  // were detected) — an inapplicable field is not a low score.
  const buckets: { key: string; value: number | null; tooltip: string }[] = [
    { key: 'Identity', value: c.identity, tooltip: 'Jersey #, persona, gamertag, platform' },
    { key: 'Build', value: c.build, tooltip: 'Rows carrying a build type' },
    {
      key: 'Bio',
      value: c.bio,
      tooltip: 'Height and weight — captured on the loadout screen only',
    },
    {
      key: 'X-Factor',
      value: c.xfactor,
      tooltip: 'Detected X-Factors resolved to a canonical name',
    },
    {
      key: 'Tier',
      value: c.tier,
      tooltip: 'Detected X-Factors with an Elite/All Star/Specialist tier',
    },
    { key: 'Attributes', value: c.attribute, tooltip: 'Rows with an attribute set' },
  ]
  const badges: ProvenanceBadge[] = buckets
    .filter((b): b is { key: string; value: number; tooltip: string } => b.value !== null)
    .map(({ key, value, tooltip }) => ({
      label: `${key} · ${formatProvenancePercent(value)}`,
      tone: value >= 0.9 ? 'ok' : 'warn',
      tooltip,
    }))

  return (
    <OcrProvenanceFooter
      capturedAt={provenance.capturedAt}
      capturedLabel="Captured"
      sources={lineupSourceLabels(provenance.sources)}
      headline={{
        value: c.overall.toFixed(2),
        word: confidenceWord(c.overall),
        tone: confidenceTone(c.overall),
      }}
      headlineTooltip={LINEUP_CONFIDENCE_TOOLTIP}
      badges={badges}
    />
  )
}

function lineupSourceLabels(sources: MatchLineupProvenance['sources']): string[] {
  const names = new Set<string>()
  for (const s of sources) names.add(SCREEN_TYPE_LABELS[s.screenType] ?? s.screenType)
  return [...names]
}
