import { formatPosition } from '@/lib/format'

export interface PositionBreakdownEntry {
  position: string
  gameCount: number
}

export const POSITION_COLORS: Record<string, string> = {
  center: '#c34353',
  leftWing: '#6ed565',
  rightWing: '#656cbe',
  defenseMen: '#74f2df',
  goalie: '#a587cd',
}
const POSITION_FALLBACK = '#71717a'

export function PositionDonut({ usage }: { usage: PositionBreakdownEntry[] }) {
  const size = 160
  const strokeWidth = 18
  const cx = size / 2
  const cy = size / 2
  const r = (size - strokeWidth * 2) / 2
  const circumference = 2 * Math.PI * r
  const GAP = 3

  const validUsage = usage.filter((u) => u.gameCount > 0)
  const total = validUsage.reduce((sum, u) => sum + u.gameCount, 0)

  const cumulativeLengths = validUsage.reduce<number[]>((acc, u) => {
    const prev = acc[acc.length - 1] ?? 0
    const segFull = total > 0 ? (u.gameCount / total) * circumference : 0
    return [...acc, prev + segFull]
  }, [])

  return (
    <div className="flex flex-col items-center gap-3">
      <svg viewBox={`0 0 ${size.toString()} ${size.toString()}`} className="h-[140px] w-[140px]" aria-hidden>
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke="rgb(39 39 42)"
          strokeWidth={strokeWidth}
        />
        {total > 0 &&
          validUsage.map((u, i) => {
            const segFull = (u.gameCount / total) * circumference
            const segLen = Math.max(0, segFull - GAP)
            const prevAcc = i === 0 ? 0 : (cumulativeLengths[i - 1] ?? 0)
            const color = POSITION_COLORS[u.position] ?? POSITION_FALLBACK
            return (
              <circle
                key={u.position}
                cx={cx}
                cy={cy}
                r={r}
                fill="none"
                stroke={color}
                strokeWidth={strokeWidth}
                strokeDasharray={`${segLen.toString()} ${(circumference - segLen).toString()}`}
                strokeDashoffset={circumference * 0.25 - prevAcc}
              >
                <title>
                  {formatPosition(u.position)}: {u.gameCount} GP
                </title>
              </circle>
            )
          })}
        <text
          x={cx}
          y={cy - 5}
          textAnchor="middle"
          className="fill-zinc-500 text-[9px] font-bold uppercase tracking-widest"
          fontSize="9"
          fontFamily="inherit"
        >
          Position
        </text>
        <text
          x={cx}
          y={cy + 10}
          textAnchor="middle"
          className="fill-zinc-300 text-[13px] font-black"
          fontSize="13"
          fontFamily="inherit"
          fontWeight="900"
        >
          {total} GP
        </text>
      </svg>
      <div className="flex flex-col gap-1">
        {validUsage.map((u) => (
          <div key={u.position} className="flex items-center gap-2">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: POSITION_COLORS[u.position] ?? POSITION_FALLBACK }}
            />
            <span className="font-condensed text-[11px] font-semibold text-zinc-400">
              {formatPosition(u.position)}
            </span>
            <span className="ml-auto font-condensed text-[11px] text-zinc-600">{u.gameCount}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
