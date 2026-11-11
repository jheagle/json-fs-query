import type { Group } from '../data/queries/groupBy'
import { isGroup } from './formatResult'

const isPlainObject = (value: unknown): value is Object => value !== null && typeof value === 'object' && !Array.isArray(value)

/**
 * One CSV field (RFC 4180): quoted when it holds a comma, a quote, a line break, or space at either end, with its
 * quotes doubled. `null` and a missing field are empty and unquoted, the empty string is `""` (as psql's CSV output
 * tells them apart). Objects and arrays are their JSON.
 * @param value
 * @param present False when the row doesn't have the field
 */
const csvField = (value: unknown, present: boolean = true): string => {
  if (!present || value === null || typeof value === 'undefined') {
    return ''
  }
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value)
  return text === '' || /[",\r\n]|^\s|\s$/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/**
 * The rows of a grouped read, in group order (each row still holds the fields it was grouped by).
 * @param groups
 */
const groupRows = (groups: Group[]): Object[] => groups.flatMap(group => group.groups ? groupRows(group.groups) : group.rows)

/**
 * Format one query's result as CSV: a header line of field names (in the order they first appear), then a line per
 * row. A grouped read is its rows, plain values (show records) one `value` column, an empty result nothing at all.
 * Anything else (`describe`, a single value) isn't a table: an object prints as JSON, a value as it is.
 * @param result One entry of what query() resolves to
 * @returns {string}
 */
export const formatCsv = (result: unknown): string => {
  if (!Array.isArray(result)) {
    return isPlainObject(result) ? JSON.stringify(result, null, 2) : csvField(result)
  }
  const rows: unknown[] = result.length && result.every(isGroup) ? groupRows(result) : result
  if (!rows.length) {
    return ''
  }
  // A boolean, not a type guard: a guard would narrow rows to never in the branch below
  const objects: boolean = rows.every(isPlainObject)
  if (!objects) {
    return ['value', ...rows.map(row => csvField(row))].join('\n')
  }
  const columns: string[] = [...new Set(rows.flatMap(row => Object.keys(row as Object)))]
  const has = (row: unknown, column: string): boolean => Object.prototype.hasOwnProperty.call(row, column)
  return [
    columns.map(column => csvField(column)).join(','),
    ...rows.map(row => columns.map(column => csvField(row[column], has(row, column))).join(','))
  ].join('\n')
}
