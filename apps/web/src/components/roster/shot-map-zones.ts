/**
 * Frozen zone layout for the Shot Map component.
 *
 * Discovery method: pattern analysis on a high-volume player's DB row
 * (index 7 dominates → slot; index 16 second-highest → long-range bar).
 * Visual validation against ChelHead's rendered map is pending; the
 * EA_ICE_INDEX_TO_ZONE block below is a working hypothesis, not yet
 * empirically confirmed for indices other than 7 and 16. Update on
 * evidence.
 *
 * Coordinates use a viewBox of 200 × 180. (0,0) is top-left.
 * The half-rink offensive zone is rendered with the goal line at the top.
 */

export type IceZoneId =
  | 'point_l' | 'point_c' | 'point_r'
  | 'high_l' | 'slot_high' | 'high_r'
  | 'circle_l' | 'slot' | 'circle_r'
  | 'low_l' | 'behind_net' | 'low_r'
  | 'wing_l' | 'wing_r'
  | 'long_l' | 'long_r'

export type NetZoneId = 'top_l' | 'top_r' | 'bot_l' | 'bot_r' | 'five_hole'

export interface IceZoneShape {
  id: IceZoneId
  /** SVG path `d` attribute for the polygon. */
  d: string
  /** Centroid for label/tooltip placement. */
  cx: number
  cy: number
  /** Coarse danger band (drives the breakdown panel totals). */
  band: 'high_danger' | 'mid_range' | 'long_range'
}

export interface NetZoneShape {
  id: NetZoneId
  /** SVG `<rect>` x/y/w/h. */
  x: number
  y: number
  w: number
  h: number
  cx: number
  cy: number
}

/**
 * EA index (1-based) → physical zone id.
 *
 * Status: WORKING HYPOTHESIS pending visual validation against ChelHead's
 * rendering. Indices 7 (slot) and 16 (long_r) are strongly supported by
 * count-distribution analysis on three real players. Other mappings are
 * provisional; flag any that look wrong during the Task 12 smoke test.
 */
export const EA_ICE_INDEX_TO_ZONE: Record<number, IceZoneId> = {
  1: 'point_l',
  2: 'point_c',
  3: 'point_r',
  4: 'high_l',
  5: 'slot_high',
  6: 'high_r',
  7: 'slot',
  8: 'circle_l',
  9: 'circle_r',
  10: 'low_l',
  11: 'behind_net',
  12: 'low_r',
  13: 'wing_l',
  14: 'wing_r',
  15: 'long_l',
  16: 'long_r',
}

export const EA_NET_INDEX_TO_ZONE: Record<number, NetZoneId> = {
  1: 'top_l',
  2: 'top_r',
  3: 'bot_l',
  4: 'bot_r',
  5: 'five_hole',
}

/**
 * Half-rink SVG geometry (viewBox 200 × 180).
 * The goal line is at y = 0 (top of viewport); the blue line is at y = 180 (bottom).
 */
export const ICE_ZONE_SHAPES: Record<IceZoneId, IceZoneShape> = {
  // Top band (point area) — three zones across the blue line
  point_l:    { id: 'point_l',    d: 'M 5 130 L 5 175 L 70 175 L 70 130 Z',   cx: 35,  cy: 152, band: 'long_range' },
  point_c:    { id: 'point_c',    d: 'M 70 130 L 70 175 L 130 175 L 130 130 Z', cx: 100, cy: 152, band: 'long_range' },
  point_r:    { id: 'point_r',    d: 'M 130 130 L 130 175 L 195 175 L 195 130 Z', cx: 165, cy: 152, band: 'long_range' },
  // Long range stripes flanking the point row
  long_l:     { id: 'long_l',     d: 'M 5 100 L 5 130 L 70 130 L 70 100 Z',   cx: 35,  cy: 115, band: 'long_range' },
  long_r:     { id: 'long_r',     d: 'M 130 100 L 130 130 L 195 130 L 195 100 Z', cx: 165, cy: 115, band: 'long_range' },
  // High slot row
  high_l:     { id: 'high_l',     d: 'M 5 70 L 5 100 L 70 100 L 70 70 Z',     cx: 35,  cy: 85,  band: 'mid_range' },
  slot_high:  { id: 'slot_high',  d: 'M 70 70 L 70 130 L 130 130 L 130 70 Z', cx: 100, cy: 100, band: 'mid_range' },
  high_r:     { id: 'high_r',     d: 'M 130 70 L 130 100 L 195 100 L 195 70 Z', cx: 165, cy: 85,  band: 'mid_range' },
  // Slot / faceoff circle row
  circle_l:   { id: 'circle_l',   d: 'M 5 40 L 5 70 L 70 70 L 70 40 Z',       cx: 35,  cy: 55,  band: 'mid_range' },
  slot:       { id: 'slot',       d: 'M 70 30 L 70 70 L 130 70 L 130 30 Z',   cx: 100, cy: 50,  band: 'high_danger' },
  circle_r:   { id: 'circle_r',   d: 'M 130 40 L 130 70 L 195 70 L 195 40 Z', cx: 165, cy: 55,  band: 'mid_range' },
  // Low slot
  low_l:      { id: 'low_l',      d: 'M 5 15 L 5 40 L 70 40 L 70 15 Z',       cx: 35,  cy: 27,  band: 'mid_range' },
  behind_net: { id: 'behind_net', d: 'M 70 0 L 70 30 L 130 30 L 130 0 Z',     cx: 100, cy: 15,  band: 'high_danger' },
  low_r:      { id: 'low_r',      d: 'M 130 15 L 130 40 L 195 40 L 195 15 Z', cx: 165, cy: 27,  band: 'mid_range' },
  // Wings (bottom corners near goal line)
  wing_l:     { id: 'wing_l',     d: 'M 5 0 L 5 15 L 70 15 L 70 0 Z',         cx: 35,  cy: 7,   band: 'high_danger' },
  wing_r:     { id: 'wing_r',     d: 'M 130 0 L 130 15 L 195 15 L 195 0 Z',   cx: 165, cy: 7,   band: 'high_danger' },
}

/** 5-zone net (viewBox 100 × 60). */
export const NET_ZONE_SHAPES: Record<NetZoneId, NetZoneShape> = {
  top_l:     { id: 'top_l',     x: 0,  y: 0,  w: 50, h: 25, cx: 25, cy: 12 },
  top_r:     { id: 'top_r',     x: 50, y: 0,  w: 50, h: 25, cx: 75, cy: 12 },
  bot_l:     { id: 'bot_l',     x: 0,  y: 25, w: 40, h: 35, cx: 20, cy: 42 },
  bot_r:     { id: 'bot_r',     x: 60, y: 25, w: 40, h: 35, cx: 80, cy: 42 },
  five_hole: { id: 'five_hole', x: 40, y: 25, w: 20, h: 35, cx: 50, cy: 42 },
}

/** Half-rink outline path (used as the SVG backdrop). */
export const HALF_RINK_OUTLINE =
  'M 5 0 L 5 175 Q 5 180 10 180 L 190 180 Q 195 180 195 175 L 195 0 Z'
