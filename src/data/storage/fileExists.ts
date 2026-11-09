import { storagePath } from './storagePath'
import { pendingExists } from './writeSet'

/**
 * Whether a file (or folder) of the database exists, counting what the running statement has written or deleted so
 * far (see withWriteSet). Node only, like the schema statements that use it.
 * @param path - A path inside the database, such as `users.json`.
 */
export const fileExists = (path: string): boolean => {
  const location = storagePath(path)
  const pending = pendingExists(location)
  if (pending !== undefined) {
    return pending
  }
  const { existsSync } = require('fs')
  return existsSync(location)
}
