/**
 * The interview article format (press interviews, migration 0074), shared by
 * the press service that writes it and the web app that shows it. An
 * interview is an ordinary `news_items` article: its slug starts with
 * `interview-` (that is the marker), and its body is the intro paragraphs,
 * then one `Q: ` paragraph and one `A: ` paragraph per question, joined by a
 * blank line like every article body. Plain text reads well on any surface
 * (the Discord teaser shows only the headline and dek).
 */

export const INTERVIEW_SLUG_PREFIX = 'interview-'
export const INTERVIEW_QUESTION_PREFIX = 'Q: '
export const INTERVIEW_ANSWER_PREFIX = 'A: '

/** The slug key of interview `id` (`articleSlug` adds the headline words). */
export function interviewSlugKey(id: number): string {
  return `${INTERVIEW_SLUG_PREFIX}${String(id)}`
}

/** True for an interview article's slug. */
export function isInterviewSlug(slug: string | null | undefined): boolean {
  return typeof slug === 'string' && slug.startsWith(INTERVIEW_SLUG_PREFIX)
}

export type InterviewParagraph =
  | { kind: 'intro'; text: string }
  | { kind: 'question'; text: string }
  | { kind: 'answer'; text: string }

/** The article body: intro paragraphs, then Q/A pairs, joined by blank lines. */
export function interviewBody(
  intro: readonly string[],
  qa: readonly { question: string; answer: string }[],
): string {
  const flat = (s: string) => s.replace(/\s*\n\s*/g, ' ').trim()
  return [
    ...intro.map(flat),
    ...qa.flatMap((p) => [
      `${INTERVIEW_QUESTION_PREFIX}${flat(p.question)}`,
      `${INTERVIEW_ANSWER_PREFIX}${flat(p.answer)}`,
    ]),
  ].join('\n\n')
}

/** One body paragraph as intro, question or answer (by its prefix). */
export function interviewParagraph(p: string): InterviewParagraph {
  if (p.startsWith(INTERVIEW_QUESTION_PREFIX)) {
    return { kind: 'question', text: p.slice(INTERVIEW_QUESTION_PREFIX.length).trim() }
  }
  if (p.startsWith(INTERVIEW_ANSWER_PREFIX)) {
    return { kind: 'answer', text: p.slice(INTERVIEW_ANSWER_PREFIX.length).trim() }
  }
  return { kind: 'intro', text: p }
}
