import { isEntityProperty } from './parsers/isEntityProperty'
import { splitEntityProperty } from './parsers/splitEntityProperty'
import { retrieveRecord } from './retrieveRecord'
import { where } from '../queries/where'
import { retrieveEntryRows } from './retrieveRecords'
import { retrieveFile } from './retrieveFile'
import { ParsedQuery } from './parsers/parseQuery'
import { retrieveIndexes } from './retrieveIndexes'
import { isSingleFieldKey } from './isSingleFieldKey'
import { ConditionNode, isCondition, requiredConditions } from './conditionTree'
import type { ParsedCondition } from './parsers/findConditions'

/**
 * The files a node's matching rows can be in, or undefined for every row (nothing narrows them).
 */
type Candidates = Set<string> | undefined

/**
 * The entity and field a condition is on (`exercises.name` is on exercises, `name` on the queried entity).
 * @param condition
 * @param mainEntity
 */
const conditionField = (condition: ParsedCondition, mainEntity: string): { entity: string, property: string } =>
  isEntityProperty(condition.property) ? splitEntityProperty(condition.property) : { entity: mainEntity, property: condition.property }

/**
 * The files an index says can match one condition, or undefined when the field has no single-field index.
 * @param entity
 * @param property
 * @param condition
 * @param recordData
 * @param indexed - index files already read, by entity and field (each is read once per query)
 */
const indexedFiles = async (entity: string, property: string, condition: ParsedCondition, recordData, indexed): Promise<Candidates> => {
  if (!Object.prototype.hasOwnProperty.call(recordData, entity)) {
    recordData[entity] = await retrieveRecord(entity)
  }
  if (!recordData[entity].keys.some(key => isSingleFieldKey(key, property))) {
    return undefined
  }
  indexed[entity] = indexed[entity] || {}
  if (!Object.prototype.hasOwnProperty.call(indexed[entity], property)) {
    indexed[entity][property] = (await retrieveIndexes(entity, [property], recordData))[property]
  }
  return new Set<string>(where(indexed[entity][property], {
    property: 'value',
    comparator: condition.comparator,
    value: condition.value,
    type: condition.type
  }).flatMap(matchedRecord => matchedRecord.record))
}

/**
 * The candidate files for a node, on the queried entity:
 * - a condition: the files its index matches; unindexed (or on another entity): every row
 * - `and`: the intersection of the children that narrow anything
 * - `or`: the union, only when every branch narrows; otherwise every row
 * - `not`: every row (its complement would have to leave out the unknown rows)
 * @param node
 * @param mainEntity
 * @param recordData
 * @param indexed
 */
const candidatesOf = async (node: ConditionNode, mainEntity: string, recordData, indexed): Promise<Candidates> => {
  if (isCondition(node)) {
    const { entity, property } = conditionField(node, mainEntity)
    return entity === mainEntity ? await indexedFiles(entity, property, node, recordData, indexed) : undefined
  }
  if ('not' in node) {
    return undefined
  }
  if ('or' in node) {
    const union = new Set<string>()
    for (const child of node.or) {
      const files = await candidatesOf(child, mainEntity, recordData, indexed)
      if (typeof files === 'undefined') {
        return undefined
      }
      files.forEach(file => union.add(file))
    }
    return union
  }
  let intersection: Candidates
  for (const child of node.and) {
    const files = await candidatesOf(child, mainEntity, recordData, indexed)
    if (typeof files !== 'undefined') {
      intersection = typeof intersection === 'undefined' ? files : new Set([...intersection].filter(file => files.has(file)))
    }
  }
  return intersection
}

/**
 * Load only the candidate rows the indexes allow for the where clause (see candidatesOf): an index only narrows which
 * rows are read. Every condition, indexed or not, stays in parsed.where and is still applied to the candidates
 * afterwards (runQuery), so an index can make a query faster but never changes its result (where-clauses decision 3;
 * it used to remove the conditions it answered, and the 3 bugs fixed in #69 came from that split).
 *
 * An indexed condition on a joined entity's field (`exercises._id = 1`) narrows that entity's rows only when every
 * row must meet it (directly under the top-level `and`, see requiredConditions). It stays in the tree too: the where
 * clause is then evaluated per pair of a row and a joined row (see whereTree).
 * @param parsed
 * @param recordData
 * @param dataSet
 * @param resolved - Filled with each entity whose candidate rows were loaded here: they must not be reloaded (an
 * empty list otherwise reads as "not loaded yet", see readEntity).
 */
export const getConditionIndexedList = async (parsed: ParsedQuery, recordData, dataSet, resolved: Set<string> = new Set()) => {
  const matchedFiles: { [entity: string]: Set<string> } = {}
  const indexed = {}
  if (typeof parsed.where !== 'undefined') {
    const candidates = await candidatesOf(parsed.where, parsed.entity, recordData, indexed)
    if (typeof candidates !== 'undefined') {
      matchedFiles[parsed.entity] = candidates
    }
  }
  for (const condition of requiredConditions(parsed.where)) {
    const { entity, property } = conditionField(condition, parsed.entity)
    if (entity === parsed.entity) {
      continue
    }
    const files = await indexedFiles(entity, property, condition, recordData, indexed)
    if (typeof files === 'undefined') {
      continue
    }
    matchedFiles[entity] = Object.prototype.hasOwnProperty.call(matchedFiles, entity)
      ? new Set([...matchedFiles[entity]].filter(file => files.has(file)))
      : files
  }
  for (const entity of Object.keys(matchedFiles)) {
    resolved.add(entity)
    const record = recordData[entity] || await retrieveRecord(entity)
    dataSet[entity] = await retrieveEntryRows(record, [...matchedFiles[entity]], retrieveFile)
  }
  return parsed
}
