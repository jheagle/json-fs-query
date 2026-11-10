import { readJson } from '../storage'
import { where } from '../queries/where'
import { retrieveRecord } from './retrieveRecord'
import { isSingleFieldKey } from './isSingleFieldKey'
import { fieldType } from './fieldType'

/**
 * Whether any row of `entity` has `property` = `value` (compared by the field's declared type, as where does: a null
 * equals nothing), answered from the index of a single-field key on the field: one file instead of every row.
 *
 * Undefined when there is no such index, or its file can't be read or parsed (a key added to a record by hand, a file
 * edited badly): the caller then reads the rows, which are the truth, as these checks always did. A record with no rows
 * has none, whatever its index says.
 * @param entity
 * @param property
 * @param value
 */
export const indexHas = async (entity: string, property: string, value: any): Promise<boolean | undefined> => {
  const record = await retrieveRecord(entity)
  const key = record.keys.find(key => isSingleFieldKey(key, property) && key.lookup)
  if (!key) {
    return undefined
  }
  if (!(record.entries || []).length) {
    return false
  }
  let index
  try {
    index = await readJson(`__indexes/${record.path}/${key.lookup}`)
  } catch (err) {
    return undefined
  }
  return where(index, { property: 'value', comparator: '=', value, type: fieldType(record, property) })
    .some(entry => Array.isArray(entry.record) && entry.record.length > 0)
}
