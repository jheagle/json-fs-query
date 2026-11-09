import { retrieveRecord } from '../utilities/retrieveRecord'
import { retrieveFile } from '../utilities/retrieveFile'
import { updateIndex } from '../utilities/updateIndex'
import { removeFromIndex } from '../utilities/removeFromIndex'
import { computeKeyValue } from '../utilities/computeKeyValue'
import { fieldType, keyValueType } from '../utilities/fieldType'
import { sameValue } from '../utilities/compareAs'
import { keyUnique } from '../introspect/policies/keyUnique'
import { typeCheck } from '../introspect/policies/typeCheck'
import { foreignKeyExists } from '../introspect/policies/foreignKeyExists'
import { hasDependents } from '../introspect/policies/hasDependents'
import { splitEntityProperty } from '../utilities/parsers/splitEntityProperty'
import { recordDefinition } from '../introspect/definitions/record'
import { keyDefinition } from '../introspect/definitions/key'
import { getSetting } from '../utilities/config'
import { keyIndexFiles } from '../utilities/keyIndexFiles'
import { writeJson } from '../storage'
import { discardPacked } from '../utilities/packedTable'
import { assertFieldsDefined } from '../utilities/knownFields'

/**
 * Same reasoning as deleteEntity: a record object carries no memory of which entry file it came
 * from, so find the file whose primary key value(s) match - a single field, or a composite of
 * several for a multi-field primary key. The primary key's index says which file that is; the file
 * is read to confirm it, and without an index (or when it leads nowhere) every entry is looked at
 * in turn, as before.
 * @param record
 * @param primaryKey
 * @param primaryValue
 */
const findEntryFile = async (record: recordDefinition, primaryKey: keyDefinition, primaryValue: any): Promise<string | null> => {
  const type = keyValueType(record, primaryKey)
  const isMatch = async (fileName: string): Promise<boolean> =>
    sameValue(type, computeKeyValue(primaryKey.fields, await retrieveFile(`${record.path}/${fileName}`)), primaryValue)
  for (const fileName of await keyIndexFiles(record, primaryKey, value => sameValue(type, value, primaryValue)) ?? []) {
    if (await isMatch(fileName)) {
      return fileName
    }
  }
  for (const fileName of record.entries) {
    if (await isMatch(fileName)) {
      return fileName
    }
  }
  return null
}

/**
 * True if the update actually changes at least one of this key's fields - a key none of whose
 * fields appear in newValues, or whose given values are all unchanged, doesn't need re-checking.
 * @param record
 * @param key
 * @param oldData
 * @param newValues
 */
const keyFieldsChanged = (record: recordDefinition, key: keyDefinition, oldData: Object, newValues: Object): boolean =>
  key.fields.some(field => Object.prototype.hasOwnProperty.call(newValues, field) && !sameValue(fieldType(record, field), newValues[field], oldData[field]))

/**
 * Only check uniqueness for a primary/unique key (single-field, or composite) whose value is
 * actually changing - checking an unchanged value would find the record's own existing entry and
 * wrongly report it as a duplicate of itself. A value with a null in it is never a duplicate (as in
 * SQL).
 * @param entity
 * @param record
 * @param oldData
 * @param newData
 * @param newValues
 */
const assertUniqueForUpdate = async (entity: string, record: recordDefinition, oldData: Object, newData: Object, newValues: Object): Promise<void> => {
  for (const key of record.keys) {
    if ((key.type !== 'primary' && key.type !== 'unique') || !keyFieldsChanged(record, key, oldData, newValues)) {
      continue
    }
    const checkKeys = key.fields.map(field => newData[field])
    // A null, or a field the row doesn't have (left out, or removed by this update), is never a duplicate
    if (checkKeys.some(value => value === null || typeof value === 'undefined')) {
      continue
    }
    const isUnique = await keyUnique(entity, key.fields, checkKeys)
    if (!isUnique) {
      throw new Error(`Duplicate value for ${key.type} key "${key.fields.join(', ')}" on ${entity}`)
    }
  }
}

