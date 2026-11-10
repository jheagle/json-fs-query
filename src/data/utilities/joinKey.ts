import { compareAs, comparableTypes } from './compareAs'

/**
 * The key a value is looked up by when joining on `=` for a field of the given declared type: two values are equal for
 * that field (sameValue) exactly when their keys are the same Map key. Undefined for a null or missing value, which
 * equals nothing (as in where).
 *
 * Only for the types sameValue normalizes (see isKeyedType); any other type compares loosely (`==`), which no Map key
 * can express, so those joins keep comparing row by row.
 * @param type
 * @param value
 */
export const joinKey = (type: string | undefined, value: any): any => {
  if (value === null || typeof value === 'undefined') {
    return undefined
  }
  return compareAs(type, value)
}

/**
 * Whether `=` on a field of this declared type can be answered by joinKey lookups.
 * @param type
 */
export const isKeyedType = (type: string | undefined): boolean => comparableTypes.includes(type)
