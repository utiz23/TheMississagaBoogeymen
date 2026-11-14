import {
  claimPressBoxRequest,
  failStuckPressBoxRequests,
  finishPressBoxRequest,
  getProfileMaterial,
  reportPressMode,
  savePlayerProfile,
} from '@eanhl/db/queries'
import type { BoxRequestStoreWithProfiles } from './box-requests.ts'

/** The Press Box request store on the database (the `@eanhl/db` queries); spread into `pressDbStore`. */
export const boxRequestDbStore: BoxRequestStoreWithProfiles = {
  claimPressBoxRequest,
  finishPressBoxRequest,
  failStuckPressBoxRequests,
  reportPressMode,
  // Release L2 (migration 0081): the profile methods; found by `runBoxRequests`.
  getProfileMaterial,
  savePlayerProfile,
}
