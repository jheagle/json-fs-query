import * as jsEnv from 'browser-or-node'
import { storagePath } from './storagePath'
import { nodeFiles } from './nodeFiles'
import { cacheRemove, cacheWrite } from './readCache'

/**
 * The changes one statement has made so far, not yet in storage: files by location (their new text, or null once
 * deleted, kept in the order they were last written), and folders made and removed.
 */
type WriteSet = {
  files: Map<string, string | null>
  madeFolders: Set<string>
  removedFolders: Set<string>
}

const writeSets: Map<string, WriteSet> = new Map()

/**
 * The write set of the database configured now (by its location, see storagePath), if a statement on it is running.
 */
const currentWriteSet = (): WriteSet | undefined => writeSets.get(storagePath())

const folderPrefix = (location: string): string => location.endsWith('/') ? location : `${location}/`

/**
 * Whether `location` is inside one of the folders `folders` (or is one of them).
 * @param location
 * @param folders
 */
const insideAny = (location: string, folders: Set<string>): boolean => {
  for (const folder of folders) {
    if (location === folder || location.startsWith(folderPrefix(folder))) {
      return true
    }
  }
  return false
}

/**
 * Write `text` to `location` so that the file is always either its old or its new content, never half of one: the
 * text goes to a temporary file next to it, which then replaces it (a rename is atomic within one folder). That holds
 * when the process stops part way (a crash, a kill); there's no fsync, so after a power cut the file system may still
 * lose a recent write. When the write or rename fails, the temporary file is removed and the original error thrown.
 * @param location
 * @param text
 */
export const writeAtomically = async (location: string, text: string): Promise<void> => {
  const temporary = `${location}.${crypto.randomUUID()}.tmp`
  const files = nodeFiles()
  try {
    await files.writeFile(temporary, text)
    await files.rename(temporary, location)
  } catch (error) {
    // Cleaning up is best effort: its own failure must not hide why the write failed
    await files.rm(temporary, { force: true }).catch(() => undefined)
    throw error
  }
}

/**
 * Remove a folder from storage and from the read cache.
 * @param location
 */
const removeFolder = async (location: string): Promise<void> => {
  cacheRemove(location, true)
  await nodeFiles().rm(location, { recursive: true, force: true })
  cacheRemove(location, true)
}

/**
 * Put a write set's changes in storage, in an order where a stop part way leaves at worst an unlisted file or folder
 * behind, never a record file or index that lists something missing:
 * - folders the statement removed and then wrote into again (none today), so the new content survives;
 * - new folders;
 * - every written file once, in the order each was last written (a record's entry list and indexes come after the
 *   entries they list);
 * - deleted files (a delete has already rewritten the record file and indexes; `drop` removes its record file here);
 * - the other removed folders (`drop`'s entries and indexes, after its record file is gone).
 * Each change also goes into the read cache, which holds what's in storage.
 * @param writeSet
 */
const commit = async (writeSet: WriteSet): Promise<void> => {
  const files = nodeFiles()
  const writtenInto = (folder: string): boolean => {
    const prefix = folderPrefix(folder)
    return [...writeSet.madeFolders].some(made => made === folder || made.startsWith(prefix)) ||
      [...writeSet.files].some(([location, text]) => text !== null && location.startsWith(prefix))
  }
  const removedFolders = [...writeSet.removedFolders]
  for (const folder of removedFolders.filter(writtenInto)) {
    await removeFolder(folder)
  }
  for (const folder of writeSet.madeFolders) {
    await files.mkdir(folder, { recursive: true })
  }
  for (const [location, text] of writeSet.files) {
    if (text !== null) {
      await writeAtomically(location, text)
      cacheWrite(location, text)
    }
  }
  for (const [location, text] of writeSet.files) {
    if (text === null) {
      cacheRemove(location)
      await files.rm(location, { force: true })
      cacheRemove(location)
    }
  }
  for (const folder of removedFolders.filter(folder => !writtenInto(folder))) {
    await removeFolder(folder)
  }
}

/**
 * Run one statement's `task` with a write set for the configured database: its writes and deletes are collected in
 * memory, and reads during the task see them (see pendingFile). When the task finishes, everything it changed is put in
 * storage at once, each file written once however many times the task changed it. When it throws, nothing it changed
 * reaches storage: a multi-row insert or update whose third row fails leaves the first two unwritten too.
 *
 * A task inside another (a public call made from inside a statement) joins the outer write set. Node only: in a
 * browser nothing can be written, so the task just runs.
 * @param task
 */
