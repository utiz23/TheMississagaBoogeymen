/**
 * Generic player silhouette, used where a player has no photo (match lineups,
 * the per-match action tracker). Kept at this path when the old roster card
 * was replaced by components/cards/player-card.tsx (spec Part 2).
 */
export function PlayerSilhouette({
  className = '',
  sizeClass = 'h-[110px] w-[110px]',
}: {
  className?: string
  sizeClass?: string
}) {
  return (
    <svg
      viewBox="0 0 100 110"
      fill="currentColor"
      className={`${sizeClass} ${className}`}
      aria-hidden
    >
      <circle cx="50" cy="32" r="21" />
      <path d="M 8 110 Q 8 66 50 66 Q 92 66 92 110 Z" />
    </svg>
  )
}
