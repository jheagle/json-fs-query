import { ParsedQuery } from './parseQuery'

const limitMatch: RegExp = /^(\d+)/

export type ParsedLimit = number

/**
 * Read a limit clause body (a whole number, see splitClauses).
 * @param parsed
 * @param body
 * @returns The rest of the body, after the number.
 */
export const findLimit = (parsed: ParsedQuery, body: string): string => {
  const limitFound: RegExpMatchArray = body.match(limitMatch)
  if (limitFound) {
    parsed['limit'] = limitFound ? parseInt(limitFound[1]) : undefined
    return body.slice(limitFound[0].length).trim()
  }
  return body
}
