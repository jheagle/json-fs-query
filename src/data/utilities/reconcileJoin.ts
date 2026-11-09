/**
 * The same row's value of a field, compared as JSON (rows are JSON data, so this is a deep comparison).
 * @param a
 * @param b
 */
const sameValue = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b)

/**
 * After a merge, put the merged version of each joined row in place of the row on the entity that joined it. The merged
 * version is found as the same row: the one in dataSet[joinEntity] whose fields include every field of the joined row
 * with the same values (merging only adds fields). Matching by the join field instead (`where joinProp = value`) gave
 * every joined row the first row holding that value: an author's three books came back as the first book three times.
 * Two rows equal in every field have equal merged versions, so either one is right.
 * @param dataSet
 * @param entityName
 * @param entityKey
 * @param joinEntity
 * @param joinProp - The merge's field on joinEntity: a joined row without it isn't part of this merge, and is left as it is.
 */
export const reconcileJoin = (dataSet, entityName, entityKey, joinEntity, joinProp) => {
  const entity = dataSet[entityName][entityKey]
  if (Object.prototype.hasOwnProperty.call(entity, joinEntity) && Array.isArray(entity[joinEntity]) && Array.isArray(dataSet[joinEntity])) {
    entity[joinEntity].forEach(
      (joinedRow, k) => {
        if (!joinedRow || !Object.prototype.hasOwnProperty.call(joinedRow, joinProp)) {
          return
        }
        const fields = Object.keys(joinedRow)
        const mergedRow = dataSet[joinEntity].find(row => fields.every(field => sameValue(row[field], joinedRow[field])))
        if (mergedRow) {
          dataSet[entityName][entityKey][joinEntity][k] = mergedRow
        }
      }
    )
  }
  return dataSet
}
