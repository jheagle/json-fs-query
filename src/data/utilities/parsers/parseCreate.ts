import { fieldProperties } from '../../introspect/definitions/field'
import { keyProperties } from '../../introspect/definitions/key'
import { fieldTypes } from '../../introspect/policies/typeCheck'
import { arraySource, fromPlaceholder, placeholderSource, unmaskStrings } from './maskStrings'
import { numberSource, parseNumber } from './parseLiteralValue'
import { startsQueryMatch } from './startsQuery'

export type ParsedCreate = {
  ifNotExists: boolean
  definition: fieldProperties[]
  keys: keyProperties[]
}

export type ParsedCreateQuery = {
  entity: string
  create: ParsedCreate
}

export const createMatch: RegExp = /^\s*create(?![a-z0-9_-])/i

const headMatch: RegExp = /^\s*create\s+(if\s+not\s+exists\s+)?([a-z0-9_-]+)\s*\(/i
export const nameSource = '[a-z0-9_-]+'
export const nameMatch: RegExp = new RegExp(`^${nameSource}$`, 'i')
const numberMatch: RegExp = new RegExp(`^${numberSource}$`, 'i')
export const fieldMatch: RegExp = new RegExp(`^(${nameSource})\\s+(${nameSource})((?:\\s[\\s\\S]*)?)$`, 'i')
const primaryMatch: RegExp = /^primary\s+key\s*\(([^()]*)\)$/i
const uniqueMatch: RegExp = /^unique\s*\(([^()]*)\)$/i
const indexMatch: RegExp = /^index\s*\(([^()]*)\)$/i
const foreignMatch: RegExp = new RegExp(`^foreign\\s+key\\s*\\(([^()]*)\\)\\s*references\\s+(${nameSource})\\s*\\(([^()]*)\\)$`, 'i')
const stringLiteral: RegExp = new RegExp(`^${placeholderSource}$`)
const arrayLiteral: RegExp = new RegExp(`^${arraySource}$`)

const lookupPrefix = { primary: 'pk', unique: 'unique', index: 'index', foreign: 'fk' }

/**
 * The index file name a key's index lives in, from its type and fields (as create names it).
 * @param type
 * @param fields
 */
export const keyLookup = (type: string, fields: string[]): string => `${lookupPrefix[type]}_${fields.join('_')}.json`

/**
 * Show a piece of the (masked) query the way it was written, for an error message.
 * @param text
 */
const shown = (text: string): string => unmaskStrings(text.trim(), '\'')

/**
 * The position of the `)` closing the `(` at `open`, or -1. Strings and arrays are placeholders by now, so round
 * brackets are the only nesting left.
 * @param text
 * @param open
 */
const findClose = (text: string, open: number): number => {
  let depth = 0
  for (let i = open; i < text.length; i++) {
    if (text[i] === '(') {
      depth++
    } else if (text[i] === ')') {
      depth--
      if (depth === 0) {
        return i
      }
    }
  }
  return -1
}

/**
 * Split the text inside the brackets on the commas that are not inside a key's own brackets.
 * @param body
 */
const splitItems = (body: string): string[] => {
  const items = []
  let depth = 0
  let start = 0
  for (let i = 0; i < body.length; i++) {
    if (body[i] === '(') {
      depth++
    } else if (body[i] === ')') {
      depth--
    } else if (body[i] === ',' && depth === 0) {
      items.push(body.slice(start, i))
      start = i + 1
    }
  }
  items.push(body.slice(start))
  return items.map(item => item.trim())
}

/**
 * The names in a key's brackets: `(a, b)` gives ['a', 'b'].
 * @param list
 * @param item - The whole key, for the error message.
 */
const parseNames = (list: string, item: string): string[] => {
  const names = list.split(',').map(name => name.trim())
  if (names.some(name => !nameMatch.test(name))) {
    throw new Error(`Expected field names separated by commas in: ${shown(item)}`)
  }
  if (new Set(names).size !== names.length) {
    throw new Error(`The same field is named twice in: ${shown(item)}`)
  }
  return names
}

/**
 * A default's value: the same literals the rest of the query language reads.
 * @param token
 */
const parseDefault = (token: string | undefined): any => {
  if (typeof token === 'undefined') {
    throw new Error('Missing a value after default')
  }
  const string = token.match(stringLiteral)
  if (string) {
    return fromPlaceholder(string[1])
  }
  const array = token.match(arrayLiteral)
  if (array) {
    return JSON.parse(fromPlaceholder(array[1]))
  }
  if (numberMatch.test(token)) {
    return parseNumber(token)
  }
  switch (token.toLowerCase()) {
    case 'null':
      return null
    case 'true':
      return true
    case 'false':
      return false
  }
  throw new Error(`Unrecognized default value: ${shown(token)}`)
}

/**
 * One field: `<name> <type> [optional] [null | not null] [auto] [default <value>]`, the modifiers in any order.
 * @param found - The field's fieldMatch match.
 */
export const parseField = (found: RegExpMatchArray): fieldProperties => {
  const [item, name, typeName, rest] = found
  const type = typeName.toLowerCase()
  if (!fieldTypes.includes(type)) {
    throw new Error(`Unknown type "${typeName}" for field "${name}" (expected ${fieldTypes.join(', ')})`)
  }
  const field: fieldProperties = { name, type, optional: false, autoGenerate: false }
  const seen = new Set()
  const once = (modifier: string) => {
    if (seen.has(modifier)) {
      throw new Error(`"${modifier}" is given twice for field "${name}"`)
    }
    seen.add(modifier)
  }
  const tokens = rest.trim() === '' ? [] : rest.trim().split(/\s+/)
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i].toLowerCase()
    if (token === 'optional') {
      once('optional')
      field.optional = true
    } else if (token === 'auto') {
      once('auto')
      field.autoGenerate = true
    } else if (token === 'null') {
      once('null')
      field.nullable = true
    } else if (token === 'not' && (tokens[i + 1] || '').toLowerCase() === 'null') {
      once('null')
      field.nullable = false
      i++
    } else if (token === 'default') {
      once('default')
      field.useDefault = true
      field.defaultValue = parseDefault(tokens[++i])
    } else {
      throw new Error(`Unrecognized "${shown(tokens[i])}" for field "${name}" in: ${shown(item)}`)
    }
  }
  if (field.autoGenerate && field.useDefault) {
    throw new Error(`Field "${name}" can't be both auto and have a default`)
  }
  if (field.autoGenerate && type !== 'string') {
    throw new Error(`Field "${name}" is auto, which generates a UUID, so its type must be string`)
  }
  return field
}

