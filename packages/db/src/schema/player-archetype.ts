/**
 * Stylistic archetype tags assigned to skaters.
 *
 * 11 archetypes split across forwards (6) and defensemen (5). Mirrors the
 * `components-archetype-pills.html` design bundle. Goalies have no archetype.
 */
export const PLAYER_ARCHETYPES = [
  'playmaker',
  'sniper',
  'power-forward',
  'grinder',
  'two-way-fwd',
  'enforcer',
  'defensive-d',
  'offensive-d',
  'two-way-d',
  'enforcer-d',
  'puckmover',
] as const

export type PlayerArchetype = (typeof PLAYER_ARCHETYPES)[number]

export const FORWARD_ARCHETYPES: readonly PlayerArchetype[] = [
  'playmaker',
  'sniper',
  'power-forward',
  'grinder',
  'two-way-fwd',
  'enforcer',
]

export const DEFENSE_ARCHETYPES: readonly PlayerArchetype[] = [
  'defensive-d',
  'offensive-d',
  'two-way-d',
  'enforcer-d',
  'puckmover',
]
