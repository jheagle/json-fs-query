import { unmaskStrings } from './maskStrings'
import { startsQueryMatch } from './startsQuery'

export type ParsedDatabaseStatement = {
  command: 'create database' | 'drop database' | 'use' | 'show databases'
  entity: string
  ifExists: boolean
  ifNotExists: boolean
}

/**
 * The statements about databases rather than records. `create database (...)` and a bare `drop database` stay a record
 * named "database": these need a database name after the keyword.
 */
export const databaseStatementMatch: RegExp =
  /^\s*(?:(?:create|drop)\s+database\s+(?!\()[a-z0-9_-]|show\s+databases(?![a-z0-9_-])|use(?![a-z0-9_.-]))/i

const createMatch: RegExp = /^\s*create\s+database\s+(if\s+not\s+exists\s+)?([a-z0-9_-]+)/i
const dropMatch: RegExp = /^\s*drop\s+database\s+(if\s+exists\s+)?([a-z0-9_-]+)/i
const useMatch: RegExp = /^\s*use\s+([a-z0-9_-]+)/i
const showMatch: RegExp = /^\s*show\s+databases/i

/**
 * Nothing may follow a database statement but the end of the query.
 * @param rest
 */
const assertNothingAfter = (rest: string): void => {
  const after = rest.trim()
  if (!after) {
    return
  }
  const shown = unmaskStrings(after, '\'')
  if (startsQueryMatch.test(after)) {
    throw new Error(`Missing ; before: ${shown}`)
  }
  throw new Error(`Unrecognized query value: ${shown}`)
}

/**
 * Read `create database [if not exists] <name>`, `drop database [if exists] <name>`, `use <name>` or `show databases`.
 * @param query - The statement, with its strings and arrays masked (see maskStrings).
 */
export const parseDatabaseStatement = (query: string): ParsedDatabaseStatement => {
  const statement = { ifExists: false, ifNotExists: false }
  let found = query.match(createMatch)
  if (found) {
    assertNothingAfter(query.slice(found[0].length))
    return { ...statement, command: 'create database', entity: found[2], ifNotExists: Boolean(found[1]) }
  }
  found = query.match(dropMatch)
  if (found) {
    assertNothingAfter(query.slice(found[0].length))
    return { ...statement, command: 'drop database', entity: found[2], ifExists: Boolean(found[1]) }
  }
  found = query.match(showMatch)
  if (found) {
    assertNothingAfter(query.slice(found[0].length))
    return { ...statement, command: 'show databases', entity: '__DATABASES' }
  }
  found = query.match(useMatch)
  if (!found) {
    throw new Error('Expected: use <database>')
  }
  assertNothingAfter(query.slice(found[0].length))
  return { ...statement, command: 'use', entity: found[1] }
}
