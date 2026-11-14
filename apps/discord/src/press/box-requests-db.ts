import {
  claimPressBoxRequest,
  failStuckPressBoxRequests,
  finishPressBoxRequest,
  reportPressMode,
} from '@eanhl/db/queries'
import type { BoxRequestStore } from './box-requests.ts'

/** The Press Box request store on the database (the `@eanhl/db` queries); spread into `pressDbStore`. */
export const boxRequestDbStore: BoxRequestStore = {
  claimPressBoxRequest,
  finishPressBoxRequest,
  failStuckPressBoxRequests,
  reportPressMode,
}
