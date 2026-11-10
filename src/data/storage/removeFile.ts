import { storagePath } from './storagePath'
import { nodeFiles } from './nodeFiles'
import { cacheRemove } from './readCache'
import { pendingFile, stageRemove } from './writeSet'

/**
 * Delete one file of the database. During a statement the delete waits in its write set until the statement succeeds
 * (see withWriteSet), and reads in the statement already find the file gone. Node only.
 * @param path - A path inside the database, such as `users/1.json`.
 * @throws {Error} When the file doesn't exist.
 */
export const removeFile = async (path: string): Promise<void> => {
  const location = storagePath(path)
  const pending = pendingFile(location)
  if (pending === null || (pending === undefined && !require('fs').existsSync(location))) {
    throw new Error(`ENOENT: no such file or directory, rm '${location}'`)
  }
  if (stageRemove(location)) {
    return
  }
  // Forgotten before and after: a read that starts while rm runs would otherwise keep the file's old text
  cacheRemove(location)
  await nodeFiles().rm(location)
  cacheRemove(location)
}
