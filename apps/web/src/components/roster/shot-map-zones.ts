/**
 * Shot Map zone geometry and EA field index mapping.
 *
 * viewBox: 0 0 841.2 859.2
 * Zone paths extracted from ChelHead's app-hockey-zone-heatmap SVG.
 * Orientation: goal line at top (y≈111), neutral zone at bottom (y≈730).
 *
 * EA_ICE_INDEX_TO_ZONE validated empirically: silkyjoker85's DB shotsIce
 * array matched 1:1 against ChelHead's rendered zone counts (2026-05-05).
 */

export type IceZoneId =
  | 'LowSlot'
  | 'HighSlot'
  | 'Crease'
  | 'CenterPoint'
  | 'LCircle'
  | 'RCircle'
  | 'LPoint'
  | 'RPoint'
  | 'LNetSide'
  | 'RNetSide'
  | 'LCorner'
  | 'RCorner'
  | 'OutsideL'
  | 'OutsideR'
  | 'BehindTheNet'
  | 'NeutralZone'

export type NetZoneId = 'top_l' | 'top_r' | 'bot_l' | 'bot_r' | 'five_hole'

export interface IceZoneShape {
  id: IceZoneId
  d: string
  cx: number
  cy: number
  band: 'high_danger' | 'mid_range' | 'long_range'
}

export interface NetZoneShape {
  id: NetZoneId
  x: number
  y: number
  w: number
  h: number
  cx: number
  cy: number
}

/**
 * EA field index (1-based, matching skShotsLocationOnIce1..16) → zone id.
 * Validated against silkyjoker85's DB row vs ChelHead's rendered counts.
 */
export const EA_ICE_INDEX_TO_ZONE: Record<number, IceZoneId> = {
  1:  'RCorner',
  2:  'BehindTheNet',
  3:  'LCorner',
  4:  'Crease',
  5:  'RNetSide',
  6:  'LNetSide',
  7:  'LowSlot',
  8:  'OutsideR',
  9:  'RCircle',
  10: 'HighSlot',
  11: 'LCircle',
  12: 'OutsideL',
  13: 'RPoint',
  14: 'CenterPoint',
  15: 'LPoint',
  16: 'NeutralZone',
}

export const EA_NET_INDEX_TO_ZONE: Record<number, NetZoneId> = {
  1: 'top_l',
  2: 'top_r',
  3: 'bot_l',
  4: 'bot_r',
  5: 'five_hole',
}

/**
 * Zone paths in viewBox 841.2 × 859.2.
 * Centroids derived from ChelHead's labels-layer transform offsets.
 * Bands match NHL EDGE zone breakdown convention:
 *   high_danger  = Crease + LowSlot
 *   mid_range    = net sides, circles, slot, wings, corners, behind net
 *   long_range   = point area + neutral zone
 */
