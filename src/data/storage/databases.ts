import * as jsEnv from 'browser-or-node'
import { databasesFolder, getSetting } from '../utilities/config'
import { nodeFiles } from './nodeFiles'
import { cacheRemove } from './readCache'
import { writeAtomically } from './writeSet'

/**
 * Where something in the folder holding the databases is (see databasesFolder), as storagePath gives it for a database:
 * on disk in Node, behind relativePath over fetch() in a browser.
 * @param path - A path inside that folder, such as `__DATABASES.json` or a database's name.
 */
export const databasesLocation = (path: string = ''): string => {
  const relativePath = jsEnv.isBrowser ? getSetting('relativePath', '') : ''
  return `${relativePath}${databasesFolder()}${path}`
}

const listLocation = (): string => databasesLocation('__DATABASES.json')

/**
 * The databases' names, in the order they were created, from `__DATABASES.json` in the folder holding them (a list, so
 * a browser can read it too: it can't list a folder). No list yet means no databases.
 */
export const readDatabaseList = async (): Promise<string[]> => {
  let text: string
  try {
    text = jsEnv.isNode
      ? await nodeFiles().readFile(listLocation(), 'utf8')
      : await fetch(listLocation()).then(response => response.ok === false ? '[]' : response.text())
  } catch (error) {
    if (jsEnv.isNode && (error as { code?: string })?.code !== 'ENOENT') {
      throw error
    }
    return []
  }
  try {
    const names = JSON.parse(text)
    return Array.isArray(names) ? names : []
  } catch (error) {
    // A static host answers a missing file with a page that isn't JSON
    if (!jsEnv.isNode) {
      return []
    }
    throw new Error(`Could not read ${listLocation()}: ${(error as Error).message}`)
  }
}

/**
 * Replace the list of databases. Node only.
 * @param names
 */
export const writeDatabaseList = async (names: string[]): Promise<void> => {
  await nodeFiles().mkdir(databasesLocation(), { recursive: true })
  await writeAtomically(listLocation(), JSON.stringify(names))
}

/**
 * Whether a database's folder exists. Node only.
 * @param name
 */
export const databaseFolderExists = (name: string): boolean => require('fs').existsSync(databasesLocation(name))

/**
 * Create a database's (empty) folder. Node only.
 * @param name
 */
export const makeDatabaseFolder = async (name: string): Promise<void> => {
  await nodeFiles().mkdir(databasesLocation(name), { recursive: true })
}

/**
 * Delete a database's folder and everything in it, and forget anything read from it. Node only.
 * @param name
 */
export const removeDatabaseFolder = async (name: string): Promise<void> => {
  const location = databasesLocation(name)
  cacheRemove(location, true)
  await nodeFiles().rm(location, { recursive: true, force: true })
  cacheRemove(location, true)
}
