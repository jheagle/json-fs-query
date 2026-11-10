import { ParsedQuery } from './parseQuery'

const groupMatch: RegExp = /^[a-z0-9._-]+(?:\s*,\s*[a-z0-9._-]+)*/i

// The fields to group by, in order: `group by a, b` groups by a, then by b within each group
export type ParsedGroupBy = string[]

/**
 * Read a group by clause body (`a, b`, see splitClauses).
 * @param parsed
 * @param body
 * @returns The rest of the body, after the last field.
 * @throws {Error} For a field named twice.
 */
export const findGroupBy = (parsed: ParsedQuery, body: string): string => {
  const groupFound: RegExpMatchArray = body.match(groupMatch)
  if (groupFound) {
    const fields = groupFound[0].split(/\s*,\s*/)
    const repeated = fields.find((field, index) => fields.indexOf(field) !== index)
    if (repeated) {
      throw new Error(`"${repeated}" is in group by twice`)
    }
    parsed['groupBy'] = fields
    return body.slice(groupFound[0].length).trim()
  }
  return body
}