/**
 * One key, or null when the item isn't written as a key (so it's a field).
 * @param item
 */
const parseKey = (item: string): keyProperties | null => {
  let found = item.match(primaryMatch)
  if (found) {
    return { type: 'primary', fields: parseNames(found[1], item) }
  }
  found = item.match(uniqueMatch)
  if (found) {
    return { type: 'unique', fields: parseNames(found[1], item) }
  }
  found = item.match(indexMatch)
  if (found) {
    return { type: 'index', fields: parseNames(found[1], item) }
  }
  found = item.match(foreignMatch)
  if (found) {
    const fields = parseNames(found[1], item)
    const referenced = parseNames(found[3], item)
    if (fields.length !== 1 || referenced.length !== 1) {
      throw new Error(`Only single-field foreign keys are supported so far: ${shown(item)}`)
    }
    return {
      type: 'foreign',
      fields,
      references: [{ fields: [`${found[2]}.${referenced[0]}`], lookup: `${found[2]}.json` }]
    }
  }
  return null
}

/**
 * Check the keys against the fields, then name each key's index file the way create() users do by hand:
 * `pk_`, `unique_`, `index_` or `fk_`, then the fields joined by `_` (`primary key (a, b)` is `pk_a_b.json`).
 * @param definition
 * @param keys
 */
const finishKeys = (definition: fieldProperties[], keys: keyProperties[]): keyProperties[] => {
  const names = definition.map(field => field.name)
  if (keys.filter(key => key.type === 'primary').length > 1) {
    throw new Error('Only one primary key is allowed')
  }
  const lookups = new Set()
  return keys.map(key => {
    const missing = key.fields.find(field => !names.includes(field))
    if (missing) {
      throw new Error(`The ${key.type} key (${key.fields.join(', ')}) names "${missing}", which is not a field`)
    }
    const lookup = keyLookup(key.type, key.fields)
    if (lookups.has(lookup)) {
      throw new Error(`The same ${key.type} key on "${key.fields.join(', ')}" is given twice`)
    }
    lookups.add(lookup)
    return Object.assign({ type: key.type, fields: key.fields, lookup }, key.references ? { references: key.references } : {})
  })
}

/**
 * Parse a create statement (strings and arrays already masked):
 * `create [if not exists] <name> (<field>, ..., <key>, ...)`. See the README's "Creating a record". Only checks
 * what the text alone can tell; the referenced records of foreign keys are checked when it runs.
 * @param query
 */
export const parseCreate = (query: string): ParsedCreateQuery => {
  const head = query.match(headMatch)
  if (!head) {
    throw new Error('Expected: create [if not exists] <name> (<fields and keys>)')
  }
  const entity = head[2]
  if (entity === '__RECORDS') {
    throw new Error('__RECORDS is reserved for the list of records')
  }
  const open = head[0].length - 1
  const close = findClose(query, open)
  if (close === -1) {
    // Not reached through parser(): splitQueries' scanner already rejects an unclosed bracket
    throw new Error('Missing ) at the end of the field list')
  }
  const after = query.slice(close + 1).trim()
  if (after) {
    if (startsQueryMatch.test(after)) {
      throw new Error(`Missing ; before: ${shown(after)}`)
    }
    throw new Error(`Unrecognized query value: ${shown(after)}`)
  }
  const body = query.slice(open + 1, close)
  const definition: fieldProperties[] = []
  const keys: keyProperties[] = []
  if (body.trim()) {
    for (const item of splitItems(body)) {
      if (!item) {
        throw new Error('Empty item in the field list (an extra comma?)')
      }
      const key = parseKey(item)
      if (key) {
        keys.push(key)
        continue
      }
      const found = item.match(fieldMatch)
      if (!found) {
        throw new Error(`Expected a field (<name> <type> ...) or a key in: ${shown(item)}`)
      }
      const field = parseField(found)
      if (definition.some(existing => existing.name === field.name)) {
        throw new Error(`Field "${field.name}" is given twice`)
      }
      definition.push(field)
    }
  }
  return {
    entity,
    create: { ifNotExists: Boolean(head[1]), definition, keys: finishKeys(definition, keys) }
  }
}