export const ICE_ZONE_SHAPES: Record<IceZoneId, IceZoneShape> = {
  LowSlot: {
    id: 'LowSlot',
    d: 'M421.1,304.3a303.33,303.33,0,0,1-79.94-10.76l-1.26-.35v.1a301.08,301.08,0,0,1-90.36-42.41L358.46,112.61a62.4,62.4,0,0,0,20.36,43.63l1.68,1.54v-.16a62.82,62.82,0,0,0,103.34-45L592.56,251a302.41,302.41,0,0,1-93.22,43A302,302,0,0,1,421.1,304.3Z',
    cx: 420, cy: 226,
    band: 'high_danger',
  },
  Crease: {
    id: 'Crease',
    d: 'M421.1,170.5a60.63,60.63,0,0,1-60.69-59.7H449.2l32.69-.1a60.8,60.8,0,0,1-60.79,59.8Z',
    cx: 420, cy: 132,
    band: 'high_danger',
  },
  HighSlot: {
    id: 'HighSlot',
    d: 'M421.7,538.1a553.57,553.57,0,0,1-142.27-18.4l62.17-224a300.23,300.23,0,0,0,79.5,10.57,304.32,304.32,0,0,0,77.8-10.08l61.17,224.37A546.07,546.07,0,0,1,421.7,538.1Z',
    cx: 420, cy: 427,
    band: 'mid_range',
  },
  LCircle: {
    id: 'LCircle',
    d: 'M277.5,519.18c-64.64-17.07-121.57-44.22-174-83L248.3,252.46c28.94,20,58.85,34,91.37,42.84Z',
    cx: 223, cy: 414,
    band: 'mid_range',
  },
  RCircle: {
    id: 'RCircle',
    d: 'M500.83,295.71a302,302,0,0,0,93-43.15L737.88,435.71A516.4,516.4,0,0,1,562,520.08Z',
    cx: 617, cy: 413,
    band: 'mid_range',
  },
  LNetSide: {
    id: 'LNetSide',
    d: 'M247.9,249.74A304.72,304.72,0,0,1,138.56,110.8H357.24Z',
    cx: 241, cy: 168,
    band: 'mid_range',
  },
  RNetSide: {
    id: 'RNetSide',
    d: 'M484.07,110.8H702.74c-22.23,56.79-59.72,104.83-108.54,139Z',
    cx: 602, cy: 168,
    band: 'mid_range',
  },
  LCorner: {
    id: 'LCorner',
    d: 'M59.73,108.8A278.5,278.5,0,0,1,279.8,1H282V108.8Z',
    cx: 199, cy: 76,
    band: 'mid_range',
  },
  RCorner: {
    id: 'RCorner',
    d: 'M559.8,108.8V1h1.6A278.95,278.95,0,0,1,758.59,82.71a268.38,268.38,0,0,1,23.08,26.09Z',
    cx: 642, cy: 76,
    band: 'mid_range',
  },
  BehindTheNet: {
    id: 'BehindTheNet',
    d: 'M284,1H557.8V108.8H284Z',
    cx: 420, cy: 74,
    band: 'mid_range',
  },
  OutsideL: {
    id: 'OutsideL',
    d: 'M1,279.9A280.51,280.51,0,0,1,58.09,110.8h78.32A306.52,306.52,0,0,0,246.56,251.21L1,563.11Z',
    cx: 106, cy: 262,
    band: 'mid_range',
  },
  OutsideR: {
    id: 'OutsideR',
    d: 'M595.44,251.41C644.5,217.07,682.36,168.47,705,110.8h78.13A278.61,278.61,0,0,1,840.2,279.5V562.71Z',
    cx: 736, cy: 262,
    band: 'mid_range',
  },
  CenterPoint: {
    id: 'CenterPoint',
    d: 'M221.52,728.4,278.9,521.62A555.44,555.44,0,0,0,421.7,540.1a552.71,552.71,0,0,0,138.89-17.58l56.1,205.88Z',
    cx: 420, cy: 632,
    band: 'long_range',
  },
  LPoint: {
    id: 'LPoint',
    d: 'M1,728.4v-162L102.28,437.78C154.9,476.7,212.06,504,277,521.11L219.44,728.4Z',
    cx: 126, cy: 606,
    band: 'long_range',
  },
  RPoint: {
    id: 'RPoint',
    d: 'M618.76,728.4,562.53,522a518.52,518.52,0,0,0,176.58-84.73L840.3,565.85V728.4Z',
    cx: 713, cy: 605,
    band: 'long_range',
  },
  NeutralZone: {
    id: 'NeutralZone',
    d: 'M1,730.4H840.2V858.2H1Z',
    cx: 420, cy: 794,
    band: 'long_range',
  },
}

/** 5-zone net grid (viewBox 100 × 60). */
export const NET_ZONE_SHAPES: Record<NetZoneId, NetZoneShape> = {
  top_l:     { id: 'top_l',     x: 0,  y: 0,  w: 50, h: 25, cx: 25, cy: 12 },
  top_r:     { id: 'top_r',     x: 50, y: 0,  w: 50, h: 25, cx: 75, cy: 12 },
  bot_l:     { id: 'bot_l',     x: 0,  y: 25, w: 40, h: 35, cx: 20, cy: 42 },
  bot_r:     { id: 'bot_r',     x: 60, y: 25, w: 40, h: 35, cx: 80, cy: 42 },
  five_hole: { id: 'five_hole', x: 40, y: 25, w: 20, h: 35, cx: 50, cy: 42 },
}

/**
 * Rink fill path — the full half-rink interior shape.
 * Stroke the outline over the top for clean borders.
 */
export const RINK_FILL =
  'M5.81,854.08V279.82C5.74,128.18,128.61,5.19,280.25,5.12H560.69c151.7,0,274.69,123,274.7,274.66v574.3Z'

export const RINK_OUTLINE =
  'M280.32,9.12H560.69C710.19,9.12,831.38,130.3,831.38,279.8V850.08H9.81V279.82C9.74,130.38,130.83,9.19,280.27,9.12Z'

/** Neutral-zone blue line (appears as a horizontal band near bottom of the zone). */
export const NEUTRAL_ZONE_LINE = 'M1.81,724.5H839.39V732.5H1.81Z'

/** Goal crease D-arc path. */
export const GOAL_CREASE =
  'M420.56,174a61.7,61.7,0,0,1-39.65-14.4l-.37-.3v-47h2v46.08a59.76,59.76,0,0,0,76,0V112.25h2v47l-.37.3A61.7,61.7,0,0,1,420.56,174Z'

/** Goal crossbar / back bar. */
export const GOAL_POSTS = 'M382.91,112.25H458.21V114.25H382.91Z'

/** Goal line (the red line across the top of the crease area). */
export const GOAL_LINE = 'M57.81,111.23H783.38V113.27H57.81Z'

/** Left faceoff circle center and radius (for <circle> element). */
export const FACEOFF_LEFT  = { cx: 206.47, cy: 307.51, r: 143.4 }
export const FACEOFF_RIGHT = { cx: 633.77, cy: 307.47, r: 143.4 }

/** Small faceoff dots. */
export const FACEOFF_DOTS = [
  { cx: 206.47, cy: 307.51 },
  { cx: 633.77, cy: 307.47 },
]
