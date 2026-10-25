import type {
  DiscordGameResult,
  DiscordUnlock,
  DiscordResult,
  DiscordStar,
} from '@eanhl/db/discord'

export const CARDS_FILENAME = 'cards.png'

export interface WebhookEmbed {
  title: string
  url: string
  color: number
  description: string
  image?: { url: string }
}

export interface WebhookPayload {
  /** Always empty: a gamertag like "@everyone" must never ping anyone. */
  allowed_mentions: { parse: never[] }
  embeds: WebhookEmbed[]
  attachments?: { id: number; filename: string }[]
}

/** Mirrors apps/web/src/lib/result-colors.ts. */
const COLORS: Record<DiscordResult, number> = {
  WIN: 0x10b981,
  LOSS: 0xe84131,
  OTL: 0xf59e0b,
  DNF: 0x3a3839,
}

const ORDINALS = ['1st', '2nd', '3rd']

export function resultLabel(result: DiscordResult, overtime: boolean): string {
  switch (result) {
    case 'WIN':
      return overtime ? 'WIN (OT)' : 'WIN'
    case 'LOSS':
      return 'LOSS'
    case 'OTL':
      return 'OT LOSS'
    case 'DNF':
      return 'DNF'
  }
}

/** Backslash-escape every character Discord markdown treats as syntax. */
export function escapeMarkdown(text: string): string {
  return text.replace(/[\\*_~`|<>[\]()#:-]/g, '\\$&')
}

function starLine(s: DiscordStar, siteUrl: string): string {
  const ordinal = ORDINALS[s.rank - 1] ?? `${String(s.rank)}th`
  const name =
    s.kind === 'member' && s.playerId !== null
      ? `[${escapeMarkdown(s.gamertag)}](${siteUrl}/roster/${String(s.playerId)})`
      : s.kind === 'opponent' && s.teamAbbrev !== null
        ? `${escapeMarkdown(s.gamertag)} (${escapeMarkdown(s.teamAbbrev)})`
        : escapeMarkdown(s.gamertag)
  const parts = [`⭐ **${ordinal}**`, name, `**${s.score.toFixed(2)}**`]
  if (s.statLine !== '') parts.push(escapeMarkdown(s.statLine))
  return parts.join(' · ')
}

export function buildGameResultPayload(
  r: DiscordGameResult,
  opts: { siteUrl: string; hasImage: boolean },
): WebhookPayload {
  const gameUrl = `${opts.siteUrl}/games/${String(r.matchId)}`
  const unix = Math.floor(Date.parse(r.playedAt) / 1000)
  const meta = [r.gameTitleName, r.gameMode, `<t:${String(unix)}:f>`]
    .filter((x): x is string => x !== null && x !== '')
    .join(' · ')
  const body =
    r.result === 'DNF' ? ['Game ended early.'] : r.stars.map((s) => starLine(s, opts.siteUrl))
  const description = [meta, '', ...body, '', `[Full box score →](${gameUrl})`].join('\n')
  const title =
    `BGM ${String(r.scoreFor)} – ${String(r.scoreAgainst)} ${r.opponentName} · ${resultLabel(r.result, r.overtime)}`.slice(
      0,
      256,
    )

  const embed: WebhookEmbed = { title, url: gameUrl, color: COLORS[r.result], description }
  const payload: WebhookPayload = { allowed_mentions: { parse: [] }, embeds: [embed] }
  // A plain attachment, not embed.image: Discord shows it under the box, larger.
  if (opts.hasImage) payload.attachments = [{ id: 0, filename: CARDS_FILENAME }]
  return payload
}

/** A plain Discord message (no embed): text plus an attached graphic. */
export interface MessagePayload {
  /** `users` lists the one player a new-card post may ping; nothing else ever pings. */
  allowed_mentions: { parse: never[]; users?: string[] }
  content: string
  attachments?: { id: number; filename: string }[]
}

export const UNLOCK_FILENAME = 'unlock.png'

/**
 * One unlock: "**[NAME](<url>)** has unlocked **…**!" — markdown text, the
 * graphic attached under it. The <url> form stops Discord adding a link preview.
 */
export function buildUnlockPayload(
  u: DiscordUnlock,
  opts: { siteUrl: string; hasImage: boolean },
): MessagePayload {
  // Only a new card (tier, mythic) pings, and only the player it is about.
  const pingId = u.kind === 'tier' || u.kind === 'mythic' ? u.discordUserId : null
  const who = `**[${escapeMarkdown(u.name)}](<${opts.siteUrl}/roster/${String(u.playerId)}>)**${pingId === null ? '' : ` <@${pingId}>`}`
  const what = escapeMarkdown(u.subject)
  const content =
    u.kind === 'badge'
      ? `${who} has unlocked **${what}**!`
      : u.kind === 'card_level'
        ? `${who} has reached **card level ${what}**!`
        : `${who} has unlocked the **${what}** card!`
  const payload: MessagePayload = {
    allowed_mentions: pingId === null ? { parse: [] } : { parse: [], users: [pingId] },
    content,
  }
  if (opts.hasImage) payload.attachments = [{ id: 0, filename: UNLOCK_FILENAME }]
  return payload
}
