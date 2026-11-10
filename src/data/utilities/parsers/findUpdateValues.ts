import { numberSource, parseLiteralValue } from './parseLiteralValue'
import { ParsedQuery } from './parseQuery'
import { arraySource, placeholderSource } from './maskStrings'

const literal = `(?:${placeholderSource.replace('(', '(?:')}|${numberSource}|${arraySource.replace('(', '(?:')}|null|true|false)`
const setMatch: RegExp = new RegExp(`^([a-z0-9_-]+\\s*=\\s*${literal}(?:\\s*,\\s*[a-z0-9_-]+\\s*=\\s*${literal})*)`, 'i')
const assignmentMatch: RegExp = new RegExp(`([a-z0-9_-]+)\\s*=\\s*(${placeholderSource}|(${numberSource})|${arraySource}|(null)|(true)|(false))`, 'ig')

export type ParsedUpdateValues = { [field: string]: any }

/**
 * Read an update's set clause body (`field = value, field2 = value2`, see splitClauses). Uses a two-pass match: the
 * whole comma-separated list first, so anything after it is left over, then each assignment out of that list.
 * @param parsed
 * @param body
 * @returns The rest of the body, after the last assignment.
 */
export const findUpdateValues = (parsed: ParsedQuery, body: string): string => {
  const clauseFound: RegExpMatchArray = body.match(setMatch)
  parsed['updateValues'] = {}
  if (!clauseFound) {
    return body
  }
  const assignmentsFound: IterableIterator<RegExpMatchArray> = clauseFound[1].matchAll(assignmentMatch)
  // @ts-ignore
  for (const assignment of assignmentsFound) {
    parsed['updateValues'][assignment[1]] = parseLiteralValue(assignment, 3)
  }
  return body.slice(clauseFound[0].length).trim()
}
