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
        This is a public website that visitors can read but not change. Visitors cannot register,
        upload anything, comment, or submit content through the site, and there is no on-site
        submission form. Members of our team can sign in with a Discord account, but only through an
        invite from the site's operator; there is no public sign-up. You can still reach us
        voluntarily by email — see "Privacy contact and requests" below.
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
          For team members who sign in, we also keep a small member-account record: the member's
          Discord user ID and Discord display name, which player on our team the account is linked
          to, the account's role, settings the member chooses for their own player, and sign-in
          session records. We do not receive or keep the member's email address, Discord avatar, or
          Discord password, and we do not keep Discord access tokens.
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
        Our public pages — things like team, game, player, and stats pages — are shared by direct
        link. At present, every page of this site asks search engines not to index it, so the site
        is not intended to appear in search results; if we later allow indexing, we will update this
        policy first. The private source evidence behind those statistics (raw recordings,
        screenshots, frames, and related OCR provenance/confidence records) is not published and is
        not intended to be indexed. See the Data Collection Policy for how public display and
        indexing work in more detail.
      </P>
    ),
  },
  {
    number: 5,
    heading: 'Information about your visit',
    body: (
      <>
        <P>
          Visitors who do not sign in get no cookies from this site's own code, and our code does
          not use <Code>localStorage</Code>, <Code>sessionStorage</Code>, or <Code>indexedDB</Code>.
          When a team member signs in, our code sets two strictly necessary cookies: a short-lived
          one (about 5 minutes) that protects the Discord sign-in step, and a session cookie that
          keeps the member signed in for up to 30 days. That describes our own code — it is not a
          claim that no browser storage of any kind is ever used by any underlying framework,
          dependency, or infrastructure component we rely on.
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
          This site's hosting and security infrastructure generates operational and error logs in
          the ordinary course of running and protecting the site. Our own server keeps these in
          small, size-limited rolling logs, and our website software does not keep a separate record
          of each page visit. Our network and security provider (Cloudflare) may keep its own logs —
          see "How long we keep information" below for how we treat logs we control.
        </P>
      </>
    ),
  },
  {
    number: 6,
    heading: 'Analytics',
    body: (
      <P>
        <Strong>We do not use analytics.</Strong> Cloudflare Web Analytics, which was previously
        enabled in this site's Cloudflare configuration, has been turned off, and this site uses no
        advertising or other nonessential tracking. Whether a cookie-consent banner is legally
        required in any particular jurisdiction remains unresolved and is a legal-review question.
      </P>
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
          test fixtures), <Strong>Backblaze</Strong> (off-site storage for backup copies of our
          database), <Strong>Healthchecks.io</Strong> (monitoring that receives only status messages
          from our server, not information about visitors), <Strong>Discord</Strong> (the sign-in
          service team members use; it tells us only the member's Discord user ID and display name),{' '}
          <Strong>EA's game services</Strong> (the source of underlying game data), and{' '}
          <Strong>community-operated hosting infrastructure based in Alberta, Canada</Strong>.
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
        Because we use Cloudflare, Proton Mail, GitHub, Backblaze, Discord, EA's services, and the
        ordinary infrastructure of the internet, some information may be processed or transmitted
        outside Alberta, or outside Canada, as part of how those services work. We do not have
        verified information about the exact countries involved, and we do not publish a list of
        them here. Separately, we do not state what legal role any of these providers has in
        relation to your information — see "Service providers" above.
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
          <Strong>Logs under our control</Strong> are size-limited rather than kept for a fixed
          period: our server keeps a small rolling log for each part of the site and automatically
          overwrites the oldest entries. Backup copies of our database are kept on the schedule
          described in the Data Collection Policy. Logs controlled independently by service
          providers are subject to those providers' own practices and retention periods.
        </P>
        <P>
          <Strong>Member accounts</Strong> are kept while the person is a member of our team and are
          deleted on request. A sign-in session is deleted when the member signs out and otherwise
          stops working after 30 days without use.
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
