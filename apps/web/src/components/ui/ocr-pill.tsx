import { getOcrCoverageStyle, ocrCoverageTier, type OcrCoverageStreams } from '@/lib/ocr-coverage'

interface OcrPillProps {
  streams: OcrCoverageStreams
  className?: string
}

/**
 * OCR coverage pill — how much of a match the video pipeline captured.
 *
 * Green / orange / red status dot for full (3 of 3) / partial (2) / minimal
 * (1) streams. Renders nothing when a match has no OCR at all, which is most
 * of the archive: the pill marks the exception, it isn't a field on every row.
 *
 * Sized and spaced to sit in the score card's existing chip cluster alongside
 * the game-mode and Private chips.
 */
export function OcrPill({ streams, className = '' }: OcrPillProps) {
  const style = getOcrCoverageStyle(ocrCoverageTier(streams))
  if (style === null) return null

  return (
    <span
      title={style.title}
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] ${style.container} ${className}`}
    >
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
      {style.label}
    </span>
  )
}
