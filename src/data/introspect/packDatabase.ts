import { fileExists, jsonText, listFiles, makeDirectory, readText, removeFile, writeJson } from '../storage'
import { retrieveRecord } from '../utilities/retrieveRecord'
import { retrieveFiles } from '../utilities/retrieveFiles'
import { retrieveEntry } from '../utilities/retrieveRecords'
import { packedPath, packedTable } from '../utilities/packedTable'
import { showRecords } from '../queries/showRecords'
import { requireNode } from '../utilities/requireNode'

export type packResult = {
  records: number
  rows: number
}

export type packCheck = {
  stale: string[]
  orphaned: string[]
}

/**
 * The packed file a record should have, read from its entry files (never from a packed file), as the compact
 * text packDatabase writes.
 * @param name - The record's name.
 */
const packedText = async (name: string): Promise<{ path: string, text: string, rows: number }> => {
  const record = await retrieveRecord(name)
  const entries: string[] = record.entries || []
  const rows = await retrieveFiles(entries.map(file => `${record.path}/${file}`), retrieveEntry)
  const packed: packedTable = { entries, rows }
  return { path: packedPath(record.path), text: jsonText(packed, 'compact'), rows: entries.length }
}

/**
 * The packed files under `__packed/` that belong to no record (left by a record dropped outside json-fs-query, or
 * renamed by hand).
 * @param names - The records' names.
 */
const orphanedPacks = async (names: string[]): Promise<string[]> => {
  const expected = new Set(names.map(name => packedPath(name)))
  return (await listFiles('__packed')).filter(path => !expected.has(path))
}

/**
 * Write every record of the configured database into one packed file (`__packed/<record>.json`, compact JSON): its
 * rows in the record's order. A browser then reads a record in one request instead of one per row when it needs more
 * rows than one round of requests (see packedReads in configure); a static site runs this as a build step, after its data changes. The entry files
 * stay the copy that's edited and reviewed; any insert, update or delete through json-fs-query removes the record's
 * packed file, and reads only use one that matches its record, so a packed file is never read in place of a change
 * made through json-fs-query. Packed files of records that no longer exist are removed.
 *
 * Runs as one statement (the public version, see withWriteSet): a row that can't be read fails it and nothing is
 * written. Node only.
 */
export const packDatabase = async (): Promise<packResult> => {
  requireNode('packDatabase')
  const names = await showRecords()
  let rows = 0
  for (const name of names) {
    const packed = await packedText(name)
    await makeDirectory(packed.path.slice(0, packed.path.lastIndexOf('/')))
    await writeJson(packed.path, JSON.parse(packed.text), 'compact')
    rows += packed.rows
  }
  for (const path of await orphanedPacks(names)) {
    await removeFile(path)
  }
  return { records: names.length, rows }
}

/**
 * Which records' packed files don't match their entry files (missing, or packed before a change made by
 * hand), and which packed files belong to no record, without changing anything: for a build or test to check that
 * packDatabase has run since the data last changed. Node only.
 */
export const checkPacked = async (): Promise<packCheck> => {
  requireNode('checkPacked')
  const names = await showRecords()
  const stale: string[] = []
  for (const name of names) {
    const packed = await packedText(name)
    const current = fileExists(packed.path) ? await readText(packed.path).catch(() => undefined) : undefined
    if (typeof current === 'undefined' || JSON.stringify(JSON.parse(current)) !== packed.text) {
      stale.push(name)
    }
  }
  return { stale, orphaned: await orphanedPacks(names) }
}
