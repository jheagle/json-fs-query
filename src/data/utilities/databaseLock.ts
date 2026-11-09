import * as jsEnv from 'browser-or-node'
import { lockPath, resolveDatabasePath, trackDatabaseCall } from './config'
import { withReadCache } from '../storage'

const queues: Map<string, Promise<void>> = new Map()

let browserCalls = 0

/**
 * How many calls are running in this browser page right now (they aren't queued there, see withDatabaseLock): `use`
 * refuses to switch the database while any other call is, as that call would carry on in the other database.
 */
export const browserCallsRunning = (): number => browserCalls

/**
 * Run `task` once every earlier task on the same database (the configured databasePath) has finished, so that calls
 * never interleave. Every write is several files in turn (an entry, the record's entry list, each index), each read and
 * rewritten whole, so two writes running at once overwrite each other's changes: ten parallel inserts used to leave
 * nine of the rows unreadable, and two parallel inserts of one unique value both succeeded. Reads take their turn too,
 * so a read never sees a write half done. A task that throws still lets the next one run.
 *
 * Only the public functions (query, create, drop, describe) take the lock; what they call inside doesn't take it
 * again, so it can't deadlock. In the browser nothing can be written, so tasks just run.
 *
 * Each task also runs with a read cache (see withReadCache): the files it reads are read once for the whole call.
 *
 * The queue is per folder (`database/` and `./database` share one). Every step of a task reads databasePath when it
 * runs, so configure() refuses to change it while tasks are queued or running (see trackDatabaseCall).
 * @param task
 */
export const withDatabaseLock = async <T>(task: () => Promise<T>): Promise<T> => {
  if (!jsEnv.isNode) {
    browserCalls++
    try {
      return await withReadCache(task)
    } finally {
      browserCalls--
    }
  }
  const database = resolveDatabasePath(lockPath())
  const ended = trackDatabaseCall()
  const previous = queues.get(database) || Promise.resolve()
  let release: () => void
  const turn = new Promise<void>(resolve => { release = resolve })
  const queued = previous.then(() => turn)
  queues.set(database, queued)
  await previous
  try {
    return await withReadCache(task)
  } finally {
    ended()
    release()
    if (queues.get(database) === queued) {
      queues.delete(database)
    }
  }
}
