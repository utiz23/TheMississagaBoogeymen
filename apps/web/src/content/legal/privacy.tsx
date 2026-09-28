import type { ReactNode } from 'react'
import type { LegalPageSection } from '@/components/legal/legal-page'
import { P, UL, LI, Strong, Em, Code, MailLink, DocLink } from '@/components/legal/legal-prose'

/**
 * Verbatim transcription of `docs/planning/privacy-policy-draft.md`'s
 * public section (## Privacy Policy through the end of §13, before
 * "## Internal drafting and publication checks"). Do not reword, trim, or
 * "improve" any sentence here — a content change belongs in the source
 * draft first, through the reviewed-draft workflow, then re-transcribed.
 * `test/legal-http.test.ts` compares this module's rendered output against
 * that draft file directly and fails on any divergence.
 *
 * Straight quotes/apostrophes throughout, matching the source markdown's
 * own ASCII punctuation exactly — not typographic entities, which would
 * silently break that text-level comparison.
 */

export const intro: ReactNode = (
  <P>
    This Privacy Policy explains, in plain language, how Boogeymen handles information in connection
    with this website. It is a short overview. For the detailed inventory of exactly what we
    collect, where it comes from, why we keep it, how long, and how public display works, see our{' '}
    <DocLink to="data-collection">Data Collection Policy</DocLink> — that document is the
    authoritative, detailed source, and this policy does not repeat its full contents.
  </P>
)

