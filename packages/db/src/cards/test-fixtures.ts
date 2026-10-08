/** Test fixtures shared by the card rule tests (not exported from the package). */
import type { BadgeValues } from './progression.js'

// NHL 27 season totals from the live database on 2026-10-08, five weeks into
// the title (EA season totals + site-recorded mode games; Dekes = successful
// dekes). Season-cards spec: regulars are Rookie by week 2, Stud by week 6-10.
// prettier-ignore
export const NHL27_2026_10_08: { gamertag: string; values: BadgeValues }[] = [
  { gamertag: 'Stick Menace', values: {p3v3: 6, p6v6: 64, p6g: 12, pwins: 35, pgoals: 67, pasts: 66, pshots: 302, pdekes: 94, pht: 7, pbrk: 10, phits: 156, pfo: 564, ptka: 189, pblk: 38, pfight: 6, gg: 0, gw: 0, gsv: 0, gdsv: 0, gpoke: 0, gso: 0} },
  { gamertag: 'silkyjoker85', values: {p3v3: 6, p6v6: 59, p6g: 12, pwins: 31, pgoals: 19, pasts: 72, pshots: 167, pdekes: 19, pht: 0, pbrk: 8, phits: 212, pfo: 359, ptka: 178, pblk: 70, pfight: 0, gg: 5, gw: 2, gsv: 48, gdsv: 4, gpoke: 0, gso: 0} },
  { gamertag: 'HenryTheBobJr', values: {p3v3: 1, p6v6: 54, p6g: 10, pwins: 25, pgoals: 46, pasts: 56, pshots: 246, pdekes: 36, pht: 5, pbrk: 6, phits: 58, pfo: 0, ptka: 144, pblk: 21, pfight: 0, gg: 0, gw: 0, gsv: 0, gdsv: 0, gpoke: 0, gso: 0} },
  { gamertag: 'camrazz', values: {p3v3: 6, p6v6: 47, p6g: 12, pwins: 28, pgoals: 55, pasts: 48, pshots: 350, pdekes: 149, pht: 8, pbrk: 11, phits: 108, pfo: 28, ptka: 104, pblk: 20, pfight: 1, gg: 0, gw: 0, gsv: 0, gdsv: 0, gpoke: 0, gso: 0} },
  { gamertag: 'JoeyFlopfish', values: {p3v3: 6, p6v6: 42, p6g: 12, pwins: 24, pgoals: 18, pasts: 43, pshots: 136, pdekes: 22, pht: 3, pbrk: 2, phits: 69, pfo: 44, ptka: 121, pblk: 27, pfight: 0, gg: 4, gw: 3, gsv: 54, gdsv: 1, gpoke: 0, gso: 0} },
  { gamertag: 'MrHomiecide', values: {p3v3: 0, p6v6: 34, p6g: 9, pwins: 15, pgoals: 8, pasts: 28, pshots: 74, pdekes: 7, pht: 0, pbrk: 0, phits: 125, pfo: 15, ptka: 76, pblk: 25, pfight: 3, gg: 0, gw: 0, gsv: 0, gdsv: 0, gpoke: 0, gso: 0} },
  { gamertag: 'Ordinary_Samich', values: {p3v3: 0, p6v6: 23, p6g: 2, pwins: 9, pgoals: 12, pasts: 17, pshots: 84, pdekes: 16, pht: 0, pbrk: 4, phits: 57, pfo: 0, ptka: 31, pblk: 11, pfight: 0, gg: 0, gw: 0, gsv: 0, gdsv: 0, gpoke: 0, gso: 0} },
]
