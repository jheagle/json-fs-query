import { stripVTControlCharacters } from 'util'
import type { Group } from '../data/queries/groupBy'

/**
 * How a cell shows a value that isn't plain text. Each marker reads without colour (piped output, NO_COLOR, screen
 * readers); dimming is only extra.
 */
export type Markers = {
  // A row without the field (see Null and missing fields in the README)
  missing: string
  // The value null
  null: string
  // The empty string
  empty: string
}

export type FormatOptions = {
  // Dim the markers with ANSI codes; leave off when stdout isn't a terminal
  color?: boolean
  markers?: Partial<Markers>
  // Add a one-line legend under a table that shows a missing or null marker
  legend?: boolean
}

export const defaultMarkers: Markers = {
  missing: '—',
  null: 'NULL',
  empty: '\'\''
}

type Settings = {
  color: boolean
  markers: Markers
  legend: boolean
}

// A cell's text, and whether it is a marker (so it can be dimmed and counted for the legend)
type Cell = {
  text: string
  marker?: keyof Markers
}

const dim = (text: string, color: boolean): string => color ? `\u001b[2m${text}\u001b[22m` : text

// Width as it shows in the terminal: colour codes take no space
const visibleWidth = (text: string): number => stripVTControlCharacters(text).length

const isPlainObject = (value: unknown): value is Object => value !== null && typeof value === 'object' && !Array.isArray(value)

const groupKeys = new Set(['field', 'value', 'missing', 'rows', 'groups'])

/**
 * Whether a value is one group of a grouped read: a field name, then either its rows or its groups, and nothing else.
 * @param value
 */
export const isGroup = (value: unknown): value is Group => isPlainObject(value) &&
  typeof value['field'] === 'string' &&
  Array.isArray(value['rows']) !== Array.isArray(value['groups']) &&
  Object.keys(value).every(key => groupKeys.has(key))

/**
 * The cell for one value. Text is shown as it is (line breaks as \n so a row stays on one line), numbers and booleans
 * as written, objects and arrays as compact JSON.
 * @param value
 * @param present False when the row doesn't have the field at all
 */
const toCell = (value: unknown, present: boolean = true): Cell => {
  if (!present) {
    return { text: '', marker: 'missing' }
  }
  if (value === null) {
    return { text: '', marker: 'null' }
  }
  if (value === '') {
    return { text: '', marker: 'empty' }
  }
  if (typeof value === 'string') {
    return { text: value.replace(/\r?\n/g, '\\n') }
  }
  if (typeof value === 'object') {
    return { text: JSON.stringify(value) }
  }
  return { text: String(value) }
}

const showCell = (cell: Cell, settings: Settings): string => cell.marker
  ? dim(settings.markers[cell.marker], settings.color)
  : cell.text

const rowCount = (count: number): string => `(${count} ${count === 1 ? 'row' : 'rows'})`

/**
 * Draw rows as a table: columns in the order the fields first appear, a count underneath, and a legend when a marker
 * that needs one is shown.
 * @param rows Plain objects, or plain values (shown as one `value` column)
 * @param settings
 */
const formatTable = (rows: unknown[], settings: Settings): string => {
  if (!rows.length) {
    return rowCount(0)
  }
  const objects = rows.every(isPlainObject)
  const columns: string[] = objects
    ? [...new Set(rows.flatMap(row => Object.keys(row as Object)))]
    : ['value']
  const has = (row: unknown, column: string): boolean => Object.prototype.hasOwnProperty.call(row, column)
  const cells: Cell[][] = rows.map(row => objects
    ? columns.map(column => toCell(row[column], has(row, column)))
    : [toCell(row)])
  const body: string[][] = cells.map(rowCells => rowCells.map(cell => showCell(cell, settings)))
  const widths: number[] = columns.map((column, i) => Math.max(visibleWidth(column), ...body.map(texts => visibleWidth(texts[i]))))
  const pad = (text: string, i: number): string => text + ' '.repeat(widths[i] - visibleWidth(text))
  const line = '+' + widths.map(width => '-'.repeat(width + 2)).join('+') + '+'
  const tableRow = (texts: string[]): string => '| ' + texts.map(pad).join(' | ') + ' |'
  const lines = [line, tableRow(columns), line, ...body.map(tableRow), line, rowCount(rows.length)]

  if (settings.legend) {
    // Only the markers this table shows (an empty string explains itself)
    const shown = new Set(cells.flat().map(cell => cell.marker))
    const legend = (['missing', 'null'] as const)
      .filter(marker => shown.has(marker))
      .map(marker => `${dim(settings.markers[marker], settings.color)} ${marker}`)
    if (legend.length) {
      lines.push(legend.join(' · '))
    }
  }
  return lines.join('\n')
}

const indent = (text: string, depth: number): string => text.split('\n').map(line => '  '.repeat(depth) + line).join('\n')

/**
 * Draw the groups of a grouped read: a heading per group (`date = 2024-06-05 (3 rows)`), then its table, or its own
 * groups indented under it.
 * @param groups
 * @param settings
 * @param depth How far nested groups are indented
 */
const formatGroups = (groups: Group[], settings: Settings, depth: number = 0): string => groups
  .map(group => {
    const heading = group.missing
      ? `${group.field} is missing`
      : `${group.field} = ${showCell(toCell(group.value), settings)}`
    const content = group.groups
      ? `${heading} (${group.groups.length} ${group.groups.length === 1 ? 'group' : 'groups'})\n${formatGroups(group.groups, settings, depth + 1)}`
      : `${heading} ${rowCount(group.rows.length)}\n${indent(formatTable(group.rows, settings), 1)}`
    return indent(content, depth)
  })
  .join('\n\n')

/**
 * Format one query's result for the terminal. Rows become a table, a grouped read a table per group, an empty list
 * `(0 rows)`; anything else (`describe`, a database name) prints as it is, or as JSON for an object.
 * @param result One entry of what query() resolves to
 * @param options
 * @returns {string}
 */
export const formatResult = (result: unknown, options: FormatOptions = {}): string => {
  const settings: Settings = {
    color: options.color ?? false,
    markers: { ...defaultMarkers, ...options.markers },
    legend: options.legend ?? true
  }
  if (Array.isArray(result)) {
    if (result.length && result.every(isGroup)) {
      return formatGroups(result, settings)
    }
    if (result.every(isPlainObject) || result.every(value => !isPlainObject(value) && !Array.isArray(value))) {
      return formatTable(result, settings)
    }
    return JSON.stringify(result, null, 2)
  }
  if (isPlainObject(result)) {
    return JSON.stringify(result, null, 2)
  }
  return showCell(toCell(result), settings)
}
