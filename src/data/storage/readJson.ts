import * as jsEnv from 'browser-or-node'
import { storagePath } from './storagePath'
import { nodeFiles } from './nodeFiles'
import { cachedRead } from './readCache'
import { pendingFile } from './writeSet'

/**
 * Read one file of the database as text, from wherever readJson would read it (the statement's write set, the read
 * cache, then storage).
 * @param path - A path inside the database, such as `users.json`.
 * @throws {Error} When the file can't be read.
 */
export const readText = async (path: string): Promise<string> => {
  const location = storagePath(path)
  const pending = pendingFile(location)
  if (pending === null) {
    throw new Error(`ENOENT: no such file or directory, open '${location}' (deleted by this statement)`)
  }
  return typeof pending === 'string'
    ? pending
    : cachedRead(location, () => jsEnv.isNode
      ? nodeFiles().readFile(location, 'utf8')
      : fetch(location).then(response => response.text()))
}

/**
 * Read and parse one JSON file of the database: from disk in Node, over `fetch()` in a browser (see storagePath for
 * where it's looked for). During a statement, a file it has written or deleted is answered from its write set (see
 * withWriteSet); otherwise, during a call, a file already read is answered from the read cache (see withReadCache).
 * @param path - A path inside the database, such as `users.json`.
 * @throws {Error} When the file can't be read or isn't valid JSON (the error from the file system, fetch or JSON.parse).
 */
export const readJson = async (path: string): Promise<any> => JSON.parse(await readText(path))
