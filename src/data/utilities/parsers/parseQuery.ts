import { findCommand, ParsedCommand, ParsedEntity } from './findCommand'
import { findInsertValues, ParsedInsertRow } from './findInsertValues'
import { findUpdateValues, ParsedUpdateValues } from './findUpdateValues'
import { findJoinEntity, ParsedJoinEntity } from './findJoinEntity'
import { findSelects, ParsedSelect } from './findSelects'
import { findConditions } from './findConditions'
import { allOf, ConditionNode } from '../conditionTree'
import { findJoinClauses, ParsedJoinClause } from './findJoinClauses'
import { findMergeJoins, ParsedMergeJoin } from './findMergeJoins'
import { findSortClauses, ParsedSortClause } from './findSortClauses'
import { findGroupBy, ParsedGroupBy } from './findGroupBy'
import { findLimit, ParsedLimit } from './findLimit'
import { findOffset, ParsedOffset } from './findOffset'
import { maskArrays, maskStrings, unmaskStrings } from './maskStrings'
import { createMatch, parseCreate, ParsedCreate } from './parseCreate'
import { parseSchemaStatement, schemaStatementMatch } from './parseSchemaStatement'
import { alterMatch, parseAlter, ParsedAlter } from './parseAlter'
import { databaseStatementMatch, parseDatabaseStatement } from './parseDatabaseStatement'
import { splitClauses } from './splitClauses'
import { startsQueryMatch } from './startsQuery'

type ClauseStep = (parsed: ParsedQuery, body: string) => string

// Each clause's own step, and what its body must start with (for the error when it doesn't)
const clauseSteps: { [keyword: string]: { step: ClauseStep, expected: string } } = {
  values: { step: findInsertValues, expected: 'an assignment (field = value)' },
  set: { step: findUpdateValues, expected: 'an assignment (field = value)' },
  select: { step: findSelects, expected: 'a field' },
  on: { step: findJoinClauses, expected: 'a join condition (a.x = b.y)' },
  merge: { step: findMergeJoins, expected: 'a merge (a.x with b.y)' },
  where: { step: findConditions, expected: 'a condition' },
  'group by': { step: findGroupBy, expected: 'a field' },
  sort: { step: findSortClauses, expected: 'a field' },
  limit: { step: findLimit, expected: 'a whole number' },
  offset: { step: findOffset, expected: 'a whole number' },
}

/**
 * The error for text a step couldn't read: another query run on without a `;`, or text that doesn't belong.
 * @param rest The text left over, masked
 * @param after What was read before it, masked
 */
const leftoverError = (rest: string, after: string): Error => {
  const shown = (text: string): string => unmaskStrings(text, '\'')
  if (startsQueryMatch.test(rest)) {
    return new Error(`Missing ; before: ${shown(rest)}`)
  }
  return new Error(`Unexpected "${shown(rest)}" after "${shown(after)}"`)
}

export type ParsedQuery = {
  command: ParsedCommand | undefined
  entity: ParsedEntity | undefined
  joinEntity: ParsedJoinEntity | undefined
  selectClauses: ParsedSelect[]
  insertValues: ParsedInsertRow[]
  updateValues: ParsedUpdateValues
  // The where clause as a tree (see ConditionNode); undefined when the query has none
  where: ConditionNode | undefined
  joinClauses: ParsedJoinClause[]
  mergeJoins: ParsedMergeJoin[]
  sortClauses: ParsedSortClause[]
  groupBy: ParsedGroupBy | undefined
  limit: ParsedLimit | undefined
  offset: ParsedOffset | undefined
  create: ParsedCreate | undefined
  alter?: ParsedAlter
  ifNotExists?: boolean
  ifExists: boolean | undefined
}

/**
 * Break a query down into its components.
 * @param query
 */
export const parseQuery = (query: string): ParsedQuery => {
  const parsedQuery: ParsedQuery = {
    command: undefined,
    entity: undefined,
    joinEntity: undefined,
    selectClauses: [],
    insertValues: [],
    updateValues: {},
    where: undefined,
    joinClauses: [],
    mergeJoins: [],
    sortClauses: [],
    groupBy: undefined,
    limit: undefined,
    offset: undefined,
    create: undefined,
    ifExists: undefined,
  }

  // No find* step may see inside a string or an array: each one becomes a placeholder holding its value
  query = maskArrays(maskStrings(query))

  // Statements about databases (create / drop database, use, show databases) come first: they share their first words
  // with the record statements
  if (databaseStatementMatch.test(query)) {
    return Object.assign(parsedQuery, parseDatabaseStatement(query))
  }
  // A create statement has its own shape (a bracketed list of fields and keys), so it gets its own parser
  if (createMatch.test(query)) {
    const { entity, create } = parseCreate(query)
    return Object.assign(parsedQuery, { command: 'create', entity, create })
  }
  if (schemaStatementMatch.test(query)) {
    return Object.assign(parsedQuery, parseSchemaStatement(query))
  }
  // So does alter: one change to a record's fields
  if (alterMatch.test(query)) {
    const { entity, alter } = parseAlter(query)
    return Object.assign(parsedQuery, { command: 'alter', entity, alter })
  }

  // Clauses come at most once each, in a fixed order (see clauseOrder); each step reads only its own clause's body
  const split = splitClauses(query)
  if (!split) {
    query = query.trim()
    if (startsQueryMatch.test(query)) {
      throw new Error(`Missing ; before: ${unmaskStrings(query, '\'')}`)
    }
    throw new Error(`Unrecognized query value: ${unmaskStrings(query, '\'')}`)
  }

  findJoinEntity(parsedQuery, findCommand(parsedQuery, split.head))
  parsedQuery.where = allOf([])
  if (split.leading) {
    throw leftoverError(split.leading, split.head)
  }
  for (const { keyword, body } of split.clauses) {
    const { step, expected } = clauseSteps[keyword]
    const rest = step(parsedQuery, body)
    if (rest === body) {
      throw new Error(`Missing ${expected} after ${keyword}${body ? `: ${unmaskStrings(body, '\'')}` : ''}`)
    }
    if (rest) {
      throw leftoverError(rest, `${keyword} ${body.slice(0, body.length - rest.length).trim()}`)
    }
  }
  // `on` joins the record named after the queried one: without it there's nothing to join (this used to fail later,
  // reading a record with no name, as "Could not read .json")
  if ((parsedQuery.joinClauses || []).length && !parsedQuery.joinEntity) {
    throw new Error(`"on" needs the record to join, after the one read: ${parsedQuery.command} ${parsedQuery.entity}.<record> on ...`)
  }
  return parsedQuery
}
