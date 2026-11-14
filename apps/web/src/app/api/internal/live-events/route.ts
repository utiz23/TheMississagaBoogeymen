import { insertLiveEvent } from '@eanhl/db/queries'
import { RATE_PER_MINUTE, handleLiveEventRequest } from '@/lib/live-events/handler'
import { RateLimiter } from '@/lib/live-events/rate-limit'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// One bucket per web process (the site runs one `web` container).
const limiter = new RateLimiter(RATE_PER_MINUTE)

const extraPublicHosts = (process.env['LIVE_EVENTS_PUBLIC_HOSTS'] ?? '')
  .split(',')
  .map((h) => h.trim())
  .filter((h) => h.length > 0)

/**
 * Live events from OBS / the engine (E1). Reachable on Hotel-Echo's Tailscale address and the
 * Docker network only; refused when it came through the public tunnel. Auth, checks and answers:
 * `lib/live-events/handler.ts`; sender guide: docs/operations/runbooks/live-events.md.
 */
export async function POST(request: Request): Promise<Response> {
  return handleLiveEventRequest(request, {
    token: process.env['LIVE_EVENTS_TOKEN'],
    hmacKey: process.env['LIVE_EVENTS_HMAC_KEY'],
    publicHosts: extraPublicHosts,
    limiter,
    store: insertLiveEvent,
  })
}
