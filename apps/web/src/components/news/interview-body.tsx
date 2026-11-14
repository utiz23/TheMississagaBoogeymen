import { interviewParagraph } from '@eanhl/db/news'
import type { MentionRef } from '@/lib/news/mentions'
import { NewsText } from './news-text'

const LABEL = 'mr-2 font-condensed text-xs font-bold uppercase tracking-widest'

/**
 * A press interview's body: the intro as plain paragraphs, then each
 * question (bold, labelled with the reporter) and answer (labelled with the
 * player). The body stores them as `Q: ` / `A: ` paragraphs.
 */
export function InterviewBody({
  paragraphs,
  reporterName,
  playerName,
  mentions,
}: {
  paragraphs: readonly string[]
  reporterName: string
  playerName: string
  mentions: readonly MentionRef[]
}) {
  return (
    <>
      {paragraphs.map((raw, i) => {
        const p = interviewParagraph(raw)
        if (p.kind === 'question') {
          return (
            <p key={i} className="break-words pt-2 font-semibold leading-relaxed text-fg-1">
              <span className={`${LABEL} text-accent-readable`}>{reporterName}</span>
              {p.text}
            </p>
          )
        }
        if (p.kind === 'answer') {
          return (
            <p key={i} className="break-words leading-relaxed">
              <span className={`${LABEL} text-fg-3`}>{playerName}</span>
              <NewsText text={p.text} mentions={mentions} />
            </p>
          )
        }
        return (
          <p key={i} className="break-words leading-relaxed">
            <NewsText text={p.text} mentions={mentions} />
          </p>
        )
      })}
    </>
  )
}
