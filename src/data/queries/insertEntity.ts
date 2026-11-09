import { retrieveRecord } from '../utilities/retrieveRecord'
import { keyUnique } from '../introspect/policies/keyUnique'
import { useDefault } from '../introspect/policies/useDefault'
import { typeCheck } from '../introspect/policies/typeCheck'
import { foreignKeyExists } from '../introspect/policies/foreignKeyExists'
import { splitEntityProperty } from '../utilities/parsers/splitEntityProperty'
import { computeKeyValue } from '../utilities/computeKeyValue'
import { fieldType, keyValueType } from '../utilities/fieldType'
import { compareAs, comparableTypes, sameValue } from '../utilities/compareAs'
import { retrieveRecords } from '../utilities/retrieveRecords'
import { isSingleFieldKey } from '../utilities/isSingleFieldKey'
import { IndexBuffer } from '../utilities/indexBuffer'
import { recordDefinition } from '../introspect/definitions/record'
import { keyDefinition } from '../introspect/definitions/key'
import { makeDirectory, readJson, writeJson } from '../storage'
import { discardPacked } from '../utilities/packedTable'
import { assertFieldsDefined } from '../utilities/knownFields'

/**
 * Whether a record holds a non-null value, as indexHas answers it: undefined when it can't say (no index on the
 * property, or one that can't be read), and the caller looks at every row instead.
 */
type Lookup = (value: any) => boolean | undefined

/**
 * The rows of a record that hold each combination of values for some fields, compared field by field by type, as
 * where's = compares them: built from the rows in storage once per statement, for a key no index can answer (several
 * fields, or no index file), instead of looking at every row in storage once per inserted row.
 */
class RowValues {
  private readonly fields: string[]
  private readonly types: Array<string | undefined>
  private readonly seen: Set<string> = new Set()

  constructor (record: recordDefinition, fields: string[]) {
    this.fields = fields
    this.types = fields.map(field => fieldType(record, field))
  }

  /**
   * Whether these fields' values can be compared this way: every field of a comparable type (see compareAs).
   * @param record
   * @param fields
   */
  static usable (record: recordDefinition, fields: string[]): boolean {
    return fields.every(field => comparableTypes.includes(fieldType(record, field)))
  }

  /**
   * The values' key, or undefined when one is null or missing (where's = never matches those) or compareAs leaves it an
   * object (compared by identity, so not by a key).
   * @param row
   */
  private keyOf (row: Object): string | undefined {
    const typed = []
    for (let position = 0; position < this.fields.length; position++) {
      const value = row[this.fields[position]]
      if (value === null || typeof value === 'undefined') {
        return undefined
      }
      const key = compareAs(this.types[position], value)
      if (typeof key === 'object') {
        return undefined
      }
      typed.push([typeof key, key])
    }
    return JSON.stringify(typed)
  }

  add (row: Object): void {
    const key = this.keyOf(row)
    if (typeof key !== 'undefined') {
      this.seen.add(key)
    }
  }

  has (row: Object): boolean {
    const key = this.keyOf(row)
    return typeof key !== 'undefined' && this.seen.has(key)
  }
}

/**
 * One insert statement's view of the keys it checks, so that each index is read and parsed once for all its rows
 * instead of once per row, and the record file and its indexes are written once at the end instead of once per row.
 *
 * It answers every check exactly as reading the files after each row would (as inserts did one row at a time): the
 * record's own indexes are held in memory (see IndexBuffer) and gain each row as it's added, so a row is checked
 * against the rows before it in the statement too; another record's index is read once, since an insert never changes
 * another record. Where a check can't use an index it looks at every row in storage as before, plus this statement's
 * rows, which aren't in storage until the end.
 */
class InsertStatement {
  readonly entity: string
  readonly record: recordDefinition
  readonly rows: Object[] = []
  private readonly hadEntries: boolean
  private readonly buffers: Map<keyDefinition, IndexBuffer> = new Map()
  private readonly unreadable: Set<keyDefinition> = new Set()
  private readonly otherLookups: Map<string, Promise<Lookup>> = new Map()
  private readonly scans: Map<string, Promise<RowValues | undefined>> = new Map()

  constructor (entity: string, record: recordDefinition) {
    this.entity = entity
    this.record = record
    this.hadEntries = (record.entries || []).length > 0
  }

  /**
   * Read the record's index files, once. An index that can't be read starts empty (as updateIndex starts one) and its
   * key is checked by looking at every row.
   */
  async load (): Promise<void> {
    for (const key of this.record.keys) {
      if (!key.lookup) {
        continue
      }
      let entries = []
      try {
        entries = await readJson(`__indexes/${this.record.path}/${key.lookup}`)
      } catch (error) {
        this.unreadable.add(key)
      }
      this.buffers.set(key, new IndexBuffer(Array.isArray(entries) ? entries : [], keyValueType(this.record, key)))
    }
  }

