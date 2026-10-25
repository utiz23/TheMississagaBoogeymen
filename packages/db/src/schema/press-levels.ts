// Leaf file: no imports, so the client-safe news module can use it without any ORM code.

/** How much the news desk may write about a player. Default 'full' (migration 0071). */
export const PRESS_LEVELS = ['full', 'easy', 'out'] as const
export type PressLevel = (typeof PRESS_LEVELS)[number]
