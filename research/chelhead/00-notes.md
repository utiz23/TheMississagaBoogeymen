# Chelhead Capture Notes

Goal: catalog Chelhead features and compare them against our site.

Capture rules:
- logged in with premium access
- preserve log enabled in browser network tab
- save HAR with content
- capture every visible tab/subtab/filter state
- take full-page screenshots
- note anything hidden behind hover, expanders, or sorting

Pages to capture:
- Club
- Players
- Matches
- Individual player page

Comparison targets:
- feature inventory
- data model / stats shown
- premium-only surfaces
- interaction patterns
- visuals/layout
- missing features in our app

## Decisions From Product Q&A (2026-04-27)

- Site role: internal team dashboard first
- Primary audience: team members
- Top surfaces: home, player profile, club stats
- Desired feel: stats tool + team brand + archive
- Next milestone: stable stats baseline
- Strategic priority: harden the foundation before broadening scope
- Canonical stats preference: EA is the source of truth for broad season totals; local data is for preserved acute/match-level detail
- Mixed-source UI is acceptable for now if clearly labeled
- `wins/losses/otl` should default to team record during player appearances regardless of position
- Goalie-only sections should be driven by actual goalie game count
- `/roster` should contain both the depth chart and a roster table below it
- Depth chart should be a fuller, inferred creative roster display; no minimum-position threshold
- Manual/member-only additions may appear and should be marked provisional
- Home should deprioritize division standing relative to latest result and player-focused widgets
- Player profile is the long-term flagship polish surface, but data correctness still outranks polish
