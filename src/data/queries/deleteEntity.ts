import { retrieveRecord } from '../utilities/retrieveRecord'
import { retrieveFile } from '../utilities/retrieveFile'
import { removeFromIndex } from '../utilities/removeFromIndex'
import { computeKeyValue } from '../utilities/computeKeyValue'
import { keyValueType } from '../utilities/fieldType'
import { hasDependents } from '../introspect/policies/hasDependents'
import { recordDefinition } from '../introspect/definitions/record'
import { keyDefinition } from '../introspect/definitions/key'
import { getSetting } from '../utilities/config'
import { keyIndexFiles } from '../utilities/keyIndexFiles'
import { removeFile, writeJson } from '../storage'
import { discardPacked } from '../utilities/packedTable'

/**
 * RESTRICT: reject the whole delete (before removing anything) if any row being deleted is still
 * referenced by a single-field foreign key elsewhere. Only meaningful for a single-field primary
 * key, since foreign key support itself is single-field only - a composite primary key can't be
 * the target of one yet, so there's nothing to check.
 * @param entity
 * @param primaryKey
 * @param toDelete
 */
const assertNoDependents = async (entity: string, primaryKey: keyDefinition, toDelete: Object[]): Promise<void> => {
  if (!getSetting('enforceForeignKeys', true) || primaryKey.fields.length !== 1) {
    return
  }
  const property = primaryKey.fields[0]
  for (const row of toDelete) {
    if (await hasDependents(entity, property, row[property])) {
      throw new Error(`Cannot delete from "${entity}" where "${property}" = ${row[property]} - other records still reference it`)
    }
  }
}

/**
 * A record object carries no memory of which entry file it was read from, and files are not
 * guaranteed to be named after any field's value, so a deleted row's file is found by its primary
 * key value(s) - a single field, or a composite of several for a multi-field primary key. The
 * primary key's index says which files those are (each is read to confirm it); any deleted value
 * the index didn't lead to, or a record without one, is found by looking at every entry, as before.
 * Inserts and updates keep primary key values unique, so each value is one row: only a database
 * edited by hand into two rows of one value, with an index listing just one, would keep the other
 * (looking at every entry used to delete both).
 * @param entity
 * @param record
 * @param primaryKey
 * @param deletedValues
 */
const removeMatchingEntries = async (entity: string, record: recordDefinition, primaryKey: keyDefinition, deletedValues: Set<any>): Promise<string[]> => {
  const removed = new Set<string>()
  const found = new Set<any>()
  const removeIfDeleted = async (fileName: string): Promise<void> => {
    const data = await retrieveFile(`${record.path}/${fileName}`)
    const value = computeKeyValue(primaryKey.fields, data)
    if (!deletedValues.has(value)) {
      return
    }
    await removeFile(`${record.path}/${fileName}`)
    for (const key of record.keys) {
      await removeFromIndex(record.path, key, computeKeyValue(key.fields, data), fileName, keyValueType(record, key))
    }
    removed.add(fileName)
    found.add(value)
  }
  for (const fileName of await keyIndexFiles(record, primaryKey, value => deletedValues.has(value)) ?? []) {
    await removeIfDeleted(fileName)
  }
  if (found.size < deletedValues.size) {
    for (const fileName of record.entries.filter(entry => !removed.has(entry))) {
      await removeIfDeleted(fileName)
    }
  }
  return record.entries.filter(fileName => !removed.has(fileName))
}

export const deleteEntity = async (entity: string = '', dataSet: Object = {}): Promise<Object> => {
  const record = await retrieveRecord(entity)
  const primaryKey = record.keys.find(key => key.type === 'primary')
  if (!primaryKey) {
    throw new Error(`Cannot delete from "${entity}" without a primary key`)
  }

  const toDelete = dataSet[entity] || []
  if (!toDelete.length) {
    return dataSet
  }
  await assertNoDependents(entity, primaryKey, toDelete)
  const deletedValues = new Set(toDelete.map(row => computeKeyValue(primaryKey.fields, row)))

  const remaining = await removeMatchingEntries(entity, record, primaryKey, deletedValues)
  if (remaining.length !== record.entries.length) {
    await discardPacked(record.path)
  }
  record.entries = remaining
  await writeJson(`${record.path}.json`, record)

  return dataSet
}
