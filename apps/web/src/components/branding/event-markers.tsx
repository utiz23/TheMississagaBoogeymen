type Side = 'home' | 'away'

interface MarkerProps {
  side: Side
  /** Pixel size; the SVG scales to fit. Default 18. */
  size?: number
  className?: string
  /**
   * Optional override for the away-team accent color (e.g. extracted from
   * the opponent's crest). Falls back to the design-system AWAY navy.
   * Used when `side === 'away'`.
   */
  awayColor?: string | null
  /**
   * Optional override for the home-team accent color (extracted from this
   * match's broadcast). Falls back to the BGM brand red. Used when
   * `side === 'home'`.
   */
  homeColor?: string | null
}

const HOME_DEFAULT = '#ce202f'
const AWAY_DEFAULT = '#233f94'
function pickAway(awayColor?: string | null): string {
  return awayColor && awayColor.length > 0 ? awayColor : AWAY_DEFAULT
}
function pickHome(homeColor?: string | null): string {
  return homeColor && homeColor.length > 0 ? homeColor : HOME_DEFAULT
}
function pickColor(side: Side, homeColor?: string | null, awayColor?: string | null): string {
  return side === 'home' ? pickHome(homeColor) : pickAway(awayColor)
}

// Per-side palette for the three-layer marker (outer / inner / letter):
//
//   Home → WHITE outer · TEAM colour inner · WHITE letter
//   Away → TEAM colour outer · WHITE inner · BLACK letter
//
// Same three SVG paths, just different fills per side. Gives strong
// visual differentiation between the two teams while keeping the
// markers legible on the dark broadcast rink in either treatment.
function markerPalette(
  side: Side,
  homeColor?: string | null,
  awayColor?: string | null,
): { outer: string; inner: string; letter: string } {
  const team = pickColor(side, homeColor, awayColor)
  if (side === 'home') {
    return { outer: '#fff', inner: team, letter: '#fff' }
  }
  return { outer: team, inner: '#fff', letter: '#000' }
}

export function GoalMarker({ side, size = 18, className, awayColor, homeColor }: MarkerProps) {
  const { outer, inner, letter } = markerPalette(side, homeColor, awayColor)
  return (
    <svg
      viewBox="0 0 39.78 34.45"
      width={size}
      height={(size * 34.45) / 39.78}
      className={className}
      aria-hidden="true"
    >
      <polygon
        fill={outer}
        points="39.78 17.22 29.84 34.45 9.95 34.45 0 17.22 9.95 0 29.84 0 39.78 17.22"
      />
      <polygon
        fill={inner}
        points="36.34 17.22 28.12 31.47 11.67 31.47 3.44 17.22 11.67 2.98 28.12 2.98 36.34 17.22"
      />
      <path
        fill={letter}
        d="M21.06,19.77h-1.67l.64-3.28h5.19l-1.39,7.18c-.13,.67-.5,1.24-1.11,1.72-.6,.47-1.25,.7-1.96,.7h-5.18c-.71,0-1.27-.23-1.69-.7-.43-.47-.57-1.05-.44-1.72l2.5-12.89c.13-.67,.5-1.24,1.11-1.72,.6-.47,1.25-.7,1.96-.7h5.18c.71,0,1.27,.23,1.69,.7,.43,.48,.57,1.05,.44,1.72l-.69,3.56h-3.52l.52-2.7h-3.33l-2.17,11.17h3.33l.59-3.04h0Z"
      />
    </svg>
  )
}

export function ShotMarker({ side, size = 18, className, awayColor, homeColor }: MarkerProps) {
  const { outer, inner, letter } = markerPalette(side, homeColor, awayColor)
  return (
    <svg
      viewBox="0 0 36.56 36.56"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
    >
      <circle fill={inner} cx="18.28" cy="18.28" r="16.87" />
      <path
        fill={outer}
        d="M18.28,36.56C8.2,36.56,0,28.36,0,18.28S8.2,0,18.28,0s18.28,8.2,18.28,18.28-8.2,18.28-18.28,18.28Zm0-33.75C9.75,2.81,2.81,9.75,2.81,18.28s6.94,15.47,15.47,15.47,15.47-6.94,15.47-15.47S26.81,2.81,18.28,2.81Z"
      />
      <path
        fill={letter}
        d="M20.9,12.97h-3.17l-.52,2.66c-.14,.72,.32,1.08,1.37,1.08,1.38,0,2.47,.37,3.25,1.11,.83,.78,1.12,1.82,.87,3.1l-.67,3.48c-.13,.64-.48,1.18-1.07,1.62-.57,.45-1.18,.67-1.85,.67h-4.92c-.67,0-1.21-.22-1.61-.67s-.53-.99-.41-1.62l.66-3.4h3.34l-.5,2.58h3.17l.51-2.66c.14-.73-.32-1.09-1.37-1.09-1.38,0-2.45-.37-3.23-1.1-.84-.78-1.13-1.82-.88-3.1l.68-3.48c.12-.64,.47-1.18,1.05-1.64,.57-.44,1.19-.66,1.87-.66h4.92c.67,0,1.21,.22,1.6,.66,.4,.46,.55,1,.43,1.64l-.66,3.38h-3.35l.5-2.57h-.01Z"
      />
    </svg>
  )
}

export function HitMarker({ side, size = 18, className, awayColor, homeColor }: MarkerProps) {
  const { outer, inner, letter } = markerPalette(side, homeColor, awayColor)
  return (
    <svg
      viewBox="0 0 34.45 34.45"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
    >
      <rect fill={outer} width="34.45" height="34.45" />
      <rect fill={inner} x="3.11" y="3.11" width="28.23" height="28.23" />
      <path
        fill={letter}
        d="M15.24,18.87l-1.4,7.22h-3.52l3.45-17.73h3.52l-1.4,7.22h3.33l1.4-7.22h3.52l-3.45,17.73h-3.52l1.4-7.22h-3.33Z"
      />
    </svg>
  )
}

export function PenaltyMarker({ side, size = 18, className, awayColor, homeColor }: MarkerProps) {
  const { outer, inner, letter } = markerPalette(side, homeColor, awayColor)
  return (
    <svg
      viewBox="0 0 48.72 48.72"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
    >
      <rect
        fill={outer}
        x="7.13"
        y="7.13"
        width="34.45"
        height="34.45"
        transform="translate(-10.09 24.36) rotate(-45)"
      />
      <rect
        fill={inner}
        x="10.51"
        y="10.5"
        width="27.7"
        height="27.7"
        transform="translate(-10.09 24.36) rotate(-45)"
      />
      <path
        fill={letter}
        d="M21.12,15.49h7.78c.71,0,1.27,.23,1.69,.7,.43,.48,.57,1.05,.44,1.72l-.89,4.57c-.26,1.35-.99,2.44-2.18,3.26-1.12,.78-2.41,1.16-3.87,1.16h-1.67l-1.23,6.32h-3.52l3.45-17.73h0Zm2.88,3.28l-.94,4.85h1.67c1.11,0,1.74-.38,1.89-1.14l.72-3.71h-3.34Z"
      />
    </svg>
  )
}
