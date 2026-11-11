import { retrieveFile } from '../utilities/retrieveFile'
import { deregisterRecord } from '../utilities/deregisterRecord'
import { requireNode } from '../utilities/requireNode'
import { removeDirectory, removeFile } from '../storage'
import { discardPacked } from '../utilities/packedTable'
import { assertValidName } from '../utilities/assertValidName'

export const drop = async (record) => {
  requireNode('drop()')
  if (record === '__RECORDS') {
    return null
  }
  // drop() removes files: a name like `../x` from a direct call must never reach storage
  assertValidName(record, 'drop()')
  const recordFile = await retrieveFile(`${record}.json`)
  for (const file of recordFile.entries) {
    await removeFile(`${recordFile.path}/${file}`)
  }
  await removeDirectory(recordFile.path)
  await removeDirectory(`__indexes/${recordFile.path}`)
  await discardPacked(recordFile.path)
  await removeFile(`${record}.json`)
  await deregisterRecord(record)
}
