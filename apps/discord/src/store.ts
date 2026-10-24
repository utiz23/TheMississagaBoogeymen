import {
  claimDiscordPost,
  claimDiscordUnlock,
  listDiscordPostCandidates,
  listDiscordUnlockCandidates,
  markDiscordPostFailed,
  markDiscordPostPosted,
  markDiscordPostSkipped,
  markDiscordUnlockFailed,
  markDiscordUnlockPosted,
  markDiscordUnlockSkipped,
} from '@eanhl/db/queries'
import type { PosterStore } from './cycle.ts'
import type { UnlockStore } from './cycle-unlocks.ts'

export const dbStore: PosterStore = {
  candidates: (since, limit) => listDiscordPostCandidates({ since, limit }),
  claim: claimDiscordPost,
  markPosted: markDiscordPostPosted,
  markFailed: markDiscordPostFailed,
  markSkipped: markDiscordPostSkipped,
}

export const dbUnlockStore: UnlockStore = {
  candidates: (since, limit) => listDiscordUnlockCandidates({ since, limit }),
  claim: claimDiscordUnlock,
  markPosted: markDiscordUnlockPosted,
  markFailed: markDiscordUnlockFailed,
  markSkipped: markDiscordUnlockSkipped,
}
