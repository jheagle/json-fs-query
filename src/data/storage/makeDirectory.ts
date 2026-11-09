import { storagePath } from './storagePath'
import { nodeFiles } from './nodeFiles'
import { stageMakeDirectory } from './writeSet'

/**
 * Create a folder of the database, and any missing folders above it (doing nothing if it already exists). During a
 * statement it's created with the statement's other changes (see withWriteSet). Node only.
 * @param path - A path inside the database, such as `users`. Empty for the database folder itself.
 */
export const makeDirectory = async (path: string = ''): Promise<void> => {
  const location = storagePath(path)
  if (stageMakeDirectory(location)) {
    return
  }
  await nodeFiles().mkdir(location, { recursive: true })
}
