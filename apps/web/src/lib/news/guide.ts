/** Where the "How to read the Press Room" page lives. */
export const GUIDE_PATH = '/news/guide'

/**
 * The link to the signed-in member's own player page (where EDIT PROFILE sets the
 * press level), or null when nobody is signed in. `paths` = `memberPaths()`.
 */
export function ownProfileHref(
  playerId: number | null,
  paths: ReadonlyMap<number, string> | null,
): string | null {
  if (playerId === null) return null
  return paths?.get(playerId) ?? `/roster/${String(playerId)}`
}

/** The guide's plain-language points, in order (Simplified Technical English). */
export const guideSteps: readonly string[] = [
  'The Press Room has nine reporters. They are made up. They do not exist.',
  'The scores, the stats and the dates come from the real games of the club.',
  'Each reporter has a voice. One is loud, one is calm, one loves numbers. They do not agree with each other. That is on purpose.',
  'Big games get more posts and sometimes an article. A normal night gets a few posts and one night article.',
  'Reporters can be harsh about a game. They write about hockey only.',
  'You decide how the reporters treat you. Sign in, open your player page and press EDIT PROFILE. Choose Press coverage: Full press, Go easy or Leave me out.',
]
