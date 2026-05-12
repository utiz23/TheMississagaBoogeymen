/**
 * Subprocess wrapper around the Python game_ocr CLI.
 *
 * The CLI lives at tools/game_ocr/ and is documented in docs/ocr/source-screen-inventory.md.
 * Output: JSON array of BaseExtractionResult-derived objects, one per source image.
 *
 * Defaults to running `python3 -m game_ocr.cli` from the repo root, with `tools/game_ocr`
 * on PYTHONPATH so the package resolves without a system-wide install. Override via
 * OCR_PYTHON env var (e.g. point at a venv interpreter or alternate module path).
 */

import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { OcrScreenType } from '@eanhl/db'

/**
 * Mirrors the Pydantic ExtractionField shape from tools/game_ocr/game_ocr/models.py.
 * Every parsed field across every screen type uses this envelope.
 */
export interface OcrExtractionField {
  raw_text: string | null
  value: unknown
  confidence: number | null
  status: 'ok' | 'uncertain' | 'missing'
}

export interface OcrExtractionMeta {
  screen_type: OcrScreenType
  source_path: string
  processed_at: string
  ocr_backend: string
  overall_confidence: number | null
  duplicate_of: string | null
}

/**
 * Top-level result envelope shared by every screen type. Screen-specific fields
 * live on the result object alongside meta/success/errors/warnings — type-narrowed
 * by callers via meta.screen_type.
 */
export interface OcrResult {
  meta: OcrExtractionMeta
  success: boolean
  errors: string[]
  warnings: string[]
  [key: string]: unknown
}

export interface RunOcrCliInput {
  screen: OcrScreenType
  /** Absolute path to a directory of images, or to a single image file. */
  inputPath: string
  /** Override for the Python invocation. Defaults to OCR_PYTHON env or 'python3'. */
  pythonBin?: string
}

export interface RunOcrCliOutput {
  results: OcrResult[]
  exitCode: number
  stderrLines: string[]
}

/**
 * Repo root resolved relative to apps/worker/src/. Used to locate tools/game_ocr/
 * for PYTHONPATH and as the cwd for the subprocess.
 */
const REPO_ROOT = resolve(import.meta.dirname, '..', '..', '..')
const GAME_OCR_DIR = join(REPO_ROOT, 'tools', 'game_ocr')

export async function runOcrCli(input: RunOcrCliInput): Promise<RunOcrCliOutput> {
  const { screen, inputPath } = input
  const pythonBin = input.pythonBin ?? process.env.OCR_PYTHON ?? 'python3'

  const tmpDir = await mkdtemp(join(tmpdir(), 'ocr-batch-'))
  const outputPath = join(tmpDir, 'results.json')

  try {
    const stderrLines: string[] = []

    const exitCode = await new Promise<number>((resolveExit, reject) => {
      const child = spawn(
        pythonBin,
        ['-m', 'game_ocr.cli', 'extract', '--screen', screen, '--input', inputPath, '--output', outputPath],
        {
          cwd: GAME_OCR_DIR,
          env: {
            ...process.env,
            // Ensure the package resolves regardless of install state.
            PYTHONPATH: [GAME_OCR_DIR, process.env.PYTHONPATH].filter(Boolean).join(':'),
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      )

      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => {
        for (const line of chunk.split(/\r?\n/)) {
          if (line) console.log(`[ocr-cli] ${line}`)
        }
      })

      child.stderr.setEncoding('utf8')
      child.stderr.on('data', (chunk: string) => {
        for (const line of chunk.split(/\r?\n/)) {
          if (line) {
            stderrLines.push(line)
            console.error(`[ocr-cli] ${line}`)
          }
        }
      })

      child.on('error', (err) => {
        reject(err)
      })
      child.on('close', (code) => {
        resolveExit(code ?? 0)
      })
    })

    // The CLI exits 1 when results have errors/warnings, but still writes the JSON.
    // Treat exit 2 (unsupported screen type) as fatal; treat missing output as fatal.
    if (exitCode === 2) {
      throw new Error(`game_ocr CLI rejected screen type '${screen}' (exit 2)`)
    }

    let raw: string
    try {
      raw = await readFile(outputPath, 'utf8')
    } catch (_err) {
      throw new Error(
        `game_ocr CLI did not produce output JSON at ${outputPath} (exit ${String(exitCode)})`,
      )
    }

    let results: OcrResult[]
    try {
      const parsed: unknown = JSON.parse(raw)
      if (!Array.isArray(parsed)) {
        throw new Error(`expected JSON array, got ${typeof parsed}`)
      }
      results = parsed as OcrResult[]
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(`Failed to parse game_ocr CLI output: ${msg}`)
    }

    return { results, exitCode, stderrLines }
  } finally {
    // Best-effort tempdir cleanup.
    await rm(tmpDir, { recursive: true, force: true }).catch(() => undefined)
  }
}
