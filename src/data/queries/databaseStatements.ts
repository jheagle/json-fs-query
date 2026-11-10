import * as jsEnv from 'browser-or-node'
import { getSetting, switchDatabase } from '../utilities/config'
import { requireNode } from '../utilities/requireNode'
import { browserCallsRunning } from '../utilities/databaseLock'
import {
  databaseFolderExists,
  makeDatabaseFolder,
  readDatabaseList,
  removeDatabaseFolder,
  writeDatabaseList
} from '../storage'

/**
 * Whether a database exists: listed in `__DATABASES.json`, or (in Node) a folder of that name is there.
 * @param name
 */
const databaseExists = async (name: string): Promise<boolean> =>
  (await readDatabaseList()).includes(name) || (jsEnv.isNode && databaseFolderExists(name))

/**
 * `create database [if not exists] <name>`: a new, empty database in the folder holding them (databasesPath). It
 * doesn't switch to it (see use). The name is listed before the folder is made, so a stop part way leaves a listed
 * database whose folder appears with its first record, never a folder no list names. A folder that's there but not
 * listed (copied in by hand, or left by an older version) is listed by `if not exists`. Node only.
 * @param name
 * @param ifNotExists
 * @returns The name, or null when it existed and `if not exists` was given.
 */
export const createDatabase = async (name: string, ifNotExists: boolean = false): Promise<string | null> => {
  requireNode('"create database"')
  const listed = await readDatabaseList()
  if (listed.includes(name) || databaseFolderExists(name)) {
    if (!ifNotExists) {
      throw new Error(listed.includes(name)
        ? `Database "${name}" already exists`
        : `Database "${name}" already exists as a folder that isn't listed: create database if not exists ${name} lists it`)
    }
    if (!listed.includes(name)) {
      await writeDatabaseList([...listed, name])
    }
    return null
  }
  await writeDatabaseList([...listed, name])
  await makeDatabaseFolder(name)
  return name
}

/**
 * `drop database [if exists] <name>`: delete a database, its records and every row in them. The database in use can't
 * be dropped (use another one first). Node only.
 * @param name
 * @param ifExists
 * @returns The name, or null when it didn't exist and `if exists` was given.
 */
export const dropDatabase = async (name: string, ifExists: boolean = false): Promise<string | null> => {
  requireNode('"drop database"')
  if (!await databaseExists(name)) {
    if (ifExists) {
      return null
    }
    throw new Error(`Database "${name}" doesn't exist`)
  }
  if (getSetting('database', undefined) === name) {
    throw new Error(`Can't drop the database in use ("${name}"): use another one first`)
  }
  // Unlisted first: a stop part way leaves a folder no list names, never a listed database with no folder
  await writeDatabaseList((await readDatabaseList()).filter(listed => listed !== name))
  await removeDatabaseFolder(name)
  return name
}

/**
 * `use <name>`: switch to another database in the folder holding them, for the rest of the call and the calls after it
 * (as configure({ database }) does). Works in a browser too (reading only), for a database listed in
 * `__DATABASES.json`, while no other call is running in the page.
 * @param name
 * @returns The name.
 */
export const useDatabase = async (name: string): Promise<string> => {
  // A browser runs calls side by side (see withDatabaseLock), and there's one database in use for the page: switching
  // now would move the other calls to it part way
  if (!jsEnv.isNode && browserCallsRunning() > 1) {
    throw new Error(`Can't use "${name}" while other calls are running in this page: await them first, or pick the database with configure({ database }) between calls`)
  }
  if (!await databaseExists(name)) {
    throw new Error(`Database "${name}" doesn't exist${jsEnv.isNode ? '' : ' (or isn\'t listed in __DATABASES.json)'}`)
  }
  switchDatabase(name)
  return name
}

/**
 * `show databases`: the databases' names, in the order they were created.
 */
export const showDatabases = async (): Promise<string[]> => readDatabaseList()
