/**
 * pnpm --filter worker repromote-lobby -- --match <id> [--run-id <N>]
 *
 * Re-runs the typed_v1 lobby promoter against existing ocr_field_evidence for
 * the given match. Strict prerequisite: the match must have been ingested via
 * pass2.lobby_engine=typed_v1 — verifiable by checking that ocr_field_evidence
 * has rows with screen_state='pre_game_lobby_state_2' for the match.
 *
 * Use to re-apply lobby-v2 after promoter-logic changes (e.g. persona alias
 * resolution at write time) without re-ingesting video.
 *
 * --run-id <N>: scope the promote to a specific decoder run rather than the
 *               currently-active (or NULL-legacy) run. Used by the A3
 *               reprocess CLI (Task 9) to promote a candidate run BEFORE
 *               activation. Canonical writes are skipped automatically when
 *               N is not the active run (the promoter's writeSnapshots gate
 *               handles this — see lobby-v2.ts). Default: undefined → legacy
 *               "live run" behavior unchanged.
 *
 * The promoter is idempotent: it deletes prior lobby-sourced snapshots for the
 * match before re-inserting.
 */
import { promoteLobbyFromEvidence } from './ocr-promoters/lobby-v2.js'

function parseArgs(argv: string[]): { matchIds: number[]; runId?: number } {
  const matchIds: number[] = []
  let runId: number | undefined
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--match' && i + 1 < argv.length) {
      const id = Number(argv[++i])
      if (!Number.isFinite(id) || id <= 0) {
        throw new Error(`invalid --match value: ${argv[i]}`)
      }
      matchIds.push(id)
    } else if (a === '--run-id' && i + 1 < argv.length) {
      const raw = argv[++i]
      const parsed = Number(raw)
      if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(`invalid --run-id value: ${raw}`)
      }
      runId = parsed
    }
  }
  if (matchIds.length === 0) {
    throw new Error('usage: repromote-lobby --match <id> [--match <id> ...] [--run-id <N>]')
  }
  return runId !== undefined ? { matchIds, runId } : { matchIds }
}

async function main(): Promise<void> {
  const { matchIds, runId } = parseArgs(process.argv.slice(2))
  for (const matchId of matchIds) {
    const r = await promoteLobbyFromEvidence(runId !== undefined ? { matchId, runId } : { matchId })
    console.log(
      `[repromote-lobby] match=${matchId} runId=${runId ?? 'live'} promoted=${r.promotedSnapshotCount} blocked=${r.blockedSnapshotCount} promotionRows=${r.promotionRowsWritten}`,
    )
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
