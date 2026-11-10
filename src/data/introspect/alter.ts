import { field as fieldDefinitionOf, fieldDefinition } from './definitions/field'
import { recordDefinition } from './definitions/record'
import { keyDefinition } from './definitions/key'
import { assertValidDefinition } from './create'
import { ParsedAlter } from '../utilities/parsers/parseAlter'
import { keyLookup, nameMatch } from '../utilities/parsers/parseCreate'
import { retrieveRecord } from '../utilities/retrieveRecord'
import { retrieveFiles } from '../utilities/retrieveFiles'
import { retrieveEntry } from '../utilities/retrieveRecords'
import { assertFieldsDefined } from '../utilities/knownFields'
import { discardPacked } from '../utilities/packedTable'
import { requireNode } from '../utilities/requireNode'
import { showRecords } from '../queries/showRecords'
import { updateEntity } from '../queries/updateEntity'
import { typeCheck } from './policies/typeCheck'
import { fileExists, readJson, removeFile, writeJson } from '../storage'

type Row = { fileName: string, data: Object }

/**
 * Every row of a record, with the entry file it's in.
 * @param record
 */
const rowsOf = async (record: recordDefinition): Promise<Row[]> => {
  const rows = await retrieveFiles(record.entries.map(file => `${record.path}/${file}`), retrieveEntry)
  return rows.map((data, position) => ({ fileName: record.entries[position], data }))
}

const has = (row: Object, name: string): boolean => Object.prototype.hasOwnProperty.call(row, name)

/** The keys of a record that use a field. */
const keysUsing = (record: recordDefinition, name: string): keyDefinition[] => record.keys.filter(key => key.fields.includes(name))

const describeKey = (key: keyDefinition): string => `${key.type} key (${key.fields.join(', ')})`

/**
 * Every record's foreign keys that reference `<entity>.<name>`, with the record they're on.
 * @param entity
 * @param name
 */
const referencesTo = async (entity: string, name: string): Promise<Array<{ entity: string, record: recordDefinition, key: keyDefinition }>> => {
  const found = []
  for (const other of await showRecords()) {
    const record = await retrieveRecord(other)
    for (const key of record.keys) {
      if (key.type === 'foreign' && (key.references || []).some(reference => reference.fields.includes(`${entity}.${name}`))) {
        found.push({ entity: other, record, key })
      }
    }
  }
  return found
}

/**
 * Write the record's new definition, after checking it as create checks a new one (defaults fit their types, keys name
 * defined fields, primary key fields aren't nullable).
 * @param entity
 * @param record
 */
const writeRecord = async (entity: string, record: recordDefinition): Promise<void> => {
  assertValidDefinition(entity, record)
  await writeJson(`${entity}.json`, record)
}

/**
 * Give `rows` a value for `name` (or, with undefined, remove it). A field no key uses is written straight into each
 * entry file. For a field a key uses, the rows go through update, as `update <entity> set <name> = ...` would change
 * them, so the key's index moves with them and its checks (uniqueness, foreign keys) apply; that needs the record's
 * new definition written first, and a primary key to find each row by.
 * @param entity
 * @param record - The record's new definition.
 * @param rows
 * @param name
 * @param value - The value, or a function giving each row's; undefined removes the field.
 */
const setField = async (entity: string, record: recordDefinition, rows: Row[], name: string, value: any): Promise<void> => {
  if (!rows.length) {
    return
  }
  await discardPacked(record.path)
  if (keysUsing(record, name).length && typeof value !== 'function') {
    if (!record.keys.some(key => key.type === 'primary')) {
      throw new Error(`Can't change "${name}" on ${entity}'s rows: a key uses it, and rows are found by the primary key, which ${entity} doesn't have`)
    }
    // update reads null in an optional field that isn't nullable as removing it (see updateEntity)
    await updateEntity(entity, { [name]: typeof value === 'undefined' ? null : value }, { [entity]: rows.map(row => row.data) })
    return
  }
  for (const row of rows) {
    const changed = Object.assign({}, row.data)
    const next = typeof value === 'function' ? value(row) : value
    if (typeof next === 'undefined') {
      delete changed[name]
    } else {
      changed[name] = next
    }
    await writeJson(`${record.path}/${row.fileName}`, changed)
  }
}

/**
 * Add a field. Existing rows get its default, or a new id for an `auto` field; with neither, it must be optional (the
 * rows would otherwise be missing a required field). A row that already holds a value under the name (written before
 * the field was defined) keeps it, if it fits the type.
 */
