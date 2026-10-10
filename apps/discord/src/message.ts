import type { DiscordGameResult, DiscordResult, DiscordStar } from '@eanhl/db/discord'

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
  if (opts.hasImage) embed.image = { url: `attachment://${CARDS_FILENAME}` }
  const payload: WebhookPayload = { allowed_mentions: { parse: [] }, embeds: [embed] }
  if (opts.hasImage) payload.attachments = [{ id: 0, filename: CARDS_FILENAME }]
  return payload
}
