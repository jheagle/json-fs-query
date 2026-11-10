import * as jsEnv from 'browser-or-node'
import { activeDatabasePath, getSetting } from '../utilities/config'

/**
 * Turn a path inside the database (such as `users.json` or `__indexes/users/name.json`) into the location the files
 * backend uses: the configured databasePath in front of it, and in a browser also the relativePath (the URL prefix the
 * database is served from).
 *
 * Every other part of json-fs-query names files by their path inside the database only; this is the one place that
 * knows where the database is.
 * @param path - A path inside the database, without a leading slash. Empty for the database folder itself.
 */
export const storagePath = (path: string = ''): string => {
  const relativePath = jsEnv.isBrowser ? getSetting('relativePath', '') : ''
  return `${relativePath}${activeDatabasePath()}${path}`
}
