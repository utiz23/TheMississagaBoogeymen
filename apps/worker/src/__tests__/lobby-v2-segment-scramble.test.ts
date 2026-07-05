/**
 * lobby-v2 promoter — settled-segment preference + per-slot gamertag coherence.
 *
 * Regression coverage for the WS-B "lobby scramble" PROMOTER bug (match 250).
 * A lobby is captured across 2+ segments: one SETTLED roster and one (or more)
 * mid-roster-slide TRANSITION frames where EA animates both teams' rows between
 * the L/R panels. In a transition frame the SAME gamertag bleeds into a for_*
 * AND an against_* slot, and the sliding player's number/persona/captain land in
 * whatever slot they pass through.
 *
 * The pre-fix promoter did a per-(slot,field) argmax over calibrated confidence
 * with NO notion of segments, so:
 *   - a transition read could out-score the settled read by hundredths
 *     (for_LW: DuhPope@0.9571 edged StickMenace@0.9547), and
 *   - a cross-roster-bled persona/number could win a slot outright
 *     (against_LD → H.Jenkins/#7 instead of the real Pat Magroyne/#23).
 *
 * The fix: rank segments by within-segment cross-team gamertag collisions
 * (skaters only), promote each slot's gamertag preferring the settled (lowest-
 * collision) segment, then accept every OTHER field for that slot only from a
 * segment whose gamertag for the slot AGREES with the promoted anchor. This
 * drops the bled reads while still keeping a transition frame's OWN coherent
 * read where it is the only observation (against_LW's #95/Whoosah).
 *
 * This fixture mirrors match 250's exact two-segment shape at minimal scale.
 *
 * Run via:
 *   pnpm --filter worker test lobby-v2-segment-scramble
 */

import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import {
  db,
  sql as rawSql,
  matches,
  ocrCaptureBatches,
  ocrExtractions,
  ocrSegments,
  ocrFieldEvidence,
  ocrPromotions,
  playerLoadoutSnapshots,
  playerLoadoutXFactors,
  playerLoadoutAttributes,
} from '@eanhl/db'
import { eq, inArray, like } from 'drizzle-orm'
import { promoteLobbyFromEvidence } from '../ocr-promoters/lobby-v2.js'

const GAME_TITLE_ID = 1 // NHL 26
const SENTINEL_TAG = 'test-sentinel-scramble'

const sentinelMatchIds = new Set<number>()

async function cleanupMatch(matchId: number): Promise<void> {
  const snapIds = (
    await db
      .select({ id: playerLoadoutSnapshots.id })
      .from(playerLoadoutSnapshots)
      .where(eq(playerLoadoutSnapshots.matchId, matchId))
  ).map((r) => r.id)
  if (snapIds.length > 0) {
    await db
      .delete(playerLoadoutXFactors)
      .where(inArray(playerLoadoutXFactors.loadoutSnapshotId, snapIds))
    await db
      .delete(playerLoadoutAttributes)
      .where(inArray(playerLoadoutAttributes.loadoutSnapshotId, snapIds))
  }
  await db.delete(playerLoadoutSnapshots).where(eq(playerLoadoutSnapshots.matchId, matchId))
  await db.delete(ocrPromotions).where(eq(ocrPromotions.matchId, matchId))
  await db.delete(ocrFieldEvidence).where(eq(ocrFieldEvidence.matchId, matchId))
  await db.delete(ocrSegments).where(eq(ocrSegments.matchId, matchId))
  await db.delete(ocrExtractions).where(eq(ocrExtractions.matchId, matchId))
  await db.delete(ocrCaptureBatches).where(eq(ocrCaptureBatches.matchId, matchId))
  await db.delete(matches).where(eq(matches.id, matchId))
}

async function cleanupAllSentinels(): Promise<void> {
  const stale = await db
    .select({ id: matches.id })
    .from(matches)
    .where(like(matches.eaMatchId, `${SENTINEL_TAG}-%`))
  for (const m of stale) await cleanupMatch(m.id)
  sentinelMatchIds.clear()
}

before(async () => {
  if (!process.env['DATABASE_URL']) return
  await cleanupAllSentinels()
})

after(async () => {
  if (!process.env['DATABASE_URL']) return
  for (const matchId of Array.from(sentinelMatchIds)) {
    try {
      await cleanupMatch(matchId)
    } catch {
      // sweep below retries
    }
  }
  await cleanupAllSentinels()
  await rawSql.end({ timeout: 5 })
})

