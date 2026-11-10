import * as jsEnv from 'browser-or-node'
import { retrieveFile } from './retrieveFile'
import { recordExists } from './recordExists'

/**
 * A record's definition (its fields, keys and entries), from `<entity>.json`.
 * @param entity
 * @throws {Error} `Record "<entity>" doesn't exist` when it doesn't (in Node, checked before reading; in a browser,
 *   where that can't be checked without reading, when the file can't be read).
 */
export const retrieveRecord = async (entity = '') => {
  if (jsEnv.isNode && !recordExists(entity)) {
    throw new Error(`Record "${entity}" doesn't exist`)
  }
  try {
    return await retrieveFile(`${entity}.json`)
  } catch (error) {
    if (!jsEnv.isNode) {
      throw new Error(`Record "${entity}" doesn't exist, or ${entity}.json can't be read`)
    }
    throw error
  }
}
