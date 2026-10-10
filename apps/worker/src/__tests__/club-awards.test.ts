/**
 * Trophy case (admin tools C3, migration 0066) — integration on a with-test-db
 * clone of eanhl_test (which carries 0066 and its seed).
 *
 * The seed holds the 11 awards that used to live in club-awards.ts; create →
 * update (incl. trophy → banner and player order) → delete round-trips; the
 * database refuses a stats trophy without a reason and a missing player.
 */
import test, { after } from 'node:test'
import assert from 'node:assert/strict'

after(async () => {
  if (process.env['DATABASE_URL']) {
    const { sql } = await import('@eanhl/db')
    await sql.end({ timeout: 1 }).catch(() => undefined)
  }
})

void test('seeded trophy case, create/update/delete, and DB-enforced shape', async (t) => {
  if (!process.env['DATABASE_URL']) {
    t.skip('DATABASE_URL not set — club-awards integration requires DB.')
    return
  }
  const { db, clubAwards, gameTitles } = await import('@eanhl/db')
  const { listClubAwards, createClubAward, updateClubAward, deleteClubAward } =
    await import('@eanhl/db/queries')
  const { eq } = await import('drizzle-orm')

  const seeded = await listClubAwards()
  assert.equal(seeded.length, 11, 'the 11 awards from club-awards.ts')
  assert.deepEqual(
    seeded.find((a) => a.kind === 'banner' && a.mode === '3s')?.playerIds,
    [2, 5, 3, 6],
    'banner players keep their order',
  )

  const [nhl25] = await db.select().from(gameTitles).where(eq(gameTitles.name, 'NHL 25'))
  assert.ok(nhl25)
  let id: number | null = null
  try {
    id = await createClubAward({
      kind: 'trophy',
      trophy: 'rookie',
      gameTitleId: nhl25.id,
      source: 'stats',
      reason: 'Test reason.',
      playerIds: [5, 2],
    })
    let row = (await listClubAwards()).find((a) => a.id === id)
    assert.ok(row && row.kind === 'trophy')
    assert.deepEqual(
      [row.trophy, row.source, row.reason, row.playerIds],
      ['rookie', 'stats', 'Test reason.', [5, 2]],
    )

    assert.equal(
      await updateClubAward(id, {
        kind: 'banner',
        mode: 'arcade',
        gameTitleId: nhl25.id,
        playerIds: [3, 1, 3],
      }),
      true,
    )
    row = (await listClubAwards()).find((a) => a.id === id)
    assert.ok(row && row.kind === 'banner')
    assert.deepEqual([row.mode, row.playerIds], ['arcade', [3, 1]])

    assert.equal(
      await updateClubAward(999_999, {
        kind: 'banner',
        mode: '3s',
        gameTitleId: nhl25.id,
        playerIds: [1],
      }),
      false,
    )

    await assert.rejects(
      db
        .insert(clubAwards)
        .values({ kind: 'trophy', trophy: 'mvp', gameTitleId: nhl25.id, source: 'stats' }),
      'a stats trophy needs a reason',
    )
    await assert.rejects(
      createClubAward({
        kind: 'banner',
        mode: '3s',
        gameTitleId: nhl25.id,
        playerIds: [987_654_321],
      }),
      'a missing player is refused by the foreign key',
    )
  } finally {
    if (id !== null) await deleteClubAward(id)
  }
  assert.equal((await listClubAwards()).length, 11, 'delete removes it (players cascade)')
})
