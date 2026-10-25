import { cache } from 'react'
import { listMemberGamertags } from '@eanhl/db/queries'

/**
 * The member gamertag list behind player page URLs (player-route.ts), read once
 * per request: the player page, its metadata and `MemberLinks` share it.
 */
export const getMemberGamertags = cache(listMemberGamertags)
