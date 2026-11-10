import { retrieveFile } from './retrieveFile'
import { retrieveRecord } from './retrieveRecord'
import { isSingleFieldKey } from './isSingleFieldKey'

export const retrieveIndexes = async (entity = '', properties = [], recordData = {}) => {
  if (!Object.prototype.hasOwnProperty.call(recordData, entity)) {
    recordData[entity] = await retrieveRecord(entity)
  }
  const indexSet = {}
  for (const property of properties) {
    for (const key of recordData[entity].keys) {
      if (isSingleFieldKey(key, property)) {
        // A record with no entries has nothing indexed: read it as an empty index rather than asking for a file that
        // databases made before create() wrote empty indexes never got
        indexSet[property] = (recordData[entity].entries || []).length
          ? await retrieveFile(`__indexes/${entity}/${key.lookup}`)
          : []
      }
    }
  }
  return indexSet
}
