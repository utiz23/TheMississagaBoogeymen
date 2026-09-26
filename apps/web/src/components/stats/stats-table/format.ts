/** Placeholder for any unavailable value. Never render NaN, Infinity or an invented 0. */
export const DASH = '—'

export type FormatId = 'int' | 'signed' | 'd1' | 'd2' | 'pct1' | 'mmss' | 'hms'

const isNum = (v: number | null | undefined): v is number =>
  typeof v === 'number' && Number.isFinite(v)

const pad2 = (n: number): string => n.toString().padStart(2, '0')

export function fmtInt(v: number | null): string {
  return isNum(v) ? Math.round(v).toLocaleString('en-US') : DASH
}

/** `+12`, `0`, `−8` (U+2212 minus). */
export function fmtSigned(v: number | null): string {
  if (!isNum(v)) return DASH
  if (v > 0) return `+${v.toLocaleString('en-US')}`
  if (v < 0) return `−${Math.abs(v).toLocaleString('en-US')}`
  return '0'
}

export function fmtFixed(v: number | null, digits: number): string {
  return isNum(v) ? v.toFixed(digits) : DASH
}

export function fmtPct1(v: number | null): string {
  return isNum(v) ? `${v.toFixed(1)}%` : DASH
}

/** m:ss — minutes may exceed 59. Input is seconds (rounded to a whole second). */
export function fmtMmss(seconds: number | null): string {
  if (!isNum(seconds)) return DASH
  const total = Math.round(seconds)
  return `${Math.floor(total / 60).toString()}:${pad2(total % 60)}`
}

/** h:mm:ss, or m:ss below one hour. Input is seconds. */
export function fmtHms(seconds: number | null): string {
  if (!isNum(seconds)) return DASH
  const total = Math.round(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return h > 0 ? `${h.toString()}:${pad2(m)}:${pad2(s)}` : `${m.toString()}:${pad2(s)}`
}

export function formatValue(id: FormatId, v: number | null): string {
  switch (id) {
    case 'int':
      return fmtInt(v)
    case 'signed':
      return fmtSigned(v)
    case 'd1':
      return fmtFixed(v, 1)
    case 'd2':
      return fmtFixed(v, 2)
    case 'pct1':
      return fmtPct1(v)
    case 'mmss':
      return fmtMmss(v)
    case 'hms':
      return fmtHms(v)
  }
}

/** Supplied decimal string (e.g. "54.50") + %, exactly as stored. */
export function fmtSuppliedPct(s: string | null): string {
  return s === null ? DASH : `${s}%`
}

export function fmtSuppliedDecimal(s: string | null): string {
  return s ?? DASH
}

/** Parse a supplied decimal string; null/blank/non-finite → null. */
export function parseSupplied(s: string | null | undefined): number | null {
  if (s === null || s === undefined || s === '') return null
  const n = Number.parseFloat(s)
  return Number.isFinite(n) ? n : null
}

/** value / gp, or null when either is missing or gp ≤ 0. */
export function perGame(value: number | null, gp: number | null): number | null {
  if (!isNum(value) || !isNum(gp) || gp <= 0) return null
  return value / gp
}

/** a / b, or null when either is missing or b ≤ 0. */
export function ratio(a: number | null, b: number | null): number | null {
  return perGame(a, b)
}
