import { ParsedQuery } from './parseQuery'

// One merge, at the start of the text; every one after the first starts with `merge` or `and merge` (see splitClauses)
const mergeJoinMatch: RegExp = /^([a-z0-9_-]+\.[a-z0-9_-]+)\s+with\s+([a-z0-9_-]+\.[a-z0-9_-]+)(?![a-z0-9._-])/i
const nextMatch: RegExp = /^(?:and\s+)?merge\s+/i

export type ParsedMergeJoin = {
  propertyA: string
  propertyB: string
}

/**
 * Read a merge clause body (`a.x with b.y merge c.z with d.w`, see splitClauses).
 * @param parsed
 * @param body
 * @returns The rest of the body, after the last merge.
 */
export const findMergeJoins = (parsed: ParsedQuery, body: string): string => {
  let rest = body
  for (let mergeJoin = rest.match(mergeJoinMatch); mergeJoin; mergeJoin = rest.match(mergeJoinMatch)) {
    parsed['mergeJoins'].push({
      propertyA: mergeJoin[1],
      propertyB: mergeJoin[2]
    })
    rest = rest.slice(mergeJoin[0].length).trim()
    // The connector only with another one after it, so a bad one is shown with its connector
    const next = rest.match(nextMatch)
    if (!next || !mergeJoinMatch.test(rest.slice(next[0].length))) {
      break
    }
    rest = rest.slice(next[0].length)
  }
  return rest
}
