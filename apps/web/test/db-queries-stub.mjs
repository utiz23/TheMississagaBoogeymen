/**
 * Stand-in for `@eanhl/db/queries` during Server Component render tests, wired
 * in by ./server-component-loader.mjs.
 *
 * Two reasons it exists rather than a real database:
 *
 *   1. It lets a test choose the database state a page renders under. The state
 *     that matters here is an EMPTY `users` table — the exact condition the
 *     removed public bootstrap form keyed off, and the state a freshly deployed
 *     public host is in.
 *   2. It RECORDS which queries the page ran. Asserting that /login never asks
 *     for the user count is a stronger statement than asserting that it renders
 *     no bootstrap form under one sampled answer: a page that never asks cannot
 *     branch on the answer, whatever the answer would have been.
 *
 * Every stub answer here is deliberately set to the value that would make a
 * reintroduced bootstrap branch RENDER — `hasAccountUsers()` returns false, and
 * the claimable roster is non-empty. A test that passes against these answers
 * passes against the dangerous case, not a convenient one.
 */

/**
 * Names of the query functions the page called, in call order.
 * @type {string[]}
 */
export const calls = []

/** @type {Record<string, unknown> | null} */
let inviteForToken = null

export function resetStub() {
  calls.length = 0
  inviteForToken = null
}

/** Make the next `getAccountInviteByToken` return this invite (or null). */
export function setInvite(invite) {
  inviteForToken = invite
}

/** An empty database: no users at all. The dangerous answer, on purpose. */
export function hasAccountUsers() {
  calls.push('hasAccountUsers')
  return Promise.resolve(false)
}

/** A non-empty roster, so a reintroduced player picker would have options. */
export function listClaimablePlayers() {
  calls.push('listClaimablePlayers')
  return Promise.resolve([
    { id: 1, gamertag: 'StubRosterGamertagOne', isClaimed: false },
    { id: 2, gamertag: 'StubRosterGamertagTwo', isClaimed: false },
  ])
}

export function getAccountInviteByToken(token) {
  calls.push('getAccountInviteByToken')
  return Promise.resolve(inviteForToken === null ? null : { ...inviteForToken, token })
}

export function isInviteUsable(invite) {
  calls.push('isInviteUsable')
  return invite.acceptedAt === null && invite.revokedAt === null && invite.expiresAt > new Date()
}

/**
 * The rest of the surface `@eanhl/db/queries` exposes, reachable through the
 * page's import graph (account-actions, lib/auth). None of it should run while
 * rendering /login, so each one fails loudly rather than returning something
 * plausible — a silent stub would hide a page that started doing account work
 * at render time.
 */
function unexpected(name) {
  return (...args) => {
    calls.push(name)
    throw new Error(
      `db-queries-stub: ${name}() was called while rendering. Nothing on /login ` +
        `should run account queries at render time. Args: ${JSON.stringify(args)}`,
    )
  }
}

export const getAccountUserById = unexpected('getAccountUserById')
export const getUserByEmail = unexpected('getUserByEmail')
export const createInvitedAccount = unexpected('createInvitedAccount')
export const createAccountInvite = unexpected('createAccountInvite')
export const revokeAccountInvite = unexpected('revokeAccountInvite')
export const setAccountDisabled = unexpected('setAccountDisabled')
export const assignUserPlayerClaim = unexpected('assignUserPlayerClaim')
