import { useDatabase } from '../data/queries/databaseStatements'
import { activeDatabasePath, configure } from '../data/utilities/config'

export type DatabaseOptions = {
  database?: string
  databases?: string
}

/**
 * Point json-fs-query at the database the options name: `-d <path>` alone is one database folder (databasePath),
 * `--databases <folder>` a folder of databases (databasesPath) with `-d <name>` picking one in it.
 * @param options
 * @returns {Promise<string>} A line saying which database is in use.
 * @throws {Error} For an invalid database name, or a database that doesn't exist.
 */
export const chooseDatabase = async (options: DatabaseOptions): Promise<string> => {
  if (options.databases) {
    configure({ databasesPath: options.databases, ...(options.database ? { database: options.database } : {}) })
    if (!options.database) {
      return `Databases: ${options.databases} (none in use yet: use <name>;)`
    }
    // Checks that it exists (configure only checks the name)
    await useDatabase(options.database)
  } else if (options.database) {
    // `-d data` is the folder data/ (configure adds the trailing slash when reading it)
    configure({ databasePath: options.database })
  }
  return `Database: ${activeDatabasePath()}`
}
