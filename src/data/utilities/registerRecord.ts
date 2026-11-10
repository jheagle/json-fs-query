import { recordDefinition } from '../introspect/definitions/record'
import { readJson, writeJson } from '../storage'

/**
 * __RECORDS is itself an ordinary record - path/definition/keys/entries - whose entries are the
 * filenames of every other record that has been created. This is the schema it's given the first
 * time a record is registered and no __RECORDS.json exists yet, matching what a hand-authored
 * database (see test-data/__RECORDS.json) already expects to find.
 */
const defaultRegistry = (): recordDefinition => ({
  path: '',
  definition: [
    { name: 'path', type: 'string', optional: false, autoGenerate: false },
    { name: 'definition', type: 'object', optional: false, autoGenerate: false },
    { name: 'keys', type: 'array', optional: false, autoGenerate: false },
    { name: 'entries', type: 'array', optional: false, autoGenerate: false }
  ],
  keys: [],
  entries: []
})

/**
 * Add a record's filename to the __RECORDS registry, creating the registry file the first time
 * a record is created if it doesn't already exist.
 * @param recordName
 */
export const registerRecord = async (recordName: string): Promise<recordDefinition> => {
  const registryPath = '__RECORDS.json'
  let registry: recordDefinition
  try {
    registry = await readJson(registryPath)
  } catch (err) {
    registry = defaultRegistry()
  }
  const fileName = `${recordName}.json`
  if (!registry.entries.includes(fileName)) {
    registry.entries.push(fileName)
  }
  await writeJson(registryPath, registry)
  return registry
}
