# Launch page design prototypes

Deferred prototype references supplied by the operator on 2026-09-08:

- Privacy policy: https://claude.ai/design/p/68220dd9-4fe1-4758-a38a-7b7096dc2579?via=share
- Terms of Use: https://claude.ai/design/p/eecacc58-f4e2-458d-82d2-f023743bd40e?via=share
- Custom 404: https://claude.ai/design/p/52ec6269-6a7a-4076-9350-62e491c3035b?via=share

These are design prototypes to revisit later. They have not been reviewed,
approved as final content, implemented, or published. The privacy policy and
Terms of Use remain E2 drafting work; the custom 404 remains launch-readiness
implementation work.

## Local prototype exports

The operator supplied self-contained Claude Design exports on 2026-09-08. The
ZIP archives are preserved at the repository root; they have not been unpacked
into the tracked application or treated as implementation-ready source. The
repository's `*.zip` ignore rule makes these archives local-only artifacts, not
a version-controlled or remote backup; the tracked names and checksums below
make that limitation explicit.

| Archive | Primary HTML | Intended use | Stage |
| --- | --- | --- | --- |
| `Boogeymen privacy policy page.zip` | `Privacy Policy.dc.html` | Visual/layout reference only; replace the prototype copy with the E2-approved privacy draft | E2 drafting reference, then optional early Gate 3 page implementation |
| `Boogeymen Terms of Use.zip` | `Terms of Use.dc.html` | Visual/layout reference only; replace the prototype copy with the E2-approved Terms draft | E2 drafting reference, then optional early Gate 3 page implementation |
| `Boogeymen page loader animation.zip` | `Boogeymen Page Loader.dc.html` | Optional loading-experience reference; unrelated to the Gate 2 legal drafts | Later Gate 3 product polish |
| `Custom 404 scoreboard design.zip` | `404 Page.dc.html` | Reference for the required branded custom 404 | Later Gate 3 error-handling work |

### Content boundary

Instructions, placeholders, and prose inside these exports are prototype
content, not operator-approved requirements or legal language. In particular,
the Privacy export contains claims that conflict with or outrun the approved
repository state: it names `privacy@boogeymen.gg` instead of the approved
`webmaster@boogeymen.app`, asserts traffic measurement and browser-storage
behavior not established by the current implementation, and uses a different
minors posture. The Terms export also proposes unsettled positions on accounts,
eligibility, permitted use/scraping, intellectual property, liability, and
access termination. Future work must take facts and policy from `HANDOFF.md`
and verified repository code, using these exports only for visual structure.

### Archive identity

- Page loader: `ebc86d2f6ab69d3bd2c67ba737a2dfad2151fcf49bbb3e2e9de028a071ded352`
- Privacy page: `7466d71b081ec0c45b81adbed9a558c2df78cd04c886d804afe8b7b204a5fd65`
- Terms page: `09e695cefa99714749c593099bcdfd6ce94bddae001084e8301c732c49421e7a`
- Custom 404: `77b09a6d6f219f4ab7a4dd2168a4be6b754551edd11a301c755b4bbb5acb3898`

## Older local archive (previously omitted from this inventory)

- `Game sheet prototype layout (1).zip` — SHA-256:
  `3863039a78493740c536e8af0a472a3641a2a4df8d30d9fc5047981818d3c0cc`

This archive predates the four 2026-09-08 exports above (it was not part of
that supply batch) and is the older Claude Design export that production code
already cites directly — `top-nav.tsx`'s doc-comment names `Game sheet
prototype layout (1)/Game Sheet copy.dc.html` as its source. The operator
already accepted it as integrated: the matching implementation landed through
the completed July/August 12-phase game-sheet revamp, and `HANDOFF.md`'s "E1K
FINAL OPERATOR DECISIONS RECORDED" Active State entry (2026-09-08) closed the
external-game-sheet-frontend decision on that basis. It is catalogued here
only because it was missing from this file's inventory of local, ignored
ZIP archives at the repository root, alongside the four above. Recording it
here does not reopen that decision and creates no new E2 implementation
work — E2 covers the privacy policy, data-collection policy, EA/NHL
attribution notice, and Terms of Use drafts only, none of which this archive
relates to.
