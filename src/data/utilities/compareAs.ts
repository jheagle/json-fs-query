/**
 * Normalize a value to a field's declared type for an equality comparison - never written back,
 * only compared. Writes are coerced to the declared type (typeCheck), but values already stored
 * may not match it (ids declared string, so they can hold an integer or a UUID, are often stored
 * as numbers), and query literals carry their own type. A declared type is what says '3' and 3
 * are the same value. A missing or unrecognized type returns the value unchanged.
 * @param type
 * @param value
 */
export const compareAs = (type: string | undefined, value: any): any => {
  if (value === null || typeof value === 'undefined') {
    return value
  }
  switch (type) {
    case 'string':
      return typeof value === 'object' ? value : String(value)
    case 'int': {
      const coerced = Number(value)
      return Number.isNaN(coerced) ? value : coerced
    }
    case 'boolean':
      if (value === 'true') {
        return true
      }
      if (value === 'false') {
        return false
      }
      return value
    default:
      return value
  }
}

export const comparableTypes = ['string', 'int', 'boolean']

/**
 * Whether two values are equal for a field of the given declared type: both are normalized to
 * that type (see compareAs) and compared strictly. A field with no declared type, or one that
 * can't be normalized (object, array, or an unrecognized type), keeps loose equality.
 * @param type
 * @param a
 * @param b
 */
export const sameValue = (type: string | undefined, a: any, b: any): boolean => {
  if (!comparableTypes.includes(type)) {
    // eslint-disable-next-line eqeqeq
    return a == b
  }
  return compareAs(type, a) === compareAs(type, b)
}
