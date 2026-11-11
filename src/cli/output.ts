import { styleText } from 'util'
import { formatResult } from './formatResult'

// Dim the markers only on a terminal, and never with NO_COLOR set (https://no-color.org)
const color = (): boolean => Boolean(process.stdout.isTTY) && !process.env.NO_COLOR

/**
 * Print each query's result as a table (see formatResult), each followed by a blank line (as psql does) so results
 * stay apart when several print in a row.
 * @param {Array<*>} results One result per query
 */
export const printResults = (results: Array<unknown>): void => {
  for (const result of results) {
    console.log(`${formatResult(result, { color: color() })}\n`)
  }
}

/**
 * Print an error in red, without its stack.
 * @param {*} error
 */
export const printError = (error: unknown): void => {
  console.error(styleText('red', `Error: ${error instanceof Error ? error.message : String(error)}`))
}
