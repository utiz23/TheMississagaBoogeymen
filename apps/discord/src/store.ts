import {
  claimDiscordCardPost,
  claimDiscordPost,
  listDiscordCardBatchCandidates,
  listDiscordPostCandidates,
  markDiscordCardPostFailed,
  markDiscordCardPostPosted,
  markDiscordCardPostSkipped,
  markDiscordPostFailed,
  markDiscordPostPosted,
  markDiscordPostSkipped,
} from '@eanhl/db/queries'
import type { PosterStore } from './cycle.ts'
import type { CardPostStore } from './cycle-cards.ts'

export const dbStore: PosterStore = {
  candidates: (since, limit) => listDiscordPostCandidates({ since, limit }),
  claim: claimDiscordPost,
  markPosted: markDiscordPostPosted,
  markFailed: markDiscordPostFailed,
  markSkipped: markDiscordPostSkipped,
}

export const dbCardStore: CardPostStore = {
  candidates: (since, limit) => listDiscordCardBatchCandidates({ since, limit }),
  claim: claimDiscordCardPost,
  markPosted: markDiscordCardPostPosted,
  markFailed: markDiscordCardPostFailed,
  markSkipped: markDiscordCardPostSkipped,
}
