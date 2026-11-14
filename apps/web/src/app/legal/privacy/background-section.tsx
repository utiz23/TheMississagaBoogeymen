import type { LegalPageSection } from '@/components/legal/legal-page'
import { P } from '@/components/legal/legal-prose'

/**
 * PROPOSED privacy sentence for player background notes (task background-b2, 2026-11-14).
 * The exact wording is the operator's to approve before merge. It is added as its own last
 * section so no other legal text changes. The privacy text is otherwise a verbatim transcription
 * of `docs/planning/privacy-policy-draft.md`: when the wording is approved, the source draft must
 * get the same section (the fidelity check in `test/legal-http.test.ts` compares the two).
 */
export const BACKGROUND_PRIVACY_SENTENCE =
  'Answers to background questions may be kept as short notes about your hockey history and your teammates; an admin checks them before the reporters use them, and you can ask to have them removed.'

/** The section, numbered after the last existing one. */
export function backgroundSection(lastNumber: number): LegalPageSection {
  return {
    number: lastNumber + 1,
    heading: 'Background notes',
    body: <P>{BACKGROUND_PRIVACY_SENTENCE}</P>,
  }
}
