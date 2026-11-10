import { readJson } from '../storage'
import { recordDefinition } from '../introspect/definitions/record'
import { keyDefinition } from '../introspect/definitions/key'

/**
 * The entry files a key's index lists for the values `matches` accepts, in the record's own order (the order its rows
 * are read in). A composite key's index holds its combined value (see computeKeyValue), so `matches` is given that.
 *
 * Undefined when the key has no index, or its file can't be read or parsed: the caller then looks through every row.
 * The files are candidates: callers read each one and check its value, and look through the rows for any value the
 * index didn't lead to, so an index that's out of step with the rows costs time, not a wrong result (for primary
 * key values, which inserts and updates keep unique; see removeMatchingEntries for a hand-edited exception).
 * @param record
 * @param key
 * @param matches
 */
export const keyIndexFiles = async (record: recordDefinition, key: keyDefinition, matches: (value: any) => boolean): Promise<string[] | undefined> => {
  if (!key.lookup) {
    return undefined
  }
  if (!(record.entries || []).length) {
    return []
  }
  let index
  try {
    index = await readJson(`__indexes/${record.path}/${key.lookup}`)
  } catch (err) {
    return undefined
  }
  const files = new Set<string>()
  for (const entry of Array.isArray(index) ? index : []) {
    if (Array.isArray(entry.record) && matches(entry.value)) {
      entry.record.forEach(file => files.add(file))
    }
  }
  return record.entries.filter(file => files.has(file))
}
