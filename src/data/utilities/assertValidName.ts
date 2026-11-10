import { nameMatch } from './parsers/parseCreate'

/** An index file name: a name plus `.json`, as keyLookup makes them (e.g. `pk__id.json`). */
const lookupMatch: RegExp = /^[a-z0-9_-]+\.json$/i

/**
 * Throw unless this is a name the query language allows (letters, digits, `_` and `-`). Record and field names end up
 * in file paths and row keys, so a name like `../x` from a direct JS call must be refused before it reaches storage.
 * @param name
 * @param where What is being named, for the error (e.g. `create()`).
 */
export const assertValidName = (name: unknown, where: string): void => {
  if (typeof name !== 'string' || !nameMatch.test(name)) {
    throw new Error(`Invalid name ${JSON.stringify(name) ?? 'undefined'} in ${where}: names use letters, digits, _ and - only`)
  }
}

/**
 * Throw unless this is a valid index file name (`<name>.json`); an empty lookup (no index file) is allowed.
 * @param lookup
 * @param where
 */
export const assertValidLookup = (lookup: unknown, where: string): void => {
  if (lookup === '' || typeof lookup === 'undefined') return
  if (typeof lookup !== 'string' || !lookupMatch.test(lookup)) {
    throw new Error(`Invalid index file ${JSON.stringify(lookup) ?? 'undefined'} in ${where}: use a name plus .json`)
  }
}
