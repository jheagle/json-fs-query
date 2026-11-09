import { record, recordDefinition } from './definitions/record'
import { keyProperties } from './definitions/key'
import { fieldProperties } from './definitions/field'
import { registerRecord } from '../utilities/registerRecord'
import { fileExists, makeDirectory, writeJson } from '../storage'
import { requireNode } from '../utilities/requireNode'
import { typeCheck } from './policies/typeCheck'

const knownKeyProperties = ['type', 'fields', 'lookup', 'references']

/**
 * Reject a key with a property key() would ignore (a typo such as `keys` for `fields`), which has to be
 * checked on the keys as given, before key() drops it.
 * @param recordName
 * @param keys
 */
const assertKnownKeyProperties = (recordName: string, keys: keyProperties[]): void => {
  for (const key of keys) {
    for (const property of Object.keys(key)) {
      if (!knownKeyProperties.includes(property)) {
        throw new Error(`Unknown property "${property}" on ${key.type ?? 'index'} key of ${recordName}; must be ${knownKeyProperties.join(', ')}`)
      }
    }
  }
}

/**
 * Reject a definition that could never be written correctly, before anything is created: a
 * default that fails its field's type check (otherwise every insert leaving that field out would
 * fail instead), including a null default on a field that isn't nullable, and a nullable field in
 * the primary key (an entry's file name comes from its primary key value). Also a key with no fields,
 * or with a field that isn't in the definition.
 * @param recordName
 * @param recordContent
 */
export const assertValidDefinition = (recordName: string, recordContent: recordDefinition): void => {
  for (const field of recordContent.definition) {
    if (!Object.prototype.hasOwnProperty.call(field, 'default')) {
      continue
    }
    try {
      typeCheck(field.type, field['default'], field.nullable)
    } catch (err) {
      throw new Error(`Invalid default for field "${field.name}" of ${recordName}: ${(err as Error).message}`)
    }
  }
  for (const key of recordContent.keys) {
    if (key.fields.length < 1) {
      throw new Error(`The ${key.type} key of ${recordName} must have at least one field`)
    }
    for (const fieldName of key.fields) {
      if (!recordContent.definition.some(field => field.name === fieldName)) {
        throw new Error(`The ${key.type} key of ${recordName} names field "${fieldName}", which isn't in the definition`)
      }
    }
  }
  const primaryKey = recordContent.keys.find(key => key.type === 'primary')
  for (const fieldName of primaryKey ? primaryKey.fields : []) {
    if (recordContent.definition.some(field => field.name === fieldName && field.nullable)) {
      throw new Error(`Primary key field "${fieldName}" of ${recordName} can't be nullable`)
    }
  }
}

/**
 * Create a new record. Throws if the definition is invalid (see assertValidDefinition).
 * @param recordName
 * @param definition
 * @param keys
 */
export const create = async (recordName: string, definition: fieldProperties[] = [], keys: keyProperties[] = []): Promise<recordDefinition | null> => {
  requireNode('create()')
  if (recordName === '__RECORDS') {
    return null
  }
  if (fileExists(`${recordName}.json`)) {
    return null
  }
  assertKnownKeyProperties(recordName, keys)
  const recordContent = record({ path: recordName, definition, keys })
  assertValidDefinition(recordName, recordContent)
  await makeDirectory()
  await writeJson(`${recordName}.json`, recordContent)
  await makeDirectory(recordName)
  // Each indexed key starts with an empty index, so the new record reads like any other before its first insert
  // (a where on a key used to fail with "Could not read __indexes/...", since the file only appeared with the first row)
  const indexedKeys = recordContent.keys.filter(key => key.lookup)
  if (indexedKeys.length) {
    await makeDirectory(`__indexes/${recordName}`)
    for (const key of indexedKeys) {
      await writeJson(`__indexes/${recordName}/${key.lookup}`, [])
    }
  }
  await registerRecord(recordName)
  return recordContent
}
