import { readEntity } from '../queries/readEntity'
import { retrieveRecord } from './retrieveRecord'
import { retrieveEntryRows } from './retrieveRecords'
import { retrieveIndexes } from './retrieveIndexes'
import { isKeyedType, joinKey } from './joinKey'
import { RowLookups } from './rowLookup'
import { JoinSide } from './semiJoin'

/**
 * One `on` clause, with each side's record, field and the declared type it's compared by.
 */
export type JoinStep = {
  entityA: string
  propertyA: string
  typeA: string | undefined
  comparator: string
  entityB: string
  propertyB: string
  typeB: string | undefined
}

/**
 * The rows of `entity` whose `property` equals that field of at least one of `others`, found through the field's index
 * (reading only those rows' files), or undefined when the field has no single-field index.
 * @param entity
 * @param property
 * @param type
 * @param others
 * @param otherProperty
 */
const indexedRows = async (entity: string, property: string, type: string | undefined, others: any[], otherProperty: string): Promise<any[] | undefined> => {
  const index = (await retrieveIndexes(entity, [property], {}))[property]
  if (!index) {
    return undefined
  }
  const wanted = new Set(others.map(row => joinKey(type, row[otherProperty])).filter(key => typeof key !== 'undefined'))
  const files = new Set<string>()
  for (const entry of index) {
    if (wanted.has(joinKey(type, entry.value))) {
      entry.record.forEach(file => files.add(file))
    }
  }
  // In the record's own order, as a full read gives them
  const record = await retrieveRecord(entity)
  return retrieveEntryRows(record, record.entries.filter(entry => files.has(entry)))
}

/**
 * The rows a join reads for each record in it, once for the whole join (every row's join then works from them):
 * - the queried record: its rows (already read, or narrowed by the where clause)
 * - the joined record when the where clause already narrowed it: those rows
 * - a record joined by `=` to one already read, through an index on its field and with both fields of one type: only
 *   the rows whose value one of those rows has (the others can't match any row's join, and the order is the record's
 *   own, so the join's result is the same as from all of them)
 * - any other: all its rows, kept on the query's data as before (merge reads them from there)
 * @param entity
 * @param joinEntity
 * @param dataSets
 * @param steps
 * @param joinAlreadyResolved
 */
export const joinBases = async (entity: string, joinEntity: string, dataSets: Object, steps: JoinStep[], joinAlreadyResolved: boolean): Promise<Map<string, JoinSide>> => {
  const bases = new Map<string, JoinSide>()
  const keep = (name: string, rows: any[]) => bases.set(name, { rows, lookups: new RowLookups(rows) })
  keep(entity, dataSets[entity])
  if (joinAlreadyResolved) {
    keep(joinEntity, dataSets[joinEntity])
  }
  const allRows = async (name: string) => (await readEntity(name, dataSets))[name]
  for (const step of steps) {
    const sides = [
      { name: step.entityA, property: step.propertyA, other: step.entityB, otherProperty: step.propertyB },
      { name: step.entityB, property: step.propertyB, other: step.entityA, otherProperty: step.propertyA }
    ]
    for (const { name, property, other, otherProperty } of sides) {
      if (bases.has(name)) {
        continue
      }
      // Fields of two types could disagree on which rows match (each side compares by its own), so only one type
      const narrowable = step.comparator === '=' && step.typeA === step.typeB && isKeyedType(step.typeA) && bases.has(other)
      const rows = narrowable ? await indexedRows(name, property, step.typeA, bases.get(other).rows, otherProperty) : undefined
      keep(name, rows ?? await allRows(name))
    }
  }
  if (!bases.has(joinEntity)) {
    keep(joinEntity, await allRows(joinEntity))
  }
  return bases
}
