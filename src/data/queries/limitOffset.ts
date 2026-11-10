/**
 * Slice a dataSet down to at most `limit` rows (or groups, after group by), starting after the first `offset` of them.
 * @param dataSet
 * @param offset
 * @param limit
 */
export const limitOffset = (dataSet: Object[] = [], offset: number | undefined, limit: number | undefined): Object[] => {
  if (typeof offset === 'undefined' && typeof limit === 'undefined') {
    return dataSet
  }
  const start = offset ?? 0
  const end = typeof limit === 'number' ? start + limit : undefined
  return dataSet.slice(start, end)
}
