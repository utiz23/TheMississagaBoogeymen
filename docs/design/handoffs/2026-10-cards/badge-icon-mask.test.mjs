// Run: node --test docs/design/handoffs/2026-10-cards/badge-icon-mask.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { maskColor, toMaskSvg } from './badge-icon-mask.mjs'

test('light paint becomes a hole, dark paint stays solid', () => {
  assert.equal(maskColor('#fff'), '#000')
  assert.equal(maskColor('#ecf0f1'), '#000')
  assert.equal(maskColor('white'), '#000')
  assert.equal(maskColor('#000'), '#fff')
  assert.equal(maskColor('#546a79'), '#fff')
  assert.equal(maskColor('none'), 'none')
})

test('the artwork moves into a mask over one black rect, colours remapped, order kept', () => {
  const out = toMaskSvg(
    '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 20"><defs><style>.a{fill:#fff;stroke:#ECF0F1}</style></defs><path d="M0 0"/><path class="a" fill="#546a79" d="M1 1"/></svg>',
  )
  assert.match(out, /viewBox="0 0 10 20"/)
  assert.match(out, /<mask id="icon" maskUnits="userSpaceOnUse" x="0" y="0" width="10" height="20">/)
  assert.match(out, /<g fill="#fff">/)
  assert.match(out, /\.a\{fill: #000;stroke: #000\}/)
  assert.match(out, /<path class="a" fill="#fff" d="M1 1"\/>/)
  assert.ok(out.indexOf('M0 0') < out.indexOf('M1 1'))
  assert.match(out, /<rect x="0" y="0" width="10" height="20" fill="#000" mask="url\(#icon\)"\/>/)
  assert.doesNotMatch(out, /<\?xml/)
})

test('unusable files are rejected with a reason', () => {
  assert.throws(() => toMaskSvg('<svg viewBox="0 0 1 1"><image href="x.png"/></svg>'), /image/)
  assert.throws(() => toMaskSvg('<svg><path d="M0 0"/></svg>'), /viewBox/)
  assert.throws(() => toMaskSvg('<p>not svg</p>'), /root/)
})

test('weight thickens the solid shapes with a same-colour round stroke', () => {
  const out = toMaskSvg('<svg viewBox="0 0 10 10"><path d="M0 0"/></svg>', { weight: 2.5 })
  assert.match(out, /<g fill="#fff" stroke="#fff" stroke-width="2.5" stroke-linejoin="round">/)
  assert.match(toMaskSvg('<svg viewBox="0 0 10 10"><path d="M0 0"/></svg>'), /<g fill="#fff">/)
})

test('solid fills the light detail too: every painted part becomes the silhouette', () => {
  const svg = '<svg viewBox="0 0 10 10"><style>.a{fill:#fff}</style><path class="a" fill="#ffffff" d="M0 0"/><path stroke="none" d="M1 1"/></svg>'
  const out = toMaskSvg(svg, { solid: true })
  assert.match(out, /\.a\{fill: #fff\}/)
  assert.match(out, /<path class="a" fill="#fff" d="M0 0"\/>/)
  assert.match(out, /stroke="none"/)
  assert.match(toMaskSvg(svg), /\.a\{fill: #000\}/)
})

test('invert swaps the roles: light paint is the shape, dark lines become cut-out gaps', () => {
  const svg = '<svg viewBox="0 0 10 10"><style>.a{fill:#fff}</style><path class="a" d="M0 0"/><path d="M1 1"/></svg>'
  const out = toMaskSvg(svg, { invert: true })
  assert.match(out, /\.a\{fill: #fff\}/)
  assert.match(out, /<g fill="#000">/)
})
