import { retrieveRecords, RowRange } from '../utilities/retrieveRecords'

/**
 * Load an entity's rows into the dataSet, unless it already holds some.
 * @param entity
 * @param dataSet
 * @param range - Only the rows in this range, by position in the record's order (see retrieveRecords).
 */
export const readEntity = async (entity = '', dataSet = {}, range?: RowRange) => {
  if (!Object.prototype.hasOwnProperty.call(dataSet, entity) || !dataSet[entity].length) {
    dataSet[entity] = await retrieveRecords(entity, range)
  }
  return dataSet
}
