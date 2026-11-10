import { ParsedQuery } from './parseQuery'

// One field is a name, then optionally `as <alias>` (`as` as a whole word); fields are separated by commas
const selectField = '[a-z0-9=._-]+(?:\\s+as\\s+[a-z0-9_-]+)?'
const selectsMatch: RegExp = new RegExp(`^${selectField}(?:\\s*,\\s*${selectField})*`, 'i')
const selectFieldMatch: RegExp = /,?\s*([a-z0-9=._-]+)(?:\s+as\s+([a-z0-9_-]+))?/ig

export type ParsedSelect = {
  property: string
  alias: string | undefined
}

/**
 * Read a select clause body (`a, b as c`, see splitClauses).
 * @param parsed
 * @param body
 * @returns The rest of the body, after the last field.
 */
export const findSelects = (parsed: ParsedQuery, body: string): string => {
  const selectsFound: RegExpMatchArray = body.match(selectsMatch)
  if (selectsFound) {
    const selectClausesFound: IterableIterator<RegExpMatchArray> = selectsFound[0].matchAll(selectFieldMatch)
    // @ts-ignore
    for (const selectClause of selectClausesFound) {
      parsed['selectClauses'].push({
        property: selectClause[1],
        alias: selectClause[2],
      })
    }
    return body.slice(selectsFound[0].length).trim()
  }
  return body
}
