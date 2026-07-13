/**
 * pnpm --filter @eanhl/worker resolve-match <subcommand> [args...]
 *
 * Operator review queue for reel→match_id associations (Milestone ② ASSOCIATE).
 *
 * A multi-match video is split into per-match reels (Milestone ①). Each reel
 * gets a cheap identity probe; this CLI scores each probe against the API-truth
 * match candidates, lands proposals in `ocr_match_associations` for review, and
 * on confirm stamps `ocr_capture_batches.match_id` — the step that unlocks
 * per-reel dispatch (orchestrator.py currently passes reel_match_ids=None).
 *
 * Subcommands:
 *   propose  --run-id N --identities <path> [--game-title-id G] [--video-sha256 SHA]
 *     Reads per-reel identity JSON (`reel-<idx>-identity.json` under a dir, or a
 *     single file), enumerates candidates for the game title, scores each reel,
 *     and inserts a `pending` proposal per reel. Prints a JSON summary.
 *
 *   list
 *     Prints the pending review queue (human-readable table on stdout).
 *
 *   confirm  --id N [--match-id M]
 *     Confirms proposal N: flips status→confirmed and stamps the reel's capture
 *     batch match_id. `--match-id` is REQUIRED for a no_api_match proposal.
 *
 *   reject   --id N
 *     Rejects proposal N (no stamp).
 *
 * Exit codes: 0 success; 1 argument/DB error.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { db, sql as sqlTag, ocrDecoderRuns } from '@eanhl/db'
import {
  getMatchById,
  enumerateApiCandidates,
  insertAssociationProposal,
  listPendingAssociations,
  confirmAssociation,
  rejectAssociation,
} from '@eanhl/db/queries'
import { eq } from 'drizzle-orm'
import { scoreCandidates, type ProbeIdentity } from './lib/match-association-score.js'

function getFlag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined
}

function requirePositiveInt(argv: string[], name: string, sub: string): number {
  const raw = getFlag(argv, name)
  if (raw === undefined) throw new Error(`${sub} requires --${name} <positive integer>`)
  const n = Number(raw)
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    throw new Error(`${sub} requires --${name} <positive integer>; got: ${raw}`)
  }
  return n
}

/** Raw per-reel identity probe as written by the Python identity_probe (Task 2.4). */
interface IdentityFile {
  reel_index?: number
  capture_epoch_s: number
  score_for: number
  score_against: number
  opponent_text: string
  personas?: string[]
}

/** Collect (reelIndex, IdentityFile) pairs from a directory or single file. */
function loadIdentities(path: string): { reelIndex: number; data: IdentityFile }[] {
  const isDir = statSync(path).isDirectory()
  const files = isDir
    ? readdirSync(path)
        .filter((f) => /^reel-\d+-identity\.json$/.test(f))
        .map((f) => join(path, f))
    : [path]
  if (files.length === 0) {
    throw new Error(`no reel-<idx>-identity.json files found under ${path}`)
  }
  return files.map((file) => {
    const data = JSON.parse(readFileSync(file, 'utf8')) as IdentityFile
    const m = /reel-(\d+)-identity\.json$/.exec(basename(file))
    const reelIndex = data.reel_index ?? (m ? Number(m[1]) : Number.NaN)
    if (!Number.isInteger(reelIndex)) {
      throw new Error(`cannot determine reel index for ${file}`)
    }
    return { reelIndex, data }
  })
}

