/**
 * The storage layer: every file json-fs-query reads, writes or deletes goes through these functions, and nothing else
 * touches `fs` or `fetch()`. Paths given to them are inside the database (see storagePath).
 *
 * Today there is one backend, JSON files (on disk in Node, over fetch() in a browser). Keeping it behind these few
 * functions is what lets a read cache, batched writes and other storage backends come later without touching queries.
 */
export { storagePath } from './storagePath'
export { readJson, readText } from './readJson'
export { writeJson, jsonText } from './writeJson'
export { makeDirectory } from './makeDirectory'
export { removeFile } from './removeFile'
export { removeDirectory } from './removeDirectory'
export { fileExists } from './fileExists'
export { listFiles } from './listFiles'
export { databasesLocation, readDatabaseList, writeDatabaseList, databaseFolderExists, makeDatabaseFolder, removeDatabaseFolder } from './databases'
export { withReadCache } from './readCache'
export { withWriteSet } from './writeSet'
