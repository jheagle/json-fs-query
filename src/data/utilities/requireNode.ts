import * as jsEnv from 'browser-or-node'

/**
 * Throw a clear error when `action` is attempted outside Node. In a browser json-fs-query reads the database over
 * fetch(), and nothing can be written: without this check a write reached the missing `fs` functions and failed with
 * an unhelpful "... is not a function".
 * @param action What was attempted, for the message (for example "insert" or "create()").
 * @throws {Error} Outside Node.
 */
export const requireNode = (action: string): void => {
  if (!jsEnv.isNode) {
    throw new Error(`${action} only works in Node: in a browser, json-fs-query can only read the database (over fetch())`)
  }
}
