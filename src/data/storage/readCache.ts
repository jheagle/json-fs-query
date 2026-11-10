import { storagePath } from './storagePath'

/**
 * The files read during the calls running on one database, by location, as the text read (a pending read is shared).
 */
type CacheScope = { calls: number, files: Map<string, Promise<string>> }

const scopes: Map<string, CacheScope> = new Map()

/**
 * The scope of the database configured now (by its location, see storagePath), if a call on it is running.
 */
const currentScope = (): CacheScope | undefined => scopes.get(storagePath())

/**
 * Run `task` with a read cache for the configured database: while it runs, each file is read from storage once and
 * later reads of it are answered from memory, so a join no longer reads the joined record's files again for every row.
 * Writes and deletes made during the task update the cache (see cacheWrite, cacheRemove), so a query reads its own
 * writes. Outside any task nothing is cached and every read goes to storage, as before.
 *
 * The cache holds text, not parsed objects: every read parses its own copy, so a caller changing what it read (a join
 * attaches rows to the rows it read) never changes what the next reader gets.
 *
 * withDatabaseLock runs every public call (query, create, drop, describe) inside one, so the cache lasts one call. In
 * Node calls on one database never overlap (the lock queues them). In a browser they can, and a read can't tell which
 * call it belongs to, so each call that starts empties the cache: calls still running carry on (only reading their
 * files again), and nothing is older than the newest call, however long calls keep overlapping.
 * @param task
 */
export const withReadCache = async <T>(task: () => Promise<T>): Promise<T> => {
  const database = storagePath()
  const scope = scopes.get(database) || { calls: 0, files: new Map() }
  scopes.set(database, scope)
  scope.calls++
  if (scope.calls > 1) {
    scope.files = new Map()
  }
  try {
    return await task()
  } finally {
    scope.calls--
    if (!scope.calls && scopes.get(database) === scope) {
      scopes.delete(database)
    }
  }
}

/**
 * The text of the file at `location`: from the cache when a call is running and the file was read (or written) during
 * it, otherwise from `read`, kept for the rest of the call. A failed read isn't kept, so it fails (or succeeds) afresh
 * the next time.
 * @param location - The file's full location (see storagePath).
 * @param read - Reads the file's text from storage.
 */
export const cachedRead = (location: string, read: () => Promise<string>): Promise<string> => {
  const scope = currentScope()
  if (!scope) {
    return read()
  }
  const cached = scope.files.get(location)
  if (cached) {
    return cached
  }
  const reading = read()
  scope.files.set(location, reading)
  reading.catch(() => {
    if (scope.files.get(location) === reading) {
      scope.files.delete(location)
    }
  })
  return reading
}

/**
 * Keep the text just written to `location`, so the rest of the call reads it without going back to storage.
 * @param location - The file's full location (see storagePath).
 * @param text
 */
export const cacheWrite = (location: string, text: string): void => {
  currentScope()?.files.set(location, Promise.resolve(text))
}

/**
 * Forget a removed file, or (with `folder`) everything under a removed folder.
 * @param location - The full location (see storagePath) of the file or folder.
 * @param folder - Whether `location` is a folder.
 */
export const cacheRemove = (location: string, folder: boolean = false): void => {
  const scope = currentScope()
  if (!scope) {
    return
  }
  scope.files.delete(location)
  if (folder) {
    const prefix = location.endsWith('/') ? location : `${location}/`
    for (const cachedLocation of [...scope.files.keys()]) {
      if (cachedLocation.startsWith(prefix)) {
        scope.files.delete(cachedLocation)
      }
    }
  }
}