  /**
   * How to look up a non-null value of `property` in the record being inserted into: through its index buffer, which
   * holds the statement's rows so far. indexHas reads a record with no entries as holding nothing, whatever its index
   * file says, so until this statement adds a row to a record that had none, nothing is found.
   * @param property
   */
  private ownLookup (property: string): Lookup {
    const key = this.record.keys.find(key => isSingleFieldKey(key, property) && key.lookup)
    if (!key || this.unreadable.has(key)) {
      return () => undefined
    }
    const buffer = this.buffers.get(key)
    return value => (this.hadEntries || this.rows.length > 0) && buffer.has(value)
  }

  /**
   * How to look up a non-null value of `property` in another record, read once (an insert doesn't change it).
   * @param entity
   * @param property
   */
  private otherLookup (entity: string, property: string): Promise<Lookup> {
    const name = `${entity}\u0000${property}`
    if (!this.otherLookups.has(name)) {
      this.otherLookups.set(name, (async (): Promise<Lookup> => {
        const record = await retrieveRecord(entity)
        const key = record.keys.find(key => isSingleFieldKey(key, property) && key.lookup)
        if (!key) {
          return () => undefined
        }
        if (!(record.entries || []).length) {
          return () => false
        }
        let entries
        try {
          entries = await readJson(`__indexes/${record.path}/${key.lookup}`)
        } catch (error) {
          return () => undefined
        }
        const buffer = new IndexBuffer(Array.isArray(entries) ? entries : [], fieldType(record, property))
        return value => buffer.has(value)
      })())
    }
    return this.otherLookups.get(name)
  }

  /**
   * The values of these fields in every row of `entity` (read once per statement), plus, for the record being inserted
   * into, every row this statement adds; undefined when a field's type can't be compared by key.
   * @param entity
   * @param fields
   */
  private scan (entity: string, fields: string[]): Promise<RowValues | undefined> {
    const name = `${entity}\u0000${fields.join('\u0000')}`
    if (!this.scans.has(name)) {
      this.scans.set(name, (async (): Promise<RowValues | undefined> => {
        const record = entity === this.entity ? this.record : await retrieveRecord(entity)
        if (!RowValues.usable(record, fields)) {
          return undefined
        }
        const values = new RowValues(record, fields)
        // The record's rows in storage: this statement's own rows aren't there until the end, and are added as they come
        for (const row of await retrieveRecords(entity)) {
          values.add(row)
        }
        if (entity === this.entity) {
          this.rows.forEach(row => values.add(row))
        }
        return values
      })())
    }
    return this.scans.get(name)
  }

  /**
   * Whether one of this statement's rows already holds these values in every one of these fields (none of them null).
   * @param fields
   * @param values
   */
  private claimed (fields: string[], values: Object): boolean {
    return this.rows.some(row => fields.every(field => row[field] !== null && typeof row[field] !== 'undefined' &&
      sameValue(fieldType(this.record, field), row[field], values[field])))
  }

  /**
   * Whether no row (in storage or earlier in this statement) holds these values for these fields, as keyUnique answers
   * it after each earlier row is written.
   * @param fields
   * @param values
   */
  async isUnique (fields: string[], values: Object): Promise<boolean> {
    if (fields.length === 1) {
      const found = this.ownLookup(fields[0])(values[fields[0]])
      if (typeof found !== 'undefined') {
        return !found
      }
    }
    const scanned = await this.scan(this.entity, fields)
    if (scanned) {
      return !scanned.has(values)
    }
    return await keyUnique(this.entity, fields, fields.map(field => values[field])) && !this.claimed(fields, values)
  }

  /**
   * Whether `entity` holds `value` in `property`, as foreignKeyExists answers it after each earlier row is written: a
   * row may reference one added earlier in the same statement when the key points at its own record.
   * @param entity
   * @param property
   * @param value
   */
  async exists (entity: string, property: string, value: any): Promise<boolean> {
    const own = entity === this.entity
    const found = own ? this.ownLookup(property)(value) : (await this.otherLookup(entity, property))(value)
    if (typeof found !== 'undefined') {
      return found
    }
    const scanned = await this.scan(entity, [property])
    if (scanned) {
      return scanned.has({ [property]: value })
    }
    return await foreignKeyExists(entity, property, value) || (own && this.claimed([property], { [property]: value }))
  }

  /**
   * Note a row added to the statement, filed under `fileName`, in the record's entries and every index buffer.
   * @param entityValues
   * @param fileName
   */
  async add (entityValues: Object, fileName: string): Promise<void> {
    this.rows.push(entityValues)
    // Scans already built for this record hold the rows in storage; a row added now joins them
    for (const [name, scanned] of this.scans) {
      if (name.startsWith(`${this.entity}\u0000`)) {
        (await scanned)?.add(entityValues)
      }
    }
    this.record.entries.push(fileName)
    for (const [key, buffer] of this.buffers) {
      buffer.add(computeKeyValue(key.fields, entityValues), fileName)
    }
  }

  /**
   * Write the record file and each index once, with every row the statement added.
   */
  async write (): Promise<void> {
    await writeJson(`${this.record.path}.json`, this.record)
    if (this.buffers.size) {
      await makeDirectory(`__indexes/${this.record.path}`)
    }
    for (const [key, buffer] of this.buffers) {
      await writeJson(`__indexes/${this.record.path}/${key.lookup}`, buffer.entries)
    }
  }
}

