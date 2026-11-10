import { ParsedQuery } from './parseQuery'

const commandMatch: RegExp = /^(delete|insert|read|update)\s+([a-z0-9_-]+)/i

export type ParsedCommand = string | 'delete' | 'insert' | 'read' | 'update'

export type ParsedEntity = string

/**
 * Read the command and record name from the start of a query's head (see splitClauses).
 * @param parsed
 * @param query
 * @returns The rest of the head (a joined record, `.joined`, for findJoinEntity).
 */
export const findCommand = (parsed: ParsedQuery, query: string): string => {
  const commandFound: RegExpMatchArray = query.match(commandMatch)
  parsed['command'] = undefined
  parsed['entity'] = undefined
  if (commandFound) {
    parsed['command'] = commandFound[1].toLowerCase()
    parsed['entity'] = commandFound[2]
    return query.slice(commandFound[0].length).trim()
  }
  return query
}
