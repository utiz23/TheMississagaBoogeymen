import type { Metadata } from 'next'
import { Barlow, Barlow_Semi_Condensed } from 'next/font/google'
import { TopNav } from '@/components/nav/top-nav'
import { SiteFooter } from '@/components/nav/site-footer'
import './globals.css'

const barlow = Barlow({
  subsets: ['latin'],
  variable: '--font-barlow',
  weight: ['400', '500', '600', '700'],
  display: 'swap',
})

const barlowSemiCondensed = Barlow_Semi_Condensed({
  subsets: ['latin'],
  variable: '--font-barlow-sc',
  weight: ['400', '500', '600', '700', '900'],
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Club Stats',
  description: 'EASHL team stats and analytics',
  // Unlisted launch: no page should appear in search results (see app/robots.ts).
  robots: { index: false, follow: false },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${barlow.variable} ${barlowSemiCondensed.variable}`}
      suppressHydrationWarning
    >
      <head>
        {/* Arms the game sheet's entrance gate BEFORE the first paint.

            The gate itself lives in CSS (`.gs-js .game-sheet
            [data-gs-stage]:not([data-gs-armed]) *`), and it is deliberately
            keyed on a class that only JS can set, so that with JS disabled
            nothing is ever paused and every entrance simply plays.

            Setting that class from a client component was too late: the
            server-rendered markup already carries its animation classes, so
            every cue started running at first paint and was only frozen a few
            hundred ms later, once the motion chunk evaluated. A scroll-armed
            module then resumed from the MIDDLE of its timeline — the action
            tracker's plot-in visibly skipped its opening markers. A synchronous
            inline script in <head> runs before the body is parsed, so the pause
            is in force for frame one and every cascade starts at 0%.

            Still fail-open: no JS means no class means no pause. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `document.documentElement.classList.add('gs-js')`,
          }}
        />
      </head>
      <body className="flex min-h-screen flex-col font-sans antialiased">
        {/* Keyboard users skip the nav; visible only when focused. */}
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:bg-accent focus:px-4 focus:py-2 focus:font-condensed focus:text-sm focus:font-bold focus:uppercase focus:tracking-widest focus:text-white"
        >
          Skip to content
        </a>
        <TopNav />
        <main id="main" className="mx-auto w-full max-w-screen-xl flex-1 px-4 py-8">
          {children}
        </main>
        <SiteFooter />
      </body>
    </html>
  )
}
