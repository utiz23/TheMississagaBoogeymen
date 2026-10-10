import { db } from '../client.js'
import { playerProfiles, type NewPlayerProfile } from '../schema/index.js'

/** The manually-owned profile fields a member or admin can edit on the site. */
export type ProfilePatch = Partial<
  Pick<
    NewPlayerProfile,
    | 'playerName'
    | 'jerseyNumber'
    | 'nationality'
    | 'bio'
    | 'preferredPosition'
    | 'archetype'
    | 'clubRoleLabel'
  >
>

/**
 * Write the given profile fields for one player; fields not in `patch` are
 * left alone. The row normally exists (ingestion creates an empty one), but
 * an upsert keeps a first edit from failing if it doesn't. The caller
 * decides who may change which field and validates the values.
 */
export async function updatePlayerProfile(playerId: number, patch: ProfilePatch): Promise<void> {
  const set = { ...patch, updatedAt: new Date() }
  await db
    .insert(playerProfiles)
    .values({ playerId, ...set })
    .onConflictDoUpdate({ target: playerProfiles.playerId, set })
}
