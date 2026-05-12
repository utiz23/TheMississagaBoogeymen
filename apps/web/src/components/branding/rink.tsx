interface RinkSvgProps {
  className?: string
}

/**
 * Full NHL-proportioned rink illustration. ViewBox is 2405×1025, with center
 * ice at (1202.5, 512.5). Hockey-standard coordinates can be mapped onto this
 * viewBox so event markers plot accurately:
 *
 *   svgX = (xHockey / 100) * 1100 + 1202.5   // ±100 → 102.5..2302.5
 *   svgY = -(yHockey / 42.5) * 467.5 + 512.5  // ±42.5 → 45..980
 *
 * (1100 horizontal half-width and 467.5 vertical half-height match the rink
 *  interior bounds, with the curved corner radius left as a small margin.)
 *
 * Styling: dark theme. Ice is `--color-surface-raised`, outlines are white,
 * the two blue lines render as actual blue and the centre line as red so the
 * rink reads correctly at a glance.
 */
export function RinkSvg({ className }: RinkSvgProps) {
  const ICE = '#1f1f22'
  const LINE = '#e4e4e7'
  const RED = '#ce202f'
  const BLUE = '#233f94'
  const DOT = '#ce202f'

  return (
    <svg
      viewBox="0 0 2405 1025"
      preserveAspectRatio="xMidYMid meet"
      className={className}
      aria-label="Hockey rink"
    >
      {/* Layer 1 — ice surface */}
      <rect
        x="2.5"
        y="2.5"
        width="2400"
        height="1020"
        rx="336"
        ry="336"
        fill={ICE}
        stroke={LINE}
        strokeWidth="5"
        strokeMiterlimit="10"
      />

      {/* Layer 2 — goal lines + centre line + blue lines */}
      <line
        x1="2270.5"
        y1="953.5"
        x2="2270.5"
        y2="71.49"
        stroke={RED}
        strokeWidth="2"
        strokeMiterlimit="10"
        fill="none"
      />
      <line
        x1="134.5"
        y1="953.5"
        x2="134.5"
        y2="71.49"
        stroke={RED}
        strokeWidth="2"
        strokeMiterlimit="10"
        fill="none"
      />
      <line
        x1="1202.5"
        y1="1022.5"
        x2="1202.5"
        y2="2.5"
        stroke={RED}
        strokeWidth="12"
        strokeMiterlimit="10"
        fill="none"
      />
      <line
        x1="902.5"
        y1="1022.5"
        x2="902.5"
        y2="2.5"
        stroke={BLUE}
        strokeWidth="12"
        strokeMiterlimit="10"
        fill="none"
      />
      <line
        x1="1502.5"
        y1="1022.5"
        x2="1502.5"
        y2="2.5"
        stroke={BLUE}
        strokeWidth="12"
        strokeMiterlimit="10"
        fill="none"
      />

      {/* Layer 3 — centre circle, neutral-zone faceoff dots, referee crease, end-zone faceoff circles */}
      <circle
        cx="1202.5"
        cy="512.5"
        r="180"
        fill="none"
        stroke={BLUE}
        strokeWidth="2"
        strokeMiterlimit="10"
      />
      <circle cx="962.5" cy="248.5" r="12" fill={DOT} />
      <circle cx="962.5" cy="770.15" r="12" fill={DOT} />
      <circle cx="1444.89" cy="248.5" r="12" fill={DOT} />
      <circle cx="1444.89" cy="770.15" r="12" fill={DOT} />
      <path
        d="M1142.5,1022.5c0-33.14,26.86-60,60-60s60,26.86,60,60"
        fill="none"
        stroke={RED}
        strokeWidth="2"
        strokeMiterlimit="10"
      />

      {/* Right offensive-zone faceoff circle (bottom) */}
      <g>
        <circle
          cx="2030.5"
          cy="785.17"
          r="180"
          fill="none"
          stroke={RED}
          strokeWidth="2"
          strokeMiterlimit="10"
        />
        <line x1="2065" y1="584.65" x2="2065" y2="608.48" stroke={RED} strokeWidth="4" />
        <line x1="1996" y1="584.65" x2="1996" y2="608.48" stroke={RED} strokeWidth="4" />
        <line x1="2065" y1="961.85" x2="2065" y2="985.85" stroke={RED} strokeWidth="4" />
        <line x1="1996" y1="961.87" x2="1996" y2="985.85" stroke={RED} strokeWidth="4" />
        <circle cx="2030.5" cy="785.17" r="12" fill={DOT} />
        <polyline
          points="2054.5 828.15 2054.5 792.15 2102.5 792.15"
          fill="none"
          stroke={RED}
          strokeWidth="2"
        />
        <polyline
          points="2006.5 828.15 2006.5 792.15 1958.5 792.15"
          fill="none"
          stroke={RED}
          strokeWidth="2"
        />
        <polyline
          points="2054.5 736.15 2054.5 772.15 2102.5 772.15"
          fill="none"
          stroke={RED}
          strokeWidth="2"
        />
        <polyline
          points="2006.5 736.15 2006.5 772.15 1958.5 772.15"
          fill="none"
          stroke={RED}
          strokeWidth="2"
        />
      </g>

      {/* Right offensive-zone faceoff circle (top) */}
      <g>
        <circle
          cx="2030.5"
          cy="248.5"
          r="180"
          fill="none"
          stroke={RED}
          strokeWidth="2"
          strokeMiterlimit="10"
        />
        <line x1="2065" y1="47.98" x2="2065" y2="71.8" stroke={RED} strokeWidth="4" />
        <line x1="1996" y1="47.98" x2="1996" y2="71.8" stroke={RED} strokeWidth="4" />
        <line x1="2065" y1="425.17" x2="2065" y2="449.17" stroke={RED} strokeWidth="4" />
        <line x1="1996" y1="425.2" x2="1996" y2="449.17" stroke={RED} strokeWidth="4" />
        <circle cx="2030.5" cy="248.5" r="12" fill={DOT} />
        <polyline
          points="2054.5 291.48 2054.5 255.48 2102.5 255.48"
          fill="none"
          stroke={RED}
          strokeWidth="2"
        />
        <polyline
          points="2006.5 291.48 2006.5 255.48 1958.5 255.48"
          fill="none"
          stroke={RED}
          strokeWidth="2"
        />
        <polyline
          points="2054.5 199.48 2054.5 235.48 2102.5 235.48"
          fill="none"
          stroke={RED}
          strokeWidth="2"
        />
        <polyline
          points="2006.5 199.48 2006.5 235.48 1958.5 235.48"
          fill="none"
          stroke={RED}
          strokeWidth="2"
        />
      </g>

      {/* Left defensive-zone faceoff circle (bottom) */}
      <g>
        <circle
          cx="374.5"
          cy="776.42"
          r="180"
          fill="none"
          stroke={RED}
          strokeWidth="2"
          strokeMiterlimit="10"
        />
        <line x1="409" y1="575.9" x2="409" y2="599.73" stroke={RED} strokeWidth="4" />
        <line x1="340" y1="575.9" x2="340" y2="599.73" stroke={RED} strokeWidth="4" />
        <line x1="409" y1="953.1" x2="409" y2="977.1" stroke={RED} strokeWidth="4" />
        <line x1="340" y1="953.12" x2="340" y2="977.1" stroke={RED} strokeWidth="4" />
        <circle cx="374.5" cy="776.42" r="12" fill={DOT} />
        <polyline
          points="398.5 819.4 398.5 783.4 446.5 783.4"
          fill="none"
          stroke={RED}
          strokeWidth="2"
        />
        <polyline
          points="350.5 819.4 350.5 783.4 302.5 783.4"
          fill="none"
          stroke={RED}
          strokeWidth="2"
        />
        <polyline
          points="398.5 727.4 398.5 763.4 446.5 763.4"
          fill="none"
          stroke={RED}
          strokeWidth="2"
        />
        <polyline
          points="350.5 727.4 350.5 763.4 302.5 763.4"
          fill="none"
          stroke={RED}
          strokeWidth="2"
        />
      </g>

      {/* Left defensive-zone faceoff circle (top) */}
      <g>
        <circle
          cx="374.5"
          cy="248.42"
          r="180"
          fill="none"
          stroke={RED}
          strokeWidth="2"
          strokeMiterlimit="10"
        />
        <line x1="409" y1="47.9" x2="409" y2="71.73" stroke={RED} strokeWidth="4" />
        <line x1="340" y1="47.9" x2="340" y2="71.73" stroke={RED} strokeWidth="4" />
        <line x1="409" y1="425.1" x2="409" y2="449.1" stroke={RED} strokeWidth="4" />
        <line x1="340" y1="425.12" x2="340" y2="449.1" stroke={RED} strokeWidth="4" />
        <circle cx="374.5" cy="248.42" r="12" fill={DOT} />
        <polyline
          points="398.5 291.4 398.5 255.4 446.5 255.4"
          fill="none"
          stroke={RED}
          strokeWidth="2"
        />
        <polyline
          points="350.5 291.4 350.5 255.4 302.5 255.4"
          fill="none"
          stroke={RED}
          strokeWidth="2"
        />
        <polyline
          points="398.5 199.4 398.5 235.4 446.5 235.4"
          fill="none"
          stroke={RED}
          strokeWidth="2"
        />
        <polyline
          points="350.5 199.4 350.5 235.4 302.5 235.4"
          fill="none"
          stroke={RED}
          strokeWidth="2"
        />
      </g>

      {/* Centre-ice dot */}
      <circle cx="1202.5" cy="512.5" r="6" fill={DOT} />

      {/* Layer 4 — goal nets */}
      <g>
        <polygon
          points="134.5 644.5 134.5 380.5 2.5 344.5 2.5 680.5 134.5 644.5"
          fill="none"
          stroke={LINE}
          strokeWidth="2"
          strokeMiterlimit="10"
        />
        <path
          d="M206.5,512.5c0,18.44-6.93,35.26-18.34,48h-53.66v-96h53.66c11.41,12.74,18.34,29.56,18.34,48Z"
          fill="none"
          stroke={LINE}
          strokeWidth="2"
          strokeMiterlimit="10"
        />
        <polyline
          points="134.5 560.5 182.5 560.5 182.5 554.37"
          fill="none"
          stroke={LINE}
          strokeWidth="2"
        />
        <polyline
          points="134.5 464.5 182.5 464.5 182.5 470.63"
          fill="none"
          stroke={LINE}
          strokeWidth="2"
        />
        <path
          d="M114.11,476.5h20v72h-20c-11.04,0-20-8.96-20-20v-32c0-11.04,8.96-20,20-20Z"
          fill="none"
          stroke={LINE}
          strokeWidth="2"
        />
      </g>

      <g>
        <polygon
          points="2270.5 644.5 2270.5 380.5 2402.5 344.5 2402.5 680.5 2270.5 644.5"
          fill="none"
          stroke={LINE}
          strokeWidth="2"
          strokeMiterlimit="10"
        />
        <path
          d="M2198.5,512.5c0,18.44,6.93,35.26,18.34,48h53.66v-96h-53.66c-11.41,12.74-18.34,29.56-18.34,48Z"
          fill="none"
          stroke={LINE}
          strokeWidth="2"
          strokeMiterlimit="10"
        />
        <polyline
          points="2270.5 560.5 2222.5 560.5 2222.5 554.37"
          fill="none"
          stroke={LINE}
          strokeWidth="2"
        />
        <polyline
          points="2270.5 464.5 2222.5 464.5 2222.5 470.63"
          fill="none"
          stroke={LINE}
          strokeWidth="2"
        />
        <path
          d="M2290.89,476.5h20v72h-20c-11.04,0-20-8.96-20-20v-32c0-11.04,8.96-20,20-20Z"
          fill="none"
          stroke={LINE}
          strokeWidth="2"
          transform="translate(4581.78 1025) rotate(180)"
        />
      </g>
    </svg>
  )
}
