import { addRelationshipPoints, isPressThread, listRelationships } from '@eanhl/db/queries'
import type { RelationshipStore } from './relationship-store.ts'

/** The relationship store on the database (the `@eanhl/db` queries); spread into `pressDbStore`. */
export const relationshipDbStore: RelationshipStore = {
  addRelationshipPoints,
  isPressThread,
  listRelationships,
}
