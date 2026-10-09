import type { ReactNode } from 'react'
import type { LegalPageSection } from '@/components/legal/legal-page'
import { P, UL, LI, Strong, MailLink, DocLink } from '@/components/legal/legal-prose'

/**
 * Verbatim transcription of `docs/planning/terms-of-use-draft.md`'s public
 * section (## Terms of Use through the end of §15, before "## Internal
 * drafting and publication checks"). Do not reword, trim, or "improve" any
 * sentence here — a content change belongs in the source draft first,
 * through the reviewed-draft workflow, then re-transcribed.
 * `test/legal-http.test.ts` compares this module's rendered output against
 * that draft file directly and fails on any divergence.
 *
 * This document's public section has no intro paragraph before its first
 * numbered section.
 */

export const intro: ReactNode = null

export const sections: LegalPageSection[] = [
  {
    number: 1,
    heading: 'About these Terms',
    body: (
      <>
        <P>
          Boogeymen — a community gaming club — runs this website. These Terms of Use explain the
          rules for using it. By using the site, you agree to these Terms. If you do not agree with
          them, do not use the site.
        </P>
        <P>
          These Terms apply to you as a visitor to this website. Appearing in the match information
          published here — for example, as an opposing player in a game we recorded — is not
          agreement to these Terms, and we do not treat it as agreement to them.
        </P>
      </>
    ),
  },
  {
    number: 2,
    heading: 'What this site is',
    body: (
      <>
        <P>
          This is a public website that publishes match history, rosters, statistics, gamertags and
          related identifiers, and related information for our EA Sports NHL Pro Clubs team. It is
          an informational and archival project, run by a single individual on a volunteer basis and
          offered free of charge.
        </P>
        <P>
          There is no advertising, monetization, or other commercial activity on this site now, and
          none is planned. If that changes, we intend to review these Terms and our privacy
          documents before any commercial activity begins.
        </P>
        <P>
          There is no public account system: you cannot register, upload, comment, or submit content
          through this site. Members of our team can sign in with a Discord account, but only
          through an invite from the site's operator. You can still reach us voluntarily by email —
          see "Contact" below.
        </P>
        <P>
          Membership of our club is adult-only. Some of the opponents we play against in matches may
          include minors; we do not know their ages, cannot verify them, and do not collect them.
          This site does not ask any visitor for age information.
        </P>
      </>
    ),
  },
  {
    number: 3,
    heading: 'How you may use this site',
    body: (
      <>
        <P>
          You may read, view, and browse this site for your own personal, noncommercial purposes.
        </P>
        <P>
          <Strong>Linking.</Strong> You may link to our public pages.
        </P>
        <P>
          <Strong>Personal copies and quotes.</Strong> You may keep a saved copy of a page, take a
          personal screenshot, or quote a short result or excerpt, for your own personal,
          noncommercial use.
        </P>
        <P>
          <Strong>Limited community sharing.</Strong> You may also share what you have kept — a
          saved page, a screenshot, a short quoted result — in ordinary, limited, noncommercial
          community contexts, such as a team Discord, a forum post, or a fan video. A link back to
          the relevant page, or reasonable credit to this site, is encouraged where practical, but
          it is not a condition of this permission.
        </P>
        <P>
          None of this permits republishing this site's information as a dataset, data feed, API,
          database, mirror, or comparable structured compilation, commercial reuse, or systematic or
          high-volume bulk automated collection — see section 4 for what those cover and when
          permission is required. Interfering with, disrupting, or attacking this site, or working
          around rate limits or other protective measures, is prohibited outright under section 5,
          regardless of purpose or permission.
        </P>
        <P>
          <Strong>Third-party rights.</Strong> We grant the permissions in this section only to the
          extent we are actually in a position to do so. Third-party material on this site remains
          subject to the rights of its owners, and nothing in this section grants you any rights
          held by EA, the NHL, the NHLPA, Sony, Microsoft, platform owners, players, teams,
          creators, or other third parties. See section 7 for more on third-party content, names,
          and marks.
        </P>
        <P>
          <Strong>Search engines.</Strong> At present, every page of this site asks search engines
          not to index it. Crawlers may fetch our pages, but we ask that they follow our
          machine-readable instructions, including the request not to list our pages in search
          results.
        </P>
        <P>
          Automated access is not prohibited as such. The limits in the next two sections are about
          disruptive volume, evasion, and downstream reuse — not about whether a request comes from
          a person or from a program.
        </P>
      </>
    ),
  },
  {
    number: 4,
    heading: 'Uses that need our permission first',
    body: (
      <>
        <P>
          Please ask us before you do any of the following. Permission requests go to{' '}
          <MailLink address="webmaster@boogeymen.app" />.
        </P>
        <UL>
          <LI>
            <Strong>Systematic or high-volume bulk automated collection.</Strong> Automated
            collection of this site's content at a systematic or high volume — for example, scraping
            large portions of the match, statistics, roster, or identifier information on an ongoing
            or repeated basis. This is not a general ban on automated access, and it is not directed
            at ordinary search-engine crawling, which remains permitted under section 3. It also
            does not extend permission for conduct that actually degrades, overloads, disrupts, or
            works around rate limits or other protective measures on this site — that conduct is
            prohibited outright under section 5, and it is not available by asking permission here.
          </LI>
          <LI>
            <Strong>Republishing information from this site as a dataset.</Strong> Redistributing
            the match, statistics, roster, identifier, or related information published here —
            regardless of how much is included — as a dataset, data feed, API, database, mirror, or
            comparable structured compilation. This applies whether the republication is commercial
            or noncommercial, and it does not cover the ordinary personal use, quoting, and limited
            community sharing permitted in section 3.
          </LI>
          <LI>
            <Strong>Commercial reuse.</Strong> Using this site's content for commercial purposes,
            including in a paid, advertising-supported, sponsored, or otherwise revenue-generating
            product or service.
          </LI>
        </UL>
        <P>
          If we do give permission, it covers only what we describe when we give it, and only the
          material we are actually in a position to permit. Our permission is ours alone: it is not
          permission from anyone else who holds rights in material appearing on this site — see
          "Third-party content, names, and marks" below.
        </P>
      </>
    ),
  },
  {
    number: 5,
    heading: 'Things you must not do',
    body: (
      <>
        <P>Please do not:</P>
        <UL>
          <LI>
            interfere with, disrupt, overload, or attack this site or the infrastructure it runs on,
            including through denial-of-service traffic or malicious code;
          </LI>
          <LI>
            attempt to gain access to non-public areas, accounts, systems, or data, or to bypass,
            disable, or work around any security, access-control, or rate-limiting measure;
          </LI>
          <LI>misrepresent yourself as us, as connected with us, or as authorized by us; or</LI>
          <LI>
            use this site to harass, threaten, defame, or endanger anyone, or to do anything
            unlawful.
          </LI>
        </UL>
        <P>
          If you believe you have found a security vulnerability, please report it to{' '}
          <MailLink address="security@boogeymen.app" /> rather than testing further.
        </P>
      </>
    ),
  },
  {
    number: 6,
    heading: 'Accuracy, and the archival character of what we publish',
    body: (
      <>
        <P>
          The information on this site comes principally from EA's NHL game services, together with
          our own optical character recognition (OCR) processing and manual review of gameplay
          recordings and screenshots. We make a reasonable effort to keep it accurate, but errors,
          gaps, and delays are possible, in both the source data and our own processing. Nothing
          here is official, and nothing here should be relied on as an authoritative record.
        </P>
        <P>
          This site is intended as a historical archive of our team, so we generally keep past match
          information rather than removing or rewriting it. If you believe something is wrong, or
          you want to ask about correction, de-identification, or removal of information about you,
          please write to <MailLink address="webmaster@boogeymen.app" />. Those requests are handled
          case-by-case, under applicable law and our legitimate need to keep an accurate archival
          record, through the process described in our Privacy Policy and Data Collection Policy.
          These Terms do not change, replace, or limit that process.
        </P>
      </>
    ),
  },
  {
    number: 7,
    heading: 'Third-party content, names, and marks',
    body: (
      <>
        <P>
          This site displays material that comes from EA's game services and from other third
          parties, alongside material we created ourselves — our own written text, our page design,
          and the operator-created artwork identified in our attribution notice.
        </P>
        <P>
          We do not claim to own everything that appears on this site. Third-party names, marks,
          logos, images, and other material remain subject to the rights of their respective owners,
          and nothing in these Terms grants you any rights in that material. Boogeymen is an
          independent fan project and is not endorsed by, affiliated with, or sponsored by EA, the
          NHL, the NHLPA, PlayStation, Xbox, Sony, Microsoft, or any team, club, or player. For the
          detail of where the material on this site comes from, and for our non-affiliation
          statement in full, see our attribution notice at{' '}
          <DocLink to="attribution">/legal/attribution</DocLink>.
        </P>
        <P>
          If you are a rights holder with a question or concern about material on this site, please
          write to <MailLink address="webmaster@boogeymen.app" />.
        </P>
      </>
    ),
  },
  {
    number: 8,
    heading: 'Privacy',
    body: (
      <P>
        How we handle information is set out in our Privacy Policy at{' '}
        <DocLink to="privacy">/legal/privacy</DocLink> and, in detail, in our Data Collection Policy
        at <DocLink to="data-collection">/legal/data-collection</DocLink>. Those documents govern
        that subject, and these Terms do not change or replace them.
      </P>
    ),
  },
  {
    number: 9,
    heading: 'Availability of the site',
    body: (
      <P>
        This is a volunteer project running on modest infrastructure. We do not promise that the
        site will be available, uninterrupted, or complete, and we may change, suspend, or
        discontinue any part of it — or all of it — at any time, without notice. This does not
        affect the notice we give for material changes to these Terms — see section 14.
      </P>
    ),
  },
  {
    number: 10,
    heading: 'Restricting access',
    body: (
      <>
        <P>
          If conduct disrupts the site or breaks these Terms, we may take proportionate technical
          measures in response: rate-limiting, blocking or filtering requests, or otherwise
          restricting access. These measures may be temporary.
        </P>
        <P>
          Member accounts are invite-only, and the site's operator may disable a member account that
          is misused or no longer needed. Otherwise, these measures apply to requests rather than to
          accounts. If you think your access has been restricted in error, write to{' '}
          <MailLink address="webmaster@boogeymen.app" />.
        </P>
      </>
    ),
  },
  {
    number: 11,
    heading: 'No warranties',
    body: (
      <>
        <P>
          This site is provided free of charge, "as is" and "as available". We do not warrant that
          it will be accurate, complete, current, uninterrupted, error-free, or secure, and we make
          no other warranties or representations about it.
        </P>
        <P>
          Some warranties, guarantees, and rights cannot be excluded or limited by agreement.
          Nothing in this section excludes, restricts, or modifies any right, guarantee, or remedy
          that applicable law — including consumer protection law — does not permit us to exclude,
          restrict, or modify. This section applies only to the extent applicable law allows.
        </P>
      </>
    ),
  },
  {
    number: 12,
    heading: 'Limits on our liability',
    body: (
      <>
        <P>
          To the fullest extent applicable law allows, Boogeymen and the individual who operates it
          are not liable for any indirect, incidental, special, or consequential loss, or for lost
          data, lost profits, or loss arising from your reliance on information published on this
          site or from the site being unavailable.
        </P>
        <P>
          As in the previous section, nothing here excludes, restricts, or modifies any liability or
          remedy that applicable law does not permit us to exclude, restrict, or modify, and this
          section applies only to the extent applicable law allows.
        </P>
      </>
    ),
  },
  {
    number: 13,
    heading: 'Governing law',
    body: (
      <>
        <P>
          These Terms are governed by the laws of the Province of Alberta and the federal laws of
          Canada that apply there.
        </P>
        <P>
          We do not require you to bring any claim in a particular court. These Terms contain no
          exclusive-venue clause, no arbitration requirement, and no waiver of a jury trial where
          one would otherwise be available to you. If the law of the place where you live gives you
          mandatory rights, or access to a court or regulator there, this section does not take that
          away.
        </P>
      </>
    ),
  },
  {
    number: 14,
    heading: 'Changes to these Terms',
    body: (
      <P>
        We may update these Terms from time to time. This page always shows the date it was last
        updated at the top, and we will post an on-site notice when we make a material change.
        Changes apply going forward from the date they are posted.
      </P>
    ),
  },
  {
    number: 15,
    heading: 'Contact',
    body: (
      <UL>
        <LI>
          General questions, permission requests for the uses listed in section 4, corrections, and
          rights-holder inquiries:{' '}
          <Strong>
            <MailLink address="webmaster@boogeymen.app" />
          </Strong>
        </LI>
        <LI>
          Security vulnerability reports only:{' '}
          <Strong>
            <MailLink address="security@boogeymen.app" />
          </Strong>
        </LI>
      </UL>
    ),
  },
]