export const withWriteSet = async <T>(task: () => Promise<T>): Promise<T> => {
  const database = storagePath()
  if (!jsEnv.isNode || writeSets.has(database)) {
    return task()
  }
  const writeSet: WriteSet = { files: new Map(), madeFolders: new Set(), removedFolders: new Set() }
  writeSets.set(database, writeSet)
  let result: T
  try {
    result = await task()
  } finally {
    writeSets.delete(database)
  }
  await commit(writeSet)
  return result
}

/**
 * What the running statement has done to the file at `location`: its pending text, `null` if the statement deleted it
 * (or a folder it was in), or `undefined` when the statement hasn't touched it (or no statement is running).
 * @param location - The file's full location (see storagePath).
 */
export const pendingFile = (location: string): string | null | undefined => {
  const writeSet = currentWriteSet()
  if (!writeSet) {
    return undefined
  }
  if (writeSet.files.has(location)) {
    return writeSet.files.get(location)
  }
  return insideAny(location, writeSet.removedFolders) ? null : undefined
}

/**
 * Whether the file or folder at `location` exists as far as the running statement knows: true for a file it wrote, a
 * folder it made, or a folder holding something it wrote or made; false for a file it deleted or anything in a folder
 * it removed; `undefined` when the statement hasn't touched it (or no statement is running), so storage decides.
 * @param location - The full location (see storagePath).
 */
export const pendingExists = (location: string): boolean | undefined => {
  const writeSet = currentWriteSet()
  if (!writeSet) {
    return undefined
  }
  if (writeSet.files.has(location)) {
    return writeSet.files.get(location) !== null
  }
  const prefix = folderPrefix(location)
  const madeInside = (path: string): boolean => path === location || path.startsWith(prefix)
  if ([...writeSet.madeFolders].some(madeInside) ||
    [...writeSet.files].some(([path, text]) => text !== null && path.startsWith(prefix))) {
    return true
  }
  return insideAny(location, writeSet.removedFolders) ? false : undefined
}

/**
 * The files under `folder` as the running statement sees them: `onDisk` (full locations) without what it deleted or
 * removed, plus what it wrote there. `onDisk` as it is when no statement is running.
 * @param folder - The folder's full location (see storagePath).
 * @param onDisk - The full locations of the files under it in storage.
 */
export const pendingListing = (folder: string, onDisk: string[]): string[] => {
  const writeSet = currentWriteSet()
  if (!writeSet) {
    return onDisk
  }
  const prefix = folderPrefix(folder)
  const listed = new Set(onDisk.filter(location => !insideAny(location, writeSet.removedFolders)))
  for (const [location, text] of writeSet.files) {
    if (location.startsWith(prefix)) {
      if (text === null) {
        listed.delete(location)
      } else {
        listed.add(location)
      }
    }
  }
  return [...listed]
}

/**
 * Keep `text` as the new content of `location` in the running statement's write set. False when no statement is
 * running, so the caller writes to storage itself.
 * @param location
 * @param text
 */
export const stageWrite = (location: string, text: string): boolean => {
  const writeSet = currentWriteSet()
  if (!writeSet) {
    return false
  }
  // Moved to the end, so files are written in the order they were last changed
  writeSet.files.delete(location)
  writeSet.files.set(location, text)
  return true
}

/**
 * Mark `location` deleted in the running statement's write set. False when no statement is running.
 * @param location
 */
export const stageRemove = (location: string): boolean => {
  const writeSet = currentWriteSet()
  if (!writeSet) {
    return false
  }
  writeSet.files.delete(location)
  writeSet.files.set(location, null)
  return true
}

/**
 * Note a folder to create in the running statement's write set. False when no statement is running.
 * @param location
 */
export const stageMakeDirectory = (location: string): boolean => {
  const writeSet = currentWriteSet()
  if (!writeSet) {
    return false
  }
  writeSet.madeFolders.add(location)
  return true
}

/**
 * Mark a folder and everything in it removed in the running statement's write set: what the statement wrote or
 * created inside it so far is dropped with it. False when no statement is running.
 * @param location
 */
export const stageRemoveDirectory = (location: string): boolean => {
  const writeSet = currentWriteSet()
  if (!writeSet) {
    return false
  }
  for (const file of [...writeSet.files.keys()]) {
    if (insideAny(file, new Set([location]))) {
      writeSet.files.delete(file)
    }
  }
  for (const folder of [...writeSet.madeFolders]) {
    if (insideAny(folder, new Set([location]))) {
      writeSet.madeFolders.delete(folder)
    }
  }
  writeSet.removedFolders.add(location)
  return true
}
