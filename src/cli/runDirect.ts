import { query } from '../data/queries/query'
import { chooseDatabase, DatabaseOptions } from './chooseDatabase'
import { assertPrintable, OutputSettings, printError, printResults } from './output'

/**
 * Run one query string (one or more queries) without opening the prompt: print each result, or the error.
 * @param queryString What `-q` / `--query` was given
 * @param options The database options
 * @param settings The output format and markers
 * @returns {Promise<number>} The exit code: 0, or 1 when choosing the database or the query failed.
 */
export const runDirect = async (queryString: string, options: DatabaseOptions, settings: OutputSettings): Promise<number> => {
  try {
    assertPrintable(settings)
    await chooseDatabase(options)
    printResults(await query(queryString), settings)
    return 0
  } catch (error) {
    printError(error)
    return 1
  }
}
