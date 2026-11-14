import {
  completeBackgroundAsk,
  countBackgroundAsksFor,
  countBackgroundAsksSince,
  getBackgroundQuestionsOn,
  getConfirmedBackground,
  getOpenBackgroundAsk,
  insertBackgroundAsk,
  insertProposedBackgroundFacts,
  listAskableBackgroundQuestions,
  listPressRoster,
} from '@eanhl/db/queries'
import type { BackgroundStore } from './background-store.ts'

/** The background store on the database (the `@eanhl/db` queries); spread into `pressDbStore`. */
export const backgroundDbStore: BackgroundStore = {
  backgroundQuestionsOn: getBackgroundQuestionsOn,
  listAskableBackgroundQuestions,
  countBackgroundAsksSince,
  countBackgroundAsksFor,
  insertBackgroundAsk,
  getOpenBackgroundAsk,
  completeBackgroundAsk,
  insertProposedBackgroundFacts,
  getConfirmedBackground: (playerId, pressLevel) =>
    getConfirmedBackground({ playerId }, pressLevel),
  listPressRoster,
}
