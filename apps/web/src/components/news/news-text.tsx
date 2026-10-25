import { PlayerLink } from '@/components/ui/player-link'
import { splitMentions, type MentionRef } from '@/lib/news/mentions'

/**
 * Text with the players it names turned into links. Members link to their
 * page, guests stay plain text (PlayerLink checks the surrounding
 * `MemberLinks`). Works in server and client components.
 */
export function NewsText({
  text,
  mentions,
  linkClassName = 'text-fg-1 underline decoration-fg-6 underline-offset-2 hover:decoration-accent',
}: {
  text: string
  mentions: readonly MentionRef[]
  linkClassName?: string
}) {
  return (
    <>
      {splitMentions(text, mentions).map((part, i) =>
        'playerId' in part ? (
          <PlayerLink key={i} playerId={part.playerId} className={linkClassName}>
            {part.text}
          </PlayerLink>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  )
}
