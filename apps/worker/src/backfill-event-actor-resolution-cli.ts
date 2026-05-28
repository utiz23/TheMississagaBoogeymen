/**
 * pnpm --filter @eanhl/worker backfill-event-actor-resolution -- \
 *     --match <id> | --all  [--dry-run] [--limit <n>] [--verbose]
 *
 * Re-resolves actor_player_id and target_player_id on match_events
 * using the match-scoped resolver (resolveActorForMatch). Players
 * resolved by the global cascade but not in this match's roster get
 * nulled out (stale-alias-leak fix). Previously-unresolved actors
 * whose alias now lands in lineup get bound.
 *
 * Symmetric fix applied to extension tables that share the same FK
 * semantics (their *_snapshot columns carry the OCR gamertag verbatim,
 * so the resolver has authoritative text to re-run against):
 *   - match_goal_events.{scorerPlayerId, primaryAssistPlayerId,
 *     secondaryAssistPlayerId}  — uses scorer/primary/secondary snapshots
 *   - match_penalty_events.culpritPlayerId — uses culprit_snapshot
 *
 * Idempotent: second run on same match reports 0 changes.
 *
 * DOES NOT touch match_events.team_side — that's deliberately scoped
 * to new-ingest behavior. Existing wrong-roster events keep their
 * (possibly mis-inferred) team_side; the L2 denominator may shift on
 * future reprocesses, captured in the regression floor.
 *
 * Args (mutually exclusive):
 *   --match <id>   Backfill a single match.
 *   --all          Backfill every match. Use --limit to cap.
 *
 * Other:
 *   --dry-run      Print would-change counts, no UPDATE.
 *   --limit <n>    With --all, cap the number of matches processed.
 *   --verbose      Per-row before/after logs.
 *
 * Prints one JSON line per match:
 *   {"match_id": 250, "actor_changes": 82, "actor_nulled": 78, "actor_bound": 4,
 *    "target_changes": 12, "target_nulled": 11, "target_bound": 1,
 *    "goal_changes": 3, "penalty_changes": 0}
 */
import {
  db,
  sql as sqlTag,
  matches,
  matchEvents,
  matchGoalEvents,
  matchPenaltyEvents,
} from '@eanhl/db'
import { asc, eq } from 'drizzle-orm'

import { resolveActorForMatch } from './ocr-promoters/resolve-identity.js'
import type { PromoterDb } from './ocr-promoters/index.js'

interface MatchCounters {
  match_id: number
  actor_changes: number
  actor_nulled: number
  actor_bound: number
  target_changes: number
  target_nulled: number
  target_bound: number
  goal_changes: number
  penalty_changes: number
}

function emptyCounters(matchId: number): MatchCounters {
  return {
    match_id: matchId,
    actor_changes: 0,
    actor_nulled: 0,
    actor_bound: 0,
    target_changes: 0,
    target_nulled: 0,
    target_bound: 0,
    goal_changes: 0,
    penalty_changes: 0,
  }
}

function getFlag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined
}

function parsePositiveInt(name: string, raw: string | undefined): number {
  if (raw === undefined) {
    throw new Error(`--${name} requires a value`)
  }
  const n = Number(raw)
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
    throw new Error(`--${name} must be a positive integer; got: ${raw}`)
  }
  return n
}

/**
 * Diff a previous FK value against a freshly-resolved candidate. Returns
 * the delta to apply (or null if unchanged) plus a counter classification.
 */
function classifyChange(
  previous: number | null,
  next: number | null,
): { changed: boolean; nulled: boolean; bound: boolean } {
  if (previous === next) {
    return { changed: false, nulled: false, bound: false }
  }
  return {
    changed: true,
    nulled: previous !== null && next === null,
    bound: previous === null && next !== null,
  }
}

interface BackfillOptions {
  dryRun: boolean
  verbose: boolean
}

