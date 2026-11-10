import { storagePath } from './storagePath'
import { cacheWrite } from './readCache'
import { stageWrite, writeAtomically } from './writeSet'
import { getSetting } from '../utilities/config'

/**
 * The text a file of the database holds for `content`: compact JSON, or indented by 2 spaces for `pretty`.
 * @param content - Anything JSON.stringify accepts.
 * @param format - Defaults to the configured format (see configure).
 */
export const jsonText = (content: any, format: 'compact' | 'pretty' = getSetting('format', 'compact')): string =>
  format === 'pretty' ? JSON.stringify(content, null, 2) : JSON.stringify(content)

/**
 * Write `content` to one file of the database as JSON in the configured format (see jsonText), replacing the file if it
 * exists. Its folder must already exist (see makeDirectory). The file is replaced whole or not at all (see
 * writeAtomically). During a statement the write waits in its write set until the statement succeeds (see
 * withWriteSet). Node only.
 * @param path - A path inside the database, such as `users.json`.
 * @param content - Anything JSON.stringify accepts.
 * @param format - Defaults to the configured format (see configure).
 */
export const writeJson = async (path: string, content: any, format?: 'compact' | 'pretty'): Promise<void> => {
  const location = storagePath(path)
  const text = jsonText(content, format)
  if (stageWrite(location, text)) {
    return
  }
  await writeAtomically(location, text)
  cacheWrite(location, text)
}
