import { keyDefinition } from '../introspect/definitions/key'
import { recordPath } from '../introspect/definitions/record'
import { indexEntry } from './updateIndex'
import { sameValue } from './compareAs'
import { readJson, writeJson } from '../storage'

/**
 * Remove a single entry file from the index that backs one of a record's keys, dropping a value
 * entirely once its last file is removed. A key with no lookup, or an index file that doesn't
 * exist yet, is left untouched.
 * @param path
 * @param key
 * @param value
 * @param fileName
 * @param type - The declared type of the indexed value (see keyValueType), so '3' and 3 are one entry.
 */
export const removeFromIndex = async (path: recordPath = '', key: keyDefinition = null, value: any = undefined, fileName: string = '', type: string = undefined): Promise<indexEntry[] | null> => {
  if (!key || !key.lookup) {
    return null
  }
  const indexPath = `__indexes/${path}/${key.lookup}`
  let index: indexEntry[] = []
  try {
    index = await readJson(indexPath)
  } catch (err) {
    return null
  }
  index = index
    .map(entry => sameValue(type, entry.value, value) ? { value: entry.value, record: entry.record.filter(record => record !== fileName) } : entry)
    .filter(entry => entry.record.length)
  await writeJson(indexPath, index)
  return index
}
