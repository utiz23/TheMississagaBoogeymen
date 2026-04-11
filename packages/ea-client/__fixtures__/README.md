# EA API Fixtures

Real EA API response snapshots used for contract testing.

## Status

**No fixtures captured yet.** Capturing requires network access to `proclubs.ea.com`.

## How to capture

Run the capture script from the project root:

```bash
pnpm --filter ea-client capture
```

Or call the endpoints manually with curl and save the output:

```bash
# Matches (gameType5 = league games)
curl -s \
  -H "User-Agent: Mozilla/5.0" \
  -H "Accept: application/json" \
  -H "Referer: https://www.ea.com/" \
  "https://proclubs.ea.com/api/nhl/clubs/matches?clubIds=19224&platform=common-gen5&matchType=gameType5" \
  | jq . > matches-gameType5.json

# Matches (gameType10 = playoffs)
curl -s \
  -H "User-Agent: Mozilla/5.0" \
  -H "Accept: application/json" \
  -H "Referer: https://www.ea.com/" \
  "https://proclubs.ea.com/api/nhl/clubs/matches?clubIds=19224&platform=common-gen5&matchType=gameType10" \
  | jq . > matches-gameType10.json

# Member stats
curl -s \
  -H "User-Agent: Mozilla/5.0" \
  -H "Accept: application/json" \
  -H "Referer: https://www.ea.com/" \
  "https://proclubs.ea.com/api/nhl/members/stats?clubId=19224&platform=common-gen5" \
  | jq . > members-stats.json
```

Save each response as `<endpoint>-<variant>.json` in this directory.

## Naming convention

| File pattern | Endpoint |
|---|---|
| `matches-gameType5.json` | `/clubs/matches?matchType=gameType5` |
| `matches-gameType10.json` | `/clubs/matches?matchType=gameType10` |
| `matches-club_private.json` | `/clubs/matches?matchType=club_private` |
| `members-stats.json` | `/members/stats` |
| `club-search.json` | `/clubs/search` |

## What to check after capturing

Once fixtures exist, run the contract tests:

```bash
pnpm --filter ea-client test
```

The tests will validate:
- [ ] Is `matchId` present in every match? (critical for dedup)
- [ ] Is `blazeId` present for every player? (determines player identity strategy)
- [ ] What timestamp field/format does the match contain?
- [ ] Is there an in-game season field in the match response?
- [ ] Are match IDs unique — do NHL 25 fixtures share IDs with NHL 26?
- [ ] What are the exact goalie stat field names?
- [ ] What positions are possible, and how are goalies distinguished?
