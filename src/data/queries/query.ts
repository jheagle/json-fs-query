import { parser } from './parser'
import { runQuery } from '../utilities/runQuery'
import { withDatabaseLock } from '../utilities/databaseLock'
import { withWriteSet } from '../storage'

/**
 * Parse a query string (one query, or several separated by `;`) and run each query in turn, resolving to one result
 * per query. The queries of one call run together, under the database lock: no other call's queries run between
 * them (see withDatabaseLock). Each query is all or nothing: one that fails changes nothing, and the queries before it
 * keep their changes (see withWriteSet).
 * @param queryString
 */
export const query = async (queryString = '') => {
  const parsedQueries = parser(queryString)
  return withDatabaseLock(async () => {
    const queryResults = []
    for (const parsed of parsedQueries) {
      // Each query's changes reach storage together, or not at all if it fails (see withWriteSet)
      const dataSet = await withWriteSet(() => runQuery(parsed))
      queryResults.push(dataSet[parsed.entity])
    }
    return queryResults
  })
}
