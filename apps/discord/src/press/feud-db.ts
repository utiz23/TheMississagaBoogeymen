import { addFeudPoints, isPressThread, listFeuds } from '@eanhl/db/queries'
import type { FeudStore } from './feud-store.ts'

/** The feud store on the database (the `@eanhl/db` queries); spread into `pressDbStore`. */
export const feudDbStore: FeudStore = { addFeudPoints, isPressThread, listFeuds }
