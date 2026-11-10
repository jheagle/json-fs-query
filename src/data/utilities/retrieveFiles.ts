import { retrieveFile } from './retrieveFile'
import { getSetting } from './config'

/**
 * Read several files of the database at once and resolve to their contents in the order of `paths`. Up to
 * `readConcurrency` reads (see configure) are in flight together: in a browser each file is an HTTP request, so a full
 * read of 1,000 rows no longer waits for 1,000 requests one after another.
 *
 * Fails as reading them one at a time would: with the error of the first file (in `paths` order) that can't be read.
 * Once a read fails no new ones start; the ones already started are awaited, so none is left running after this
 * returns, and since reads start in order, every file before the first failure was read.
 * @param paths - Paths inside the database, such as `users/1.json`.
 * @param read - Reads one path (default retrieveFile); callers with their own error message for a missing file pass it
 *   here.
 * @throws {Error} The error of the first file that couldn't be read.
 */
export const retrieveFiles = async (paths: string[], read: (path: string) => Promise<any> = retrieveFile): Promise<any[]> => {
  const limit = Math.max(1, Math.floor(getSetting('readConcurrency', 16)) || 1)
  const contents = new Array(paths.length)
  const failures: Array<{ position: number, error: unknown }> = []
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < paths.length && !failures.length) {
      const position = next++
      try {
        contents[position] = await read(paths[position])
      } catch (error) {
        failures.push({ position, error })
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, paths.length) }, worker))
  if (failures.length) {
    throw failures.reduce((first, failure) => failure.position < first.position ? failure : first).error
  }
  return contents
}
