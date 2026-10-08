/**
 * Storm strike timing (PlayerCard.dc.html stormLoop): rain for 6–16 s, then a
 * strike for 1–2 s. The first wait is shorter (1.5–4 s) so a card that only
 * starts animating on hover can still strike while it is hovered.
 */
export function nextStrikeDelay(
  state: { striking: boolean; first: boolean },
  random: () => number = Math.random,
): number {
  if (state.striking) return 1000 + random() * 1000
  if (state.first) return 1500 + random() * 2500
  return 6000 + random() * 10000
}
