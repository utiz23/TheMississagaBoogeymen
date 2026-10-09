import type { ReactNode } from 'react'
import type { LegalPageSection } from '@/components/legal/legal-page'
import { P, UL, LI, Strong, Em, Code, MailLink } from '@/components/legal/legal-prose'

/**
 * Verbatim transcription of
 * `docs/planning/data-collection-policy-draft.md`'s public section
 * (## Data Collection Policy through the end of §13, before "## Internal
 * drafting and publication checks"). Do not reword, trim, or "improve" any
 * sentence here — a content change belongs in the source draft first,
 * through the reviewed-draft workflow, then re-transcribed.
 * `test/legal-http.test.ts` compares this module's rendered output against
 * that draft file directly and fails on any divergence.
 *
 * This draft has no PLACEHOLDER-*-URL cross-links to any other legal
 * document, so it uses no `DocLink`.
 */

export const intro: ReactNode = (
  <P>
    Boogeymen — a community gaming club — publishes this policy to explain what information this
    website collects or maintains, where it comes from, why we keep it, and how you can ask about or
    correct it.
  </P>
)

export const sections: LegalPageSection[] = [
  {
    number: 1,
    heading: 'Scope and launch posture',
    body: (
      <>
        <P>
          This is a public community gaming-club website that visitors can read but not change. It
          publishes statistics and history for our EA Sports NHL Pro Clubs team. The project is
          currently operated by a single individual on a volunteer basis; that describes who runs it
          day to day, not a conclusion about its legal form or about which privacy law, if any,
          applies to it.
        </P>
        <UL>
          <LI>
            There is no public account system. Members of our team can sign in with a Discord
            account, but only through an invite from the site's operator; nobody can register on
            their own — see "Accounts and authentication" below.
          </LI>
          <LI>
            There is no on-site form, upload, comment, or submission feature. You cannot submit
            content through this site, though you can still voluntarily send us information through
            project email — see the information categories below. Signed-in members can only change
            settings for their own player, such as how their player card looks.
          </LI>
          <LI>There is no advertising.</LI>
          <LI>
            No monetization or other commercial activity exists on this site, and none is planned.
            If that changes, we intend to carry out a fresh privacy review before any commercial
            activity begins.
          </LI>
          <LI>
            Our posture is <Strong>no analytics and no nonessential tracking</Strong> — see
            "Cookies, browser storage, and analytics" below.
          </LI>
        </UL>
      </>
    ),
  },
  {
    number: 2,
    heading: 'Information we collect or maintain',
    body: (
      <>
        <P>
          We maintain the following categories of information, drawn mostly from EA's game services
          and our own team members' review and correction of that data:
        </P>
        <UL>
          <LI>
            <Strong>Gamertags and gamertag history.</Strong> Current and prior gamertags used to
            identify players across matches over time.
          </LI>
          <LI>
            <Strong>Approved display names and personas.</Strong> Where a player's profile name is
            entered manually by our team rather than pulled verbatim from EA, that name is an
            operator-attested, member-approved display name or alias chosen for identification
            purposes. We do not request or verify legal names for player-profile identification.
            This does not mean legal-name or other personally identifying information is impossible
            to encounter elsewhere in what we retain: email correspondence, attachments, recordings,
            screenshots, or other raw evidence a person sends us or that we capture could
            incidentally contain someone's name or other information they choose to provide. We have
            not inspected every retained item to confirm this, and do not claim it is absent.
          </LI>
          <LI>
            <Strong>Member agreement to publication.</Strong> Current members of our club have
            verbally agreed that their gamertags, profiles, and statistics may be published and used
            as described in this policy. This is a record of the verbal agreement our operator
            understands members to have given; it is not written consent, legal clearance, or a
            statement that this agreement is legally sufficient under any particular law.
          </LI>
          <LI>
            <Strong>Roster membership.</Strong> Which players belong to our club, and for what
            periods.
          </LI>
          <LI>
            <Strong>Match results and metadata.</Strong> Scores, dates, game mode, and related match
            details for games our club played.
          </LI>
          <LI>
            <Strong>Team and player statistics.</Strong> Skater and goalie statistics compiled from
            match data.
          </LI>
          <LI>
            <Strong>Derived hockey metrics, scores, summaries, and classifications.</Strong> Values
            we calculate from the underlying match and player statistics — for example, performance
            scores and summary classifications — are also maintained as part of the statistical
            record.
          </LI>
          <LI>
            <Strong>Opponent-club and opponent-player information.</Strong> Because Pro Clubs
            matches involve two teams, our records necessarily include the opposing club's name and
            the opposing players' gamertags and statistics for the matches they played against us.
            This includes an EA-provided stable persona identifier for each player, so our records
            can link the same opponent's appearances over time.
          </LI>
          <LI>
            <Strong>Raw EA-provided data.</Strong> We store the raw data returned by EA's game
            services verbatim before we process it, so that we can correct or reprocess it later
            without having lost the original source.
          </LI>
          <LI>
            <Strong>OCR (optical character recognition) extractions and related evidence.</Strong>{' '}
            For some matches, we extract additional statistics from screen recordings using
            automated image/text recognition. This includes the extracted text values, supporting
            evidence, confidence information, review status, and records of where each extracted
            value came from.
          </LI>
          <LI>
            <Strong>Source recordings, screenshots, and extracted video frames.</Strong> Underlying
            video recordings, screenshots, and individual frames used as OCR source material or as
            an evidentiary record for the statistics we publish.
          </LI>
          <LI>
            <Strong>Party voice chat captured in team recordings.</Strong> Our gameplay recordings
            may incidentally include in-game party voice chat. This audio is captured only as a
            by-product of recording gameplay for our statistics and evidentiary purposes — we do not
            currently analyze it, use it for any separate purpose, or publicly display it. Current
            participants in our recorded sessions know that gameplay may be recorded and have
            verbally agreed to that. We do not claim that every possible future participant has
            agreed, and we do not claim that an opponent or other third party can never be present
            in a recorded voice channel. We do not publish where any participant is located.
            Recordings and any incidental audio they contain are kept under the retention approach
            described in "How long we keep information" below. We have not inspected every
            recording's contents and do not claim to know what any specific recording does or does
            not contain.
          </LI>
          <LI>
            <Strong>Website operational and error logs.</Strong> This site's hosting stack generates
            operational and error records in the course of operating and securing the site. Our own
            server keeps them in small, size-limited rolling logs, and our website software does not
            keep a separate record of each page visit. Our network and security provider
            (Cloudflare) may keep its own records. See "How long we keep information" below for how
            we treat logs under our control, and "Service providers and other parties" for logs
            controlled independently by our providers.
          </LI>
          <LI>
            <Strong>Email correspondence sent to our project addresses</Strong>, which may include
            the sender's email address, the sender's display name, message contents, attachments,
            and any evidence you provide to verify a request (for example, to establish that you
            control a gamertag you're asking us to correct or remove).
          </LI>
          <LI>
            <Strong>Member accounts.</Strong> For team members who sign in: the member's Discord
            user ID and Discord display name (as it was when the account was created), the player on
            our team the account is linked to, the account's role (member or admin), whether the
            account has been disabled, when it was created, settings the member chooses for their
            own player (such as their player card's theme), and sign-in session records. See
            "Accounts and authentication" below for what is not kept.
          </LI>
          <LI>
            <Strong>
              A limited set of authentic source fixtures retained in our private GitHub repository
            </Strong>
            , used for testing and development. See "Service providers and other parties" below.
          </LI>
        </UL>
      </>
    ),
  },
  {
    number: 3,
    heading: 'Where this information comes from',
    body: (
      <>
        <UL>
          <LI>
            EA's Pro Clubs game and service interfaces, which return match, player, and club data.
          </LI>
          <LI>Recordings and screenshots captured by our own team members during our matches.</LI>
          <LI>Automated OCR processing of those recordings and screenshots.</LI>
          <LI>
            Manual review and correction by our team's operator(s) — for example, fixing a misread
            gamertag or approving a display name.
          </LI>
          <LI>Correspondence sent to our project email addresses.</LI>
          <LI>
            Discord, when a team member signs in — it tells us the member's Discord user ID and
            display name only.
          </LI>
          <LI>
            Ordinary requests made to our public website and the infrastructure and security
            processing that supports it.
          </LI>
        </UL>
        <P>
          This site is not affiliated with, endorsed by, or sponsored by Electronic Arts, EA Sports,
          the NHL, the NHLPA, or their affiliates. It is an independent, community-run project. A
          separate attribution and non-affiliation notice covers EA-sourced content and third-party
          marks in more detail; this policy is not that notice.
        </P>
      </>
    ),
  },
  {
    number: 4,
    heading: 'Why we use this information',
    body: (
      <>
        <P>We use the information described above only to:</P>
        <UL>
          <LI>Operate this public website.</LI>
          <LI>Display our team's history, games, rosters, and statistics.</LI>
          <LI>Produce, verify, and correct derived hockey statistics.</LI>
          <LI>Maintain a historical and evidentiary archive of our team's matches.</LI>
          <LI>Diagnose errors and keep the site's infrastructure secure.</LI>
          <LI>
            Develop, test, validate, and maintain this website and its data and OCR processing
            pipeline, including using a limited set of authentic source fixtures for testing,
            provenance, and regression verification.
          </LI>
          <LI>Let invited team members sign in and manage settings for their own player.</LI>
          <LI>Respond to privacy, correction, removal, and security-related requests.</LI>
          <LI>
            Maintain provenance and auditability — i.e., being able to show where a published number
            came from and correct it if it's wrong.
          </LI>
        </UL>
        <P>
          We do not use this information to measure website traffic or user behavior as an approved
          purpose at launch. See "Cookies, browser storage, and analytics" below for the current
          state of an analytics feature that conflicts with that posture and must be resolved before
          publication.
        </P>
      </>
    ),
  },
  {
    number: 5,
    heading: 'Public display and search-engine indexing',
    body: (
      <>
        <P>
          The public site displays gamertags, approved display names/aliases, roster membership,
          match information, statistics, opponent-club and opponent-player information, and derived
          metrics described above.
        </P>
        <P>
          Our indexing policy: at present, every page of this site — including the home page, game
          pages, roster pages, and stats pages — asks search engines not to index it (a{' '}
          <Code>noindex</Code> instruction on every page and response), so the site is not intended
          to appear in search results and is shared by direct link. If we later allow indexing of
          public pages, we will update this policy first. Diagnostic and non-public surfaces are not
          meant to be indexed in any case.
        </P>
        <P>
          Public display of statistics is distinct from our retention of private raw data and OCR
          evidence (recordings, screenshots, frames, confidence and review-state information): the
          raw evidence is not published; only the resulting statistics and match information are.
        </P>
      </>
    ),
  },
  {
    number: 6,
    heading: 'Cookies, browser storage, and analytics',
    body: (
      <>
        <P>
          Visitors who do not sign in get no cookies from this site's own code, and our code does
          not use <Code>localStorage</Code>, <Code>sessionStorage</Code>, or <Code>indexedDB</Code>.
          When a team member signs in, our code sets two strictly necessary cookies:
        </P>
        <UL>
          <LI>
            <Code>__Secure-better-auth.state</Code> — set when a member starts signing in with
            Discord. It protects that step against forgery and expires after about 5 minutes.
          </LI>
          <LI>
            <Code>__Secure-better-auth.session_token</Code> — keeps a signed-in member signed in. It
            holds a random session reference rather than personal information, cannot be read by the
            page's scripts, and expires after 30 days, renewed while the member keeps using the
            site. Signing out removes it.
          </LI>
        </UL>
        <P>
          This describes our own code; it is not a claim that no browser storage of any kind is ever
          used by any underlying framework, dependency, or infrastructure component.
        </P>
        <P>
          Our hosting/security provider (Cloudflare) may, under some circumstances, use strictly
          necessary cookies or similar mechanisms as part of its edge security or challenge
          processing. We do not currently have specific, verified information about any individual
          cookie Cloudflare may set, so we are not naming one here.
        </P>
        <P>
          <Strong>We do not use analytics.</Strong> Cloudflare Web Analytics, which was previously
          enabled in this site's Cloudflare configuration, has been turned off, and this site uses
          no advertising or other nonessential tracking.
        </P>
        <P>
          We do not plan to show a cookie-consent banner while our posture is "no nonessential
          tracking," but whether a banner is legally required in any particular jurisdiction is a
          legal-review question, not one this policy resolves for itself.
        </P>
      </>
    ),
  },
  {
    number: 7,
    heading: 'Accounts and authentication',
    body: (
      <>
        <P>
          Members of our team can sign in to this site. There is no public sign-up: an account can
          only be created through a single-use invite link that the site's operator makes for a
          specific team member, and each account is linked to that member's player. Sign-in uses
          Discord; this site has no passwords.
        </P>
        <P>
          When a member signs in, Discord tells us only the member's Discord user ID and display
          name (Discord's <Code>identify</Code> permission). We do not ask Discord for, receive, or
          keep the member's email address, and we do not keep their Discord avatar or any Discord
          access tokens. Because our account software requires an email field, each account stores a
          placeholder address made from the Discord user ID that cannot receive mail.
        </P>
        <P>
          We keep a record of each sign-in session (when it was created and when it expires) so the
          member stays signed in. We do not record the IP address or browser of a session. To
          protect sign-in from abuse, our server counts recent sign-in attempts per IP address in
          memory for about a minute; those counts are not written to our database.
        </P>
        <P>
          Signed-in members can change settings for their own player, such as their player card's
          theme. The site's operator can create and cancel invites, disable an account, and change
          these settings for any player.
        </P>
        <P>
          A member can ask us to delete their account at any time — see "Requests and corrections"
          below. Deleting an account removes the member-account record; it does not remove the
          member's match statistics, which the rest of this policy covers.
        </P>
      </>
    ),
  },
  {
    number: 8,
    heading: 'Service providers and other parties',
    body: (
      <>
        <P>
          We use the following third-party services to operate this site. This section describes
          their role for us; it is not a formal legal classification of any provider as a
          "processor," "controller," or similar term, which remains a legal-review question.
        </P>
        <UL>
          <LI>
            <Strong>Cloudflare</Strong> — our domain registrar and DNS provider, and the proxied
            edge/network layer (including our Cloudflare Tunnel) that routes traffic to our server
            and provides security processing (such as its managed security ruleset). Cloudflare's
            own edge-level log retention is not something we have independently verified; we
            describe it only in general terms until we do.
          </LI>
          <LI>
            <Strong>Proton Mail</Strong> — our email provider. All of our project addresses (
            <MailLink address="webmaster@boogeymen.app" />,{' '}
            <MailLink address="security@boogeymen.app" />, and an internal-only address) deliver
            into a single Proton mailbox under one operator account. We do not use mail forwarding,
            a catch-all address, Proton Mail Bridge, a third-party mail client, or any export or
            separate backup of this mailbox's contents.
          </LI>
          <LI>
            <Strong>GitHub</Strong> — hosts our private source-code repository, which also contains
            a limited set of authentic data fixtures used for testing. This repository was public
            for part of its history; copies made by others during that period cannot be recalled by
            us.
          </LI>
          <LI>
            <Strong>Backblaze</Strong> — stores off-site backup copies of our database (see "How
            long we keep information" below).
          </LI>
          <LI>
            <Strong>Healthchecks.io</Strong> — monitoring that alerts us if our backups or data
            collection stop working. It receives only short status messages from our server, not
            information about visitors.
          </LI>
          <LI>
            <Strong>Discord</Strong> — the sign-in service team members use to sign in to this site.
            Discord tells us the member's Discord user ID and display name when they sign in;
            visitors who do not sign in are never sent to Discord by this site.
          </LI>
          <LI>
            <Strong>Electronic Arts (EA)</Strong> — the source of the underlying game data and some
            visual assets referenced by this site. EA does not endorse, and is not affiliated with,
            this project.
          </LI>
          <LI>
            <Strong>Our hosting infrastructure</Strong> is community-operated from Alberta, Canada.
            We do not claim that every service we use stores or processes information only in Canada
            — see "Location and cross-border handling" below.
          </LI>
        </UL>
        <P>
          Fonts used by this site (Barlow and Barlow Semi Condensed) are downloaded and self-hosted
          as part of our build process rather than requested by your browser from Google at
          page-load time, based on how our font loading is currently configured.
        </P>
      </>
    ),
  },
  {
    number: 9,
    heading: 'How long we keep information',
    body: (
      <UL>
        <LI>
          We keep gamertags, approved display names/aliases, match and statistics data, raw
          EA-provided data, structured database records, OCR evidence, and source
          recordings/screenshots/frames for as long as we reasonably need them for the purposes
          described in "Why we use this information" above — principally to maintain an accurate,
          verifiable historical and evidentiary archive of our team's matches, and for the other
          purposes listed there. We do not apply an automatic expiry to this category. This does not
          mean deletion is impossible, and it does not mean every item must always be kept: removal
          happens by manual operator action, including in response to a request (see "Requests and
          corrections" below). We have not adopted a scheduled periodic review of this archive.
          Describing retention this way is a description of our current practice, not a statement
          that indefinite retention has been legally reviewed or approved.
        </LI>
        <LI>
          <Strong>Logs under our control</Strong> are size-limited rather than kept for a fixed
          period: our server keeps a small rolling log for each part of the site and automatically
          overwrites the oldest entries.
        </LI>
        <LI>
          <Strong>Logs controlled independently by service providers</Strong> are subject to those
          providers' practices and retention periods.
        </LI>
        <LI>
          <Strong>Member accounts</Strong> are kept while the person is a member of our team and are
          deleted on request (see "Requests and corrections" below). A sign-in session is deleted
          when the member signs out and otherwise stops working after 30 days without use. Records
          of used, cancelled, or expired invite links are kept for the operator's reference.
        </LI>
        <LI>
          <Strong>Correspondence sent to our project email addresses</Strong> is retained under the
          following operator targets, reviewed at least annually:
          <UL>
            <LI>Obvious spam or junk: approximately 30 days.</LI>
            <LI>Routine correspondence: up to 12 months after the last action needed on it.</LI>
            <LI>
              Privacy, correction, security, and incident-related correspondence (including evidence
              sent to verify a request — see "Requests and corrections" below): up to 24 months
              after the matter is closed.
            </LI>
            <LI>
              Any of the above may be kept longer only while reasonably necessary for an active
              legal, dispute, investigation, or security purpose.
            </LI>
          </UL>
          These are our own manually-applied targets, not settings automatically enforced by our
          email provider.
        </LI>
        <LI>
          Our email provider's own internal retention behavior (for example, anything it retains
          independently of our mailbox) is not something we have independently verified.
        </LI>
        <LI>
          We keep automatic daily backup copies of our database. Copies on our own server are kept
          for about 12 months (daily copies for 14 days, weekly copies for 8 weeks, and monthly
          copies for 12 months); off-site copies with Backblaze are kept for about 90 days. Copies
          are sent to Backblaze over an encrypted connection. Corrections you request are reflected
          in new backups going forward; we do not individually rewrite existing backup copies, which
          instead expire on that schedule.
        </LI>
      </UL>
    ),
  },
  {
    number: 10,
    heading: 'Requests and corrections',
    body: (
      <>
        <P>
          To ask about, correct, or otherwise raise a question about information we hold about you,
          contact the <Strong>Privacy Contact for Boogeymen</Strong> at{' '}
          <Strong>
            <MailLink address="webmaster@boogeymen.app" />
          </Strong>
          .
        </P>
        <UL>
          <LI>
            We aim to acknowledge requests within <Strong>7 days</Strong>.
          </LI>
          <LI>
            We aim to resolve, or provide a substantive response to, requests within{' '}
            <Strong>30 days</Strong>. Where a privacy law that applies to us sets its own deadline
            for a request, we intend to meet that deadline as well; our own targets above are meant
            to be at least as fast.
          </LI>
          <LI>We do not charge a fee for access or correction requests.</LI>
          <LI>
            We may ask for reasonable evidence that you control the gamertag or identity in
            question. We do not request government-issued ID by default.
          </LI>
          <LI>
            <Strong>
              Access, correction, withdrawal, and removal are different things, and we treat them
              differently:
            </Strong>
            <UL>
              <LI>
                <Em>Access</Em> means asking what we hold about you.
              </LI>
              <LI>
                <Em>Correction</Em> means asking us to fix an error or omission in information we
                hold about you. Where correcting information you raised is something we're required
                to do under a law that applies to us, we'll do it; if we decide not to make a
                correction you've asked for, and the law requires it, we will note your requested
                correction alongside the information we hold.
              </LI>
              <LI>
                <Em>Withdrawal</Em> means telling us you no longer agree to something you previously
                agreed to (for example, a member withdrawing agreement to have new statistics
                published going forward). If you do this, we will explain what it means in practice,
                stop what we are required to stop, and tell you what we keep and why.
              </LI>
              <LI>
                <Em>Removal</Em> is considered case-by-case, not automatic. Whether we remove,
                de-identify, or otherwise change information depends on applicable law and on our
                legitimate need to keep an accurate archival record of our team's history. We do not
                promise removal in every case, and we do not rule out that applicable law may
                require it in a given case. The fact that information was previously published by EA
                through its own game services is not, by itself, a reason for us to refuse a
                request.
              </LI>
            </UL>
          </LI>
          <LI>
            Because our records are about matches involving several people, some of what we hold
            about you may be mixed together with information about others. Where applicable law
            requires it, we will give you the parts that are about you and hold back the parts that
            would reveal someone else's information.
          </LI>
          <LI>
            Evidence you send us to verify a request is used only to verify and handle that request.
            We do not add it to our published statistics record. We do not promise to delete it
            immediately; where we keep it, it is kept under the same
            privacy/correction-correspondence retention category described in "How long we keep
            information" above.
          </LI>
          <LI>
            If a copy of our data (including from a period when our source repository was public)
            has already been taken by someone else, we cannot recall or delete that copy — our
            removal only affects what we ourselves publish and retain going forward.
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
      </>
    ),
  },
  {
    number: 11,
    heading: 'Children and opponents',
    body: (
      <>
        <P>
          Team membership on this site is adult-only. No children are, or are planned to be, members
          of our club.
        </P>
        <P>
          Some of the opponents we play against in matches may include minors. We do not know their
          ages, cannot verify them, do not collect them, and have no way to determine them from the
          information EA's game services provide. This site does not ask any visitor or opponent for
          age information, and does not offer submissions; sign-in is limited to invited members of
          our adult team.
        </P>
      </>
    ),
  },
  {
    number: 12,
    heading: 'Location and cross-border handling',
    body: (
      <>
        <P>
          Our club is community-operated from Alberta, Canada. We do not claim that every team
          member lives in Alberta, or in any other specific place — team members are located in
          various places, and we do not publish individual member locations.
        </P>
        <P>
          Because we use Cloudflare, Proton Mail, GitHub, Backblaze, Discord, EA's services, and the
          ordinary infrastructure of the internet, information may be processed or transmitted
          outside Alberta or Canada as part of how those services work. We do not have verified
          information about the exact physical storage locations each of these providers uses, and
          we do not claim otherwise.
        </P>
      </>
    ),
  },
  {
    number: 13,
    heading: 'Accuracy, security, incidents, and changes to this policy',
    body: (
      <>
        <P>
          We make a reasonable effort to keep the information we publish accurate, and we
          investigate and correct it, where appropriate, when an error is reported to us or that we
          otherwise notice.
        </P>
        <P>
          We take reasonable steps to protect the information we maintain, but no website or storage
          system can guarantee absolute security. If personal information we hold is lost, or
          accessed or disclosed without authorization, in a way that creates a real risk of harm to
          someone, we will carry out any incident reporting or notification that applicable law
          requires of us. This policy does not set out our internal incident-response procedure.
        </P>
        <P>
          Our source code repository is now private, but copies made during any earlier public
          period cannot be recalled — see "Service providers and other parties" above.
        </P>
        <P>
          We will post an on-site notice when we make a material change to this policy, and this
          page will always show the date it was last updated at the top.
        </P>
        <P>
          <Strong>Contact:</Strong>
        </P>
        <UL>
          <LI>
            General, privacy, data, and correction requests:{' '}
            <Strong>Privacy Contact for Boogeymen</Strong>,{' '}
            <MailLink address="webmaster@boogeymen.app" />
          </LI>
          <LI>
            Security vulnerability reports only: <MailLink address="security@boogeymen.app" />
          </LI>
        </UL>
      </>
    ),
  },
]
