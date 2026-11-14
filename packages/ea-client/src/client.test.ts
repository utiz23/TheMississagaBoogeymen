/**
 * EA request time limit (worker watchdog task, 2026-11-14): a request that never answers must end
 * in a failure after the time limit, never hang. The caller's own abort must still work.
 *   pnpm --filter @eanhl/ea-client test
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { EaTimeoutError, eaFetch, getRequestTimeoutMs } from './client.js'

/** A fetch that never answers; it rejects only when its signal aborts (like the real one). */
function hangingFetch(): typeof fetch {
  return ((_url: unknown, init?: RequestInit) =>
    new Promise((_resolve, reject) => {
      const signal = init?.signal
      if (!signal) return // no signal: hangs forever (this is the bug)
      const fail = () => reject(signal.reason)
      if (signal.aborted) fail()
      else signal.addEventListener('abort', fail, { once: true })
    })) as typeof fetch
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('eaFetch time limit', () => {
  it('a request that never answers fails after the time limit (once, no retry)', async () => {
    const f = vi.fn(hangingFetch())
    vi.stubGlobal('fetch', f)
    const started = Date.now()
    const err = await eaFetch('https://example.test/a', { timeoutMs: 50 }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(EaTimeoutError)
    expect((err as Error).message).toContain('timed out after 50ms')
    expect(f).toHaveBeenCalledTimes(1)
    expect(Date.now() - started).toBeLessThan(2000)
  })

  it('a body that never arrives also ends in the time limit', async () => {
    vi.stubGlobal('fetch', ((_u: unknown, init?: RequestInit) =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          new Promise((_res, rej) => {
            init?.signal?.addEventListener('abort', () => rej(init.signal?.reason), { once: true })
          }),
      })) as unknown as typeof fetch)
    await expect(eaFetch('https://example.test/b', { timeoutMs: 50 })).rejects.toBeInstanceOf(
      EaTimeoutError,
    )
  })

  it('the default limit is 30 s and EA_REQUEST_TIMEOUT_MS changes it', () => {
    expect(getRequestTimeoutMs()).toBe(30_000)
    vi.stubEnv('EA_REQUEST_TIMEOUT_MS', '1234')
    expect(getRequestTimeoutMs()).toBe(1234)
    vi.stubEnv('EA_REQUEST_TIMEOUT_MS', 'nonsense')
    expect(getRequestTimeoutMs()).toBe(30_000)
    vi.stubEnv('EA_REQUEST_TIMEOUT_MS', '0')
    expect(getRequestTimeoutMs()).toBe(30_000)
  })

  it("the caller's own abort still works and is not called a timeout", async () => {
    vi.stubGlobal('fetch', hangingFetch())
    const ctl = new AbortController()
    const p = eaFetch('https://example.test/c', { signal: ctl.signal, timeoutMs: 60_000 })
    setTimeout(() => {
      ctl.abort()
    }, 20)
    const err = await p.catch((e: unknown) => e)
    expect(err).not.toBeInstanceOf(EaTimeoutError)
    expect((err as Error).name).toBe('AbortError')
  })

  it('a signal that is already aborted fails at once', async () => {
    vi.stubGlobal('fetch', hangingFetch())
    const err = await eaFetch('https://example.test/d', {
      signal: AbortSignal.abort(),
      timeoutMs: 60_000,
    }).catch((e: unknown) => e)
    expect(err).not.toBeInstanceOf(EaTimeoutError)
    expect((err as Error).name).toBe('AbortError')
  })

  it('a normal answer is returned as before', async () => {
    vi.stubGlobal('fetch', (() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ a: 1 }),
      })) as unknown as typeof fetch)
    await expect(eaFetch('https://example.test/e')).resolves.toEqual({ a: 1 })
  })

  it('a 404 is still an EaApiError, not retried', async () => {
    const f = vi.fn(
      () => Promise.resolve({ ok: false, status: 404 }) as unknown as Promise<Response>,
    )
    vi.stubGlobal('fetch', f)
    await expect(eaFetch('https://example.test/f')).rejects.toMatchObject({ status: 404 })
    expect(f).toHaveBeenCalledTimes(1)
  })
})
