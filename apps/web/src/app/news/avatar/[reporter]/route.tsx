import { ImageResponse } from 'next/og'
import { REPORTERS, REPORTER_IDS, type ReporterId } from '@eanhl/db/news'
import { initialsColor } from '@/lib/news/avatar-color'

const SIZE = 256

function isReporterId(id: string): id is ReporterId {
  return (REPORTER_IDS as readonly string[]).includes(id)
}

/**
 * A reporter's picture: initials on their tint (dark, or white when white is
 * readable), 256x256 PNG. The Discord webhook sends this URL as the avatar,
 * so the URL must stay as it is.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ reporter: string }> },
): Promise<Response> {
  const { reporter } = await params
  if (!isReporterId(reporter)) return new Response('Not Found', { status: 404 })
  const r = REPORTERS[reporter]
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: r.tint,
        color: initialsColor(r.tint),
        fontSize: 120,
        fontWeight: 700,
        letterSpacing: 4,
      }}
    >
      {r.initials}
    </div>,
    {
      width: SIZE,
      height: SIZE,
      headers: { 'cache-control': 'public, max-age=86400' },
    },
  )
}