interface Fixture {
  matchId: number
  extractionId: number
  settledSegId: number
  transitionSegId: number
}

async function setupMatch(suffix: string): Promise<Fixture> {
  const [m] = await db
    .insert(matches)
    .values({
      gameTitleId: GAME_TITLE_ID,
      eaMatchId: `${SENTINEL_TAG}-${suffix}`,
      matchType: 'gameType5',
      opponentClubId: '99999',
      opponentName: 'scramble sentinel opp',
      playedAt: new Date('2026-01-01T00:00:00Z'),
      result: 'WIN',
      scoreFor: 1,
      scoreAgainst: 0,
      shotsFor: 1,
      shotsAgainst: 0,
      hitsFor: 0,
      hitsAgainst: 0,
    })
    .returning({ id: matches.id })
  assert.ok(m)
  const matchId = m.id
  sentinelMatchIds.add(matchId)

  const [batch] = await db
    .insert(ocrCaptureBatches)
    .values({
      gameTitleId: GAME_TITLE_ID,
      matchId,
      sourceDirectory: `/tmp/${SENTINEL_TAG}/${suffix}`,
      captureKind: 'manual_screenshots',
      notes: `${SENTINEL_TAG}-${suffix}`,
    })
    .returning({ id: ocrCaptureBatches.id })
  assert.ok(batch)

  const [extraction] = await db
    .insert(ocrExtractions)
    .values({
      batchId: batch.id,
      matchId,
      screenType: 'pre_game_lobby_state_2',
      sourcePath: `/tmp/${SENTINEL_TAG}/${suffix}/lobby.png`,
      rawResultJson: {},
      transformStatus: 'success',
    })
    .returning({ id: ocrExtractions.id })
  assert.ok(extraction)

  const seg = async (key: string): Promise<number> => {
    const [s] = await db
      .insert(ocrSegments)
      .values({
        matchId,
        segmentKey: key,
        state: 'pre_game_lobby_state_2',
        frameCount: 20,
        uiVersion: 'nhl26',
        decoderVersion: 'test-scramble-v1',
        captureBatchId: batch.id,
      })
      .returning({ id: ocrSegments.id })
    assert.ok(s)
    return s.id
  }
  const settledSegId = await seg('seg-settled')
  const transitionSegId = await seg('seg-transition')

  return { matchId, extractionId: extraction.id, settledSegId, transitionSegId }
}

type FieldFamily = 'open_text' | 'closed_vocab' | 'tabular_numeric' | 'icon' | 'geometry'

async function seedEvidence(args: {
  matchId: number
  segmentId: number
  slotKey: string
  fieldKey: string
  fieldFamily: FieldFamily
  candidateValue: unknown
  cal: string
}): Promise<void> {
  await db.insert(ocrFieldEvidence).values({
    matchId: args.matchId,
    segmentId: args.segmentId,
    screenState: 'pre_game_lobby_state_2',
    subjectSlotKey: args.slotKey,
    fieldKey: args.fieldKey,
    fieldFamily: args.fieldFamily,
    candidateValue: args.candidateValue,
    candidateRank: 0,
    rawConfidence: args.cal,
    calibratedConfidence: args.cal,
    supportFrameIds: [],
    extractorFamily: args.fieldFamily,
    extractorVersion: `${SENTINEL_TAG}-v1`,
    observabilityStatus: 'observable',
    normalizationStatus: 'normalized',
  })
}

/**
 * Seed one lobby slot within one segment: gamertag + position (hard fields)
 * plus optional number/persona/captain soft fields.
 */
