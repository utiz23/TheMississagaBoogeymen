import { chromium } from 'playwright'
import { INTERNAL_TOKEN_HEADER } from './web-client.ts'

/**
 * Screenshot BGM's lineup (every player on their card with this game's
 * stats). Reduced motion + disabled animations ⇒ each card's still variant. A fresh browser per render, always
 * closed; a hard timeout kills it if anything hangs.
 */
export async function renderLineup(opts: {
  webBaseUrl: string
  token: string
  matchId: number
  timeoutMs: number
}): Promise<Uint8Array> {
  const browser = await chromium.launch()
  const killer = setTimeout(() => void browser.close(), opts.timeoutMs + 5_000)
  try {
    const context = await browser.newContext({
      reducedMotion: 'reduce',
      deviceScaleFactor: 2,
      // Two rows of ~421 px cards must fit: a fixed element can't be scrolled into view.
      viewport: { width: 1000, height: 1100 },
      extraHTTPHeaders: { [INTERNAL_TOKEN_HEADER]: opts.token },
    })
    const page = await context.newPage()
    const res = await page.goto(
      `${opts.webBaseUrl}/internal/discord/lineup/${String(opts.matchId)}`,
      { waitUntil: 'networkidle', timeout: opts.timeoutMs },
    )
    if (res === null || !res.ok()) throw new Error(`card page HTTP ${String(res?.status() ?? 0)}`)
    const strip = page.locator('#discord-lineup')
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
      timeout: opts.timeoutMs,
    })
    return new Uint8Array(png)
  } finally {
    clearTimeout(killer)
    await browser.close().catch(() => undefined)
  }
}
