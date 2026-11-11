import { styleText } from 'util'
import { formatCsv } from './formatCsv'
import { formatResult, Markers } from './formatResult'

export const outputFormats = ['table', 'json', 'csv', 'dump'] as const

export type OutputFormat = typeof outputFormats[number]

/**
 * How results print: the format (-o / /output), and the table's markers for missing and null (--missing, --null, or
 * /missing and /null at the prompt). The prompt changes these during a session, so one object is shared.
 */
export type OutputSettings = {
  format: OutputFormat
  markers: Partial<Markers>
}

// Dim the markers only on a terminal, and never with NO_COLOR set (https://no-color.org)
const color = (): boolean => Boolean(process.stdout.isTTY) && !process.env.NO_COLOR

/**
 * Refuse a format that can't print yet, before the query runs (so `-o dump -q "insert ..."` doesn't insert and then
 * fail to show it).
 * @param settings
 * @throws {Error} For dump, which needs the record's name and query() results don't carry it.
 */
export const assertPrintable = (settings: OutputSettings): void => {
  if (settings.format === 'dump') {
    throw new Error('dump output isn\'t available yet (it needs the record\'s name, which results don\'t carry): use table, json or csv')
  }
}

/**
 * Format one result in the chosen format.
 * @param result
 * @param settings
 * @returns {string}
 */
const format = (result: unknown, settings: OutputSettings): string => {
  switch (settings.format) {
    case 'json':
      return JSON.stringify(result, null, 2)
    case 'csv':
      return formatCsv(result)
    default:
      return formatResult(result, { color: color(), markers: settings.markers })
  }
}

/**
 * Print each query's result in the chosen format, each followed by a blank line (as psql does) so results stay apart
 * when several print in a row. Several JSON results are one JSON value each, which jq reads as a stream.
 * @param {Array<*>} results One result per query
 * @param settings
 */
export const printResults = (results: Array<unknown>, settings: OutputSettings): void => {
  for (const result of results) {
    console.log(`${format(result, settings)}\n`)
  }
}

/**
 * Print an error in red, without its stack.
 * @param {*} error
 */
export const printError = (error: unknown): void => {
  console.error(styleText('red', `Error: ${error instanceof Error ? error.message : String(error)}`))
}
