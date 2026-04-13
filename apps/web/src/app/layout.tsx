import type { Metadata } from 'next'
import { Barlow, Barlow_Semi_Condensed } from 'next/font/google'
import { TopNav } from '@/components/nav/top-nav'
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
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${barlow.variable} ${barlowSemiCondensed.variable}`}
      suppressHydrationWarning
    >
      <body className="font-sans antialiased">
        <TopNav />
        <main className="mx-auto max-w-screen-xl px-4 py-8">{children}</main>
      </body>
    </html>
  )
}
