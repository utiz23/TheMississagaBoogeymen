import {
  EA_ICE_INDEX_TO_ZONE,
  EA_NET_INDEX_TO_ZONE,
  ICE_ZONE_SHAPES,
  NET_ZONE_SHAPES,
  RINK_FILL,
  RINK_OUTLINE,
  NEUTRAL_ZONE_LINE,
  GOAL_CREASE,
  GOAL_LINE,
  FACEOFF_LEFT,
  FACEOFF_RIGHT,
  FACEOFF_DOTS,
} from './shot-map-zones'
import type { IceZoneId, NetZoneId } from './shot-map-zones'
import { COLOR_PCT_INSUFFICIENT } from '@/lib/shot-map-colors'

interface IceMapSvgProps {
  /** Unique prefix to avoid SVG id collisions if multiple maps appear on one page. */
  idPrefix: string
  getZoneFill: (zoneId: IceZoneId, index: number) => string
  getZoneTooltip: (zoneId: IceZoneId, index: number) => string
}

export function IceMapSvg({ idPrefix, getZoneFill, getZoneTooltip }: IceMapSvgProps) {
  const hatchId = `${idPrefix}-hatch`
  const clipId = `${idPrefix}-rink-clip`

  return (
    <svg viewBox="0 0 841.2 750" className="w-full" aria-label="Ice shot map">
      <defs>
        <pattern
          id={hatchId}
          patternContentUnits="userSpaceOnUse"
          width="14"
          height="14"
          patternTransform="rotate(45)"
        >
          <rect width="14" height="14" fill={COLOR_PCT_INSUFFICIENT} />
          <line x1="0" y1="0" x2="0" y2="14" stroke="#27272a" strokeWidth="4" />
        </pattern>
        <clipPath id={clipId}>
          <path d={RINK_FILL} />
        </clipPath>
      </defs>

      <path d={RINK_FILL} fill="#18181b" />

      <g clipPath={`url(#${clipId})`}>
        {Object.entries(EA_ICE_INDEX_TO_ZONE).map(([idxStr, zoneId]) => {
          const i = Number(idxStr) - 1
          const shape = ICE_ZONE_SHAPES[zoneId]
          const fill = getZoneFill(zoneId, i)
          const fillForRender = fill === COLOR_PCT_INSUFFICIENT ? `url(#${hatchId})` : fill

          return (
            <path
              key={zoneId}
              d={shape.d}
              fill={fillForRender}
              fillOpacity={0.82}
              stroke="#0f0f11"
              strokeWidth="2"
              data-zone={zoneId}
            >
              <title>{`${zoneId}: ${getZoneTooltip(zoneId, i)}`}</title>
            </path>
          )
        })}
      </g>

      <path d={NEUTRAL_ZONE_LINE} fill="#4872a0" opacity={0.7} />
      <circle
        cx={FACEOFF_LEFT.cx}
        cy={FACEOFF_LEFT.cy}
        r={FACEOFF_LEFT.r}
        fill="none"
        stroke="#3f3f46"
        strokeWidth="3"
      />
      <circle
        cx={FACEOFF_RIGHT.cx}
        cy={FACEOFF_RIGHT.cy}
        r={FACEOFF_RIGHT.r}
        fill="none"
        stroke="#3f3f46"
        strokeWidth="3"
      />
      {FACEOFF_DOTS.map((dot) => (
        <circle
          key={`dot-${String(dot.cx)}-${String(dot.cy)}`}
          cx={dot.cx}
          cy={dot.cy}
          r={6}
          fill="#52525b"
        />
      ))}
      <path d={GOAL_CREASE} fill="none" stroke="#52525b" strokeWidth="3.5" />
      <path d={GOAL_LINE} fill="#7f1d1d" />
      <path d={RINK_OUTLINE} fill="none" stroke="#3f3f46" strokeWidth="6" />
    </svg>
  )
}

interface NetMapSvgProps {
  idPrefix: string
  getZoneFill: (zoneId: NetZoneId, index: number) => string
  getZoneTooltip: (zoneId: NetZoneId, index: number) => string
}

export function NetMapSvg({ idPrefix, getZoneFill, getZoneTooltip }: NetMapSvgProps) {
  const hatchId = `${idPrefix}-net-hatch`

  return (
    <svg viewBox="0 0 100 60" className="w-full" aria-label="Net shot map">
      <defs>
        <pattern
          id={hatchId}
          patternContentUnits="userSpaceOnUse"
          width="4"
          height="4"
          patternTransform="rotate(45)"
        >
          <rect width="4" height="4" fill={COLOR_PCT_INSUFFICIENT} />
          <line x1="0" y1="0" x2="0" y2="4" stroke="#3f3f46" strokeWidth="1" />
        </pattern>
      </defs>
      {Object.entries(EA_NET_INDEX_TO_ZONE).map(([idxStr, zoneId]) => {
        const i = Number(idxStr) - 1
        const shape = NET_ZONE_SHAPES[zoneId]
        const fill = getZoneFill(zoneId, i)
        const fillForRender = fill === COLOR_PCT_INSUFFICIENT ? `url(#${hatchId})` : fill

        return (
          <rect
            key={zoneId}
            x={shape.x}
            y={shape.y}
            width={shape.w}
            height={shape.h}
            fill={fillForRender}
            stroke="#c34353"
            strokeWidth="0.5"
            data-zone={zoneId}
          >
            <title>{`${zoneId}: ${getZoneTooltip(zoneId, i)}`}</title>
          </rect>
        )
      })}
    </svg>
  )
}
