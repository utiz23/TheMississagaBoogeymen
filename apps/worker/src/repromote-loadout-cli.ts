/**
 * pnpm --filter worker repromote-loadout -- --match <id> [--run-id <N>] [--dry-run]
 *
 * Re-runs the typed_v1 loadout promoter against existing ocr_field_evidence
 * for the given match. Strict prerequisite: the match must have been ingested
 * via pass2.loadout_engine=typed_v1 — verifiable by checking that
 * ocr_field_evidence has rows with screen_state='player_loadout_view' for the
 * match. If empty, errors out with:
 *   "match <id> has no loadout evidence — re-ingest with pass2.loadout_engine=typed_v1 first."
 * No legacy raw_result_json reconstruction path exists (Round 3 finding: that
 * would be lossy fiction).
 *
 * --dry-run: collects the proposed canonical-row writes inside a transaction
 *            that always rolls back. Prints a diff (added/removed/changed)
 *            vs. the current canonical rows. No writes occur.
 *
 * --run-id <N>: scope the promote to a specific decoder run rather than the
 *               currently-active (or NULL-legacy) run. Used by the A3
 *               reprocess CLI (Task 9) to promote a candidate run BEFORE
 *               activation. Canonical writes are skipped automatically when
 *               N is not the active run (the promoter's writeSnapshots gate
 *               handles this — see loadout-v2.ts). Default: undefined →
 *               legacy "live run" behavior unchanged.
 *
 * Without --dry-run: runs promoteLoadoutFromEvidence for real (writes canonical
 *                    rows + ocr_promotions). Use this to re-apply the gate after
 *                    gate-logic changes without re-ingesting.
 *
 * Used by Task 2B-7 (parallel-diff inspection) to verify cutover safety before
 * backfilling matches 1/2/250/463.
 */
import { eq, inArray, sql } from 'drizzle-orm'
import { TransactionRollbackError } from 'drizzle-orm'
import {
  db as defaultDb,
  sql as sqlTag,
  ocrFieldEvidence,
  playerLoadoutSnapshots,
  playerLoadoutXFactors,
  playerLoadoutAttributes,
  type Database,
} from '@eanhl/db'
import { promoteLoadoutFromEvidence } from './ocr-promoters/loadout-v2.js'

// ─── types ─────────────────────────────────────────────────────────────────────

export interface CanonicalSnapshot {
  readonly id: number
  readonly matchId: number
  readonly teamSide: string
  readonly position: string
  readonly gamertagSnapshot: string
  readonly buildClass: string | null
  readonly playerNumber: number | null
  readonly isCaptain: boolean | null
  readonly playerNamePersonaRaw?: string | null
}

export interface DiffResult {
  added: CanonicalSnapshot[]
  removed: CanonicalSnapshot[]
  changed: Array<{ key: string; diffFields: string[] }>
  proposedSnapshots: CanonicalSnapshot[]
  proposedXFactorCount: number
  proposedAttributeCount: number
}

// ─── arg parsing ───────────────────────────────────────────────────────────────

export function parseArgs(argv: string[]): {
  matchId: number
  dryRun: boolean
  runId?: number
} {
  let matchId: number | undefined
  let dryRun = false
  let runId: number | undefined

  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--dry-run') {
      dryRun = true
    } else if (argv[i] === '--match') {
      const raw = argv[i + 1]
      if (!raw) {
        console.error('Usage: repromote-loadout --match <matchId> [--run-id <N>] [--dry-run]')
        process.exit(1)
      }
      matchId = Number(raw)
      i++
    } else if (argv[i] === '--run-id') {
      const raw = argv[i + 1]
      if (!raw) {
        console.error('Usage: repromote-loadout --match <matchId> [--run-id <N>] [--dry-run]')
        process.exit(1)
      }
      const parsed = Number(raw)
      if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
        console.error(`--run-id must be a positive integer; got: ${raw}`)
        process.exit(1)
      }
      runId = parsed
      i++
    }
  }

  if (matchId === undefined || !Number.isFinite(matchId)) {
    console.error('Usage: repromote-loadout --match <matchId> [--run-id <N>] [--dry-run]')
    process.exit(1)
  }

  return runId !== undefined ? { matchId: matchId!, dryRun, runId } : { matchId: matchId!, dryRun }
}

// ─── strict prereq check ───────────────────────────────────────────────────────

/**
 * Check whether the match has loadout evidence rows (screen_state='player_loadout_view').
 * Returns the count of evidence rows.
 */
