import * as jsEnv from 'browser-or-node'
import { fileExists, readJson, removeFile } from '../storage'
import { getSetting } from './config'
import { recordDefinition } from '../introspect/definitions/record'

/**
 * One record packed into one file by packDatabase: its entry files' names and rows, in the record's order, so a browser
 * reads a whole record in one request instead of one per row. Indexes stay in their own (small) files: a lookup that
 * needs a few rows reads the index and those rows, not the whole record.
 */
export type packedTable = {
  entries: string[]
  rows: any[]
}

/**
 * Where a record's packed file lives, inside the database.
 * @param recordPath
 */
export const packedPath = (recordPath: string): string => `__packed/${recordPath}.json`

/**
 * Whether reads may use packed files: by default in a browser (where every file is a request) and not in Node (which
 * reads the entry files, the copy that's edited, so a packed file can never hide a change there). See configure.
 */
export const usesPackedReads = (): boolean => getSetting('packedReads', !jsEnv.isNode)

/**
 * A record's packed file, when reads may use packed files (see usesPackedReads) and the record has one that matches it:
 * the same entries in the same order as the record file. Anything else (no packed file, one that can't be read, or one
 * packed before entries were added or removed) gives undefined, and the caller reads the entry files as before.
 * @param record
 */
export const retrievePacked = async (record: recordDefinition): Promise<packedTable | undefined> => {
  if (!usesPackedReads()) {
    return undefined
  }
  let packed: packedTable
  try {
    packed = await readJson(packedPath(record.path))
  } catch (error) {
    return undefined
  }
  const entries = record.entries || []
  if (!packed || !Array.isArray(packed.entries) || !Array.isArray(packed.rows) ||
    packed.entries.length !== entries.length || packed.rows.length !== entries.length ||
    packed.entries.some((entry, position) => entry !== entries[position])) {
    return undefined
  }
  return packed
}

/**
 * Remove a record's packed file, if it has one, as part of a statement that changes the record's rows: a packed file
 * is a copy of them, and one left behind after a change would be read in a browser in place of the change.
 * @param recordPath
 */
export const discardPacked = async (recordPath: string): Promise<void> => {
  if (fileExists(packedPath(recordPath))) {
    await removeFile(packedPath(recordPath))
  }
}