export const sections: LegalPageSection[] = [
  {
    number: 1,
    heading: 'Who operates this project',
    body: (
      <>
        <P>
          Boogeymen is a community gaming-club project for our EA Sports NHL Pro Clubs team. It is
          currently operated by a single individual on a volunteer basis. That describes who runs it
          day to day — it is not a statement about the project's legal form, and it is not a
          statement about which privacy law, if any, applies to it.
        </P>
        <P>
          There is no advertising, monetization, or other commercial activity on this site now, and
          none is planned. If that changes, we intend to carry out a fresh privacy review before any
          commercial activity begins.
        </P>
      </>
    ),
  },
  {
    number: 2,
    heading: 'How you can use this site',
    body: (
      <P>
        This is a public, read-only website. Visitors cannot register, log in, upload anything,
        comment, or submit content through the site. There is no on-site submission form. You can
        still reach us voluntarily by email — see "Privacy contact and requests" below.
      </P>
    ),
  },
  {
    number: 3,
    heading: 'Information we maintain',
    body: (
      <>
        <P>
          In summary, we maintain team-member and opponent match information — including gamertags,
          statistics, roster and match history, opponent-club and opponent-player information
          (including an EA-provided identifier that stays the same for each opponent across matches,
          so our records can link that opponent's appearances over time), OCR (optical character
          recognition) evidence, and the source recordings and screenshots that evidence is drawn
          from — along with raw data as received from EA's game services and correspondence sent to
          our project email addresses.
        </P>
        <P>
          Our source gameplay recordings may incidentally include in-game party voice chat. This is
          not a statement that any recording is lawful; see the Data Collection Policy for the
          detailed factual treatment.
        </P>
        <P>
          This is a summary, not the full list. For the complete category-by-category inventory,
          including how each category is sourced and used, see our{' '}
          <DocLink to="data-collection">Data Collection Policy</DocLink>.
        </P>
      </>
    ),
  },
  {
    number: 4,
    heading: 'Public pages versus private evidence',
    body: (
      <P>
        Our canonical public pages — things like team, game, player, and stats pages — are intended
        to be found through normal search-engine indexing, the same as any other public website. The
        private source evidence behind those statistics (raw recordings, screenshots, frames, and
        related OCR provenance/confidence records) is not published and is not intended to be
        indexed. See the Data Collection Policy for how public display and indexing work in more
        detail.
      </P>
    ),
  },
  {
    number: 5,
    heading: 'Information about your visit',
    body: (
      <>
        <P>
          Our own application source code does not directly use <Code>localStorage</Code>,{' '}
          <Code>sessionStorage</Code>, browser cookies, or <Code>indexedDB</Code>. That describes
          our own code — it is not a claim that no browser storage of any kind is ever used by any
          underlying framework, dependency, or infrastructure component we rely on.
        </P>
        <P>
          Our hosting/security provider (Cloudflare) may, under some circumstances, use strictly
          necessary cookies or similar mechanisms as part of its edge security or challenge
          processing. We do not currently have specific, verified information about any individual
          cookie Cloudflare may set, so we are not naming one here. We do not plan to show a
          cookie-consent banner while our posture is "no nonessential tracking," but whether a
          banner is legally required in any particular jurisdiction is a legal-review question, not
          one this policy resolves for itself. See the Data Collection Policy for the detailed,
          authoritative treatment of cookies and browser storage.
        </P>
        <P>
          This site's hosting and security infrastructure may generate access, operational, error,
          and security logs in the ordinary course of running and protecting the site. We do not
          claim that any particular log exists, or describe its exact contents, without evidence
          that it does — see "How long we keep information" below for how we treat logs we control.
        </P>
      </>
    ),
  },
  {
    number: 6,
    heading: 'Analytics',
    body: (
      <>
        <P>
          <Strong>Cloudflare Web Analytics is currently enabled</Strong> on this site's Cloudflare
          configuration. This conflicts with our intended "no analytics" launch posture.{' '}
          <Strong>
            We intend to disable Cloudflare Web Analytics, and confirm from our live Cloudflare
            dashboard that it is off, before this site is published.
          </Strong>{' '}
          This policy does not claim analytics is already disabled, and will not do so until that
          has been verified.
        </P>
        <P>
          Cloudflare describes its Web Analytics product as cookie-free — Cloudflare states the
          product does not use cookies or client-side storage to collect metrics. We attribute that
          claim to Cloudflare. Cloudflare Web Analytics is nonetheless an analytics feature, and
          having it enabled conflicts with our approved no-analytics posture regardless of whether
          it uses cookies. Whether a cookie-consent banner is legally required in any particular
          jurisdiction remains unresolved and is a legal-review question.
        </P>
      </>
    ),
  },
  {
    number: 7,
    heading: 'Service providers',
    body: (
      <>
        <P>
          We use a small number of outside services to run this project: <Strong>Cloudflare</Strong>{' '}
          (domain, DNS, and proxied edge/security layer), <Strong>Proton Mail</Strong> (email),{' '}
          <Strong>GitHub</Strong> (a private repository holding our source code and a limited set of
          test fixtures), <Strong>EA's game services</Strong> (the source of underlying game data),
          and <Strong>community-operated hosting infrastructure based in Alberta, Canada</Strong>.
        </P>
        <P>
          This is a summary list, not a legal classification. We do not describe any provider here
          as a "processor," "controller," "service provider," or similar legal term — that
          determination has not been made. We do not claim to have a data-processing agreement, a
          specific contractual term, or a specific retention period with any provider beyond what we
          have directly verified, and we do not assert where any provider physically stores
          information. See the Data Collection Policy for more detail on how each provider is used.
        </P>
      </>
    ),
  },
  {
    number: 8,
    heading: 'Cross-border handling',
    body: (
      <P>
        Because we use Cloudflare, Proton Mail, GitHub, EA's services, and the ordinary
        infrastructure of the internet, some information may be processed or transmitted outside
        Alberta, or outside Canada, as part of how those services work. We do not have verified
        information about the exact countries involved, and we do not publish a list of them here.
        Separately, we do not state what legal role any of these providers has in relation to your
        information — see "Service providers" above.
      </P>
    ),
  },
  {
    number: 9,
    heading: 'Safeguards',
    body: (
      <P>
        We take reasonable steps to protect the information we maintain, but no website or storage
        system can guarantee absolute security. If personal information we hold is lost, or accessed
        or disclosed without authorization, in a way that creates a real risk of harm to someone, we
        will carry out any incident reporting or notification that applicable law requires of us.
        This policy does not set out our internal incident-response procedure.
      </P>
    ),
  },
  {
    number: 10,
    heading: 'How long we keep information',
    body: (
      <>
        <P>
          In summary: we keep match, statistics, and evidentiary records for as long as we
          reasonably need them to maintain an accurate historical archive of our team, with removal
          happening by manual operator action rather than on a fixed schedule. See the{' '}
          <DocLink to="data-collection">Data Collection Policy</DocLink> for the full retention
          treatment by category, including email-correspondence retention.
        </P>
        <P>
          <Strong>Logs under our control</Strong> do not currently have a fixed automatic deletion
          period. We retain them only for as long as reasonably needed to operate, secure,
          troubleshoot, or protect the website, or to meet applicable legal obligations. We delete
          them when they are no longer reasonably needed for those purposes. Logs controlled
          independently by service providers are subject to those providers' own practices and
          retention periods.
        </P>
        <P>We have not adopted a scheduled periodic review of our main historical archive.</P>
      </>
    ),
  },
  {
    number: 11,
    heading: 'Privacy contact and requests',
    body: (
      <>
        <P>
          To ask about, correct, or otherwise raise a question about information we hold, contact
          the <Strong>Privacy Contact for Boogeymen</Strong> at{' '}
          <Strong>
            <MailLink address="webmaster@boogeymen.app" />
          </Strong>
          .
        </P>
        <UL>
          <LI>We do not charge a fee for access or correction requests.</LI>
          <LI>
            We may ask for reasonable evidence that you control the gamertag or identity in
            question. We do not request government-issued ID by default.
          </LI>
          <LI>
            Correction, de-identification, or removal is considered case-by-case, under applicable
            law and our legitimate need to keep an accurate archival record. We do not promise
            removal in every case, and we do not rule out that applicable law may require it in a
            given case. The fact that information was previously published by EA through its own
            game services is not, by itself, a reason for us to refuse a request.
          </LI>
          <LI>
            If a privacy law that applies to us gives you a right to ask a regulator to review how
            we handled your request, we want you to be able to use it. In Alberta, that regulator is
            the Office of the Information and Privacy Commissioner of Alberta (
            <Code>oipc.ab.ca</Code>). We mention this as the applicable route where Alberta's{' '}
            <Em>Personal Information Protection Act</Em> governs a request; mentioning it is not a
            statement that this project's activities are conclusively covered by that Act.
          </LI>
        </UL>
        <P>
          See the <DocLink to="data-collection">Data Collection Policy</DocLink> for the full detail
          on request types (access, correction, withdrawal, removal), response targets, and how
          mixed records involving other people are handled.
        </P>
        <P>
          <Strong>Security reports.</Strong> If you need to report a security vulnerability, use{' '}
          <Code>security@boogeymen.app</Code>. That address is for vulnerability reports only.
        </P>
      </>
    ),
  },
  {
    number: 12,
    heading: 'Team membership and opponents',
    body: (
      <P>
        Team membership on this site is adult-only; no children are, or are planned to be, members
        of our club. Some of the opponents we play against in matches may include minors. We do not
        know their ages, cannot verify them, do not collect them, and have no way to determine them
        from the information EA's game services provide.
      </P>
    ),
  },
  {
    number: 13,
    heading: 'Changes to this policy',
    body: (
      <P>
        We will post an on-site notice when we make a material change to this policy, and this page
        will always show the date it was last updated at the top.
      </P>
    ),
  },
]