const addField = async (entity: string, record: recordDefinition, added: fieldDefinition): Promise<recordDefinition> => {
  if (record.definition.some(field => field.name === added.name)) {
    throw new Error(`Field "${added.name}" already exists on ${entity}`)
  }
  const updated = { ...record, definition: [...record.definition, added] }
  const rows = await rowsOf(record)
  for (const row of rows.filter(row => has(row.data, added.name))) {
    try {
      typeCheck(added.type, row.data[added.name], added.nullable)
    } catch (error) {
      throw new Error(`Can't add "${added.name}" to ${entity}: row ${row.fileName} already holds a value for it that doesn't fit (${(error as Error).message})`)
    }
  }
  const missing = rows.filter(row => !has(row.data, added.name))
  const hasDefault = has(added, 'default')
  if (missing.length && !added.optional && !hasDefault && !added.autoGenerate) {
    throw new Error(`Can't add required field "${added.name}" to ${entity}: its ${missing.length} row(s) have no value for it (give it a default, or make it optional)`)
  }
  await writeRecord(entity, updated)
  if (added.autoGenerate) {
    await setField(entity, updated, missing, added.name, () => crypto.randomUUID())
  } else if (hasDefault) {
    await setField(entity, updated, missing, added.name, added['default'])
  }
  return updated
}

/**
 * Drop a field, removing it from every row. Refused while a key uses it, or another record's foreign key references it
 * (drop or change those first).
 */
const dropField = async (entity: string, record: recordDefinition, name: string): Promise<recordDefinition> => {
  assertFieldsDefined(entity, record, [name], 'alter')
  const key = keysUsing(record, name)[0]
  if (key) {
    throw new Error(`Can't drop "${name}" from ${entity}: its ${describeKey(key)} uses it`)
  }
  const reference = (await referencesTo(entity, name))[0]
  if (reference) {
    throw new Error(`Can't drop "${name}" from ${entity}: ${reference.entity}'s foreign key "${reference.key.fields[0]}" references it`)
  }
  const updated = { ...record, definition: record.definition.filter(field => field.name !== name) }
  await writeRecord(entity, updated)
  await setField(entity, updated, (await rowsOf(record)).filter(row => has(row.data, name)), name, undefined)
  return updated
}

/**
 * Rename a field: in the definition, in every row, in the record's keys (moving an index file named after the field to
 * its new name), and in every foreign key that references it.
 */
const renameField = async (entity: string, record: recordDefinition, name: string, to: string): Promise<recordDefinition> => {
  assertFieldsDefined(entity, record, [name], 'alter')
  if (record.definition.some(field => field.name === to)) {
    throw new Error(`Can't rename "${name}" on ${entity} to "${to}": a field of that name already exists`)
  }
  const references = await referencesTo(entity, name)
  const keys = record.keys.map(key => {
    if (!key.fields.includes(name)) {
      return key
    }
    const fields = key.fields.map(field => field === name ? to : field)
    // An index file create named after the fields moves to the new name; a name given some other way stays
    const lookup = key.lookup && key.lookup === keyLookup(key.type, key.fields) ? keyLookup(key.type, fields) : key.lookup
    return { ...key, fields, lookup }
  })
  const renameReferences = (key: keyDefinition): keyDefinition => key.type !== 'foreign'
    ? key
    : {
        ...key,
        references: (key.references || []).map(reference => ({
          ...reference,
          fields: reference.fields.map(field => field === `${entity}.${name}` ? `${entity}.${to}` : field)
        }))
      }
  const updated = {
    ...record,
    definition: record.definition.map(field => field.name === name ? { ...field, name: to } : field),
    keys: keys.map(renameReferences)
  }
  for (const [position, key] of record.keys.entries()) {
    const moved = keys[position].lookup
    if (key.lookup && moved !== key.lookup && fileExists(`__indexes/${record.path}/${key.lookup}`)) {
      await writeJson(`__indexes/${record.path}/${moved}`, await readJson(`__indexes/${record.path}/${key.lookup}`))
      await removeFile(`__indexes/${record.path}/${key.lookup}`)
    }
  }
  await writeRecord(entity, updated)
  for (const reference of references.filter(reference => reference.entity !== entity)) {
    await writeJson(`${reference.entity}.json`, { ...reference.record, keys: reference.record.keys.map(renameReferences) })
  }
  // Each row's value moves to the new name (the indexes hold values, not names, so they only moved file)
  const rows = (await rowsOf(record)).filter(row => has(row.data, name))
  if (rows.length) {
    await discardPacked(record.path)
  }
  for (const row of rows) {
    const moved = Object.assign({}, row.data)
    moved[to] = moved[name]
    delete moved[name]
    await writeJson(`${record.path}/${row.fileName}`, moved)
  }
  return updated
}

