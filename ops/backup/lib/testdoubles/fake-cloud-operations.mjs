/**
 * TEST DOUBLE — an in-memory, exact-path model of the four E3J4/E3J6A cloud
 * operations the upload attempt and E3J6B readback call (`runInfo`,
 * `runCreateFolder`, `runUpload`, `runContainedDownload`).
 *
 * **This is not Proton and not the Proton Drive CLI.** It spawns nothing,
 * touches no network, and proves nothing about real provider behaviour. It
 * exists so `internal/backup-cloud-upload-core.mjs`'s and
 * `internal/backup-cloud-readback-core.mjs`'s orchestration — order,
 * stop-after-failure, classification, write-target scope — can be exercised
 * deterministically. Real-spawn coverage of the same sequences goes through
 * `fake-proton-drive.mjs` and the production E3J4/E3J6A boundary instead.
 *
 * Every default result is a fresh, frozen object in the exact shape the
 * boundary returns (`kind`, `operation`, and the operation's allowlisted
 * fields). `runUpload`'s default success path additionally reads and RETAINS
 * the uploaded file's bytes on the in-memory tree node (E3J6B addition, purely
 * additive — no existing field or behaviour changes), so a later
 * `runContainedDownload` in the SAME fake can write real bytes to a real local
 * path for readback tests, without a real subprocess.
 *
 * `respond(call)` may return a result to use instead of the default, throw to
 * simulate a boundary throw, or return `undefined` to fall through to the
 * default model behaviour. `call` is `{ index, operation, params }`, where
 * `index` counts calls of any operation from 0. The recorded `log` holds
 * `{ operation, remotePath | parentPath+name | localFilePath+remoteParentPath+
 * expectedLocalSizeBytes, hadSignal }` per call — never the options object.
 */

import fs from 'node:fs'

export const FAKE_ROOT_UID = 'root~uid'

export function infoAbsent() {
  return Object.freeze({ kind: 'success', operation: 'info', present: false })
}

export function infoPresent({ nodeKind = 'folder', state = 'active', nodeUid = 'node~uid' } = {}) {
  return Object.freeze({
    kind: 'success',
    operation: 'info',
    present: true,
    nodeKind,
    nodeUid,
    state,
    activeRevisionUid: null,
    claimedSizeBytes: null,
    claimedSha1: null,
    sha1Verified: null,
  })
}

export function createdResult(folderUid) {
  return Object.freeze({ kind: 'success', operation: 'create-folder', created: true, folderUid })
}

export function uploadSuccess(bytes) {
  return Object.freeze({
    kind: 'success',
    operation: 'upload',
    transferredItems: 1,
    transferredBytes: bytes,
    skippedItems: 0,
    failedItems: 0,
    failureCodes: Object.freeze([]),
  })
}

export function rejectedResult(operation, code) {
  return Object.freeze({ kind: 'rejected', operation, code, transferState: 'definitely_zero' })
}

export function indeterminateResult(operation, code) {
  return Object.freeze({ kind: 'indeterminate', operation, code, transferState: 'unknown' })
}

export function downloadSuccess({ localPath, bytesWritten }) {
  return Object.freeze({
    kind: 'success',
    operation: 'download',
    localPath,
    bytesWritten,
    completed: true,
  })
}

const basename = (p) => p.slice(p.lastIndexOf('/') + 1)

/**
 * @param {object} [opts]
 * @param {string|null} [opts.root]  pre-provisioned active root folder (null: none)
 * @param {Record<string, {nodeKind: string, state: string, nodeUid?: string}>} [opts.nodes]
 * @param {(call: object) => unknown} [opts.respond]
 */
export function makeFakeCloud({ root = '/proton/eanhl-backups', nodes = {}, respond } = {}) {
  const tree = new Map()
  if (root !== null) tree.set(root, { nodeKind: 'folder', state: 'active', nodeUid: FAKE_ROOT_UID })
  for (const [p, node] of Object.entries(nodes)) {
    tree.set(p, { nodeUid: `preexisting~${tree.size}`, ...node })
  }
  const log = []
  let index = 0
  let uidCounter = 0

  async function dispatch(operation, params, record, fallback) {
    const call = { index: index++, operation, params }
    log.push(Object.freeze({ operation, ...record, hadSignal: params.signal !== undefined }))
    if (respond) {
      const override = await respond(call)
      if (override !== undefined) return override
    }
    return fallback()
  }

  const ops = Object.freeze({
    runInfo: (params) =>
      dispatch('info', params, { remotePath: params.remotePath }, () => {
        const node = tree.get(params.remotePath)
        return node ? infoPresent(node) : infoAbsent()
      }),
    runCreateFolder: (params) =>
      dispatch(
        'create-folder',
        params,
        { parentPath: params.parentPath, name: params.name },
        () => {
          const target = `${params.parentPath}/${params.name}`
          const parent = tree.get(params.parentPath)
          if (!parent || parent.nodeKind !== 'folder' || tree.has(target)) {
            return indeterminateResult('create-folder', 'provider_error_unrecognised')
          }
          uidCounter += 1
          const nodeUid = `folder~${uidCounter}`
          tree.set(target, { nodeKind: 'folder', state: 'active', nodeUid })
          return createdResult(nodeUid)
        },
      ),
    runUpload: (params) =>
      dispatch(
        'upload',
        params,
        {
          localFilePath: params.localFilePath,
          remoteParentPath: params.remoteParentPath,
          expectedLocalSizeBytes: params.expectedLocalSizeBytes,
        },
        () => {
          const target = `${params.remoteParentPath}/${basename(params.localFilePath)}`
          const parent = tree.get(params.remoteParentPath)
          if (!parent || parent.nodeKind !== 'folder') {
            return indeterminateResult('upload', 'provider_error_unrecognised')
          }
          if (tree.has(target)) return rejectedResult('upload', 'name_conflict')
          uidCounter += 1
          const content = fs.readFileSync(params.localFilePath)
          tree.set(target, {
            nodeKind: 'file',
            state: 'active',
            nodeUid: `file~${uidCounter}`,
            content,
          })
          return uploadSuccess(params.expectedLocalSizeBytes)
        },
      ),
    runContainedDownload: (params) =>
      dispatch(
        'download',
        params,
        {
          remotePath: params.remotePath,
          localDir: params.localDir,
          maxFileBytes: params.maxFileBytes,
        },
        () => {
          const node = tree.get(params.remotePath)
          if (!node || node.nodeKind !== 'file' || node.content === undefined) {
            return indeterminateResult('download', 'provider_error_unrecognised')
          }
          if (node.content.length > params.maxFileBytes) {
            return indeterminateResult('download', 'download_containment_violated')
          }
          fs.writeFileSync(params.expectedLocalPath, node.content, { mode: 0o600 })
          return downloadSuccess({
            localPath: params.expectedLocalPath,
            bytesWritten: node.content.length,
          })
        },
      ),
  })

  return { ops, log, tree }
}