async function backfillMatch(
  matchId: number,
  opts: BackfillOptions,
): Promise<MatchCounters> {
  // 1. Resolve game_title_id once.
  const [match] = await db
    .select({ gameTitleId: matches.gameTitleId })
    .from(matches)
    .where(eq(matches.id, matchId))
    .limit(1)
  if (!match) {
    throw new Error(`backfill: match ${matchId} not found`)
  }
  const gameTitleId = match.gameTitleId

  const counters = emptyCounters(matchId)

  // Per-match transaction. resolveActorForMatch reads its lineup view
  // off the same `tx`, so the gate is consistent with any writes we do.
  await db.transaction(async (tx) => {
    const promoterTx = tx as unknown as PromoterDb

    // 2. Pull every match_events row (including actor_player_id IS NULL —
    //    they may now resolve via the new logic if the gamertag is now in
    //    lineup).
    const events = await tx
      .select({
        id: matchEvents.id,
        actorPlayerId: matchEvents.actorPlayerId,
        actorGamertagSnapshot: matchEvents.actorGamertagSnapshot,
        targetPlayerId: matchEvents.targetPlayerId,
        targetGamertagSnapshot: matchEvents.targetGamertagSnapshot,
      })
      .from(matchEvents)
      .where(eq(matchEvents.matchId, matchId))
      .orderBy(asc(matchEvents.id))

    for (const ev of events) {
      // Re-resolve actor.
      const newActor = await resolveActorForMatch(
        ev.actorGamertagSnapshot,
        matchId,
        gameTitleId,
        promoterTx,
      )
      const actorDelta = classifyChange(ev.actorPlayerId, newActor.playerId)

      // Re-resolve target.
      const newTarget = await resolveActorForMatch(
        ev.targetGamertagSnapshot,
        matchId,
        gameTitleId,
        promoterTx,
      )
      const targetDelta = classifyChange(ev.targetPlayerId, newTarget.playerId)

      if (actorDelta.changed) {
        counters.actor_changes++
        if (actorDelta.nulled) counters.actor_nulled++
        if (actorDelta.bound) counters.actor_bound++
      }
      if (targetDelta.changed) {
        counters.target_changes++
        if (targetDelta.nulled) counters.target_nulled++
        if (targetDelta.bound) counters.target_bound++
      }

      if (opts.verbose && (actorDelta.changed || targetDelta.changed)) {
        process.stderr.write(
          `match_event id=${ev.id}` +
            ` actor: ${ev.actorPlayerId ?? 'null'}→${newActor.playerId ?? 'null'} (${newActor.via})` +
            ` target: ${ev.targetPlayerId ?? 'null'}→${newTarget.playerId ?? 'null'} (${newTarget.via})\n`,
        )
      }

      if (!opts.dryRun && (actorDelta.changed || targetDelta.changed)) {
        await tx
          .update(matchEvents)
          .set({
            ...(actorDelta.changed ? { actorPlayerId: newActor.playerId } : {}),
            ...(targetDelta.changed ? { targetPlayerId: newTarget.playerId } : {}),
          })
          .where(eq(matchEvents.id, ev.id))
      }
    }

    // 4. Extension tables — match_goal_events. Each row has its own scorer/
    //    primary/secondary snapshots, so all three FKs are independently
    //    re-resolvable. (Scorer = actor on the parent match_event in the
    //    promote path, but we trust the goal row's own snapshot here so the
    //    backfill is a single-table read per row.)
    const goalRows = await tx
      .select({
        eventId: matchGoalEvents.eventId,
        scorerPlayerId: matchGoalEvents.scorerPlayerId,
        scorerSnapshot: matchGoalEvents.scorerSnapshot,
        primaryAssistPlayerId: matchGoalEvents.primaryAssistPlayerId,
        primaryAssistSnapshot: matchGoalEvents.primaryAssistSnapshot,
        secondaryAssistPlayerId: matchGoalEvents.secondaryAssistPlayerId,
        secondaryAssistSnapshot: matchGoalEvents.secondaryAssistSnapshot,
      })
      .from(matchGoalEvents)
      .innerJoin(matchEvents, eq(matchGoalEvents.eventId, matchEvents.id))
      .where(eq(matchEvents.matchId, matchId))
      .orderBy(asc(matchGoalEvents.eventId))

    for (const g of goalRows) {
      const newScorer = await resolveActorForMatch(
        g.scorerSnapshot,
        matchId,
        gameTitleId,
        promoterTx,
      )
      const newPrimary = g.primaryAssistSnapshot
        ? await resolveActorForMatch(
            g.primaryAssistSnapshot,
            matchId,
            gameTitleId,
            promoterTx,
          )
        : { playerId: null as number | null }
      const newSecondary = g.secondaryAssistSnapshot
        ? await resolveActorForMatch(
            g.secondaryAssistSnapshot,
            matchId,
            gameTitleId,
            promoterTx,
          )
        : { playerId: null as number | null }

      const scorerDelta = classifyChange(g.scorerPlayerId, newScorer.playerId)
      const primaryDelta = classifyChange(g.primaryAssistPlayerId, newPrimary.playerId)
      const secondaryDelta = classifyChange(
        g.secondaryAssistPlayerId,
        newSecondary.playerId,
      )

      const goalChanged =
        scorerDelta.changed || primaryDelta.changed || secondaryDelta.changed
      if (goalChanged) counters.goal_changes++

      if (opts.verbose && goalChanged) {
        process.stderr.write(
          `match_goal_event eventId=${g.eventId}` +
            ` scorer: ${g.scorerPlayerId ?? 'null'}→${newScorer.playerId ?? 'null'}` +
            ` primary: ${g.primaryAssistPlayerId ?? 'null'}→${newPrimary.playerId ?? 'null'}` +
            ` secondary: ${g.secondaryAssistPlayerId ?? 'null'}→${newSecondary.playerId ?? 'null'}\n`,
        )
      }

      if (!opts.dryRun && goalChanged) {
        await tx
          .update(matchGoalEvents)
          .set({
            ...(scorerDelta.changed ? { scorerPlayerId: newScorer.playerId } : {}),
            ...(primaryDelta.changed
              ? { primaryAssistPlayerId: newPrimary.playerId }
              : {}),
            ...(secondaryDelta.changed
              ? { secondaryAssistPlayerId: newSecondary.playerId }
              : {}),
          })
          .where(eq(matchGoalEvents.eventId, g.eventId))
      }
    }

    // match_penalty_events. culprit_snapshot is NOT NULL by schema, so we
    // always have text to re-resolve.
    const penaltyRows = await tx
      .select({
        eventId: matchPenaltyEvents.eventId,
        culpritPlayerId: matchPenaltyEvents.culpritPlayerId,
        culpritSnapshot: matchPenaltyEvents.culpritSnapshot,
      })
      .from(matchPenaltyEvents)
      .innerJoin(matchEvents, eq(matchPenaltyEvents.eventId, matchEvents.id))
      .where(eq(matchEvents.matchId, matchId))
      .orderBy(asc(matchPenaltyEvents.eventId))

    for (const p of penaltyRows) {
      const newCulprit = await resolveActorForMatch(
        p.culpritSnapshot,
        matchId,
        gameTitleId,
        promoterTx,
      )
      const culpritDelta = classifyChange(p.culpritPlayerId, newCulprit.playerId)
      if (culpritDelta.changed) {
        counters.penalty_changes++
        if (opts.verbose) {
          process.stderr.write(
            `match_penalty_event eventId=${p.eventId}` +
              ` culprit: ${p.culpritPlayerId ?? 'null'}→${newCulprit.playerId ?? 'null'}\n`,
          )
        }
        if (!opts.dryRun) {
          await tx
            .update(matchPenaltyEvents)
            .set({ culpritPlayerId: newCulprit.playerId })
            .where(eq(matchPenaltyEvents.eventId, p.eventId))
        }
      }
    }
  })

  return counters
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)

  const matchFlag = getFlag(argv, 'match')
  const all = argv.includes('--all')
  const dryRun = argv.includes('--dry-run')
  const verbose = argv.includes('--verbose')
  const limitRaw = getFlag(argv, 'limit')

  if (matchFlag && all) {
    throw new Error('--match and --all are mutually exclusive')
  }
  if (!matchFlag && !all) {
    throw new Error(
      'one of --match <id> or --all is required (use --all to backfill every match)',
    )
  }
  if (limitRaw !== undefined && !all) {
    throw new Error('--limit is only valid with --all')
  }

  const opts: BackfillOptions = { dryRun, verbose }

  let matchIds: number[]
  if (matchFlag) {
    matchIds = [parsePositiveInt('match', matchFlag)]
  } else {
    const limit = limitRaw !== undefined ? parsePositiveInt('limit', limitRaw) : undefined
    const baseQuery = db
      .select({ id: matches.id })
      .from(matches)
      .orderBy(asc(matches.id))
    const rows = limit !== undefined ? await baseQuery.limit(limit) : await baseQuery
    matchIds = rows.map((r) => r.id)
  }

  for (const matchId of matchIds) {
    const counters = await backfillMatch(matchId, opts)
    process.stdout.write(JSON.stringify(counters) + '\n')
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
