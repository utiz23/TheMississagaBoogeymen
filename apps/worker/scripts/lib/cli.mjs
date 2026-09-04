/**
 * Verification-database harness — CLI orchestration.
 *
 * This is the whole of `with-test-db.mjs`'s behaviour, expressed as one
 * importable function with every boundary injected: argv, env, the diagnostic
 * writer, the filesystem reads used for test discovery, and the
 * Docker/network/child-process dependencies.
 *
 * Why it is a module rather than a script body: the safety regressions have to
 * prove that a missing TEST_DATABASE_URL is refused *without* consulting
 * DATABASE_URL or a repo-root `.env`. Proving that by spawning the real bin
 * requires permission to spawn a Node process from a Node process, which some
 * managed runners deny (EPERM). Running the same production code in-process
 * needs no such permission and lets the test assert on things a subprocess
 * cannot expose at all — for instance that the filesystem boundary was never
 * touched, and that no Docker/network dependency was invoked even once.
 *
 * `runCli()` NEVER throws for an expected failure and never terminates the
 * process; it writes a diagnostic and returns a status. The bin turns that into
 * `process.exitCode`.
 */

import { GuardError } from './test-db-guard.mjs'
import { withTestDatabase } from './test-db-session.mjs'

/** A usage/precondition failure (bad argv, missing build, no matching tests). */
export class UsageError extends Error {
  constructor(message) {
    super(message)
    this.name = 'UsageError'
  }
}

/** Split argv into test-file selectors and an optional `-- <command>`. */
export function parseArgv(argv) {
  const sep = argv.indexOf('--')
  return {
    selectors: sep === -1 ? argv : argv.slice(0, sep),
    command: sep === -1 ? null : argv.slice(sep + 1),
  }
}

/**
 * Enumerate the built worker test files, optionally narrowed by selectors.
 *
 * `fs` is injected ({ existsSync, readdirSync }) so a test can both stub it and
 * assert on exactly which paths were read.
 */
export function discoverTestFiles({ distDir, selectors, fs, path, write }) {
  if (!fs.existsSync(distDir)) {
    throw new UsageError(`${distDir} not found — build first (pnpm --filter @eanhl/worker build).`)
  }
  const allTestFiles = fs
    .readdirSync(distDir, { recursive: true })
    .filter((p) => typeof p === 'string' && p.endsWith('.test.js'))
    .map((p) => path.join(distDir, p))
    .sort()

  // Positional args = test-file selectors (substring match), so the targeted
  // workflow still works under isolation, e.g.
  //   pnpm --filter worker test decoder-runs-cli
  // No args -> the full suite. Selectors match on the .test.js path (the .ts
  // source name works too, since dist mirrors src). Matching is against the
  // clone, so a targeted run is isolated the same as a full run.
  const testFiles =
    selectors.length === 0
      ? allTestFiles
      : allTestFiles.filter((f) => selectors.some((s) => f.includes(s.replace(/\.ts$/, ''))))

  if (selectors.length === 0) {
    write(`discovered ${testFiles.length} test file(s) under apps/worker/dist`)
  } else {
    write(
      `selectors [${selectors.join(', ')}] matched ${testFiles.length}/${allTestFiles.length} file(s)`,
    )
  }
  if (testFiles.length === 0) {
    throw new UsageError(
      selectors.length === 0
        ? 'no test files discovered — did the build run?'
        : `no test files matched selectors: ${selectors.join(', ')}`,
    )
  }
  return testFiles
}

/**
 * Run the harness. Returns the exit status; never throws for an expected
 * failure and never exits the process.
 *
 * @param {object} args
 * @param {string[]} args.argv               Arguments after the script name.
 * @param {Record<string,string|undefined>} args.env
 * @param {(line: string) => void} args.write  Diagnostic sink (one line, unprefixed).
 * @param {object} args.deps                 dockerExec, dockerExecInherit,
 *                                           networkSystemIdentifier, now, pid,
 *                                           runChild, registerCleanup?
 * @param {object} args.fs                   { existsSync, readdirSync }
 * @param {object} args.path                 node:path (or a stub)
 * @param {string} args.distDir              Where built worker tests live.
 * @param {string} args.nodeExecPath         Interpreter for the default suite run.
 */
export async function runCli({ argv, env, write, deps, fs, path, distDir, nodeExecPath }) {
  const log = (msg) => {
    write(`[with-test-db] ${msg}`)
  }
  try {
    const { selectors, command } = parseArgv(argv)
    if (command !== null && command.length === 0) {
      throw new UsageError('`--` was given with no command to run.')
    }

    // Discover BEFORE provisioning, so a build/selector mistake never creates a clone.
    const testFiles =
      command === null ? discoverTestFiles({ distDir, selectors, fs, path, write: log }) : null

    return await withTestDatabase({
      env,
      deps: { ...deps, log },
      run: async ({ childEnv }) => {
        if (command !== null) {
          log(`running: ${command.join(' ')}`)
          return await deps.runChild(command[0], command.slice(1), childEnv)
        }
        // `--test-force-exit`: backstop so a file that leaves the @eanhl/db pool
        // open can't keep its child process alive after its tests complete.
        return await deps.runChild(
          nodeExecPath,
          ['--test', '--test-force-exit', '--test-concurrency=1', ...testFiles],
          childEnv,
        )
      },
    })
  } catch (err) {
    if (err instanceof GuardError) {
      write(`[with-test-db] REFUSED (${err.code}): ${err.message}`)
    } else if (err instanceof UsageError) {
      write(`[with-test-db] ERROR: ${err.message}`)
    } else {
      write(`[with-test-db] ERROR: ${err?.stack ?? String(err)}`)
    }
    return 1
  }
}
