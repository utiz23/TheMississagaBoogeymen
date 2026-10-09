/**
 * Club-vote trophies and championship banners — the awards stats can't
 * produce. Entered by hand; add a line per result. `playerIds` are
 * `players.id` (stable across gamertag changes); `title` is the game title's
 * display name. A trophy is either a real club vote (`from: 'vote'`) or, for
 * seasons with no vote on record, picked from the archive stats
 * (`from: 'stats'`, with the reason shown on the page).
 */

export type VotedTrophy = 'mvp' | 'defense' | 'rookie'
export type BannerMode = '3s' | 'arcade'

export type ClubAward =
  | {
      kind: 'trophy'
      trophy: VotedTrophy
      title: string
      playerIds: readonly number[]
      from: 'vote'
    }
  | {
      kind: 'trophy'
      trophy: VotedTrophy
      title: string
      playerIds: readonly number[]
      from: 'stats'
      reason: string
    }
  | { kind: 'banner'; mode: BannerMode; title: string; playerIds: readonly number[] }

export const CLUB_AWARDS: readonly ClubAward[] = [
  // NHL 25 — club vote.
  { kind: 'trophy', trophy: 'mvp', title: 'NHL 25', playerIds: [3], from: 'vote' }, // Stick Menace
  { kind: 'trophy', trophy: 'defense', title: 'NHL 25', playerIds: [1], from: 'vote' }, // HenryTheBobJr ("Erb")
  { kind: 'trophy', trophy: 'rookie', title: 'NHL 25', playerIds: [8], from: 'vote' }, // Ordinary_Samich ("beav")

  // NHL 22–24 — no vote on record; picked from the archive. NHL 22 has no
  // Rookie (the archive starts there) and NHL 23's only newcomer played 7 games.
  {
    kind: 'trophy',
    trophy: 'mvp',
    title: 'NHL 24',
    playerIds: [2], // silkyjoker85
    from: 'stats',
    reason:
      'Led the club in goals (726), assists (1,106), points (1,832) and plus-minus (+440), and also played 150 games in goal (68 W, 11 shutouts).',
  },
  {
    kind: 'trophy',
    trophy: 'defense',
    title: 'NHL 24',
    playerIds: [5], // JoeyFlopfish
    from: 'stats',
    reason:
      'Most blocked shots (554) and interceptions (3,374) on the club, +364, with 334 games on defense.',
  },
  {
    kind: 'trophy',
    trophy: 'rookie',
    title: 'NHL 24',
    playerIds: [13], // joseph4577
    from: 'stats',
    reason: 'First season with the club: 187 goals and 313 points in 148 games, +36.',
  },
  {
    kind: 'trophy',
    trophy: 'mvp',
    title: 'NHL 23',
    playerIds: [5], // JoeyFlopfish
    from: 'stats',
    reason:
      'Led the club in goals (626), assists (693) and points (1,319), and also played 67 games in goal (33 W).',
  },
  {
    kind: 'trophy',
    trophy: 'defense',
    title: 'NHL 23',
    playerIds: [1], // HenryTheBobJr
    from: 'stats',
    reason:
      'Full-time defenseman (298 games on D) with the most interceptions per game on the club (6.4).',
  },
  {
    kind: 'trophy',
    trophy: 'mvp',
    title: 'NHL 22',
    playerIds: [5], // JoeyFlopfish
    from: 'stats',
    reason:
      'Led the club in goals (427) and points (850), and also played 81 games in goal (35 W).',
  },
  {
    kind: 'trophy',
    trophy: 'defense',
    title: 'NHL 22',
    playerIds: [1], // HenryTheBobJr
    from: 'stats',
    reason:
      'Full-time defenseman with the club’s best plus-minus (+208) and the most takeaways (1,236), blocked shots (173) and interceptions (2,189).',
  },

  // Championship banners.
  // silkyjoker85, JoeyFlopfish, Stick Menace, camrazz
  { kind: 'banner', mode: '3s', title: 'NHL 24', playerIds: [2, 5, 3, 6] },
  // silkyjoker85, Stick Menace, JoeyFlopfish
  { kind: 'banner', mode: 'arcade', title: 'NHL 23', playerIds: [2, 3, 5] },
]
