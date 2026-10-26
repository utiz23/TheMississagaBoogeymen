export const trimSlash = (s: string) => s.replace(/\/+$/, '')

export function intOr(value: string | undefined, fallback: number): number {
  const n = value === undefined ? NaN : Number.parseInt(value, 10)
  return Number.isSafeInteger(n) && n > 0 ? n : fallback
}

export function amountOr(value: string | undefined, fallback: number): number {
  const n = value === undefined || value.trim() === '' ? NaN : Number(value)
  return Number.isFinite(n) && n > 0 ? n : fallback
}
