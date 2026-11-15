/**
 * `import-engine-periods` (task P1): import goals and shots per period, read from
 * recordings by the eanhl-live-engine, into `match_period_summaries`
 * (`source = 'engine_video'`). Rules and checks: `lib/engine-periods.ts`.
 *
 *   pnpm --filter worker import-engine-periods --dir /path/to/periods            # DRY RUN
 *   pnpm --filter worker import-engine-periods --dir /path/to/periods --apply    # writes
 *
 * Dry run is the default and writes nothing. `--apply` needs the operator's OK and a
 * fresh backup first (runbook: docs/operations/runbooks/engine-period-import.md).
 */

import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { and, eq } from 'drizzle-orm'
import { db, sql as dbSql, gameTitles, matchPeriodSummaries, matches } from '@eanhl/db'
import {
  ENGINE_SHOTS_REVIEW_STATUS,
  ENGINE_VIDEO_SOURCE,
  formatTable,
  importFolder,
  summarize,
  type EnginePeriodRowValues,
  type FolderEntry,
  type MatchRef,
  type PeriodStore,
} from './lib/engine-periods.js'

function getFlag(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`)
  if (idx === -1) return undefined
  return process.argv[idx + 1]
}
const hasFlag = (name: string) => process.argv.includes(`--${name}`)

const dbStore: PeriodStore = {
  async findMatch(slug, eaMatchId) {
    const [title] = await db
      .select({ id: gameTitles.id })
      .from(gameTitles)
      .where(eq(gameTitles.slug, slug))
      .limit(1)
    if (title === undefined) return { titleKnown: false, match: null }
    const [m] = await db
      .select({
        id: matches.id,
        scoreFor: matches.scoreFor,
        scoreAgainst: matches.scoreAgainst,
        shotsFor: matches.shotsFor,
        shotsAgainst: matches.shotsAgainst,
        result: matches.result,
        bgmWasHome: matches.bgmWasHome,
      })
      .from(matches)
      .where(and(eq(matches.gameTitleId, title.id), eq(matches.eaMatchId, eaMatchId)))
      .limit(1)
    const match: MatchRef | null = m ?? null
    return { titleKnown: true, match }
  },

  async getEngineRows(matchId) {
    const rows = await db
      .select({
        periodNumber: matchPeriodSummaries.periodNumber,
        periodLabel: matchPeriodSummaries.periodLabel,
        goalsFor: matchPeriodSummaries.goalsFor,
        goalsAgainst: matchPeriodSummaries.goalsAgainst,
        shotsFor: matchPeriodSummaries.shotsFor,
        shotsAgainst: matchPeriodSummaries.shotsAgainst,
        goalsStatus: matchPeriodSummaries.goalsReviewStatus,
        shotsStatus: matchPeriodSummaries.shotsReviewStatus,
      })
      .from(matchPeriodSummaries)
      .where(
        and(
          eq(matchPeriodSummaries.matchId, matchId),
          eq(matchPeriodSummaries.source, ENGINE_VIDEO_SOURCE),
        ),
      )
    return rows.map(
      ({ goalsStatus, shotsStatus, ...r }): EnginePeriodRowValues => ({
        ...r,
        goalsFor: r.goalsFor ?? -1,
        goalsAgainst: r.goalsAgainst ?? -1,
        // Only the goals family is reviewed (D27: shots stay hidden, see ENGINE_SHOTS_REVIEW_STATUS).
        reviewed: goalsStatus === 'reviewed' && shotsStatus === ENGINE_SHOTS_REVIEW_STATUS,
      }),
    )
  },

  async replaceEngineRows(matchId, rows) {
    return db.transaction(async (tx) => {
      // Only this match's engine_video rows. Rows of any other source are never touched.
      const deleted = await tx
        .delete(matchPeriodSummaries)
        .where(
          and(
            eq(matchPeriodSummaries.matchId, matchId),
            eq(matchPeriodSummaries.source, ENGINE_VIDEO_SOURCE),
          ),
        )
        .returning({ id: matchPeriodSummaries.id })
      const inserted = await tx
        .insert(matchPeriodSummaries)
        .values(
          rows.map((r) => ({
            matchId,
            periodNumber: r.periodNumber,
            periodLabel: r.periodLabel,
            goalsFor: r.goalsFor,
            goalsAgainst: r.goalsAgainst,
            shotsFor: r.shotsFor,
            shotsAgainst: r.shotsAgainst,
            faceoffsFor: null,
            faceoffsAgainst: null,
            source: ENGINE_VIDEO_SOURCE,
            ocrExtractionId: null,
            // Goals (and shots, where counted) were authorized by the score check in lib/engine-periods.ts.
            // Legacy review_status is transitional metadata (migration 0056); faceoffs stay
            // empty and unreviewed.
            reviewStatus: 'reviewed' as const,
            goalsReviewStatus: 'reviewed' as const,
            shotsReviewStatus: ENGINE_SHOTS_REVIEW_STATUS,
            faceoffsReviewStatus: 'pending_review' as const,
            bgmAttackDirection: null,
          })),
        )
        .returning({ id: matchPeriodSummaries.id })
      return { deleted: deleted.length, inserted: inserted.length }
    })
  },
}

async function readFolder(dir: string): Promise<FolderEntry[]> {
  const names = (await readdir(dir)).filter((n) => n.toLowerCase().endsWith('.json')).sort()
  const entries: FolderEntry[] = []
  for (const name of names) {
    try {
      entries.push({
        name,
        json: { ok: true, value: JSON.parse(await readFile(join(dir, name), 'utf8')) },
      })
    } catch (err) {
      entries.push({
        name,
        json: { ok: false, error: err instanceof Error ? err.message : String(err) },
      })
    }
  }
  return entries
}

async function main(): Promise<void> {
  const dir = getFlag('dir')
  const apply = hasFlag('apply')
  if (dir === undefined || dir.startsWith('--')) {
    console.error(
      'Usage: import-engine-periods --dir <folder of <ea_match_id>.json files> [--apply]',
    )
    process.exitCode = 2
    return
  }
  if (apply && hasFlag('dry-run')) {
    console.error('Use --apply or --dry-run, not both.')
    process.exitCode = 2
    return
  }
  let host = '(unknown)'
  try {
    const u = new URL(process.env.DATABASE_URL ?? '')
    host = `${u.hostname}:${u.port}${u.pathname}`
  } catch {
    // DATABASE_URL is checked by the db client at import time.
  }
  console.log(
    apply
      ? `APPLY: writing to ${host}. Only engine_video rows of complete, score-checked matches.`
      : `DRY RUN: nothing is written (database ${host}). Add --apply to write.`,
  )
  const entries = await readFolder(dir)
  console.log(`${String(entries.length)} .json files in ${dir}\n`)
  const outcomes = await importFolder(entries, dbStore, { apply })
  console.log(formatTable(outcomes))
  console.log(`\n${summarize(outcomes, apply)}`)
}

main()
  .catch((err: unknown) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => {
    void dbSql.end()
  })
