import { storagePath } from './storagePath'
import { nodeFiles } from './nodeFiles'
import { cacheRemove } from './readCache'
import { stageRemoveDirectory } from './writeSet'

/**
 * Delete a folder of the database and everything in it; a folder that doesn't exist is left alone. During a statement
 * it's removed with the statement's other changes (see withWriteSet), and reads in the statement already find
 * everything in it gone. Node only.
 * @param path - A path inside the database, such as `__indexes/users`.
 */
export const removeDirectory = async (path: string): Promise<void> => {
  const location = storagePath(path)
  if (stageRemoveDirectory(location)) {
    return
  }
  // Forgotten before and after: a read that starts while rm runs would otherwise keep a removed file's old text
  cacheRemove(location, true)
  await nodeFiles().rm(location, { recursive: true, force: true })
  cacheRemove(location, true)
}
