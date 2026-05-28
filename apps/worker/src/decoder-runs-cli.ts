/**
 * pnpm --filter @eanhl/worker decoder-runs <subcommand> [args...]
 *
 * DB-atomic operations on `ocr_decoder_runs`. The Python
 * `video_ingest reprocess` orchestrator (Tasks 8/9) shells out to this
 * CLI for run lifecycle ops because Drizzle is the schema source of
 * truth — TypeScript owns the transaction boundaries.
 *
 * Subcommands:
 *   create-candidate  --match-id N --decoder-version V --weights-hash WH \
 *                     --config-hash CH [--video-sha256 SHA]
 *     Inserts a new `ocr_decoder_runs` row with is_active=false.
 *     Prints `{"run_id": N, "is_active": false}` on stdout (JSON, one line)
 *     so the Python orchestrator can capture the new run id with a simple
 *     `JSON.parse`.
 *
 *   validate          --run-id N [--min-loadout K] [--min-lobby K]
 *     (Task 4 — not yet implemented)
 *
 *   activate          --run-id N [--dry-run]
 *     (Task 4 — not yet implemented)
 *
 *   undo              --match-id N [--dry-run]
 *     (Task 5 — not yet implemented)
 *
 * Exit codes:
 *   0 — success
 *   1 — argument validation error, unknown subcommand, or DB error
 *   2 — reserved for `validate` fail-soft (Task 4)
 */
import {
  db,
  sql as sqlTag,
  ocrDecoderRuns,
} from '@eanhl/db'

function getFlag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined
}

async function createCandidate(argv: string[]): Promise<void> {
  const matchIdRaw = getFlag(argv, 'match-id')
  if (!matchIdRaw) {
    throw new Error('create-candidate requires --match-id <positive integer>')
  }
  const matchId = Number(matchIdRaw)
  if (!Number.isFinite(matchId) || !Number.isInteger(matchId) || matchId <= 0) {
    throw new Error(
      `create-candidate requires --match-id <positive integer>; got: ${matchIdRaw}`,
    )
  }

  const decoderVersion = getFlag(argv, 'decoder-version')
  const weightsHash = getFlag(argv, 'weights-hash')
  const configHash = getFlag(argv, 'config-hash')
  const videoSha256 = getFlag(argv, 'video-sha256') ?? null

  if (!decoderVersion) {
    throw new Error('create-candidate requires --decoder-version <string>')
  }
  if (!weightsHash) {
    throw new Error('create-candidate requires --weights-hash <string>')
  }
  if (!configHash) {
    throw new Error('create-candidate requires --config-hash <string>')
  }

  const [row] = await db
    .insert(ocrDecoderRuns)
    .values({
      matchId,
      videoSha256,
      decoderVersion,
      weightsHash,
      configHash,
      isActive: false,
    })
    .returning({ id: ocrDecoderRuns.id, isActive: ocrDecoderRuns.isActive })

  if (!row) {
    throw new Error('create-candidate: insert returned no row')
  }

  process.stdout.write(
    JSON.stringify({ run_id: row.id, is_active: row.isActive }) + '\n',
  )
}

async function main(): Promise<void> {
  const [subcommand, ...rest] = process.argv.slice(2)
  switch (subcommand) {
    case 'create-candidate':
      await createCandidate(rest)
      break
    case 'validate':
    case 'activate':
    case 'undo':
      throw new Error(
        `subcommand '${subcommand}' not yet implemented (Task 4/5)`,
      )
    default:
      throw new Error(
        `unknown subcommand: ${subcommand ?? '(none)'}; expected create-candidate | validate | activate | undo`,
      )
  }
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    const msg =
      err instanceof Error ? err.message : typeof err === 'string' ? err : String(err)
    console.error(msg)
    process.exit(1)
  })
  .finally(() => {
    void sqlTag.end()
  })
