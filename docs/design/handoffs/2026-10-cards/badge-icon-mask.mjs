/**
 * Badge icon → one-colour mask SVG (spec D14). The operator's icons draw a dark
 * shape with light (white / pale grey) detail painted on top as cut-outs. The
 * badge tints its icon with a CSS mask, which only sees alpha, so the details
 * would fill in solid. This rewrites an icon so its alpha IS the intended
 * silhouette: dark paint → opaque, light paint → hole, painting order kept,
 * by moving the artwork into an SVG luminance <mask> over one filled rect.
 */

const NAMED = { white: '#ffffff', black: '#000000' }
const FORBIDDEN = /<(image|script|foreignObject)\b/i

function hexToRgb(hex) {
  let h = hex.replace('#', '').toLowerCase()
  if (h.length === 3) h = [...h].map((c) => c + c).join('')
  if (!/^[0-9a-f]{6}$/.test(h)) return null
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
}

/** Relative luminance (sRGB, WCAG). */
function luminance(color) {
  const rgb = hexToRgb(NAMED[color.toLowerCase()] ?? color)
  if (rgb === null) return null
  const lin = rgb.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]
}

/** Light paint becomes a hole (black in the mask); anything else stays solid (white). */
export function maskColor(color) {
  const c = color.trim()
  if (/^(none|transparent)$/i.test(c)) return c
  const l = luminance(c)
  return l !== null && l >= 0.5 ? '#000' : '#fff'
}

const COLOR = /#[0-9a-fA-F]{3,6}\b|\b(?:white|black)\b/

function remapColors(markup, solid) {
  const to = (val) => (solid && !/^\s*(none|transparent)\s*$/i.test(val) ? '#fff' : maskColor(val))
  return markup
    .replace(/\b(fill|stroke)\s*:\s*([^;}"]+)/g, (_, prop, val) => {
      return COLOR.test(val) ? `${prop}: ${to(val)}` : `${prop}: ${val}`
    })
    .replace(/\b(fill|stroke)="([^"]+)"/g, (_, prop, val) => {
      return COLOR.test(val) ? `${prop}="${to(val)}"` : `${prop}="${val}"`
    })
}

/**
 * Rewrite one icon. Throws with a reason when the file can't be used.
 * `weight` (viewBox units) thickens the solid shapes with a round stroke of the
 * same colour, for thin art that fades at small sizes. Only for icons whose
 * detail isn't drawn as light cut-outs: the stroke would also fill the holes.
 * `solid` treats light paint as solid too, so art drawn as a light fill inside
 * a dark outline reads as one filled silhouette instead of an outline.
 * `closeGaps` (viewBox units) fills gaps narrower than 2×closeGaps between strokes — a
 * morphological closing (dilate then erode) — so art drawn as an outline (two
 * parallel edges) reads as a solid shape; wider openings stay open.
 */
export function toMaskSvg(svgText, { weight = 0, solid = false, closeGaps = 0 } = {}) {
  if (FORBIDDEN.test(svgText)) throw new Error('contains <image>, <script> or <foreignObject>')
  const open = /<svg\b[^>]*>/i.exec(svgText)
  const close = svgText.lastIndexOf('</svg>')
  if (open === null || close < 0) throw new Error('no <svg> root')
  const viewBox = /viewBox="([^"]+)"/i.exec(open[0])?.[1]
  if (viewBox === undefined) throw new Error('no viewBox')
  const [x, y, w, h] = viewBox.trim().split(/[\s,]+/).map(Number)
  if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) throw new Error('bad viewBox')
  const body = remapColors(svgText.slice(open.index + open[0].length, close), solid)
  const box = `x="${String(x)}" y="${String(y)}" width="${String(w)}" height="${String(h)}"`
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">`,
    `<defs>`,
    closeGaps > 0
      ? `<filter id="close" x="-10%" y="-10%" width="120%" height="120%"><feMorphology operator="dilate" radius="${String(closeGaps)}"/><feMorphology operator="erode" radius="${String(closeGaps)}"/></filter>`
      : '',
    `<mask id="icon" maskUnits="userSpaceOnUse" ${box}>`,
    closeGaps > 0 ? `<g filter="url(#close)">` : '',
    weight > 0
      ? `<g fill="#fff" stroke="#fff" stroke-width="${String(weight)}" stroke-linejoin="round">${body}</g>`
      : `<g fill="#fff">${body}</g>`,
    closeGaps > 0 ? `</g>` : '',
    `</mask></defs>`,
    `<rect ${box} fill="#000" mask="url(#icon)"/>`,
    `</svg>`,
    '',
  ].join('\n')
}
