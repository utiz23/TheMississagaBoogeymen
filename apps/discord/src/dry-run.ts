import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { CARDS_FILENAME, type MessagePayload, type WebhookPayload } from './message.ts'

/** Write what would have been posted to <outDir>/<key>/ (a match id, or unlock-<event>). */
export async function writeDryRunFiles(
  outDir: string,
  key: string | number,
  payload: WebhookPayload | MessagePayload,
  image: Uint8Array | null,
): Promise<string> {
  const dir = path.join(outDir, String(key))
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, 'payload.json'), JSON.stringify(payload, null, 2))
  const filename = payload.attachments?.[0]?.filename ?? CARDS_FILENAME
  if (image !== null) await writeFile(path.join(dir, filename), image)
  return dir
}
