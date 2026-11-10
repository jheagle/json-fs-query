import { ParsedQuery } from './parseQuery'

// One join condition, at the start of the text; every one after the first starts with `and on` (see splitClauses)
const joinClauseMatch: RegExp = /^([a-z0-9_-]+\.[a-z0-9_-]+)\s+(=|!=|>|<|>=|<=|in|between|like)\s+([a-z0-9_-]+\.[a-z0-9_-]+)(?![a-z0-9._-])/i
const nextMatch: RegExp = /^and\s+on\s+/i

export type ParsedJoinClause = {
  propertyA: string
  comparator: string
  propertyB: string
}

/**
 * Read an on clause body (`a.x = b.y and on b.z = c.w`, see splitClauses).
 * @param parsed
 * @param body
 * @returns The rest of the body, after the last join condition.
 */
export const findJoinClauses = (parsed: ParsedQuery, body: string): string => {
  let rest = body
  for (let joinClause = rest.match(joinClauseMatch); joinClause; joinClause = rest.match(joinClauseMatch)) {
    parsed['joinClauses'].push({
      propertyA: joinClause[1],
      comparator: joinClause[2],
      propertyB: joinClause[3]
    })
    rest = rest.slice(joinClause[0].length).trim()
    // The connector only with another one after it, so a bad one is shown with its connector
    const next = rest.match(nextMatch)
    if (!next || !joinClauseMatch.test(rest.slice(next[0].length))) {
      break
    }
    rest = rest.slice(next[0].length)
  }
  return rest
}
