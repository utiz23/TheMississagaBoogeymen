/**
 * Mythic awards (admin tools C2) — integration on a with-test-db clone.
 *
 * Award → T6 'manual' + mythic_awarded event; re-award swaps the theme;
 * clear → back to the stats standing + mythic_cleared event; clearing again
 * is a no-op (null). Uses a synthetic card title (release_order far above any
 * real one) and a synthetic player, both removed in `finally`.
 */
import test, { after } from 'node:test'
import assert from 'node:assert/strict'

const SLUG = 'mythic-inttest'
const GAMERTAG = 'mythic-inttest-player'

after(async () => {
  if (process.env['DATABASE_URL']) {
    const { sql } = await import('@eanhl/db')
    await sql.end({ timeout: 1 }).catch(() => undefined)
  }
})

void test('award, re-award, clear and clear-again on one season card', async (t) => {
  if (!process.env['DATABASE_URL']) {
    t.skip('DATABASE_URL not set — card-mythics integration requires DB.')
    return
  }
  const { db, players, gameTitles, playerCardProgress, playerCardEvents } =
    await import('@eanhl/db')
  const { awardMythic, clearMythic, listMythicCards, loadCardTitles } =
    await import('@eanhl/db/queries')
  const { and, eq } = await import('drizzle-orm')

  const cleanup = async () => {
    const [p] = await db.select().from(players).where(eq(players.gamertag, GAMERTAG))
    const [g] = await db.select().from(gameTitles).where(eq(gameTitles.slug, SLUG))
    if (p) {
      await db.delete(playerCardEvents).where(eq(playerCardEvents.playerId, p.id))
      await db.delete(playerCardProgress).where(eq(playerCardProgress.playerId, p.id))
      await db.delete(players).where(eq(players.id, p.id))
    }
    if (g) await db.delete(gameTitles).where(eq(gameTitles.id, g.id))
  }
  await cleanup()
  try {
    const [title] = await db
      .insert(gameTitles)
      .values({
        slug: SLUG,
        name: 'Mythic Inttest',
        eaPlatform: 'common-gen5',
        eaClubId: '0',
        apiBaseUrl: 'https://example.invalid',
        releaseOrder: 9999,
      })
      .returning()
    const [player] = await db.insert(players).values({ gamertag: GAMERTAG }).returning()
    assert.ok(title && player)
    assert.ok(
      (await loadCardTitles()).some((c) => c.id === title.id),
      'a card title',
    )

    const card = async () =>
      (
        await db
          .select()
          .from(playerCardProgress)
          .where(
            and(
              eq(playerCardProgress.playerId, player.id),
              eq(playerCardProgress.gameTitleId, title.id),
            ),
          )
      )[0]
    const events = async () =>
      (
        await db.select().from(playerCardEvents).where(eq(playerCardEvents.playerId, player.id))
      ).map((e) => `${e.kind}:${String(e.fromValue)}->${String(e.toValue)}`)

    assert.deepEqual(
      await awardMythic({ playerId: player.id, gameTitleId: title.id, theme: 'inferno' }),
      {
        fromTier: 1,
      },
    )
    let c = await card()
    assert.deepEqual([c?.tier, c?.level, c?.tierPool, c?.mythicTheme], [6, 10, 'manual', 'inferno'])
    assert.ok(
      (await listMythicCards()).some((m) => m.playerId === player.id && m.theme === 'inferno'),
    )

    await awardMythic({ playerId: player.id, gameTitleId: title.id, theme: 'frozen' })
    assert.equal((await card())?.mythicTheme, 'frozen', 're-award swaps the theme')

    const cleared = await clearMythic({ playerId: player.id, gameTitleId: title.id })
    assert.deepEqual(cleared, { toTier: 1 }, 'no stats: back to T1')
    c = await card()
    assert.deepEqual([c?.tier, c?.tierPool, c?.mythicTheme], [1, 'skater', null])
    assert.equal(await clearMythic({ playerId: player.id, gameTitleId: title.id }), null)

    assert.deepEqual((await events()).sort(), [
      'mythic_awarded:1->6',
      'mythic_awarded:6->6',
      'mythic_cleared:6->1',
    ])
  } finally {
    await cleanup()
  }
})