async function seedSlot(
  fx: Fixture,
  segmentId: number,
  slotKey: string,
  position: string,
  gamertag: string,
  gtCal: string,
  soft: { number?: number; persona?: string; captain?: boolean; softCal?: string } = {},
): Promise<void> {
  const softCal = soft.softCal ?? '0.99'
  await seedEvidence({
    matchId: fx.matchId,
    segmentId,
    slotKey,
    fieldKey: 'gamertag',
    fieldFamily: 'open_text',
    candidateValue: gamertag,
    cal: gtCal,
  })
  await seedEvidence({
    matchId: fx.matchId,
    segmentId,
    slotKey,
    fieldKey: 'position',
    fieldFamily: 'closed_vocab',
    candidateValue: position,
    cal: '0.99',
  })
  if (soft.number !== undefined) {
    await seedEvidence({
      matchId: fx.matchId,
      segmentId,
      slotKey,
      fieldKey: 'player_number',
      fieldFamily: 'tabular_numeric',
      candidateValue: soft.number,
      cal: softCal,
    })
  }
  if (soft.persona !== undefined) {
    await seedEvidence({
      matchId: fx.matchId,
      segmentId,
      slotKey,
      fieldKey: 'player_name_persona',
      fieldFamily: 'open_text',
      candidateValue: soft.persona,
      cal: softCal,
    })
  }
  if (soft.captain !== undefined) {
    await seedEvidence({
      matchId: fx.matchId,
      segmentId,
      slotKey,
      fieldKey: 'is_captain',
      fieldFamily: 'icon',
      candidateValue: soft.captain,
      cal: soft.captain ? '1.0' : '0.0',
    })
  }
}

async function snapshotBySlot(
  matchId: number,
): Promise<Map<string, typeof playerLoadoutSnapshots.$inferSelect>> {
  const rows = await db
    .select()
    .from(playerLoadoutSnapshots)
    .where(eq(playerLoadoutSnapshots.matchId, matchId))
  const bySlot = new Map<string, (typeof rows)[number]>()
  for (const r of rows) bySlot.set(r.subjectSlotKey ?? '__none__', r)
  return bySlot
}