export async function getLoadoutEvidenceCount(
  matchId: number,
  db: Database = defaultDb,
): Promise<number> {
  const result = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(ocrFieldEvidence)
    .where(
      sql`${ocrFieldEvidence.matchId} = ${matchId} AND ${ocrFieldEvidence.screenState} = 'player_loadout_view'`,
    )
  return result[0]?.count ?? 0
}

// ─── canonical snapshot helpers ────────────────────────────────────────────────

/**
 * Read the current canonical snapshots + child counts for a match.
 * Works with either the real db or a transaction object.
 */
export async function snapshotCanonical(
  matchId: number,
  db: Database = defaultDb,
): Promise<{
  snapshots: CanonicalSnapshot[]
  xFactorCount: number
  attributeCount: number
}> {
  const snapshots = (await db
    .select()
    .from(playerLoadoutSnapshots)
    .where(eq(playerLoadoutSnapshots.matchId, matchId))) as CanonicalSnapshot[]

  const snapshotIds = snapshots.map((s) => s.id)

  let xFactorCount = 0
  let attributeCount = 0

  if (snapshotIds.length > 0) {
    const xfResult = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(playerLoadoutXFactors)
      .where(inArray(playerLoadoutXFactors.loadoutSnapshotId, snapshotIds))
    xFactorCount = xfResult[0]?.count ?? 0

    const attrResult = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(playerLoadoutAttributes)
      .where(inArray(playerLoadoutAttributes.loadoutSnapshotId, snapshotIds))
    attributeCount = attrResult[0]?.count ?? 0
  }

  return { snapshots, xFactorCount, attributeCount }
}

// ─── diff ──────────────────────────────────────────────────────────────────────

/**
 * Compare before and after snapshot arrays. Key is (teamSide, position).
 * Returns added, removed, and changed rows.
 */
export function diffSnapshotArrays(
  before: CanonicalSnapshot[],
  after: CanonicalSnapshot[],
): Pick<DiffResult, 'added' | 'removed' | 'changed'> {
  const beforeByKey = new Map<string, CanonicalSnapshot>()
  const afterByKey = new Map<string, CanonicalSnapshot>()

  for (const s of before) beforeByKey.set(`${s.teamSide}|${s.position}`, s)
  for (const s of after) afterByKey.set(`${s.teamSide}|${s.position}`, s)

  const added: CanonicalSnapshot[] = []
  const removed: CanonicalSnapshot[] = []
  const changed: Array<{ key: string; diffFields: string[] }> = []

  for (const [key, afterRow] of afterByKey) {
    if (!beforeByKey.has(key)) {
      added.push(afterRow)
    } else {
      const beforeRow = beforeByKey.get(key)!
      const diffFields: string[] = []
      const fields = ['gamertagSnapshot', 'buildClass', 'playerNumber', 'isCaptain'] as const
      for (const field of fields) {
        if (beforeRow[field] !== afterRow[field]) {
          diffFields.push(`${field}: ${String(beforeRow[field])} → ${String(afterRow[field])}`)
        }
      }
      if (diffFields.length > 0) {
        changed.push({ key, diffFields })
      }
    }
  }

  for (const [key, beforeRow] of beforeByKey) {
    if (!afterByKey.has(key)) {
      removed.push(beforeRow)
    }
  }

  return { added, removed, changed }
}

// ─── dry-run ──────────────────────────────────────────────────────────────────

/**
 * Run the promoter inside a rolled-back transaction to capture proposed writes
 * without persisting anything. Returns the proposed canonical state as a
 * DiffResult against the current canonical state.
 */
export async function runDryRun(
  matchId: number,
  db: Database = defaultDb,
  runId?: number,
): Promise<DiffResult> {
  const before = await snapshotCanonical(matchId, db)

  let proposed: { snapshots: CanonicalSnapshot[]; xFactorCount: number; attributeCount: number } = {
    snapshots: [],
    xFactorCount: 0,
    attributeCount: 0,
  }

  try {
    await db.transaction(async (tx) => {
      // Run the promoter inside the transaction.
      await promoteLoadoutFromEvidence({
        matchId,
        db: tx as unknown as Database,
        ...(runId !== undefined ? { runId } : {}),
      })
      // Capture proposed state before rolling back.
      proposed = await snapshotCanonical(matchId, tx as unknown as Database)
      // Force rollback — TransactionRollbackError propagates out of the callback.
      tx.rollback()
    })
  } catch (err: unknown) {
    // TransactionRollbackError is the expected signal from tx.rollback().
    // Re-throw anything else.
    if (!(err instanceof TransactionRollbackError)) {
      throw err
    }
  }

  const { added, removed, changed } = diffSnapshotArrays(before.snapshots, proposed.snapshots)

  return {
    added,
    removed,
    changed,
    proposedSnapshots: proposed.snapshots,
    proposedXFactorCount: proposed.xFactorCount,
    proposedAttributeCount: proposed.attributeCount,
  }
}

