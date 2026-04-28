'use client'

import { useEffect, useMemo, useState } from 'react'
import Image from 'next/image'
import { opponentCrestUrls } from '@/lib/format'

interface OpponentCrestProps {
  crestAssetId: string | null
  useBaseAsset: string | null
  alt: string
  width: number
  height: number
  className?: string
  fallback?: React.ReactNode
}

export function OpponentCrest({
  crestAssetId,
  useBaseAsset,
  alt,
  width,
  height,
  className,
  fallback = null,
}: OpponentCrestProps) {
  const urls = useMemo(
    () => opponentCrestUrls(crestAssetId, useBaseAsset),
    [crestAssetId, useBaseAsset],
  )
  const [urlIndex, setUrlIndex] = useState(0)
  const [exhausted, setExhausted] = useState(urls.length === 0)

  useEffect(() => {
    setUrlIndex(0)
    setExhausted(urls.length === 0)
  }, [urls])

  if (exhausted || urls.length === 0) return <>{fallback}</>

  const src = urls[urlIndex]
  if (!src) return <>{fallback}</>

  return (
    <Image
      src={src}
      alt={alt}
      width={width}
      height={height}
      className={className}
      onError={() => {
        if (urlIndex < urls.length - 1) {
          setUrlIndex((current) => current + 1)
          return
        }
        setExhausted(true)
      }}
    />
  )
}