/**
 * A new id for an autoGenerate field that no row holds yet, in storage or earlier in the statement.
 * @param statement
 * @param field
 */
const generateKey = async (statement: InsertStatement, field: string): Promise<string> => {
  let uuid: string
  do {
    uuid = crypto.randomUUID()
  } while (!await statement.isUnique([field], { [field]: uuid }))
  return uuid
}

/**
 * Build one entity's stored values from the raw input values, generating any autoGenerate
 * fields and applying field defaults, then throw if a required field still has no value. A null
 * in an optional field that isn't nullable means the same as leaving it out (the field can't
 * hold null, so nothing is lost): it isn't stored, and a default fills it in as for a field left out.
 * @param statement
 * @param rowValues
 */
const buildEntityValues = async (statement: InsertStatement, rowValues: Object = {}): Promise<Object> => {
  const entityValues = {}
  for (const field of statement.record.definition) {
    let value = rowValues[field.name]
    if (value === null && field.optional && !field.nullable) {
      value = undefined
    }
    if (field.autoGenerate) {
      value = await generateKey(statement, field.name)
    } else if (Object.prototype.hasOwnProperty.call(field, 'default')) {
      value = useDefault(field['default'], value)
    }
    if (typeof value === 'undefined') {
      if (!field.optional) {
        throw new Error(`Missing required field "${field.name}" for ${statement.entity}`)
      }
      continue
    }
    entityValues[field.name] = typeCheck(field.type, value, field.nullable)
  }
  return entityValues
}

/**
 * Reject the insert if it collides with an existing primary or unique key value - a single field,
 * or a composite of several for a multi-field key. As in SQL, a value with a null in it is never a
 * duplicate, so a nullable unique field can hold null in any number of rows.
 * @param statement
 * @param entityValues
 */
const assertUnique = async (statement: InsertStatement, entityValues: Object): Promise<void> => {
  for (const key of statement.record.keys) {
    if (key.type !== 'primary' && key.type !== 'unique') {
      continue
    }
    if (key.fields.some(field => entityValues[field] === null)) {
      continue
    }
    if (!await statement.isUnique(key.fields, entityValues)) {
      throw new Error(`Duplicate value for ${key.type} key "${key.fields.join(', ')}" on ${statement.entity}`)
    }
  }
}

/**
 * Reject the insert if a single-field foreign key's value doesn't exist in the record it
 * references. A null references nothing, so it isn't checked (as in SQL).
 * @param statement
 * @param entityValues
 */
const assertForeignKeys = async (statement: InsertStatement, entityValues: Object): Promise<void> => {
  for (const key of statement.record.keys) {
    if (key.type !== 'foreign' || key.fields.length !== 1 || !key.references || key.references.length !== 1) {
      continue
    }
    const field = key.fields[0]
    if (!Object.prototype.hasOwnProperty.call(entityValues, field) || entityValues[field] === null) {
      continue
    }
    const { entity: refEntity, property: refProperty } = splitEntityProperty(key.references[0].fields[0])
    if (!await statement.exists(refEntity, refProperty, entityValues[field])) {
      throw new Error(`Foreign key "${field}" on ${statement.entity} references a nonexistent ${refEntity}.${refProperty} = ${entityValues[field]}`)
    }
  }
}

/**
 * Insert rows into a record, all in one statement: every row is checked (against the rows in storage and the rows
 * before it in the statement) and its entry file written, then the record file and each index are written once.
 * Inside a write set (as every query runs, see withWriteSet) a row that fails leaves none of them written.
 * @param entity
 * @param values - The rows, as field -> value.
 * @param dataSet
 */
export const insertEntity = async (entity: string = '', values: Object[] = [], dataSet: Object = {}): Promise<Object> => {
  const record = await retrieveRecord(entity)
  const primaryKey = record.keys.find(key => key.type === 'primary' && key.fields.length === 1)

  if (!Object.prototype.hasOwnProperty.call(dataSet, entity)) {
    dataSet[entity] = []
  }

  // The record's folder can be missing even though the record exists: git doesn't keep empty folders, so a database
  // committed before its first insert comes back from a fresh clone without it
  await makeDirectory(record.path)
  if (!values.length) {
    return dataSet
  }
  // A field the record doesn't define would otherwise be dropped without a word
  for (const rowValues of values) {
    assertFieldsDefined(entity, record, Object.keys(rowValues || {}), 'insert')
  }
  await discardPacked(record.path)

  const statement = new InsertStatement(entity, record)
  await statement.load()
  for (const rowValues of values) {
    const entityValues = await buildEntityValues(statement, rowValues)
    await assertUnique(statement, entityValues)
    await assertForeignKeys(statement, entityValues)

    const fileName = `${primaryKey ? entityValues[primaryKey.fields[0]] : crypto.randomUUID()}.json`
    await writeJson(`${record.path}/${fileName}`, entityValues)
    await statement.add(entityValues, fileName)
    dataSet[entity].push(entityValues)
  }
  await statement.write()

  return dataSet
}
