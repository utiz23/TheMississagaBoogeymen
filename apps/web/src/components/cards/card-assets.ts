/**
 * Mythic card-theme assets, built by
 * docs/design/handoffs/2026-10-cards/make-card-assets.sh into
 * public/images/cards/. Regular themes (T1–T5) use none. Videos are listed by
 * base name and ship as .webm + .mp4; the effects mount them only while motion
 * runs, so a card at rest downloads nothing but its stills.
 */
import type { MythicThemeKey } from '@eanhl/db/cards'

export const CARD_ASSET_DIR = '/images/cards'
export const VIDEO_FORMATS = ['webm', 'mp4'] as const
type VideoFormat = (typeof VIDEO_FORMATS)[number]

/** Source order per video: the smaller encode first (browsers take the first they can play). */
const VIDEO_ORDER: Readonly<Record<string, readonly VideoFormat[]>> = {
  'fx-inferno-embers': ['webm', 'mp4'],
  'fx-storm-live': ['mp4', 'webm'],
}

/** <source> list for a video base URL (theme data stores videos by base name). */
export function videoSources(base: string): { src: string; type: string }[] {
  const name = base.split('/').pop() ?? base
  return (VIDEO_ORDER[name] ?? VIDEO_FORMATS).map((ext) => ({
    src: `${base}.${ext}`,
    type: `video/${ext}`,
  }))
}

export interface MythicAssets {
  stills: readonly string[]
  videos: readonly string[]
}

export const MYTHIC_ASSETS: Readonly<Record<MythicThemeKey, MythicAssets>> = {
  frozen: { stills: ['tex-ice-glacier.webp', 'ice-cracks.avif'], videos: [] },
  futureC: { stills: ['tex-future-circuit.webp', 'fx-future-mask.webp'], videos: [] },
  inferno: { stills: ['tex-inferno-gate.webp'], videos: ['fx-inferno-embers'] },
  stormLive: { stills: ['tex-storm-clouds.webp', 'fx-storm-rain.webp'], videos: ['fx-storm-live'] },
  olympus: { stills: ['tex-olympus-temple.webp'], videos: [] },
}

/** Public URL of a card asset (still file name, or video base name). */
export function cardAsset(file: string): string {
  return `${CARD_ASSET_DIR}/${file}`
}