/**
 * Same "only if it actually changed" scoping as assertUniqueForUpdate: re-checking an unchanged
 * foreign key value would re-validate a reference this update never touches, which could fail an
 * unrelated field's update if that parent record happened to be deleted since. A null references
 * nothing, so it isn't checked.
 * @param entity
 * @param record
 * @param oldData
 * @param newValues
 */
const assertForeignKeysForUpdate = async (entity: string, record: recordDefinition, oldData: Object, newValues: Object): Promise<void> => {
  for (const key of record.keys) {
    if (key.type !== 'foreign' || key.fields.length !== 1 || !key.references || key.references.length !== 1) {
      continue
    }
    const field = key.fields[0]
    // A null, or a field the update removes (undefined), references nothing
    if (!Object.prototype.hasOwnProperty.call(newValues, field) || newValues[field] === null || typeof newValues[field] === 'undefined' ||
      sameValue(fieldType(record, field), newValues[field], oldData[field])) {
      continue
    }
    const { entity: refEntity, property: refProperty } = splitEntityProperty(key.references[0].fields[0])
    const exists = await foreignKeyExists(refEntity, refProperty, newValues[field])
    if (!exists) {
      throw new Error(`Foreign key "${field}" on ${entity} references a nonexistent ${refEntity}.${refProperty} = ${newValues[field]}`)
    }
  }
}

/**
 * RESTRICT: reject an update that would change a single-field primary key's value while another
 * entity's foreign key still points at the old one - that reference would otherwise be left
 * dangling, since the row itself isn't gone, just re-keyed. Only meaningful for a single-field
 * primary key, matching foreign key support's own single-field-only scope.
 * @param entity
 * @param record
 * @param primaryKey
 * @param oldData
 * @param newValues
 */
const assertNoDependentsForUpdate = async (entity: string, record: recordDefinition, primaryKey: keyDefinition, oldData: Object, newValues: Object): Promise<void> => {
  if (!getSetting('enforceForeignKeys', true) || primaryKey.fields.length !== 1 || !keyFieldsChanged(record, primaryKey, oldData, newValues)) {
    return
  }
  const property = primaryKey.fields[0]
  if (await hasDependents(entity, property, oldData[property])) {
    throw new Error(`Cannot update "${entity}" where "${property}" = ${oldData[property]} - other records still reference it`)
  }
}

/**
 * Move a key's index entry (single-field, or a composite for a multi-field key) from the old
 * value to the new one wherever the update actually changed one of its fields.
 * @param record
 * @param oldData
 * @param newData
 * @param newValues
 * @param fileName
 */
const reconcileIndexes = async (record: recordDefinition, oldData: Object, newData: Object, newValues: Object, fileName: string): Promise<void> => {
  for (const key of record.keys) {
    if (!keyFieldsChanged(record, key, oldData, newValues)) {
      continue
    }
    await removeFromIndex(record.path, key, computeKeyValue(key.fields, oldData), fileName, keyValueType(record, key))
    await updateIndex(record.path, key, computeKeyValue(key.fields, newData), fileName, keyValueType(record, key))
  }
}

/**
 * The rows of one update are checked before any is written, so a check can't see the batch's own new values on disk.
 * Reject the update if two of its rows would end with the same value for a primary or unique key that it changes (a
 * value with a null in it is never a duplicate, as in assertUniqueForUpdate).
 * @param entity
 * @param record
 * @param planned
 * @param newValues
 */
const assertUniqueWithinUpdate = (entity: string, record: recordDefinition, planned: Array<{ oldData: Object, newData: Object }>, newValues: Object): void => {
  for (const key of record.keys) {
    if (key.type !== 'primary' && key.type !== 'unique') {
      continue
    }
    const claimed = []
    for (const { oldData, newData } of planned) {
      if (!keyFieldsChanged(record, key, oldData, newValues) || key.fields.some(field => newData[field] === null || typeof newData[field] === 'undefined')) {
        continue
      }
      const value = computeKeyValue(key.fields, newData)
      if (claimed.some(other => sameValue(keyValueType(record, key), other, value))) {
        throw new Error(`Duplicate value for ${key.type} key "${key.fields.join(', ')}" on ${entity}`)
      }
      claimed.push(value)
    }
  }
}

