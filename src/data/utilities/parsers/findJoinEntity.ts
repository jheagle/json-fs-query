import { ParsedQuery } from './parseQuery'

// What findCommand leaves of the head: `.joined`
const joinEntityMatch: RegExp = /^\.([a-z0-9_-]+)/i

export type ParsedJoinEntity = string

/**
 * Read the joined record from what findCommand left of the head.
 * @param parsed
 * @param query
 */
export const findJoinEntity = (parsed: ParsedQuery, query: string): string => {
  const joinEntityFound: RegExpMatchArray = query.match(joinEntityMatch)
  if (joinEntityFound) {
    parsed['joinEntity'] = joinEntityFound ? joinEntityFound[1] : undefined
    return query.slice(joinEntityFound[0].length).trim()
  }
  return query
}
