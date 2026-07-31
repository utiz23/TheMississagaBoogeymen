import Image from 'next/image'

/**
 * Platform indicator next to a gamertag. Uses the official-brand SVG logos
 * stored at `apps/web/public/assets/platforms/{xbox|playstation}.svg` (copied
 * from `docs/branding/logos/platforms/`). The asset family is picked from
 * `resolvePlatform()` so callers never touch the raw EA code (`xbsx`, etc.).
 *
 * Lifted verbatim out of the pre-revamp `matches/lineup-section.tsx` (deleted
 * in Phase 11) — the revamped lineup row dropped the badge along with the
 * card, and it is real EA-authoritative data with nowhere else to live.
 */
export interface PlatformInfo {
  label: string
  family: 'xbox' | 'playstation'
}

/**
 * Map raw platform strings to a display label + the asset family on disk.
 * EA's API uses codes like `xbsx` (Xbox Series X|S) / `ps5`; the OCR (when
 * wired) is expected to emit "Xbox" / "PlayStation" form. Both flow through
 * this single normalizer.
 */
const PLATFORM_LOOKUP: Readonly<Record<string, PlatformInfo>> = {
  // EA API codes
  xbsx: { label: 'Xbox', family: 'xbox' },
  xbox1: { label: 'Xbox', family: 'xbox' },
  ps5: { label: 'PS5', family: 'playstation' },
  ps4: { label: 'PS4', family: 'playstation' },
  // Human-readable forms (OCR or hand-entered)
  xbox: { label: 'Xbox', family: 'xbox' },
  playstation: { label: 'PlayStation', family: 'playstation' },
}

export function resolvePlatform(raw: string | null): PlatformInfo | null {
  if (!raw) return null
  const key = raw.trim().toLowerCase()
  if (!key) return null
  return PLATFORM_LOOKUP[key] ?? null
}

export function PlatformBadge({ platform, size = 12 }: { platform: PlatformInfo; size?: number }) {
  return (
    <span className="inline-flex flex-none items-center" title={platform.label}>
      <Image
        src={`/assets/platforms/${platform.family}.svg`}
        alt={platform.label}
        width={size}
        height={size}
        className="shrink-0 opacity-80"
        style={{ width: `${size.toString()}px`, height: `${size.toString()}px` }}
        aria-hidden
      />
    </span>
  )
}
