import { chromium } from 'playwright'
import { INTERNAL_TOKEN_HEADER } from './web-client.ts'

/**
 * Screenshot one element of an internal page (`selector` on `path`). Reduced
 * motion + disabled animations ⇒ each card's still variant. A fresh browser
 * per render, always closed; a hard timeout kills it if anything hangs.
 */
export async function renderElement(opts: {
  webBaseUrl: string
  token: string
  path: string
  selector: string
  timeoutMs: number
  /** A fixed element can't scroll, so a tall page needs a tall viewport. */
  viewportHeight?: number
  /** Transparent PNG (the page must not paint a background behind the element). */
  omitBackground?: boolean
  /** Device scale factor (2 by default; 3 for a full card). */
  scale?: number
}): Promise<Uint8Array> {
  const browser = await chromium.launch()
  const killer = setTimeout(() => void browser.close(), opts.timeoutMs + 5_000)
  try {
    const context = await browser.newContext({
      reducedMotion: 'reduce',
      deviceScaleFactor: opts.scale ?? 2,
      // Two rows of ~421 px cards must fit: a fixed element can't be scrolled into view.
      viewport: { width: 1000, height: opts.viewportHeight ?? 1100 },
      extraHTTPHeaders: { [INTERNAL_TOKEN_HEADER]: opts.token },
    })
    const page = await context.newPage()
    const res = await page.goto(`${opts.webBaseUrl}${opts.path}`, {
      waitUntil: 'networkidle',
      timeout: opts.timeoutMs,
    })
    if (res === null || !res.ok()) throw new Error(`card page HTTP ${String(res?.status() ?? 0)}`)
    const strip = page.locator(opts.selector)
    await strip.waitFor({ state: 'visible', timeout: opts.timeoutMs })
    await page.evaluate(async () => {
      await document.fonts.ready
      await Promise.all(
        Array.from(document.images).map((img) =>
          img.complete
            ? null
            : new Promise((resolve) => {
                img.onload = resolve
                img.onerror = resolve
              }),
        ),
      )
    })
    const png = await strip.screenshot({
      type: 'png',
      animations: 'disabled',
      omitBackground: opts.omitBackground ?? false,
      timeout: opts.timeoutMs,
    })
    return new Uint8Array(png)
  } finally {
    clearTimeout(killer)
    await browser.close().catch(() => undefined)
  }
}

/** BGM's lineup for one game (every player on their card with this game's stats). */
export const renderLineup = (o: {
  webBaseUrl: string
  token: string
  matchId: number
  timeoutMs: number
}): Promise<Uint8Array> =>
  renderElement({
    ...o,
    path: `/internal/discord/lineup/${String(o.matchId)}`,
    selector: '#discord-lineup',
  })

/** One unlock's graphic: the badge (scale 2) or the full card (scale 3), transparent. */
export const renderUnlock = (o: {
  webBaseUrl: string
  token: string
  eventId: number
  graphic: 'badge' | 'card'
  timeoutMs: number
}): Promise<Uint8Array> =>
  renderElement({
    ...o,
    path: `/internal/discord/unlock/${String(o.eventId)}`,
    selector: '#discord-unlock',
    omitBackground: true,
    scale: o.graphic === 'card' ? 3 : 2,
  })
