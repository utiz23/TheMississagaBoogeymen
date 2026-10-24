import type {
  DiscordCardUpdates,
  DiscordGameResult,
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

/** Discord rejects an embed description longer than 4096 characters (HTTP 400). */
const DESCRIPTION_LIMIT = 4096

/**
 * Whole lines while they fit, then "…and N more": a long batch (a new
 * season's first night) still posts instead of failing every retry.
 */
function fitLines(lines: string[], limit: number): string {
  const out: string[] = []
  let used = 0
  for (const [i, line] of lines.entries()) {
    const rest = lines.length - i - 1
    const tail = rest > 0 ? `\n…and ${String(rest + 1)} more` : ''
    const add = (out.length > 0 ? 1 : 0) + line.length
    if (used + add + (rest > 0 ? tail.length : 0) > limit) {
      out.push(`…and ${String(lines.length - i)} more`)
      return out.join('\n')
    }
    out.push(line)
    used += add
  }
  return out.join('\n')
}

/** One "Card updates" post: one linked line per player, the image under the box. */
export function buildCardUpdatesPayload(
  d: DiscordCardUpdates,
  opts: { siteUrl: string; hasImage: boolean },
): WebhookPayload {
  const lines = d.players.map(
    (p) =>
      `[${escapeMarkdown(p.name)}](${opts.siteUrl}/roster/${String(p.playerId)}) — ${p.changes.map(escapeMarkdown).join(' · ')}`,
  )
  const description = fitLines(lines, DESCRIPTION_LIMIT)
  const payload: WebhookPayload = {
    allowed_mentions: { parse: [] },
    embeds: [{ title: 'CARD UPDATES', url: opts.siteUrl, color: 0xe84131, description }],
  }
  if (opts.hasImage) payload.attachments = [{ id: 0, filename: CARDS_FILENAME }]
  return payload
}
