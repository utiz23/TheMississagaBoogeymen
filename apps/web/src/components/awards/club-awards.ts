/**
 * Club-vote trophies and championship banners — the awards stats can't
 * produce. Entered by hand; add a line per result. `playerIds` are
 * `players.id` (stable across gamertag changes); `title` is the game title's
 * display name.
 */

export type VotedTrophy = 'mvp' | 'defense' | 'rookie'
export type BannerMode = '3s' | 'arcade'

export type ClubAward =
  | { kind: 'trophy'; trophy: VotedTrophy; title: string; playerIds: readonly number[] }
  | { kind: 'banner'; mode: BannerMode; title: string; playerIds: readonly number[] }

export const CLUB_AWARDS: readonly ClubAward[] = [
  { kind: 'trophy', trophy: 'mvp', title: 'NHL 25', playerIds: [3] }, // Stick Menace
  { kind: 'trophy', trophy: 'defense', title: 'NHL 25', playerIds: [1] }, // HenryTheBobJr ("Erb")
  { kind: 'trophy', trophy: 'rookie', title: 'NHL 25', playerIds: [8] }, // Ordinary_Samich ("beav")
  // silkyjoker85, JoeyFlopfish, Stick Menace, camrazz
  { kind: 'banner', mode: '3s', title: 'NHL 24', playerIds: [2, 5, 3, 6] },
  // silkyjoker85, Stick Menace, JoeyFlopfish
  { kind: 'banner', mode: 'arcade', title: 'NHL 23', playerIds: [2, 3, 5] },
]
