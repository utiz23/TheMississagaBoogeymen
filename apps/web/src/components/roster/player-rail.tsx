'use client'

import { useEffect, useState, type MouseEvent } from 'react'
import './player-rail.css'

export interface RailSheet {
  /** DOM id of the section wrapper on the page. */
  id: string
  /** Short doc code, e.g. "REC" → "REC/0010". */
  code: string
  title: string
}

/**
 * Case-file index rail for the player page (wireframe 1c/2a). Lists the sheets
 * actually rendered, ticks the one being read, and jumps on click.
 *
 * It lives in the empty margin LEFT of the page column and only shows when that
 * margin is wide enough (see player-rail.css), so it never narrows the content.
 */
export function PlayerRail({
  sheets,
  gamertag,
  fileNo,
}: {
  sheets: RailSheet[]
  gamertag: string
  /** Zero-padded jersey ("0010"), or null when unknown. */
  fileNo: string | null
}) {
  const [active, setActive] = useState(sheets[0]?.id ?? null)

  useEffect(() => {
    let frame = 0
    const update = () => {
      frame = 0
      // The active sheet is the last one whose top has crossed 30% of the viewport;
      // at the very bottom of the page it's the last sheet, however short.
      const line = window.innerHeight * 0.3
      const atBottom =
        window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4
      let current = sheets[0]?.id ?? null
      for (const s of sheets) {
        const el = document.getElementById(s.id)
        if (el !== null && el.getBoundingClientRect().top <= line) current = s.id
      }
      if (atBottom) current = sheets[sheets.length - 1]?.id ?? current
      setActive(current)
    }
    const onScroll = () => {
      if (frame === 0) frame = requestAnimationFrame(update)
    }
    update()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      if (frame !== 0) cancelAnimationFrame(frame)
    }
  }, [sheets])

  const jump = (e: MouseEvent<HTMLAnchorElement>, id: string) => {
    const el = document.getElementById(id)
    if (el === null) return
    e.preventDefault()
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
    history.replaceState(null, '', `#${id}`)
  }

  const suffix = fileNo ?? '----'

  return (
    <aside className="pr-rail" aria-label="Player page sections">
      <nav className="pr-inner">
        <div className="pr-head">
          <span className="pr-kicker">Case File</span>
          <span className="pr-who">
            BGM-{suffix} · {gamertag}
          </span>
        </div>

        <ol className="pr-list">
          {sheets.map((s, i) => {
            const on = s.id === active
            return (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  className={on ? 'pr-item is-active' : 'pr-item'}
                  aria-current={on ? 'location' : undefined}
                  onClick={(e) => jump(e, s.id)}
                >
                  <span className="pr-title">
                    <span className="pr-no">{String(i + 1).padStart(2, '0')}</span>
                    {s.title}
                  </span>
                  <span className="pr-code">
                    {s.code}/{suffix}
                  </span>
                </a>
              </li>
            )
          })}
        </ol>

        <div className="pr-stamp">
          File · {sheets.length} {sheets.length === 1 ? 'sheet' : 'sheets'}
        </div>
      </nav>
    </aside>
  )
}
