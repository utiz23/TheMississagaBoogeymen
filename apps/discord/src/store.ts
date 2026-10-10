import {
  claimDiscordPost,
  listDiscordPostCandidates,
  markDiscordPostFailed,
  markDiscordPostPosted,
  markDiscordPostSkipped,
} from '@eanhl/db/queries'
import type { PosterStore } from './cycle.ts'

export const dbStore: PosterStore = {
  candidates: (since, limit) => listDiscordPostCandidates({ since, limit }),
  claim: claimDiscordPost,
  markPosted: markDiscordPostPosted,
  markFailed: markDiscordPostFailed,
  markSkipped: markDiscordPostSkipped,
}
