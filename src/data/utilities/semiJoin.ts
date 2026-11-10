import { where } from '../queries/where'
import { isKeyedType, joinKey } from './joinKey'
import { groupRows, RowLookups } from './rowLookup'

/**
 * Rows of one record in a join: either all the rows the join read for it (with their lookups, built once and reused
 * for every row joined) or a narrower list for one row's join.
 */
export type JoinSide = {
  rows: any[]
  lookups?: RowLookups
}

/**
 * One step of a join, `target.targetProperty <comparator> source.sourceProperty`: the target rows that match at least
 * one source row, compared by `type` (the target field's declared type).
 *
 * The order is the one the join has always produced: through the source rows in order, each adding the target rows it
 * matches (in their order) that aren't in yet. For `=` on a keyed type (see isKeyedType) that's computed from lookups
 * instead of comparing every pair: by going through the source rows and taking each key's group of target rows once,
 * or, when the source is all of its record's rows and the target is smaller, by placing each target row at its key's
 * first source row. Other comparators, and types compared loosely, compare row by row as before.
 * @param target
 * @param source
 * @param targetProperty
 * @param sourceProperty
 * @param comparator
 * @param type
 */
export const semiJoin = (target: JoinSide, source: JoinSide, targetProperty: string, sourceProperty: string, comparator: string, type: string | undefined): any[] => {
  if (comparator === '=' && isKeyedType(type)) {
    if (source.lookups && target.rows.length < source.rows.length) {
      const positions = source.lookups.positionsBy(sourceProperty, type)
      const placed = []
      target.rows.forEach((row, index) => {
        const position = positions.get(joinKey(type, row[targetProperty]))
        if (typeof position !== 'undefined') {
          placed.push({ row, position, index })
        }
      })
      return placed
        .sort((a, b) => a.position - b.position || a.index - b.index)
        .map(({ row }) => row)
    }
    const groups = target.lookups ? target.lookups.groupsBy(targetProperty, type) : groupRows(target.rows, targetProperty, type)
    const matched = []
    const taken = new Set<any>()
    for (const row of source.rows) {
      const key = joinKey(type, row[sourceProperty])
      if (typeof key === 'undefined' || taken.has(key)) {
        continue
      }
      taken.add(key)
      const group = groups.get(key)
      if (group) {
        matched.push(...group)
      }
    }
    return matched
  }
  const matched = []
  const kept = new Set<any>()
  for (const row of source.rows) {
    for (const match of where(target.rows, { property: targetProperty, comparator, value: row[sourceProperty], type })) {
      if (!kept.has(match)) {
        kept.add(match)
        matched.push(match)
      }
    }
  }
  return matched
}
