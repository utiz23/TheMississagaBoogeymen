/**
 * pnpm --filter worker repromote-lobby -- --match <id>
 *
 * Re-runs the typed_v1 lobby promoter against existing ocr_field_evidence for
 * the given match. Strict prerequisite: the match must have been ingested via
 * pass2.lobby_engine=typed_v1 — verifiable by checking that ocr_field_evidence
 * has rows with screen_state='pre_game_lobby_state_2' for the match.
 *
 * Use to re-apply lobby-v2 after promoter-logic changes (e.g. persona alias
 * resolution at write time) without re-ingesting video.
 *
 * The promoter is idempotent: it deletes prior lobby-sourced snapshots for the
 * match before re-inserting.
 */
import { promoteLobbyFromEvidence } from './ocr-promoters/lobby-v2.js'

function parseArgs(argv: string[]): { matchIds: number[] } {
  const matchIds: number[] = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--match' && i + 1 < argv.length) {
      const id = Number(argv[++i])
      if (!Number.isFinite(id) || id <= 0) {
        throw new Error(`invalid --match value: ${argv[i]}`)
      }
      matchIds.push(id)
    }
  }
  if (matchIds.length === 0) {
    throw new Error('usage: repromote-lobby --match <id> [--match <id> ...]')
  }
  return { matchIds }
}

async function main(): Promise<void> {
  const { matchIds } = parseArgs(process.argv.slice(2))
  for (const matchId of matchIds) {
    const r = await promoteLobbyFromEvidence({ matchId })
    console.log(
      `[repromote-lobby] match=${matchId} promoted=${r.promotedSnapshotCount} blocked=${r.blockedSnapshotCount} promotionRows=${r.promotionRowsWritten}`,
    )
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
