import { REPORTERS, type NewsGameFacts, type NewsFactsResponse } from '@eanhl/db/news'
import type { NewNewsScrumPerson } from '@eanhl/db/queries'
import { talkButton } from '../bot-rest.ts'
import { escapeMarkdown } from '../message.ts'
import { benchPortOf, describe, memberName, personColumns, type BenchPerson } from './bench.ts'
import type { PressConfig } from './config.ts'
import type { Reply } from './interactions.ts'
import { type PressDeps } from './pass.ts'
import { PRESS_GM_PING_DELAY_MS, chooseScrumReporter, scrumCandidates } from './rules.ts'
import { TEST_SCRUM_BUZZ_VALUE, TEST_SCRUM_OPEN_MS } from './test-scrum-rules.ts'
import { testScrumStoreOf } from './test-scrum-store.ts'

/**
 * `/gm testscrum` (T8): a free test scrum in the bot test channel, for trying the scrum mechanics
 * (own threads, no Answer button, reporter replies, other people ignored, volunteers, the bench)
 * without waiting for a game and without spending credits. Pure over `PressDeps`; only the GM, only
 * in the guild.
 *
 * What it does: a reporter posts a made-up recap line marked "(test scrum)" in the TEST channel
 * (`PRESS_TEST_CHANNEL_ID`, also in live mode, never in the game channel) with the "Talk to the
 * press" button; a scrum on that message (`is_test`, marker `buzz_level = testscrum`) is open for 60
 * minutes, whatever the game's age; each named person is added like a GM request, and the timer pass
 * pings them. The scrum then runs with NO model call at all (see `test-scrum-rules.ts`).
 */

const TEXT = {
  outsideGuild: 'This command only works in the server.',
  gmOnly: 'Only the GM can do that.',
  noChannel: 'No test channel is set (PRESS_TEST_CHANNEL_ID). No test scrum made.',
  noStore: 'The test scrum is not available here. Nothing was made.',
  noGame: 'No game found for a test scrum.',
  failed: 'The test scrum could not be made. Nothing was posted.',
} as const

const say = (text: string): Reply => ({ kind: 'ephemeral', text })
const reason = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/** The most people one test scrum pings: the named players and the bench person. */
export const TEST_SCRUM_MAX_PEOPLE = 5

export interface TestScrumOptions {
  /** True when the command ran in the configured guild (a DM or another server: false). */
  inGuild: boolean
  /** A match id; null = the latest game. */
  game: number | null
  /** Discord user ids to ping (up to 4; none = the GM). */
  players: readonly string[]
  /** A Discord user to treat as watching from the call, or null. */
  bench: string | null
}

/** One person of the test scrum, ready to insert. */
interface Entry {
  userId: string
  playerId: number | null
  name: string
  bench: BenchPerson | null
}

/** The game: the match id asked for, else the newest game there is (any age). */
async function pickGame(
  deps: PressDeps,
  matchId: number | null,
): Promise<{ res: NewsFactsResponse; game: NewsGameFacts } | null> {
  let id = matchId
  if (id === null) {
    // `new Date(0)`: no age limit. The newest game of the night found, then its game sheet.
    const night = await deps.store.latestPressNight(new Date(0))
    if (night === null) return null
    const games = (await deps.fetchFacts('night', night)).facts.games
    const newest = [...games].sort(
      (a, b) => a.playedAt.localeCompare(b.playedAt) || a.matchId - b.matchId,
    )
    id = newest.at(-1)?.matchId ?? null
    if (id === null) return null
  }
  const res = await deps.fetchFacts('game', String(id))
  const game = res.facts.games.find((g) => g.matchId === id)
  return game === undefined ? null : { res, game }
}

/**
 * A person who did not play, for the bench path (T7 rules for the person: "Leave me out" never, a
 * bot never, the coach is "Coach <name>"). The voice call is NOT checked: a test has nobody in the
 * call. Null with the reason when the person cannot be asked.
 */
async function benchEntry(
  deps: PressDeps,
  config: PressConfig,
  userId: string,
): Promise<{ ok: true; person: BenchPerson } | { ok: false; why: string }> {
  const port = benchPortOf(deps)
  const member = port === undefined ? null : await port.member(userId)
  if (member?.bot === true) return { ok: false, why: 'is a bot' }
  const person = await describe(
    deps.store,
    config,
    await deps.store.listPressRoster(),
    userId,
    member,
  )
  if (person === null) {
    const known = await deps.store.getPlayerForDiscordUser(userId)
    return {
      ok: false,
      why:
        known === null
          ? 'cannot be found (no linked player, not on the server)'
          : 'is on Leave me out',
    }
  }
  return { ok: true, person }
}

