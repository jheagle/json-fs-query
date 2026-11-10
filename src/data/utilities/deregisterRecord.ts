import { recordDefinition } from '../introspect/definitions/record'
import { readJson, writeJson } from '../storage'

/**
 * Remove a record's filename from the __RECORDS registry. A missing registry file is left
 * untouched rather than created, since there's nothing to remove from it.
 * @param recordName
 */
export const deregisterRecord = async (recordName: string): Promise<recordDefinition | null> => {
  const registryPath = '__RECORDS.json'
  let registry: recordDefinition
  try {
    registry = await readJson(registryPath)
  } catch (err) {
    return null
  }
  const fileName = `${recordName}.json`
  registry.entries = registry.entries.filter(entry => entry !== fileName)
  await writeJson(registryPath, registry)
  return registry
}
