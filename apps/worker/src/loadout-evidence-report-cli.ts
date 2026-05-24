/**
 * Phase 2B evidence-layer inspector for loadout promotions.
 *
 * Reports the state of `ocr_field_evidence` (player_loadout_view screen) and
 * `ocr_promotions` (player_loadout_snapshots target) for a given match — useful
 * for confirming the typed_v1 promoter's per-slot promotion gate decisions
 * without grep'ing through SQL by hand.
 *
 * Usage:
 *   pnpm --filter worker loadout-evidence-report -- --match 250
 *   pnpm --filter worker loadout-evidence-report -- --match 250 --verbose
 *
 * Output columns mirror the schema in packages/db/src/schema/ocr-evidence.ts.
 */

import { sql } from '@eanhl/db'
import { getFieldEvidenceForLoadoutSlot, getLoadoutPromotionsForMatch } from '@eanhl/db/queries'
import { getExpectedSlotsForMatch } from '@eanhl/db/queries'

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

  console.log(`\n=== loadout evidence report — match ${m} ===\n`)

  // 1. Expected roster
  const expectedSlots = await getExpectedSlotsForMatch(m)
  console.log(`Expected slots (from getExpectedSlotsForMatch): ${expectedSlots.length}`)
  if (args.verbose) {
    for (const slot of expectedSlots) {
      console.log(`  ${pad(slot.teamSide, 8)} / ${slot.position}`)
    }
  }
  console.log()

  // 2. Field evidence — all player_loadout_view rows for this match
  const evidence = await getFieldEvidenceForLoadoutSlot(m)

  // Group by subject_slot_key (null = no slot assigned)
  const bySlot = new Map<string | null, typeof evidence>()
  for (const row of evidence) {
    const key = row.subjectSlotKey ?? null
    if (!bySlot.has(key)) bySlot.set(key, [])
    bySlot.get(key)!.push(row)
  }

  if (evidence.length === 0) {
    console.log(
      'Field evidence: 0 rows (no player_loadout_view evidence — typed_v1 promoter not yet run for this match)\n',
    )
  } else {
    console.log(`Field evidence: ${evidence.length} rows across ${bySlot.size} slot key(s)\n`)
  }

  // 3. Promotions — scoped to player_loadout_snapshots target table
  const promotions = await getLoadoutPromotionsForMatch(m)

  if (promotions.length === 0) {
    console.log('Promotions: 0 decisions (no ocr_promotions rows for player_loadout_snapshots)\n')
  } else {
    const promotionCounts: Record<string, number> = {
      promoted: 0,
      blocked_consensus: 0,
      blocked_observability: 0,
      blocked_invariant: 0,
      blocked_authority: 0,
    }
    for (const p of promotions) {
      promotionCounts[p.promotionStatus] = (promotionCounts[p.promotionStatus] ?? 0) + 1
    }
    console.log(`Promotions: ${promotions.length} decisions`)
    console.log(`  ${pad('promoted', 24)} ${pad(promotionCounts.promoted, 6, 'r')}`)
    console.log(
      `  ${pad('blocked_consensus', 24)} ${pad(promotionCounts.blocked_consensus, 6, 'r')}`,
    )
    console.log(
      `  ${pad('blocked_observability', 24)} ${pad(promotionCounts.blocked_observability, 6, 'r')}`,
    )
    console.log(
      `  ${pad('blocked_invariant', 24)} ${pad(promotionCounts.blocked_invariant, 6, 'r')}`,
    )
    console.log(
      `  ${pad('blocked_authority', 24)} ${pad(promotionCounts.blocked_authority, 6, 'r')}`,
    )
    console.log()
  }

  // 4. Per-slot breakdown
  if (bySlot.size > 0) {
    console.log(`Per-slot breakdown:\n`)

    // Sort slot keys: nulls last, then alphabetically
    const sortedSlotKeys = [...bySlot.keys()].sort((a, b) => {
      if (a === null && b === null) return 0
      if (a === null) return 1
      if (b === null) return -1
      return a.localeCompare(b)
    })

    for (const slotKey of sortedSlotKeys) {
      const rows = bySlot.get(slotKey)!

      // Group by field_key within slot
      const fieldsByKey = new Map<string, typeof rows>()
      for (const r of rows) {
        const k = r.fieldKey
        if (!fieldsByKey.has(k)) fieldsByKey.set(k, [])
        fieldsByKey.get(k)!.push(r)
      }

      console.log(
        `  ${slotKey ?? '<no slot>'}: ${fieldsByKey.size} field(s), ${rows.length} candidate(s)`,
      )

      if (args.verbose) {
        // Sample: top candidate (rank 0) per field, sorted by field key
        const sortedFields = [...fieldsByKey.keys()].sort()
        for (const fieldKey of sortedFields) {
          const fieldCandidates = [...fieldsByKey.get(fieldKey)!].sort(
            (a, b) => a.candidateRank - b.candidateRank,
          )
          const top = fieldCandidates[0]
          if (top === undefined) continue
          const valueStr = JSON.stringify(top.candidateValue)
          const conf = top.rawConfidence !== null ? Number(top.rawConfidence).toFixed(4) : '-'
          console.log(`    ${pad(fieldKey, 40)} ${pad(valueStr.slice(0, 30), 32)} conf=${conf}`)
        }
      }
      console.log()
    }
  }

  // 5. Blocked promotions — always printed (primary triage queue)
  const blocked = promotions.filter((p) => p.promotionStatus !== 'promoted')
  if (blocked.length > 0) {
    console.log(`Blocked promotions (${blocked.length}):\n`)
    console.log(`  ${pad('status', 24)} ${pad('field_key', 28)} ${pad('semantic_key', 50)} reason`)
    console.log(`  ${'-'.repeat(24)} ${'-'.repeat(28)} ${'-'.repeat(50)} ${'-'.repeat(20)}`)
    for (const b of blocked.slice(0, 50)) {
      const key = b.targetSemanticKey !== null ? JSON.stringify(b.targetSemanticKey) : '-'
      console.log(
        `  ${pad(b.promotionStatus, 24)} ${pad(b.fieldKey ?? '<snapshot>', 28)} ${pad(key, 50)} ${b.blockingReason ?? ''}`,
      )
    }
    if (blocked.length > 50) {
      console.log(`  ... and ${blocked.length - 50} more`)
    }
    console.log()
  } else if (promotions.length > 0) {
    console.log('All promotions passed (no blocked rows).\n')
  }
}

main()
  .catch((err: unknown) => {
    console.error('[loadout-evidence-report] Fatal error:', err)
    process.exitCode = 1
  })
  .finally(() => {
    void sql.end()
  })
