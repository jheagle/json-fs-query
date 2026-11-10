import { ParsedQuery } from './parseQuery'

// One rule is a field, then optionally asc or desc as a whole word. Rules are separated by commas, so the list ends
// at the first word that doesn't follow a comma: in `sort a b`, `b` is left over.
const sortRule = '[a-z0-9._-]+(?:\\s+(?:asc|desc)(?![a-z0-9._-]))?'
const sortMatch: RegExp = new RegExp(`^${sortRule}(?:\\s*,\\s*${sortRule})*`, 'i')
const sortRuleMatch: RegExp = /,?\s*([a-z0-9._-]+)(?:\s+(asc|desc)(?![a-z0-9._-]))?/ig

export type ParsedSortClause = {
  property: string
  direction: string | 'asc' | 'desc'
  // The field's declared type, resolved from its record when the query runs (see sortBy)
  type?: string
}

/**
 * Read a sort clause body (`a, b desc`, see splitClauses).
 * @param parsed
 * @param body
 * @returns The rest of the body, after the last rule.
 */
export const findSortClauses = (parsed: ParsedQuery, body: string): string => {
  const sortFound: RegExpMatchArray = body.match(sortMatch)
  if (sortFound) {
    const sortRulesFound: IterableIterator<RegExpMatchArray> = sortFound[0].matchAll(sortRuleMatch)
    // @ts-ignore
    for (const sortClause of sortRulesFound) {
      parsed['sortClauses'].push({
        property: sortClause[1],
        direction: (sortClause[2] || 'asc').toLowerCase(),
      })
    }
    return body.slice(sortFound[0].length).trim()
  }
  return body
}