// ─── CLI entrypoint ───────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { matchId, dryRun, runId } = parseArgs(process.argv)

  // Strict prereq check
  const evCount = await getLoadoutEvidenceCount(matchId)
  if (evCount === 0) {
    console.error(
      `match ${String(matchId)} has no loadout evidence — re-ingest with pass2.loadout_engine=typed_v1 first.`,
    )
    process.exit(2)
  }
  console.log(`Loadout evidence rows for match ${String(matchId)}: ${String(evCount)}`)
  if (runId !== undefined) {
    console.log(
      `Scoping promote to runId=${String(runId)} (candidate run; canonical writes gated by activation)`,
    )
  }

  // Capture before state
  const before = await snapshotCanonical(matchId)
  console.log(
    `Before: ${String(before.snapshots.length)} snapshots, ${String(before.xFactorCount)} x_factors, ${String(before.attributeCount)} attributes`,
  )

  if (dryRun) {
    console.log(`\n[DRY-RUN] Running promoter inside rolled-back transaction…`)
    const diff = await runDryRun(matchId, defaultDb, runId)

    console.log(
      `[DRY-RUN] Proposed: ${String(diff.proposedSnapshots.length)} snapshots, ${String(diff.proposedXFactorCount)} x_factors, ${String(diff.proposedAttributeCount)} attributes`,
    )

    if (diff.added.length === 0 && diff.removed.length === 0 && diff.changed.length === 0) {
      console.log('\nNo diff — proposed canonical rows match current canonical rows.')
    } else {
      console.log(`\nDiff:`)
      console.log(`  Added:   ${String(diff.added.length)}`)
      console.log(`  Removed: ${String(diff.removed.length)}`)
      console.log(`  Changed: ${String(diff.changed.length)}`)
      for (const a of diff.added.slice(0, 10)) {
        console.log(`    + ${a.teamSide}/${a.position}: ${a.gamertagSnapshot}`)
      }
      for (const r of diff.removed.slice(0, 10)) {
        console.log(`    - ${r.teamSide}/${r.position}: ${r.gamertagSnapshot}`)
      }
      for (const c of diff.changed.slice(0, 10)) {
        console.log(`    ~ ${c.key}: ${c.diffFields.join(', ')}`)
      }
    }

    // Show what the typed_v1 promoter newly wrote (rows in proposed whose IDs
    // are not present in before).
    const beforeIds = new Set(before.snapshots.map((s) => s.id))
    const newlyWritten = diff.proposedSnapshots.filter((s) => !beforeIds.has(s.id))
    console.log(
      `\n[DRY-RUN] Newly-written by typed_v1 promoter: ${String(newlyWritten.length)} snapshots`,
    )
    for (const s of newlyWritten) {
      console.log(
        `    > ${s.teamSide}|${s.position}: ${s.gamertagSnapshot} #${String(s.playerNumber)} build=${String(s.buildClass)} persona=${String(s.playerNamePersonaRaw)}`,
      )
    }

    console.log(`\n[DRY-RUN] No writes committed.`)
  } else {
    // Run for real
    const result = await promoteLoadoutFromEvidence({
      matchId,
      db: defaultDb,
      ...(runId !== undefined ? { runId } : {}),
    })
    const after = await snapshotCanonical(matchId)
    console.log(
      `After: ${String(after.snapshots.length)} snapshots, ${String(after.xFactorCount)} x_factors, ${String(after.attributeCount)} attributes`,
    )
    console.log(
      `Promoter result: ${String(result.promotedSnapshotCount)} promoted, ${String(result.blockedSnapshotCount)} blocked, ${String(result.promotionRowsWritten)} promotion rows written`,
    )
  }
}

// Only run the CLI when this file is the main entry point, not when imported.
// Detect by checking if the resolved main module path matches this file.
// In Node ESM: `import.meta.url` vs `process.argv[1]`.
const isMain = process.argv[1]?.endsWith('repromote-loadout-cli.js') ?? false
if (isMain) {
  main()
    .then(() => process.exit(0))
    .catch((err: unknown) => {
      console.error('[repromote-loadout] Fatal:', err)
      process.exit(1)
    })
    .finally(() => {
      void sqlTag.end()
    })
}
