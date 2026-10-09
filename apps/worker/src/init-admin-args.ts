/**
 * Argument parsing for `init-admin` (./init-admin-cli.ts). Pure and separate so
 * it is unit-testable, and so a bad invocation is refused before the CLI loads
 * the database module.
 */

export const INIT_ADMIN_USAGE = `Usage: init-admin --player-id <id> [--hours <1-168>] [--base-url <url>] [--dry-run]

Mints the ONE bootstrap admin invite and prints its link. Open the link and
sign in with Discord to become the site's admin, linked to that player.
Refuses once any admin exists — after that, invite people from /admin/accounts.

  --player-id <id>   players.id of the admin's own player (required)
  --hours <n>        how long the link works (default 24, max 168)
  --base-url <url>   site origin for the link (default: APP_BASE_URL)
  --dry-run          check everything, create nothing
  --help             show this text`

export interface InitAdminArgs {
  playerId: number
  hours: number
  baseUrl: string
  dryRun: boolean
}

export type ParseResult =
  | { kind: 'help' }
  | { kind: 'error'; message: string }
  | { kind: 'ok'; args: InitAdminArgs }

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1'])

export function parseInitAdminArgs(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): ParseResult {
  let playerId: number | null = null
  let hours = 24
  let baseUrl = env['APP_BASE_URL'] ?? ''
  let dryRun = false

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    const value = (): string | null => {
      const v = argv[i + 1]
      if (v === undefined || v.startsWith('--')) return null
      i++
      return v
    }
    switch (flag) {
      case '--help':
      case '-h':
        return { kind: 'help' }
      case '--dry-run':
        dryRun = true
        break
      case '--player-id': {
        const v = value()
        if (v === null || !/^\d+$/.test(v) || Number(v) < 1) {
          return { kind: 'error', message: '--player-id needs a positive whole number' }
        }
        playerId = Number(v)
        break
      }
      case '--hours': {
        const v = value()
        if (v === null || !/^\d+$/.test(v) || Number(v) < 1 || Number(v) > 168) {
          return { kind: 'error', message: '--hours needs a whole number from 1 to 168' }
        }
        hours = Number(v)
        break
      }
      case '--base-url': {
        const v = value()
        if (v === null) return { kind: 'error', message: '--base-url needs a value' }
        baseUrl = v
        break
      }
      default:
        return { kind: 'error', message: `unknown argument: ${String(flag)}` }
    }
  }

  if (playerId === null) return { kind: 'error', message: '--player-id is required' }

  let url: URL
  try {
    url = new URL(baseUrl)
  } catch {
    return { kind: 'error', message: 'a site URL is required: pass --base-url or set APP_BASE_URL' }
  }
  if (url.protocol !== 'https:' && !LOCAL_HOSTS.has(url.hostname)) {
    return { kind: 'error', message: '--base-url must use https outside localhost' }
  }

  return { kind: 'ok', args: { playerId, hours, baseUrl: url.origin, dryRun } }
}