async function propose(argv: string[]): Promise<void> {
  const runId = requirePositiveInt(argv, 'run-id', 'propose')
  const identitiesPath = getFlag(argv, 'identities')
  if (!identitiesPath) throw new Error('propose requires --identities <path>')

  const [run] = await db
    .select({ matchId: ocrDecoderRuns.matchId, videoSha256: ocrDecoderRuns.videoSha256 })
    .from(ocrDecoderRuns)
    .where(eq(ocrDecoderRuns.id, runId))
    .limit(1)
  if (!run) throw new Error(`propose: run ${runId} not found`)

  const videoSha = getFlag(argv, 'video-sha256') ?? run.videoSha256
  if (!videoSha) {
    throw new Error(`propose: run ${runId} has no video_sha256; pass --video-sha256 <sha>`)
  }

  const gameTitleFlag = getFlag(argv, 'game-title-id')
  let gameTitleId: number
  if (gameTitleFlag !== undefined) {
    gameTitleId = Number(gameTitleFlag)
    if (!Number.isInteger(gameTitleId) || gameTitleId <= 0) {
      throw new Error(`propose: --game-title-id must be a positive integer; got: ${gameTitleFlag}`)
    }
  } else {
    const match = await getMatchById(run.matchId)
    if (!match) throw new Error(`propose: match ${run.matchId} for run ${runId} not found`)
    gameTitleId = match.gameTitleId
  }

  const candidates = await enumerateApiCandidates(gameTitleId)
  const identities = loadIdentities(identitiesPath)

  const results: Record<string, unknown>[] = []
  for (const { reelIndex, data } of identities) {
    const probe: ProbeIdentity = {
      captureEpochS: data.capture_epoch_s,
      scoreFor: data.score_for,
      scoreAgainst: data.score_against,
      opponentText: data.opponent_text,
      personas: data.personas ?? [],
    }
    const proposal = scoreCandidates(probe, candidates)
    const reelIdentity = `${videoSha}:${reelIndex}`
    const evidence = {
      score: { for: probe.scoreFor, against: probe.scoreAgainst },
      opponent: probe.opponentText,
      personas: probe.personas,
      signals: proposal.signals,
      runnerUpGap: proposal.runnerUpGap,
    }
    try {
      const row = await insertAssociationProposal({
        reelIdentity,
        videoSha256: videoSha,
        runId,
        proposedMatchId: proposal.matchId,
        confidence: proposal.confidence.toFixed(4),
        evidence,
      })
      results.push({
        id: row.id,
        reelIdentity,
        proposedMatchId: proposal.matchId,
        confidence: Number(proposal.confidence.toFixed(4)),
        runnerUpGap: Number(proposal.runnerUpGap.toFixed(4)),
      })
    } catch (e) {
      results.push({
        reelIdentity,
        skipped: true,
        reason: e instanceof Error ? e.message : String(e),
      })
    }
  }

  process.stdout.write(JSON.stringify({ runId, gameTitleId, proposals: results }, null, 2) + '\n')
}

async function list(): Promise<void> {
  const rows = await listPendingAssociations()
  if (rows.length === 0) {
    process.stdout.write('No pending associations.\n')
    return
  }
  process.stdout.write(`Pending associations (${rows.length}):\n`)
  for (const r of rows) {
    const conf = r.confidence == null ? '—' : Number(r.confidence).toFixed(4)
    const proposed = r.proposedMatchId == null ? 'no_api_match' : String(r.proposedMatchId)
    process.stdout.write(
      `  #${r.id}  reel=${r.reelIdentity}  →  match=${proposed}  (conf ${conf})\n`,
    )
  }
}

async function confirm(argv: string[]): Promise<void> {
  const id = requirePositiveInt(argv, 'id', 'confirm')
  const matchFlag = getFlag(argv, 'match-id')
  let overrideMatchId: number | undefined
  if (matchFlag !== undefined) {
    overrideMatchId = Number(matchFlag)
    if (!Number.isInteger(overrideMatchId) || overrideMatchId <= 0) {
      throw new Error(`confirm: --match-id must be a positive integer; got: ${matchFlag}`)
    }
  }
  const result = await confirmAssociation(id, overrideMatchId)
  process.stdout.write(
    JSON.stringify({
      confirmed: result.association.id,
      matchId: result.association.proposedMatchId,
      stampedBatchIds: result.stampedBatchIds,
    }) + '\n',
  )
  if (result.stampedBatchIds.length === 0) {
    process.stderr.write(
      `confirm: WARNING — no capture batch matched (video_sha256, run_id) for association ${id}; ` +
        `status flipped but no match_id stamped.\n`,
    )
  }
}

async function reject(argv: string[]): Promise<void> {
  const id = requirePositiveInt(argv, 'id', 'reject')
  const row = await rejectAssociation(id)
  process.stdout.write(JSON.stringify({ rejected: row.id, status: row.status }) + '\n')
}

async function main(): Promise<void> {
  const [subcommand, ...rest] = process.argv.slice(2)
  switch (subcommand) {
    case 'propose':
      await propose(rest)
      break
    case 'list':
      await list()
      break
    case 'confirm':
      await confirm(rest)
      break
    case 'reject':
      await reject(rest)
      break
    default:
      throw new Error(
        `unknown subcommand: ${subcommand ?? '(none)'}; expected propose | list | confirm | reject`,
      )
  }
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : String(err)
    console.error(msg)
    process.exit(1)
  })
  .finally(() => {
    void sqlTag.end()
  })
