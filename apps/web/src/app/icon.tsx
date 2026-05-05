import { ImageResponse } from 'next/og'

export const size = {
  width: 32,
  height: 32,
}

export const contentType = 'image/png'

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          alignItems: 'center',
          background: '#111215',
          color: '#ff285a',
          display: 'flex',
          fontSize: 24,
          fontStyle: 'italic',
          fontWeight: 900,
          height: '100%',
          justifyContent: 'center',
          textTransform: 'uppercase',
          width: '100%',
        }}
      >
        BM
      </div>
    ),
    size,
  )
}