const assertRequiredFields = (entity: string, record: recordDefinition, newData: Object): void => {
  for (const field of record.definition) {
    if (!field.optional && typeof newData[field.name] === 'undefined') {
      throw new Error(`Missing required field "${field.name}" for ${entity}`)
    }
  }
}

/**
 * Type-check (and coerce) only the fields actually present in an update's values, never the rest
 * of the merged record - a field whose already-stored value doesn't match its declared type
 * (nothing enforced this before typeCheck() existed) must not block an update that never touches
 * that field.
 *
 * A null for an optional field that isn't nullable means the field is removed from the row (the
 * field can't hold null, so this is the only thing it can mean, and the only way to clear one):
 * it's kept as undefined here, so the key checks and indexes see the field change, and removed from
 * the row that's written (see withoutRemoved).
 * @param record
 * @param values
 */
const applyFieldTypes = (record: recordDefinition, values: Object): Object => {
  const typedValues = Object.assign({}, values)
  for (const field of record.definition) {
    if (Object.prototype.hasOwnProperty.call(typedValues, field.name)) {
      typedValues[field.name] = typedValues[field.name] === null && field.optional && !field.nullable
        ? undefined
        : typeCheck(field.type, typedValues[field.name], field.nullable)
    }
  }
  return typedValues
}

/**
 * A row without the fields an update removes (those it set to undefined, see applyFieldTypes).
 * @param row
 * @param typedValues
 */
const withoutRemoved = (row: Object, typedValues: Object): Object => {
  const kept = Object.assign({}, row)
  for (const field of Object.keys(typedValues)) {
    if (typeof typedValues[field] === 'undefined') {
      delete kept[field]
    }
  }
  return kept
}

export const updateEntity = async (entity: string = '', values: Object = {}, dataSet: Object = {}): Promise<Object> => {
  const record = await retrieveRecord(entity)
  const primaryKey = record.keys.find(key => key.type === 'primary')
  if (!primaryKey) {
    throw new Error(`Cannot update "${entity}" without a primary key`)
  }
  // A field the record doesn't define would otherwise be stored outside its definition
  assertFieldsDefined(entity, record, Object.keys(values || {}), 'set')
  const typedValues = applyFieldTypes(record, values)
  // A row is found by its primary key, so none of its fields can be cleared (an optional one could be, by null)
  for (const field of primaryKey.fields) {
    if (Object.prototype.hasOwnProperty.call(typedValues, field) && typeof typedValues[field] === 'undefined') {
      throw new Error(`Cannot clear "${field}" on ${entity}: it's part of the primary key`)
    }
  }

  // Check every row first and write only once all of them pass, so a row that fails leaves the others unchanged too
  const planned = []
  for (const row of dataSet[entity] || []) {
    const fileName = await findEntryFile(record, primaryKey, computeKeyValue(primaryKey.fields, row))
    if (!fileName) {
      throw new Error(`Could not find entry for ${entity} where "${primaryKey.fields.join(', ')}" = ${computeKeyValue(primaryKey.fields, row)}`)
    }
    if (planned.some(other => other.fileName === fileName)) {
      // The same entry given twice is one row: updating it once is enough, and it can't collide with itself
      continue
    }
    const oldData = await retrieveFile(`${record.path}/${fileName}`)
    const newData = withoutRemoved(Object.assign({}, oldData, typedValues), typedValues)
    await assertUniqueForUpdate(entity, record, oldData, newData, typedValues)
    await assertForeignKeysForUpdate(entity, record, oldData, typedValues)
    await assertNoDependentsForUpdate(entity, record, primaryKey, oldData, typedValues)
    assertRequiredFields(entity, record, newData)
    planned.push({ fileName, oldData, newData })
  }
  assertUniqueWithinUpdate(entity, record, planned, typedValues)
  if (planned.length) {
    await discardPacked(record.path)
  }

  for (const { fileName, oldData, newData } of planned) {
    await reconcileIndexes(record, oldData, newData, typedValues, fileName)
    await writeJson(`${record.path}/${fileName}`, newData)
  }

  dataSet[entity] = planned.map(({ newData }) => newData)
  return dataSet
}
