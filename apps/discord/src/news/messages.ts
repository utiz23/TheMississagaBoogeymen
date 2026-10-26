import { REPORTERS, type Reporter } from '@eanhl/db/news'
import type { NewsItemRow } from '@eanhl/db/queries'
import { talkButton, type BotMessage } from '../bot-rest.ts'
import { escapeMarkdown } from '../message.ts'

export interface NewsWebhookPayload {
  username: string
  avatar_url: string
  content: string
  allowed_mentions: { parse: never[] }
}

function base(reporter: Reporter, siteUrl: string, content: string): NewsWebhookPayload {
  return {
    username: reporter.name,
    avatar_url: `${siteUrl.replace(/\/+$/, '')}/news/avatar/${reporter.id}`,
    content,
    allowed_mentions: { parse: [] },
  }
}

/** A short post. A reply is a normal message that starts with `↪ to <Name>: ` (webhooks cannot reply). */
export function buildNewsPostPayload(args: {
  reporter: Reporter
  text: string
  replyToName: string | null
  siteUrl: string
}): NewsWebhookPayload {
  const prefix = args.replyToName === null ? '' : `↪ to ${escapeMarkdown(args.replyToName)}: `
  return base(args.reporter, args.siteUrl, `${prefix}${escapeMarkdown(args.text)}`)
}

/** The Discord notice for an article: headline, one-line summary, link to the full piece. */
export function buildArticlePayload(args: {
  reporter: Reporter
  headline: string
  dek: string
  url: string
  siteUrl: string
}): NewsWebhookPayload {
  const content = `**${escapeMarkdown(args.headline)}**\n${escapeMarkdown(args.dek)}\n${args.url}`
  return base(args.reporter, args.siteUrl, content)
}

/**
 * The payload of a stored item: an article notice, or a post (a reply starts
 * with `↪ to <replyToName>: `; null sends it without the prefix). The news
 * cycle and the press trial mirror share it.
 */
export function payloadForItem(
  item: NewsItemRow,
  siteUrl: string,
  replyToName: string | null,
): NewsWebhookPayload {
  const reporter = REPORTERS[item.reporter]
  if (item.kind === 'article') {
    return buildArticlePayload({
      reporter,
      headline: item.headline ?? '',
      dek: item.dek ?? '',
      url: `${siteUrl}/news/${item.slug ?? ''}`,
      siteUrl,
    })
  }
  return buildNewsPostPayload({ reporter, text: item.body, replyToName, siteUrl })
}

/**
 * The same post sent as the reporter's bot (PRESS_MODE=live). The bot has its
 * own name and avatar, so only the content and the no-mentions rule carry over.
 * `talkItemId` set (a game recap only) adds the "Talk to the press" button.
 */
export function toBotMessage(payload: NewsWebhookPayload, talkItemId: number | null): BotMessage {
  const msg: BotMessage = { content: payload.content, allowed_mentions: payload.allowed_mentions }
  if (talkItemId !== null) msg.components = [{ type: 1, components: [talkButton(talkItemId)] }]
  return msg
}

/** `<key>-<lowercase words joined by ->`, ASCII only, at most 80 characters. */
export function articleSlug(key: string, headline: string): string {
  const words = headline
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  const slug = words === '' ? key : `${key}-${words}`
  return slug.slice(0, 80).replace(/-+$/, '')
}
