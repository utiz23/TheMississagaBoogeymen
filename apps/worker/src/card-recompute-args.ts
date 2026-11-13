/**
 * Arguments of `card-recompute`. Unknown arguments throw: `--rebase` deletes
 * card history, so a typo such as `--dryrun` must stop the command, not run a
 * real rebase.
 */
const KNOWN = new Set(['--dry-run', '--rebase'])

export function parseCardRecomputeArgs(argv: readonly string[]): {
  dryRun: boolean
  rebase: boolean
} {
  for (const a of argv) if (!KNOWN.has(a)) throw new Error(`unknown argument: ${a}`)
  return { dryRun: argv.includes('--dry-run'), rebase: argv.includes('--rebase') }
}
