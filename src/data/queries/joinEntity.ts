import { readEntity } from './readEntity'
import { retrieveRecord } from '../utilities/retrieveRecord'
import { splitEntityProperty } from '../utilities/parsers/splitEntityProperty'
import { fieldType } from '../utilities/fieldType'
import { JoinSide, semiJoin } from '../utilities/semiJoin'
import { joinBases, JoinStep } from '../utilities/joinBases'

/**
 * Each `on` clause with the types its two sides are compared by. Each record is read here, before its type is looked
 * up, so a record that doesn't exist fails with "Could not read <record>.json", as it always has.
 * @param joinClauses
 */
const joinSteps = async (joinClauses): Promise<JoinStep[]> => {
  const steps = []
  for (const { propertyA, comparator, propertyB } of joinClauses) {
    const { entity: entityA, property: a } = splitEntityProperty(propertyA)
    const { entity: entityB, property: b } = splitEntityProperty(propertyB)
    steps.push({
      entityA,
      propertyA: a,
      typeA: fieldType(await retrieveRecord(entityA), a),
      comparator,
      entityB,
      propertyB: b,
      typeB: fieldType(await retrieveRecord(entityB), b)
    })
  }
  return steps
}

/**
 * What a row gets for its joined rows. Today every row is kept with the list of rows its join found (none is an empty
 * list), and a condition on the joined record's fields then drops rows with none (whereTree): an inner join. This is
 * the one place a join type (left, right, outer) would decide differently.
 * @param matches - The joined rows the row's join found, shared with other rows' joins until copied here.
 */
const joinedRows = (matches: any[]): any[] => matches.map(match => structuredClone(match))

/**
 * Attach to each row of `entity` the rows of `joinEntity` its join reaches, through the `on` clauses in order.
 *
 * Each clause narrows both its records to the rows that match the other side: first the rows of the left one that
 * match a right one, then the right ones that match those (see semiJoin for the order). A row's join starts from the
 * row alone and from the rows read for every other record (see joinBases), so each record is read once for the whole
 * join and each lookup is built once, rather than every loaded row being copied for each row joined.
 * @param entity
 * @param joinEntity
 * @param dataSets
 * @param joinClauses
 * @param entityAlreadyResolved - Whether the where clause already narrowed entity's rows (then they aren't read again:
 * an empty list reads as "not loaded yet", see readEntity).
 * @param joinAlreadyResolved - The same for joinEntity.
 */
export const joinEntity = async (entity, joinEntity, dataSets = {}, joinClauses = [], entityAlreadyResolved = false, joinAlreadyResolved = false) => {
  if (!entityAlreadyResolved) {
    dataSets = await readEntity(entity, dataSets)
  }
  if (!joinClauses.length) {
    return dataSets
  }
  const steps = await joinSteps(joinClauses)
  if (!dataSets[entity].length) {
    return dataSets
  }
  const bases = await joinBases(entity, joinEntity, dataSets, steps, joinAlreadyResolved)
  for (const row of dataSets[entity]) {
    const sides = new Map<string, JoinSide>(bases)
    sides.set(entity, { rows: [row] })
    for (const step of steps) {
      sides.set(step.entityA, { rows: semiJoin(sides.get(step.entityA), sides.get(step.entityB), step.propertyA, step.propertyB, step.comparator, step.typeA) })
      sides.set(step.entityB, { rows: semiJoin(sides.get(step.entityB), sides.get(step.entityA), step.propertyB, step.propertyA, step.comparator, step.typeB) })
    }
    row[joinEntity] = joinedRows(sides.get(joinEntity).rows)
  }
  return dataSets
}
