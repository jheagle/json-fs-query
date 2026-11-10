import { numberSource, parseLiteralValue } from './parseLiteralValue'
import { ParsedQuery } from './parseQuery'
import { arraySource, placeholderSource } from './maskStrings'

const literal = `(?:${placeholderSource.replace('(', '(?:')}|${numberSource}|${arraySource.replace('(', '(?:')}|null|true|false)`
const assignments = `[a-z0-9_-]+\\s*=\\s*${literal}(?:\\s*,\\s*[a-z0-9_-]+\\s*=\\s*${literal})*`
const valuesMatch: RegExp = new RegExp(`^(${assignments})`, 'i')
const rowSource = `\\(\\s*(${assignments})\\s*\\)`
const rowsMatch: RegExp = new RegExp(`^${rowSource}(?:\\s*,\\s*${rowSource.replace('(' + assignments, '(?:' + assignments)})*`, 'i')
const rowMatch: RegExp = new RegExp(rowSource, 'ig')
const assignmentMatch: RegExp = new RegExp(`([a-z0-9_-]+)\\s*=\\s*(${placeholderSource}|(${numberSource})|${arraySource}|(null)|(true)|(false))`, 'ig')

export type ParsedInsertRow = { [field: string]: any }

/**
 * One row's values from its assignments (`field = value, field2 = value2`).
 * @param assignments
 */
const parseRow = (assignments: string): ParsedInsertRow => {
  const row = {}
  // @ts-ignore
  for (const assignment of assignments.matchAll(assignmentMatch)) {
    row[assignment[1]] = parseLiteralValue(assignment, 3)
  }
  return row
}

/**
 * Read an insert's values clause body (see splitClauses), the same way findUpdateValues() does for "set": one row
 * (`field = value, field2 = value2`), or several, each in brackets and separated by commas
 * (`(field = value, field2 = value2), (field = value3, field2 = value4)`), inserted together in one statement.
 * @param parsed
 * @param body
 * @returns The rest of the body, after the last assignment.
 */
export const findInsertValues = (parsed: ParsedQuery, body: string): string => {
  parsed['insertValues'] = []
  const rowsFound: RegExpMatchArray = body.match(rowsMatch)
  if (rowsFound) {
    // @ts-ignore
    parsed['insertValues'] = [...rowsFound[0].matchAll(rowMatch)].map(row => parseRow(row[1]))
    return body.slice(rowsFound[0].length).trim()
  }
  const clauseFound: RegExpMatchArray = body.match(valuesMatch)
  if (!clauseFound) {
    return body
  }
  parsed['insertValues'] = [parseRow(clauseFound[1])]
  return body.slice(clauseFound[0].length).trim()
}
