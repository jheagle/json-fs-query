import { fieldProperties } from '../../introspect/definitions/field'
import { fieldMatch, nameMatch, nameSource, parseField } from './parseCreate'
import { unmaskStrings } from './maskStrings'
import { startsQueryMatch } from './startsQuery'

/**
 * One change to a record's fields (see alter):
 * - `add`: a new field, as create defines one
 * - `drop`: remove a field
 * - `rename`: give a field a new name
 * - `modify`: a field's new definition (the same name and type; optional, null and default can change)
 */
export type ParsedAlter =
  | { action: 'add', field: fieldProperties }
  | { action: 'drop', name: string }
  | { action: 'rename', name: string, to: string }
  | { action: 'modify', field: fieldProperties }

export type ParsedAlterQuery = {
  entity: string
  alter: ParsedAlter
}

export const alterMatch: RegExp = /^\s*alter(?![a-z0-9_-])/i

const headMatch: RegExp = new RegExp(`^\\s*alter\\s+(${nameSource})\\s+(add|drop|rename|modify)(?![a-z0-9_-])([\\s\\S]*)$`, 'i')
const renameMatch: RegExp = new RegExp(`^\\s*(${nameSource})\\s+to\\s+(${nameSource})\\s*$`, 'i')
const expected = 'Expected: alter <record> add <field> <type> ..., drop <field>, rename <field> to <name>, or modify <field> <type> ...'

const shown = (text: string): string => unmaskStrings(text.trim(), '\'')

/**
 * A field as create's field list writes one (`<name> <type> [optional] [null | not null] [default <value>] [auto]`).
 * @param text
 */
const fieldSpec = (text: string): fieldProperties => {
  const found = text.trim().match(fieldMatch)
  if (!found) {
    throw new Error(`Expected a field (<name> <type> ...) in: ${shown(text)}`)
  }
  return parseField(found)
}

/**
 * Read an alter statement (one change per statement; several statements in one query run in turn).
 * @param query - The statement, with its strings and arrays masked (see maskStrings).
 */
export const parseAlter = (query: string): ParsedAlterQuery => {
  const head = query.match(headMatch)
  if (!head) {
    throw new Error(expected)
  }
  const [, entity, actionWord, rest] = head
  if (entity === '__RECORDS') {
    throw new Error('__RECORDS is reserved for the list of records')
  }
  const action = actionWord.toLowerCase()
  if (startsQueryMatch.test(rest.trim()) && !/^\s*(add|drop|rename|modify)\b/i.test(rest)) {
    throw new Error(`Missing ; before: ${shown(rest)}`)
  }
  switch (action) {
    case 'add':
    case 'modify':
      return { entity, alter: { action, field: fieldSpec(rest) } }
    case 'drop': {
      const name = rest.trim()
      if (!nameMatch.test(name)) {
        throw new Error(`Expected: alter ${entity} drop <field>${name ? ` (got: ${shown(name)})` : ''}`)
      }
      return { entity, alter: { action, name } }
    }
    default: {
      const found = rest.match(renameMatch)
      if (!found) {
        throw new Error(`Expected: alter ${entity} rename <field> to <name>${rest.trim() ? ` (got: ${shown(rest)})` : ''}`)
      }
      return { entity, alter: { action: 'rename', name: found[1], to: found[2] } }
    }
  }
}