/** `/gm testscrum [game] [player..player4] [bench]`. */
export async function onGmTestScrum(
  deps: PressDeps,
  config: PressConfig,
  userId: string,
  opts: TestScrumOptions,
): Promise<Reply> {
  const { store, discord, log } = deps
  if (!opts.inGuild) return say(TEXT.outsideGuild)
  if (userId !== config.gmUserId) return say(TEXT.gmOnly)
  const channelId = config.testChannelId
  if (channelId === undefined || channelId === '') return say(TEXT.noChannel)
  const ts = testScrumStoreOf(store)
  if (ts === null) return say(TEXT.noStore)

  let picked: Awaited<ReturnType<typeof pickGame>>
  try {
    picked = await pickGame(deps, opts.game)
  } catch (err: unknown) {
    log(`[press] test scrum: no game (${reason(err)})`)
    picked = null
  }
  if (picked === null) {
    return say(opts.game === null ? TEXT.noGame : `No game ${String(opts.game)} found.`)
  }
  const { res, game } = picked

  // Who is asked. Named players who played the game take the player path; anyone else, and the
  // `bench` user (even one who played), take the bench path.
  const named = [...new Set(opts.players.length === 0 ? [config.gmUserId] : opts.players)].slice(
    0,
    4,
  )
  const ids = new Map<number, string>()
  for (const line of game.players) {
    const id = await store.getPlayerDiscordUserId(line.playerId)
    if (id !== null) ids.set(line.playerId, id)
  }
  const candidates = scrumCandidates(game, res.facts, ids)
  const entries: Entry[] = []
  const refused: string[] = []
  const plan: { userId: string; forceBench: boolean }[] = [
    ...named.filter((u) => u !== opts.bench).map((u) => ({ userId: u, forceBench: false })),
    ...(opts.bench === null ? [] : [{ userId: opts.bench, forceBench: true }]),
  ]
  for (const p of plan) {
    const c = candidates.find((x) => x.discordUserId === p.userId)
    if (c !== undefined && !p.forceBench) {
      entries.push({ userId: p.userId, playerId: c.playerId, name: c.name, bench: null })
      continue
    }
    const b = await benchEntry(deps, config, p.userId)
    if (!b.ok) {
      refused.push(`<@${p.userId}> ${b.why}`)
      continue
    }
    entries.push({
      userId: p.userId,
      playerId: b.person.playerId,
      name: b.person.name,
      bench: b.person,
    })
  }
  if (entries.length === 0) {
    return say(`No test scrum made: nobody can be asked (${refused.join('; ')}).`)
  }

  // The recap line: made up, marked, and only the final score from the game sheet.
  const now = deps.now()
  const reporter = chooseScrumReporter({
    heat: 'normal',
    seed: now.getTime(),
    disabled: await store.listDisabledReporters(),
    lastScrumReporter: null,
    takeReporters: [],
  })
  const body = `(test scrum) ${REPORTERS[reporter].name}: a made-up recap of a game that ended ${String(game.scoreFor)}-${String(game.scoreAgainst)}. This is a test: nothing here is real news. Talk to the press below.`

  let itemId: number
  try {
    itemId = await ts.insertTestRecapItem({ reporter, body })
  } catch (err: unknown) {
    log(`[press] test scrum: item not stored (${reason(err)})`)
    return say(TEXT.failed)
  }
  let messageId: string
  try {
    messageId = await discord.send(reporter, channelId, {
      content: body,
      allowed_mentions: { parse: [] },
      components: [{ type: 1, components: [talkButton(itemId)] }],
    })
  } catch (err: unknown) {
    log(`[press] test scrum: post failed (${reason(err)})`)
    await ts.deleteTestRecapItem(itemId).catch((e: unknown) => {
      log(`[press] test scrum: item ${String(itemId)} not removed (${reason(e)})`)
    })
    return say(TEXT.failed)
  }
  const scrumId = await store.insertScrum({
    matchId: game.matchId,
    night: game.night,
    recapItemId: itemId,
    channelId,
    messageId,
    reporter,
    heat: 'normal',
    buzzLevel: TEST_SCRUM_BUZZ_VALUE,
    // Open for an hour from now, whatever the game's age.
    openUntil: new Date(now.getTime() + TEST_SCRUM_OPEN_MS),
    isTest: true,
  })
  if (scrumId === null) {
    log(`[press] test scrum: scrum not stored for item ${String(itemId)}`)
    return say(TEXT.failed)
  }

  // Like a GM request, but made ready at once: the 60 s wait is for a GM who may correct a note.
  const created = new Date(now.getTime() - PRESS_GM_PING_DELAY_MS - 1000)
  const added: string[] = []
  for (const e of entries) {
    const values: NewNewsScrumPerson = {
      scrumId,
      playerId: e.playerId,
      discordUserId: e.userId,
      ...(e.bench === null ? {} : personColumns(e.bench)),
      role: 'picked',
      requestedBy: 'gm',
      requestedByUserId: userId,
      createdAt: created,
    }
    const personId = await store.insertScrumPerson(values)
    if (personId === null) refused.push(`<@${e.userId}> is already in the scrum`)
    else added.push(`${escapeMarkdown(e.name)}${e.bench === null ? '' : ` (${e.bench.role})`}`)
  }

  const lines = [
    `Test scrum made: ${REPORTERS[reporter].name} posted a made-up recap in <#${channelId}> (game ${String(game.matchId)}), open for 60 minutes.`,
    `Pinged in a moment, each in their own thread: ${added.length === 0 ? 'nobody' : added.join(', ')}.`,
    'The "Talk to the press" button works for players of that game. No AI is used, and nothing from it reaches a story.',
  ]
  if (refused.length > 0) lines.push(`Not added: ${refused.join('; ')}.`)
  return say(lines.join('\n'))
}
