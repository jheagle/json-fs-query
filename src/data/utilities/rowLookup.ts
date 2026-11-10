import { joinKey } from './joinKey'

/**
 * Rows grouped by their join key on one field (see joinKey), each group in the rows' order. Rows whose field is null or
 * missing are left out: they equal nothing.
 * @param rows
 * @param property
 * @param type - The declared type the field is compared by.
 */
export const groupRows = (rows: any[], property: string, type: string | undefined): Map<any, any[]> => {
  const groups = new Map<any, any[]>()
  for (const row of rows) {
    const key = joinKey(type, row[property])
    if (typeof key === 'undefined') {
      continue
    }
    const group = groups.get(key)
    if (group) {
      group.push(row)
    } else {
      groups.set(key, [row])
    }
  }
  return groups
}

/**
 * The position of the first row with each join key on one field (see groupRows).
 * @param rows
 * @param property
 * @param type - The declared type the field is compared by.
 */
export const firstPositions = (rows: any[], property: string, type: string | undefined): Map<any, number> => {
  const positions = new Map<any, number>()
  rows.forEach((row, position) => {
    const key = joinKey(type, row[property])
    if (typeof key !== 'undefined' && !positions.has(key)) {
      positions.set(key, position)
    }
  })
  return positions
}

/**
 * Lookups over one list of rows, built once and kept for as long as the list (a join's rows of a record), so a join
 * builds each lookup once rather than once per row joined.
 */
export class RowLookups {
  private groups = new Map<string, Map<any, any[]>>()
  private positions = new Map<string, Map<any, number>>()

  constructor (readonly rows: any[]) {}

  /**
   * See groupRows.
   * @param property
   * @param type
   */
  groupsBy (property: string, type: string | undefined): Map<any, any[]> {
    const name = `${property}\u0000${type}`
    if (!this.groups.has(name)) {
      this.groups.set(name, groupRows(this.rows, property, type))
    }
    return this.groups.get(name)
  }

  /**
   * See firstPositions.
   * @param property
   * @param type
   */
  positionsBy (property: string, type: string | undefined): Map<any, number> {
    const name = `${property}\u0000${type}`
    if (!this.positions.has(name)) {
      this.positions.set(name, firstPositions(this.rows, property, type))
    }
    return this.positions.get(name)
  }
}