void test('settled-segment preference: transition-frame gamertag never out-scores the settled roster', async () => {
  if (!process.env['DATABASE_URL']) return
  const fx = await setupMatch('0001')
  const S = fx.settledSegId
  const T = fx.transitionSegId

  // ── SETTLED segment: distinct rosters (no cross-team gamertag collisions) ──
  await seedSlot(fx, S, 'lobby_for_C', 'C', 'MrHomiecide', '0.98', {
    number: 11,
    persona: 'Evgeni Wanhg',
    captain: true,
  })
  await seedSlot(fx, S, 'lobby_for_LW', 'LW', 'StickMenace', '0.9547') // gamertag ONLY
  await seedSlot(fx, S, 'lobby_for_LD', 'LD', 'HenryTheBobJr', '0.98')
  await seedSlot(fx, S, 'lobby_against_C', 'C', 'XZ4RKY', '0.95', {
    number: 19,
    persona: 'Toews',
    captain: true,
  })
  await seedSlot(fx, S, 'lobby_against_LW', 'LW', 'Duh Pope', '0.93') // gamertag ONLY (spaced)
  await seedSlot(fx, S, 'lobby_against_LD', 'LD', 'MuttButt', '0.99', {
    number: 23,
    persona: 'P.Magroyne',
  })

  // ── TRANSITION segment: rosters mid-slide → same tag on BOTH panels ────────
  //   for_C≡against_C=MrHomiecide, for_LW≡against_LW=DuhPope,
  //   for_LD≡against_LD=HenryTheBobJr (3 cross-team collisions).
  //   The bled soft fields land in whatever slot the sliding player passes.
  await seedSlot(fx, T, 'lobby_for_C', 'C', 'MrHomiecide', '0.94')
  await seedSlot(fx, T, 'lobby_for_LW', 'LW', 'DuhPope', '0.9571', {
    number: 95, // <- DuhPope's number, bled into for_LW
    persona: 'Whoosah',
    captain: true, // <- historical for_LW false positive
  })
  await seedSlot(fx, T, 'lobby_for_LD', 'LD', 'HenryTheBobJr', '0.98')
  await seedSlot(fx, T, 'lobby_against_C', 'C', 'MrHomiecide', '0.986', {
    number: 11, // <- MrHomiecide's number, bled into against_C
    persona: 'E.Wanhg',
  })
  await seedSlot(fx, T, 'lobby_against_LW', 'LW', 'DuhPope', '0.9836', {
    number: 95, // <- DuhPope's OWN number: coherent here (gamertag matches settled)
    persona: 'Whoosah',
    softCal: '0.95',
  })
  await seedSlot(fx, T, 'lobby_against_LD', 'LD', 'HenryTheBobJr', '0.9946', {
    number: 7, // <- HenryTheBobJr's number, bled into against_LD (out-scores settled)
    persona: 'H.Jenkins',
    softCal: '0.9946',
  })

  const result = await promoteLobbyFromEvidence({ matchId: fx.matchId })
  assert.equal(result.blockedSnapshotCount, 0, 'no slot should hard-block')

  const snap = await snapshotBySlot(fx.matchId)

  // (1) for_LW: settled gamertag wins despite lower confidence; the bled
  //     number/persona/captain from the transition frame are DROPPED.
  const forLW = snap.get('lobby_for_LW')
  assert.ok(forLW, 'for_LW snapshot exists')
  assert.equal(forLW.gamertagSnapshot, 'StickMenace', 'for_LW keeps the settled gamertag')
  assert.equal(forLW.playerNumber, null, 'for_LW must NOT inherit DuhPope #95')
  assert.equal(forLW.playerNamePersonaRaw, null, 'for_LW must NOT inherit DuhPope persona')
  assert.notEqual(forLW.isCaptain, true, 'for_LW captain false-positive dropped')

  // (2) against_LW: keeps the transition frame's OWN coherent read (its
  //     gamertag matches the settled anchor), so #95/Whoosah survive.
  const againstLW = snap.get('lobby_against_LW')
  assert.ok(againstLW, 'against_LW snapshot exists')
  assert.equal(againstLW.gamertagSnapshot, 'Duh Pope', 'against_LW keeps settled gamertag')
  assert.equal(againstLW.playerNumber, 95, 'against_LW keeps its own coherent #95')
  assert.equal(againstLW.playerNamePersonaRaw, 'Whoosah', 'against_LW keeps its own persona')

  // (3) against_LD: the bled H.Jenkins/#7 out-scored the settled read pre-fix;
  //     now the settled MuttButt/P.Magroyne/#23 wins.
  const againstLD = snap.get('lobby_against_LD')
  assert.ok(againstLD, 'against_LD snapshot exists')
  assert.equal(againstLD.gamertagSnapshot, 'MuttButt', 'against_LD gamertag')
  assert.equal(againstLD.playerNumber, 23, 'against_LD keeps settled #23 (not bled #7)')
  assert.equal(againstLD.playerNamePersonaRaw, 'P.Magroyne', 'against_LD keeps Pat Magroyne')

  // (4) against_C: the settled XZ4RKY/Toews/#19 survives the MrHomiecide bleed.
  const againstC = snap.get('lobby_against_C')
  assert.ok(againstC, 'against_C snapshot exists')
  assert.equal(againstC.gamertagSnapshot, 'XZ4RKY', 'against_C gamertag')
  assert.equal(againstC.playerNumber, 19, 'against_C keeps settled #19 (not bled #11)')
  assert.equal(againstC.playerNamePersonaRaw, 'Toews', 'against_C keeps Toews (not bled E.Wanhg)')

  // (5) for_C: settled roster read carries through unchanged.
  const forC = snap.get('lobby_for_C')
  assert.ok(forC, 'for_C snapshot exists')
  assert.equal(forC.gamertagSnapshot, 'MrHomiecide')
  assert.equal(forC.playerNumber, 11)
  assert.equal(forC.playerNamePersonaRaw, 'Evgeni Wanhg')
})

void test('single-segment lobby is unaffected (coherence + settled logic is a no-op)', async () => {
  if (!process.env['DATABASE_URL']) return
  const fx = await setupMatch('0002')
  const S = fx.settledSegId

  await seedSlot(fx, S, 'lobby_for_C', 'C', 'MrHomiecide', '0.98', {
    number: 11,
    persona: 'Evgeni Wanhg',
  })
  await seedSlot(fx, S, 'lobby_for_LW', 'LW', 'StickMenace', '0.95', {
    number: 96,
    persona: 'Mikko Rantanen',
  })

  const result = await promoteLobbyFromEvidence({ matchId: fx.matchId })
  assert.equal(result.blockedSnapshotCount, 0)

  const snap = await snapshotBySlot(fx.matchId)
  const forLW = snap.get('lobby_for_LW')
  assert.ok(forLW)
  assert.equal(forLW.gamertagSnapshot, 'StickMenace')
  assert.equal(forLW.playerNumber, 96, 'single-segment: number promotes as before')
  assert.equal(forLW.playerNamePersonaRaw, 'Mikko Rantanen', 'single-segment: persona as before')
})
