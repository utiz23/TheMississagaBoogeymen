/**
 * Phase 0 evidence-layer inspector.
 *
 * Reports the state of `ocr_segments`, `ocr_field_evidence`, and
 * `ocr_promotions` for a given match — useful for confirming Pass-1 →
 * evidence-layer flow without grep'ing through SQL by hand.
 *
 * Usage:
 *   pnpm --filter worker ocr-segments-report --match 250
 *   pnpm --filter worker ocr-segments-report --match 250 --verbose
 *
 * Output columns mirror the schema in packages/db/src/schema/ocr-evidence.ts.
 */

import { sql } from '@eanhl/db'
import {
  getFieldEvidenceForLoadoutSlot,
  getLoadoutPromotionsForMatch,
  getMatchSegmentDecoderVersionCounts,
  getMatchSegments,
  getMatchSegmentStateCounts,
  getPromotionStatusCounts,
  listFieldEvidence,
  listPromotions,
} from '@eanhl/db/queries'

interface CliArgs {
  matchId: number
  verbose: boolean
}

function getFlag(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`)
  if (idx === -1) return undefined
  return process.argv[idx + 1]
}

function parseArgs(): CliArgs {
  const matchIdRaw = getFlag('match')
  if (!matchIdRaw) {
    throw new Error('Missing required --match <id>')
  }
  const matchId = Number.parseInt(matchIdRaw, 10)
  if (!Number.isFinite(matchId)) {
    throw new Error(`Invalid --match: ${matchIdRaw}`)
  }
  const verbose = process.argv.includes('--verbose') || process.argv.includes('-v')
  return { matchId, verbose }
}

function pad(s: string | number | null | undefined, width: number, align: 'l' | 'r' = 'l'): string {
  const str = s === null || s === undefined ? '-' : String(s)
  if (str.length >= width) return str.slice(0, width)
  return align === 'l' ? str.padEnd(width) : str.padStart(width)
}

async function main(): Promise<void> {
  const args = parseArgs()
  const m = args.matchId

  console.log(`\n=== ocr_segments — match ${m} ===\n`)

  // Phase 1: show decoder_version distribution at-a-glance so operators
  // can distinguish HMM-decoded rows from legacy passthrough.
  const byDecoder = await getMatchSegmentDecoderVersionCounts(m)
  if (byDecoder.length > 0) {
    console.log(`  segments by decoder_version:`)
    for (const r of byDecoder) {
      console.log(`    ${pad(r.decoderVersion, 36)} ${pad(r.segmentCount, 4, 'r')} segment(s)`)
    }
    console.log()
  }

  const stateCounts = await getMatchSegmentStateCounts(m)
  if (stateCounts.length === 0) {
    console.log('  (no segments)\n')
  } else {
    console.log(
      `  ${pad('state', 32)} ${pad('segments', 10, 'r')} ${pad('frames', 8, 'r')} ${pad('avg_conf', 10, 'r')}`,
    )
    console.log(`  ${'-'.repeat(32)} ${'-'.repeat(10)} ${'-'.repeat(8)} ${'-'.repeat(10)}`)
    let totalSegs = 0
    let totalFrames = 0
    for (const r of stateCounts) {
      console.log(
        `  ${pad(r.state, 32)} ${pad(r.segmentCount, 10, 'r')} ${pad(r.totalFrames, 8, 'r')} ${pad(
          r.avgConfidence !== null ? r.avgConfidence.toFixed(4) : '-',
          10,
          'r',
        )}`,
      )
      totalSegs += r.segmentCount
      totalFrames += r.totalFrames
    }
    console.log(`  ${'-'.repeat(32)} ${'-'.repeat(10)} ${'-'.repeat(8)} ${'-'.repeat(10)}`)
    console.log(`  ${pad('TOTAL', 32)} ${pad(totalSegs, 10, 'r')} ${pad(totalFrames, 8, 'r')}\n`)
  }

  if (args.verbose) {
    const segs = await getMatchSegments(m)
    if (segs.length > 0) {
      console.log(`  Full segment list (${segs.length} rows):`)
      console.log(
        `  ${pad('segment_key', 36)} ${pad('state', 32)} ${pad('t_start', 10, 'r')} ${pad(
          't_end',
          10,
          'r',
        )} ${pad('frames', 7, 'r')} ${pad('decoder', 24)}`,
      )
      for (const s of segs) {
        console.log(
          `  ${pad(s.segmentKey, 36)} ${pad(s.state, 32)} ${pad(
            s.tStartSec ?? '-',
            10,
            'r',
          )} ${pad(s.tEndSec ?? '-', 10, 'r')} ${pad(s.frameCount, 7, 'r')} ${pad(
            s.decoderVersion,
            24,
          )}`,
        )
      }
      console.log()
    }
  }

  console.log(`=== ocr_field_evidence — match ${m} ===\n`)
  const evidenceRows = await listFieldEvidence({ matchId: m })
  if (evidenceRows.length === 0) {
    console.log('  (no field-evidence rows — Phase 2+ will populate these)\n')
  } else {
    console.log(`  ${evidenceRows.length} candidate row(s) across all screens.`)
    // Group by (screenState, fieldFamily) for the summary view.
    const grouped = new Map<string, number>()
    for (const r of evidenceRows) {
      const k = `${r.screenState}${r.fieldFamily}`
      grouped.set(k, (grouped.get(k) ?? 0) + 1)
    }
    console.log(`  ${pad('screen_state', 32)} ${pad('field_family', 18)} ${pad('rows', 8, 'r')}`)
    for (const [k, v] of [...grouped.entries()].sort()) {
      const [state, family] = k.split('')
      console.log(`  ${pad(state ?? '', 32)} ${pad(family ?? '', 18)} ${pad(v, 8, 'r')}`)
    }
    console.log()
  }

  console.log(`=== ocr_promotions — match ${m} ===\n`)
  const promoStatusCounts = await getPromotionStatusCounts(m)
  if (promoStatusCounts.length === 0) {
    console.log('  (no promotion rows — Phase 2+ will populate these)\n')
  } else {
    console.log(`  ${pad('promotion_status', 28)} ${pad('count', 10, 'r')}`)
    console.log(`  ${'-'.repeat(28)} ${'-'.repeat(10)}`)
    for (const r of promoStatusCounts) {
      console.log(`  ${pad(r.promotionStatus, 28)} ${pad(r.count, 10, 'r')}`)
    }
    console.log()
    if (args.verbose) {
      const promos = await listPromotions({ matchId: m })
      console.log(`  Full promotion list (${promos.length} rows):`)
      for (const p of promos.slice(0, 100)) {
        console.log(
          `  [${p.promotionStatus}] ${p.targetTable}.${p.fieldKey ?? '(row)'}  conf=${
            p.winningConfidence ?? '-'
          }  evidence=${p.evidenceCount}  conflicts=${p.conflictCount}`,
        )
      }
      if (promos.length > 100) console.log(`  … and ${promos.length - 100} more`)
      console.log()
    }
  }

  // Phase 2B-5: loadout per-slot breakdown when player_loadout_view evidence exists
  const loadoutEvidence = await getFieldEvidenceForLoadoutSlot(m)
  const loadoutPromos = await getLoadoutPromotionsForMatch(m)

  if (loadoutEvidence.length > 0) {
    console.log(`=== Loadout per-slot breakdown ===\n`)

    // Group field evidence by subject_slot_key
    const bySlot = new Map<string | null, typeof loadoutEvidence>()
    for (const row of loadoutEvidence) {
      const key = row.subjectSlotKey ?? null
      if (!bySlot.has(key)) bySlot.set(key, [])
      bySlot.get(key)!.push(row)
    }

    // Group promotions by target_semantic_key.position (which maps to slot semantics)
    const promosBySlotPosition = new Map<
      string,
      {
        promoted: number
        blocked: number
      }
    >()
    for (const p of loadoutPromos) {
      // Extract position from target_semantic_key if available
      let posKey = 'unknown'
      if (p.targetSemanticKey !== null && typeof p.targetSemanticKey === 'object') {
        const pos = (p.targetSemanticKey as Record<string, unknown>)['position']
        if (pos !== undefined) {
          posKey = String(pos)
        }
      }
      if (!promosBySlotPosition.has(posKey)) {
        promosBySlotPosition.set(posKey, { promoted: 0, blocked: 0 })
      }
      const stats = promosBySlotPosition.get(posKey)!
      if (p.promotionStatus === 'promoted') {
        stats.promoted += 1
      } else {
        stats.blocked += 1
      }
    }

    // Sort slot keys: nulls last, then alphabetically
    const sortedSlotKeys = [...bySlot.keys()].sort((a, b) => {
      if (a === null && b === null) return 0
      if (a === null) return 1
      if (b === null) return -1
      return a.localeCompare(b)
    })

    console.log(
      `  ${pad('Slot', 46)} ${pad('Promoted', 10, 'r')} ${pad('Blocked', 9, 'r')} ${pad('Top conf', 10, 'r')}`,
    )
    console.log(`  ${'-'.repeat(46)} ${'-'.repeat(10)} ${'-'.repeat(9)} ${'-'.repeat(10)}`)

    for (const slotKey of sortedSlotKeys) {
      const rows = bySlot.get(slotKey)!

      // Count promoted/blocked for this slot from ocr_promotions
      const posKey =
        slotKey !== null && slotKey.includes('_')
          ? (slotKey.split('_').pop() ?? 'unknown')
          : (slotKey ?? 'null')
      const slotPromoStats = promosBySlotPosition.get(posKey) ?? { promoted: 0, blocked: 0 }

      // Compute top candidate confidence (rank=0 records) across all fields in this slot
      const topCandidates = rows
        .filter((r) => r.candidateRank === 0)
        .map((r) => Number(r.rawConfidence ?? 0))
      const avgTopConf =
        topCandidates.length > 0
          ? (topCandidates.reduce((a, b) => a + b, 0) / topCandidates.length).toFixed(2)
          : '-'

      console.log(
        `  ${pad(slotKey ?? '<no slot>', 46)} ${pad(slotPromoStats.promoted, 10, 'r')} ${pad(
          slotPromoStats.blocked,
          9,
          'r',
        )} ${pad(avgTopConf, 10, 'r')}`,
      )
    }
    console.log()
  }
}

main()
  .catch((err: unknown) => {
    console.error('[ocr-segments-report] Fatal error:', err)
    process.exitCode = 1
  })
  .finally(() => {
    void sql.end()
  })
