import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { CARDS_FILENAME, type WebhookPayload } from './message.ts'

/** Write what would have been posted to <outDir>/<matchId>/. */
export async function writeDryRunFiles(
  outDir: string,
  matchId: number,
  payload: WebhookPayload,
  image: Uint8Array | null,
): Promise<string> {
  const dir = path.join(outDir, String(matchId))
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, 'payload.json'), JSON.stringify(payload, null, 2))
  if (image !== null) await writeFile(path.join(dir, CARDS_FILENAME), image)
  return dir
}
