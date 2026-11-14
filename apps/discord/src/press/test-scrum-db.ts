import {
  TEST_SCRUM_BUZZ,
  deleteTestRecapItem,
  insertTestRecapItem,
  isTestScrumThread,
} from '@eanhl/db/queries'
import { TEST_SCRUM_BUZZ_VALUE } from './test-scrum-rules.ts'
import type { TestScrumStore } from './test-scrum-store.ts'

// The db queries and the press code each hold the marker: they must be the same, or a test scrum
// would reach a story. Checked once, at start-up.
if (TEST_SCRUM_BUZZ !== TEST_SCRUM_BUZZ_VALUE) {
  throw new Error('test scrum marker differs between @eanhl/db and the press code')
}

/** The test scrum store on the database (the `@eanhl/db` queries); spread into `pressDbStore`. */
export const testScrumDbStore: TestScrumStore = {
  insertTestRecapItem,
  deleteTestRecapItem,
  isTestScrumThread,
}
