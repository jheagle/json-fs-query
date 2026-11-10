import { retrieveRecords } from '../../utilities/retrieveRecords'
import { where } from '../../queries/where'
import { retrieveRecord } from '../../utilities/retrieveRecord'
import { fieldType } from '../../utilities/fieldType'
import { indexHas } from '../../utilities/indexHas'

/**
 * Check that no existing record already has this combination of values across all of the given
 * fields - a single field for a normal unique/primary key, or several for a composite one.
 * references and checkKeys are parallel arrays: references[i]'s value must equal checkKeys[i].
 *
 * One field with an index (every primary and unique key has one) is answered from the index; a composite key, or a
 * field without one, reads every row.
 * @param entity
 * @param references
 * @param checkKeys
 */
export const keyUnique = async (entity, references = [], checkKeys = []) => {
  if (!references.length || references.length !== checkKeys.length) {
    return false
  }
  if (references.length === 1) {
    const found = await indexHas(entity, references[0], checkKeys[0])
    if (typeof found !== 'undefined') {
      return !found
    }
  }
  let records = await retrieveRecords(entity)
  const record = await retrieveRecord(entity)
  for (let i = 0; i < references.length; i++) {
    records = where(records, { property: references[i], comparator: '=', value: checkKeys[i], type: fieldType(record, references[i]) })
  }
  return !records.length
}
