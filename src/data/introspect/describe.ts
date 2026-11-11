import { retrieveFile } from '../utilities/retrieveFile'
import { assertValidName } from '../utilities/assertValidName'

export const describe = async (record = '__RECORDS') => {
  assertValidName(record, 'describe()')
  const recordFile = await retrieveFile(`${record}.json`)
  if (record === '__RECORDS') {
    return recordFile.entries
  }
  return recordFile.definition
}