/**
 * Change a field's definition: whether it's optional or nullable, and its default (its type, and whether it's auto,
 * stay). The statement gives the whole new definition, as MySQL's MODIFY does: what it leaves out is cleared, so a
 * default it doesn't repeat is removed, as `optional` or `null` left out make the field required or not nullable. Rows that would no longer fit are filled with the new default, or the change is refused: a field made
 * required needs a value in every row, and one made not nullable can't hold null (an optional one then has no value,
 * as null means in an optional field).
 */
const modifyField = async (entity: string, record: recordDefinition, changed: fieldDefinition): Promise<recordDefinition> => {
  assertFieldsDefined(entity, record, [changed.name], 'alter')
  const current = record.definition.find(field => field.name === changed.name)
  if (current.type !== changed.type) {
    throw new Error(`Can't change the type of "${changed.name}" on ${entity} (${current.type} to ${changed.type}): only optional, null and default can change`)
  }
  if (Boolean(current.autoGenerate) !== Boolean(changed.autoGenerate)) {
    throw new Error(`Can't change whether "${changed.name}" on ${entity} is auto: only optional, null and default can change`)
  }
  const updated = { ...record, definition: record.definition.map(field => field.name === changed.name ? changed : field) }
  const rows = await rowsOf(record)
  const hasDefault = has(changed, 'default')
  const holdsNull = changed.nullable ? [] : rows.filter(row => row.data[changed.name] === null)
  const missing = changed.optional ? [] : rows.filter(row => !has(row.data, changed.name))
  const unfillable = changed.optional ? [] : holdsNull
  if ((missing.length || unfillable.length) && !hasDefault) {
    throw missing.length
      ? new Error(`Can't make "${changed.name}" required on ${entity}: ${missing.length} row(s) have no value for it (give it a default to fill them in)`)
      : new Error(`Can't make "${changed.name}" not null on ${entity}: ${unfillable.length} row(s) hold null (give it a default to fill them in, or make it optional)`)
  }
  await writeRecord(entity, updated)
  if (hasDefault) {
    await setField(entity, updated, [...missing, ...unfillable], changed.name, changed['default'])
  }
  if (changed.optional && holdsNull.length) {
    await setField(entity, updated, holdsNull, changed.name, undefined)
  }
  return updated
}

/**
 * Change one field of an existing record (see ParsedAlter): add, drop or rename it, or change whether it's optional or
 * nullable and its default. The public version runs as one statement (see withWriteSet): a change that fails part way
 * changes nothing. Node only.
 * @param entity
 * @param change
 * @returns The record's new field definitions (as describe gives them).
 */
export const alter = async (entity: string, change: ParsedAlter): Promise<fieldDefinition[]> => {
  requireNode('alter')
  if (entity === '__RECORDS') {
    throw new Error('__RECORDS is reserved for the list of records')
  }
  // The same names the query language allows: a name becomes a key in every row and part of index file paths, so
  // one like `../x` from a direct call must not get that far
  const names = [entity, ...('field' in change ? [change.field?.name] : []), ...('name' in change ? [change.name] : []), ...('to' in change ? [change.to] : [])]
  const invalid = names.findIndex(name => typeof name !== 'string' || !nameMatch.test(name))
  if (invalid !== -1) {
    throw new Error(`Invalid name ${JSON.stringify(names[invalid]) ?? 'undefined'} in alter: names use letters, digits, _ and - only`)
  }
  const record = await retrieveRecord(entity)
  switch (change.action) {
    case 'add':
      return (await addField(entity, record, fieldDefinitionOf(change.field))).definition
    case 'drop':
      return (await dropField(entity, record, change.name)).definition
    case 'rename':
      return (await renameField(entity, record, change.name, change.to)).definition
    case 'modify':
      return (await modifyField(entity, record, fieldDefinitionOf(change.field))).definition
    default:
      throw new Error(`Unknown alter action: ${(change as { action: string }).action}`)
  }
}
