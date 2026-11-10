import { ParsedSelect } from '../utilities/parsers/findSelects'
import { Group } from './groupBy'

/**
 * The value a select name picks from a row: the row's own key (a field, a merged record's `<record>.<field>`, or a
 * joined record's rows), or for `<queried record>.<field>`, the row's own field.
 * @param row
 * @param property
 * @param entity - The queried record's name.
 */
const pick = (row: Object, property: string, entity: string | undefined): any => {
  if (Object.prototype.hasOwnProperty.call(row, property) || typeof entity === 'undefined' || !property.startsWith(`${entity}.`)) {
    return row[property]
  }
  return row[property.slice(entity.length + 1)]
}

const shapeRow = (row: Object, selectClauses: ParsedSelect[], entity: string | undefined): Object => selectClauses.reduce(
  (shaped: Object, { property, alias }: ParsedSelect) => {
    shaped[alias || property] = pick(row, property, entity)
    return shaped
  },
  {}
)

const shapeGroup = (group: Group, selectClauses: ParsedSelect[], entity: string | undefined): Group => group.groups
  ? { ...group, groups: group.groups.map((inner: Group) => shapeGroup(inner, selectClauses, entity)) }
  : { ...group, rows: group.rows.map((row: Object) => shapeRow(row, selectClauses, entity)) }

/**
 * Shape each row down to only the selected properties (aliased, when given, otherwise named as written). dataSet is
 * either a list of rows, or (once groupBy has run) a list of groups, whose rows are shaped the same way at any depth;
 * the groups keep their field and value, selected or not.
 * @param dataSet
 * @param selectClauses
 * @param grouped Whether dataSet is a list of groups (see groupBy)
 * @param entity The queried record's name, so `<record>.<field>` picks the row's own field
 */
export const selectFields = (dataSet: Object[] | Group[] = [], selectClauses: ParsedSelect[] = [], grouped: boolean = false, entity?: string): Object[] | Group[] => {
  if (!selectClauses.length) {
    return dataSet
  }
  if (grouped) {
    return (dataSet as Group[]).map((group: Group) => shapeGroup(group, selectClauses, entity))
  }
  return dataSet.map((row: Object) => shapeRow(row, selectClauses, entity))
}
