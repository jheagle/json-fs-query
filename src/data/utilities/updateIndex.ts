import { keyDefinition } from '../introspect/definitions/key'
import { recordPath } from '../introspect/definitions/record'
import { sameValue } from './compareAs'
import { makeDirectory, readJson, writeJson } from '../storage'

export type indexEntry = {
  value: any
  record: string[]
}

/**
 * Add a single entry file to the index that backs one of a record's keys, creating the index
 * file (and its __indexes/{record} directory) the first time a value is indexed. Keys with no
 * lookup (multi-field keys are not indexed here) are left untouched.
 * @param path
 * @param key
 * @param value
 * @param fileName
 * @param type - The declared type of the indexed value (see keyValueType), so '3' and 3 share one entry.
 */
export const updateIndex = async (path: recordPath = '', key: keyDefinition = null, value: any = undefined, fileName: string = '', type: string = undefined): Promise<indexEntry[] | null> => {
  if (!key || !key.lookup) {
    return null
  }
  const indexDir = `__indexes/${path}`
  const indexPath = `${indexDir}/${key.lookup}`
  let index: indexEntry[] = []
  try {
    index = await readJson(indexPath)
  } catch (err) {
    index = []
  }
  const existingEntry = index.find(entry => sameValue(type, entry.value, value))
  if (existingEntry) {
    if (!existingEntry.record.includes(fileName)) {
      existingEntry.record.push(fileName)
    }
  } else {
    index.push({ value, record: [fileName] })
  }
  await makeDirectory(indexDir)
  await writeJson(indexPath, index)
  return index
}
