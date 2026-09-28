import type { ReactNode } from 'react'
import type { LegalPageSection } from '@/components/legal/legal-page'
import { P, UL, LI, Strong, MailLink, DocLink } from '@/components/legal/legal-prose'

/**
 * Verbatim transcription of
 * `docs/planning/ea-nhl-attribution-notice-draft.md`'s public notice
 * (## Public notice through the end of §10, before "## Drafting
 * component: short-form / footer notice"). Do not reword, trim, or
 * "improve" any sentence here — a content change belongs in the source
 * draft first, through the reviewed-draft workflow, then re-transcribed.
 * `test/legal-http.test.ts` compares this module's rendered output against
 * that draft file directly and fails on any divergence.
 *
 * The drafting component ("Drafting component: short-form / footer
 * notice") that follows the public notice in the source file is NOT
 * transcribed anywhere in this app — it is explicitly out of scope for
 * this legal page and for the Unit 2 footer.
 *
 * This document's public section has no intro paragraph before its first
 * numbered section.
 */

export const intro: ReactNode = null

export const sections: LegalPageSection[] = [
  {
    number: 1,
    heading: 'What Boogeymen is',
    body: (
      <>
        <P>
          Boogeymen is an independent, individually operated, noncommercial community gaming-club
          and fan project built around our EA Sports NHL Pro Clubs team. There is no advertising,
          monetization, or other commercial activity on this site now, and none is planned.
        </P>
        <P>
          <Strong>
            Boogeymen is not an official Electronic Arts (EA), EA SPORTS, NHL, NHLPA, PlayStation,
            Xbox, Sony, Microsoft, league, team, club, or player site.
          </Strong>{' '}
          Nothing on this site should be read as implying sponsorship, endorsement, partnership,
          approval, or affiliation by or with any of those parties, or with any other organization
          or individual named or depicted on this site.
        </P>
        <P>
          Electronic Arts specifies the following statement as a condition for websites that display
          EA game content, and we state it here:
        </P>
        <P>
          <Strong>This website is not endorsed by or affiliated with EA or its licensors.</Strong>
        </P>
      </>
    ),
  },
  {
    number: 2,
    heading: 'Where our match and statistics data comes from',
    body: (
      <>
        <P>
          The match, club, roster, player, opponent, statistics, identifier, and related game data
          shown on this site originates primarily from EA's NHL game services. Some additional
          statistics and supporting evidence come from our own operator-run optical character
          recognition (OCR) processing and manual review of gameplay recordings and screenshots.
        </P>
        <P>
          Boogeymen independently prepares, organizes, and presents the calculations, summaries, and
          derived statistics published here, and is solely responsible for them. This site is not an
          official EA data source, and Boogeymen neither claims nor knows of any EA review,
          verification, or approval of that work.
        </P>
        <P>
          The site may contain errors, including in data drawn from EA's services or produced by our
          own processing. If you believe something is inaccurate, or you have a correction request,
          contact{' '}
          <Strong>
            <MailLink address="webmaster@boogeymen.app" />
          </Strong>
          .
        </P>
      </>
    ),
  },
  {
    number: 3,
    heading: 'EA-sourced visual material',
    body: (
      <>
        <P>
          This section describes, factually and without characterizing their legal status, the
          EA-sourced images currently used on this site.
        </P>
        <UL>
          <LI>
            <Strong>NHL X-Factor images.</Strong> The X-Factor ability icons shown on player loadout
            displays were obtained from web and content-delivery (CDN) sources operated by EA, and
            are stored and served by this site.
          </LI>
          <LI>
            <Strong>Opponent club crest images.</Strong> Crest images shown for opposing clubs are
            retrieved from EA's media/game-data sources, using identifiers EA's game services return
            for each club. EA's data distinguishes a base crest family from a club-specific custom
            crest family. We do not state here who created or owns any particular crest.
          </LI>
        </UL>
      </>
    ),
  },
  {
    number: 4,
    heading: 'NHL, NHLPA, and other third-party rights',
    body: (
      <>
        <P>
          EA states that it does not provide permission to use third-party content from its games.
          EA's materials therefore do not purport to grant rights held by the NHL, the NHLPA,
          individual teams or clubs, individual players, Sony or PlayStation, Microsoft or Xbox, or
          other third parties. Names, marks, likenesses, and other material associated with those
          parties that may appear on this site — directly or as part of EA-sourced content — remain
          subject to the rights of their respective owners.
        </P>
        <P>
          References to third parties on this site identify a source or provide context. They do not
          imply affiliation, they do not identify the specific owner of any individual mark or
          asset, and they do not state the scope of any trademark right. Nothing in this notice
          asserts a specific ownership claim, and nothing in it should be read as claiming that
          providing this attribution, by itself, creates or establishes permission to use any such
          content.
        </P>
      </>
    ),
  },
  {
    number: 5,
    heading: 'Platform marks and other SVG-derived assets',
    body: (
      <>
        <UL>
          <LI>
            <Strong>PlayStation and Xbox marks.</Strong> The PlayStation and Xbox marks used on this
            site were obtained through SVG Repo (svgrepo.com).
          </LI>
          <LI>
            <Strong>Player-archetype icons.</Strong> The player-archetype icons shown on this site
            were reproduced as inline vector paths from local SVG files obtained through SVG Repo.
            The inline paths deployed on this site do not themselves contain the SVG Repo metadata
            carried by those local source files.
          </LI>
        </UL>
        <P>The country flags used on this site are attributed in section 6.</P>
      </>
    ),
  },
  {
    number: 6,
    heading: 'Other third-party visual and typographic elements',
    body: (
      <>
        <P>
          <Strong>Country flags.</Strong> The country flags rendered by the site reproduce vector
          artwork from the project's local Canada and United States SVG source files. The metadata
          in those local files refers to SVG Repo and to a Twemoji-derived visual style.
        </P>
        <P>
          <Strong>Typefaces.</Strong> This site uses the Barlow and Barlow Semi Condensed typefaces.
          The site's current source loads them through Next.js font tooling, which retrieves the
          font files at build time and self-hosts them as part of the site's own build output.
        </P>
      </>
    ),
  },
  {
    number: 7,
    heading: 'Operator-created material',
    body: (
      <UL>
        <LI>
          <Strong>BGM/SPD logo artwork</Strong> is original artwork created by our operator.
        </LI>
        <LI>
          <Strong>Rink and event-marker artwork</Strong> was created from scratch by our operator
          and later incorporated into the site's design with the assistance of Claude Design.
        </LI>
      </UL>
    ),
  },
  {
    number: 8,
    heading: 'What this notice does not grant you',
    body: (
      <P>
        This notice does not grant visitors any rights in EA-sourced content, NHL or NHLPA material,
        platform marks, SVG-derived assets, third-party fonts or icons, or any other third-party
        material referenced on this site. Third-party names, marks, images, and other material
        described in this notice remain subject to the rights of their respective owners. Detailed
        rules about how visitors may use content on this site are set out in our Terms of Use —{' '}
        <DocLink to="terms">/legal/terms</DocLink>.
      </P>
    ),
  },
  {
    number: 9,
    heading: 'Questions, corrections, and rights-holder inquiries',
    body: (
      <P>
        For attribution questions, correction requests, or inquiries from a rights holder about
        material on this site, contact{' '}
        <Strong>
          <MailLink address="webmaster@boogeymen.app" />
        </Strong>
        . Security vulnerability reports should go to <MailLink address="security@boogeymen.app" />{' '}
        instead.
      </P>
    ),
  },
  {
    number: 10,
    heading: 'Changes to this notice',
    body: (
      <P>
        We will post an on-site notice when we make a material change to this notice, and this page
        will always show the date it was last updated at the top.
      </P>
    ),
  },
]
