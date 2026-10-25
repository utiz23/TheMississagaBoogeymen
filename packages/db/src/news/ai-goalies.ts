/**
 * The worker's two AI goalies by their in-game names (spec §12.8; players.ai_goalie_side
 * 'home' = Matteo Lehmann, 'away' = Jonas Wagner). Not people: never in `people`,
 * no press level, no pile-on limit. The fact check allows both names whenever a
 * game of the sheet had an AI goalie in net (C2.12), also when the game has no
 * AI goalie line (an ended-early game).
 */
export const AI_GOALIE_NAMES = ['Matteo Lehmann', 'Jonas Wagner'] as const
