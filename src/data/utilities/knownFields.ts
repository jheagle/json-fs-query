import { retrieveRecord } from './retrieveRecord'
import { isEntityProperty } from './parsers/isEntityProperty'
import { splitEntityProperty } from './parsers/splitEntityProperty'
import { conditionsOf } from './conditionTree'
import { recordDefinition } from '../introspect/definitions/record'

/**
 * The fields a record defines, for an error message.
 * @param record
 */
const fieldList = (record: recordDefinition): string => record.definition.map(field => field.name).join(', ')

/**
 * Throw unless `record` defines every one of `fields`, naming the first that it doesn't and the fields it has: a
 * misspelled field would otherwise be dropped from an insert, stored by an update, or match nothing in a read.
 * @param entity - The record's name, for the message.
 * @param record
 * @param fields
 * @param where - Where the fields were given (`insert`, `set`, `where`...), for the message.
 * @throws {Error} `Unknown field "<field>" in <where>: <entity> has <fields>`.
 */
export const assertFieldsDefined = (entity: string, record: recordDefinition, fields: string[], where: string): void => {
  const defined = new Set(record.definition.map(field => field.name))
  const unknown = fields.find(field => !defined.has(field))
  if (typeof unknown !== 'undefined') {
    throw new Error(`Unknown field "${unknown}" in ${where}: ${entity} has ${fieldList(record)}`)
  }
}

/**
 * Throw unless every field a query names (in `where`, `sort`, `group by`, `select`, `on`, `merge`, and an insert's or
 * update's values) is defined by its record, before anything is read: the queried record for a plain name, the named
 * one for `<record>.<field>` (any record, as a join through another one names it). In `select`, the joined record's
 * name stands for its rows, and `<record>.<field>` names the queried record's own field or a merged record's (a joined
 * record's rows are a list, with no one value to pick).
 * @param parsed - The parsed query.
 * @param recordData - Records already read, by name (more are read as they're named, and kept here).
 * @throws {Error} `Unknown field ...` (see assertFieldsDefined), or `Record "<name>" doesn't exist` for a record that
 *   doesn't.
 */
export const assertKnownFields = async (parsed, recordData: { [entity: string]: recordDefinition }): Promise<void> => {
  // A merged record's fields are on each row as `<record>.<field>`, so select can name them; a joined one's rows are a
  // list, with no one value to pick
  const merged = new Set((parsed.mergeJoins || []).map(merge => splitEntityProperty(merge.propertyB).entity))
  const named: Array<{ property: string, clause: string, own?: boolean }> = [
    ...conditionsOf(parsed.where).map(condition => ({ property: condition.property, clause: 'where' })),
    ...(parsed.sortClauses || []).map(sort => ({ property: sort.property, clause: 'sort' })),
    ...(parsed.groupBy || []).map(property => ({ property, clause: 'group by' })),
    ...(parsed.selectClauses || [])
      .filter(select => select.property !== parsed.joinEntity)
      .map(select => ({ property: select.property, clause: 'select' })),
    ...(parsed.insertValues || []).flatMap(row => Object.keys(row || {}).map(property => ({ property, clause: 'insert', own: true }))),
    ...Object.keys(parsed.updateValues || {}).map(property => ({ property, clause: 'set', own: true })),
    ...(parsed.joinClauses || []).flatMap(join => [
      { property: join.propertyA, clause: 'on' },
      { property: join.propertyB, clause: 'on' }
    ]),
    ...(parsed.mergeJoins || []).flatMap(merge => [
      { property: merge.propertyA, clause: 'merge' },
      { property: merge.propertyB, clause: 'merge' }
    ])
  ]
  for (const { property, clause, own } of named) {
    if (typeof property !== 'string') {
      continue
    }
    let entity = parsed.entity
    let field = property
    // Insert and set values are always the queried record's own fields, whatever their name
    if (!own && isEntityProperty(property)) {
      ({ entity, property: field } = splitEntityProperty(property))
    }
    if (clause === 'select' && entity !== parsed.entity && !merged.has(entity)) {
      throw new Error(`Can't select "${property}": a joined record's rows are a list under its name (select ${entity}), ` +
        `and its fields are on each row only when merged (merge ... with ${entity}.<field>)`)
    }
    if (!Object.prototype.hasOwnProperty.call(recordData, entity)) {
      recordData[entity] = await retrieveRecord(entity)
    }
    assertFieldsDefined(entity, recordData[entity], [field], clause)
  }
}
