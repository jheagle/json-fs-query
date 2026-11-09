import { deleteEntity } from '../queries/deleteEntity'
import { insertEntity } from '../queries/insertEntity'
import { readEntity } from '../queries/readEntity'
import { updateEntity } from '../queries/updateEntity'
import { createRecord } from '../queries/createRecord'
import { dropRecord } from '../queries/dropRecord'
import { describeRecord } from '../queries/describeRecord'
import { alter as alterRecord } from '../introspect/alter'
import { createDatabase, dropDatabase, showDatabases, useDatabase } from '../queries/databaseStatements'
import { showRecords } from '../queries/showRecords'
import { joinEntity } from '../queries/joinEntity'
import { mergeJoins } from '../queries/mergeJoins'
import { whereTree } from '../queries/where'
import { sortBy } from '../queries/sortBy'
import { groupBy } from '../queries/groupBy'
import { limitOffset } from '../queries/limitOffset'
import { selectFields } from '../queries/selectFields'
import { retrieveRecord } from './retrieveRecord'
import { getConditionIndexedList } from './getConditionIndexedList'
import { isEntityProperty } from './parsers/isEntityProperty'
import { splitEntityProperty } from './parsers/splitEntityProperty'
import { fieldType } from './fieldType'
import { conditionsOf } from './conditionTree'
import { conditionEntities } from './conditionEntities'
import { requireNode } from './requireNode'
import { assertKnownFields } from './knownFields'

/**
 * Give each condition and sort clause its field's declared type, so where and sortBy compare by it
 * (a joined entity's field is looked up on that entity's record).
 * @param parsed
 * @param recordData
 */
const typeClauses = async (parsed, recordData) => {
  for (const clause of [...conditionsOf(parsed.where), ...parsed.sortClauses]) {
    let entity = parsed.entity
    let property = clause.property
    if (isEntityProperty(property)) {
      ({ entity, property } = splitEntityProperty(property))
    }
    if (!Object.prototype.hasOwnProperty.call(recordData, entity)) {
      recordData[entity] = await retrieveRecord(entity)
    }
    clause.type = fieldType(recordData[entity], property)
  }
}

export const runQuery = async (parsed) => {
  // Checked before anything is read: which entity each condition is on, and whether it needs per-pair evaluation
  const perPair = typeof parsed.where !== 'undefined' && conditionEntities(parsed)
  // Writes and schema changes need the filesystem; say so plainly in a browser
  if (['insert', 'update', 'delete', 'create', 'drop', 'alter'].includes(parsed.command)) {
    requireNode(`"${parsed.command}"`)
  }
  // Schema statements act on the database, not on entries (for create there is no record to read yet)
  switch (parsed.command) {
    case 'create':
      return { [parsed.entity]: await createRecord(parsed.entity, parsed.create) }
    case 'drop':
      return { [parsed.entity]: await dropRecord(parsed.entity, parsed.ifExists) }
    case 'describe':
      return { [parsed.entity]: await describeRecord(parsed.entity) }
    case 'alter':
      return { [parsed.entity]: await alterRecord(parsed.entity, parsed.alter) }
    case 'create database':
      return { [parsed.entity]: await createDatabase(parsed.entity, parsed.ifNotExists) }
    case 'drop database':
      return { [parsed.entity]: await dropDatabase(parsed.entity, parsed.ifExists) }
    case 'use':
      return { [parsed.entity]: await useDatabase(parsed.entity) }
    case 'show databases':
      return { [parsed.entity]: await showDatabases() }
    case 'show':
      return { [parsed.entity]: await showRecords() }
  }
  const recordData = {
    [parsed.entity]: await retrieveRecord(parsed.entity)
  }
  if (typeof parsed.joinEntity !== 'undefined') {
    recordData[parsed.joinEntity] = await retrieveRecord(parsed.joinEntity)
  }

  // Every field the query names must be one its record defines: a misspelled one would otherwise match nothing
  await assertKnownFields(parsed, recordData)
  await typeClauses(parsed, recordData)

  let dataSet: any = { [parsed.entity]: [] }

  // An indexed condition that matches nothing leaves dataSet[entity] at [] - the same state it starts in before
  // anything has looked at it at all. readEntity() (below) can't tell those two states apart on its own (it reloads
  // whenever the array is empty), so getConditionIndexedList reports which entities it resolved: once any indexed
  // condition has narrowed entity's rows, they are the candidates (every condition is applied to them below) and
  // must not be reloaded. This used to ask whether EVERY condition was indexed, so `where date = 'none' and reps =
  // 10` reloaded every row and returned, updated or deleted all rows with reps 10.
  const resolved = new Set<string>()
  parsed = await getConditionIndexedList(parsed, recordData, dataSet, resolved)
  const entityResolved = resolved.has(parsed.entity)
  // The join is joinEntity's (below), for rows an index narrowed too

  // delete/update act on whatever is already in dataSet[entity] - unlike read, which loads
  // everything and lets the where-reduce below narrow it down afterward, they never get a second
  // pass. So every condition is applied to the candidates (all rows, or the ones the indexes picked)
  // before either runs.
  if (parsed.command === 'delete' || parsed.command === 'update') {
    if (!entityResolved) {
      dataSet = await readEntity(parsed.entity, dataSet)
    }
    dataSet[parsed.entity] = whereTree(dataSet[parsed.entity], parsed.where)
  }

  switch (parsed.command) {
    case 'delete':
      dataSet = await deleteEntity(parsed.entity, dataSet)
      break
    case 'insert':
      dataSet = await insertEntity(parsed.entity, parsed.insertValues, dataSet)
      break
    case 'read':
      if (!entityResolved) {
        dataSet = await readEntity(parsed.entity, dataSet)
      }
      break
    case 'update':
      dataSet = await updateEntity(parsed.entity, parsed.updateValues, dataSet)
      break
    default:
      throw new Error(`Unknown command: ${parsed.command}`)
  }
  dataSet = await joinEntity(parsed.entity, parsed.joinEntity, dataSet, parsed.joinClauses, entityResolved, resolved.has(parsed.joinEntity))
  dataSet = await mergeJoins(dataSet, parsed.mergeJoins)

  // delete/update already had parsed.where applied above, before they ran. Re-applying the
  // same conditions here would be wrong, not just redundant, for update specifically: if the
  // update just changed the very field a condition filters on, re-checking that condition against
  // the now-changed data would filter the just-updated rows back out.
  if (parsed.command !== 'delete' && parsed.command !== 'update') {
    dataSet[parsed.entity] = whereTree(dataSet[parsed.entity], parsed.where, perPair ? parsed.joinEntity : undefined)
  }

  // Sorted before grouping, so the groups come in sorted order; limit and offset count groups once there are any
  dataSet[parsed.entity] = sortBy(dataSet[parsed.entity], parsed.sortClauses)
  dataSet[parsed.entity] = groupBy(dataSet[parsed.entity], parsed.groupBy)
  dataSet[parsed.entity] = limitOffset(dataSet[parsed.entity], parsed.offset, parsed.limit)
  dataSet[parsed.entity] = selectFields(dataSet[parsed.entity], parsed.selectClauses, Boolean(parsed.groupBy?.length), parsed.entity)

  return dataSet
}
