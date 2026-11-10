import { ParsedQuery } from './parseQuery'

const offsetMatch: RegExp = /^(\d+)/

export type ParsedOffset = number

/**
 * Read a offset clause body (a whole number, see splitClauses).
 * @param parsed
 * @param body
 * @returns The rest of the body, after the number.
 */
export const findOffset = (parsed: ParsedQuery, body: string): string => {
  const offsetFound: RegExpMatchArray = body.match(offsetMatch)
  if (offsetFound) {
    parsed['offset'] = offsetFound ? parseInt(offsetFound[1]) : undefined
    return body.slice(offsetFound[0].length).trim()
  }
  return body
}
