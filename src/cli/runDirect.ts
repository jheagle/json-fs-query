import { query } from '../data/queries/query'
import { chooseDatabase, DatabaseOptions } from './chooseDatabase'
import { printError, printResults } from './output'

/**
 * Run one query string (one or more queries) without opening the prompt: print each result, or the error.
 * @param queryString What `-q` / `--query` was given
 * @param options The database options
 * @returns {Promise<number>} The exit code: 0, or 1 when choosing the database or the query failed.
 */
export const runDirect = async (queryString: string, options: DatabaseOptions): Promise<number> => {
  try {
    await chooseDatabase(options)
    printResults(await query(queryString))
    return 0
  } catch (error) {
    printError(error)
    return 1
  }
}
