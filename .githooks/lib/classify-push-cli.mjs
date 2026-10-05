#!/usr/bin/env node
/**
 * classify-push-cli.mjs — thin CLI wrapper around classify-push.mjs for the
 * bash pre-push hook.
 *
 * Reads the standard pre-push stdin protocol (one "local-ref local-object
 * remote-ref remote-object" line per pushed ref) from stdin, classifies it,
 * prints a human-readable explanation to stderr, and communicates the
 * decision via exit code so the bash hook stays a thin dispatcher:
 *
 *   0 = fast path, git diff --check passed        -> push allowed
 *   1 = fast path, but git diff --check failed     -> push BLOCKED
 *   2 = full verification required                 -> hook runs the existing
 *       (video-stats change, or unreadable push)      TEST_* / verify-ocr.sh path
 *
 * Any unexpected crash here also exits 2 (fail closed to full verification,
 * never to "push allowed").
 */

import { classifyPush } from './classify-push.mjs'

async function readStdin() {
  let data = ''
  for await (const chunk of process.stdin) data += chunk
  return data
}

async function main() {
  const repoRoot = process.argv[2]
  if (!repoRoot) {
    console.error('[pre-push] classify-push-cli: missing <repoRoot> argument')
    process.exit(2)
  }

  const stdinText = await readStdin()
  const result = classifyPush({ stdinText, repoRoot, env: process.env })

  if (result.mode === 'full') {
    console.error(`[pre-push] classification: FULL verification required (${result.reason})`)
    if (result.paths.length > 0) {
      console.error('[pre-push]   paths considered:')
      for (const p of result.paths) console.error(`[pre-push]     ${p}`)
    }
    process.exit(2)
  }

  console.error(`[pre-push] classification: fast path (${result.reason})`)
  console.error('[pre-push]   paths considered:')
  if (result.paths.length === 0) {
    console.error('[pre-push]     (none — no-op ref update or branch deletion)')
  } else {
    for (const p of result.paths) console.error(`[pre-push]     ${p}`)
  }

  if (!result.diffCheck.ok) {
    console.error(
      '[pre-push] BLOCKED: git diff --check found whitespace/error issues in the pushed range:',
    )
    console.error(result.diffCheck.output)
    console.error('[pre-push] Fix the issues reported above, then push again.')
    process.exit(1)
  }

  console.error(
    '[pre-push] no video-stats changes — skipping scripts/verify-ocr.sh and verification-database credentials.',
  )
  console.error(
    '[pre-push] Force full verification for this push with: EANHL_PRE_PUSH_FULL=1 git push ...',
  )
  process.exit(0)
}

main().catch((err) => {
  console.error('[pre-push] classify-push-cli: unexpected error, falling back to full verification')
  console.error(err?.stack ?? String(err))
  process.exit(2)
})
