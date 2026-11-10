import { retrieveRecords } from '../../utilities/retrieveRecords'
import { where } from '../../queries/where'
import { retrieveRecord } from '../../utilities/retrieveRecord'
import { fieldType } from '../../utilities/fieldType'
import { indexHas } from '../../utilities/indexHas'

/**
 * Check whether any record in the referenced entity has the given property set to the given
 * value - the mirror image of keyUnique(), which checks that no record already has a value.
 * A referenced field with an index (a foreign key usually references a primary key) is answered from it; otherwise
 * every row is read.
 * @param entity
 * @param property
 * @param value
 */
export const foreignKeyExists = async (entity: string, property: string, value: any): Promise<boolean> => {
  const found = await indexHas(entity, property, value)
  if (typeof found !== 'undefined') {
    return found
  }
  const records = await retrieveRecords(entity)
  const type = fieldType(await retrieveRecord(entity), property)
  return where(records, { property, comparator: '=', value, type }).length > 0
}
