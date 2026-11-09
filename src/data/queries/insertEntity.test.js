import { create } from '../introspect/create'
import { insertEntity } from './insertEntity'
import { fileExists, setUp } from 'test-filesystem'
import { configure } from '../utilities/config'

const { readFile, rm } = require('fs/promises')

const databasePath = 'insert-entity-database/'
configure({ databasePath })
setUp.setDefaults(databasePath)

beforeEach(setUp.beforeEach)

afterEach(setUp.afterEach)

const definition = [
  { name: '_id', type: 'string', optional: false, autoGenerate: true },
  { name: 'bar', type: 'string', optional: true, autoGenerate: false }
]

const keys = [
  { type: 'primary', fields: ['_id'], lookup: 'pk__id.json' }
]

describe('insertEntity', () => {
  test('inserts a new entity, generating its primary key', async () => {
    await create('foo', definition, keys)
    const dataSet = await insertEntity('foo', [{ bar: 'baz' }], {})

    expect(dataSet.foo).toHaveLength(1)
    const inserted = dataSet.foo[0]
    expect(typeof inserted._id).toBe('string')
    expect(inserted.bar).toBe('baz')

    expect(fileExists(`${databasePath}foo/${inserted._id}.json`)).toBeTruthy()
    const entryFile = JSON.parse(await readFile(`${databasePath}foo/${inserted._id}.json`, 'utf8'))
    expect(entryFile).toEqual(inserted)

    const recordFile = JSON.parse(await readFile(`${databasePath}foo.json`, 'utf8'))
    expect(recordFile.entries).toEqual([`${inserted._id}.json`])

    const indexFile = JSON.parse(await readFile(`${databasePath}__indexes/foo/pk__id.json`, 'utf8'))
    expect(indexFile).toEqual([{ value: inserted._id, record: [`${inserted._id}.json`] }])
  })

  test('creates the record\'s folder when it is missing, as in a fresh git clone of an empty database', async () => {
    await create('foo', definition, keys)
    // git doesn't keep empty folders: a committed database with no entries comes back without foo/
    await rm(`${databasePath}foo`, { recursive: true })
    expect(await fileExists(`${databasePath}foo`)).toBe(false)

    const dataSet = await insertEntity('foo', [{ bar: 'baz' }], {})
    const fileName = `${dataSet.foo[0]._id}.json`
    expect(JSON.parse(await readFile(`${databasePath}foo/${fileName}`, 'utf8'))).toEqual(dataSet.foo[0])
  })

  test('inserts multiple entities from one call', async () => {
    await create('foo', definition, keys)
    const dataSet = await insertEntity('foo', [{ bar: 'one' }, { bar: 'two' }], {})

    expect(dataSet.foo).toHaveLength(2)
    const recordFile = JSON.parse(await readFile(`${databasePath}foo.json`, 'utf8'))
    expect(recordFile.entries).toHaveLength(2)
  })

  test('appends onto an existing dataSet entry instead of replacing it', async () => {
    await create('foo', definition, keys)
    const dataSet = await insertEntity('foo', [{ bar: 'one' }], { foo: [{ bar: 'existing' }] })
    expect(dataSet.foo).toHaveLength(2)
    expect(dataSet.foo[0]).toEqual({ bar: 'existing' })
  })

  test('applies a field default when no value is given', async () => {
    const definitionWithDefault = [
      { name: '_id', type: 'string', optional: false, autoGenerate: true },
      { name: 'status', type: 'string', optional: false, useDefault: true, defaultValue: 'pending' }
    ]
    await create('foo', definitionWithDefault, keys)
    const dataSet = await insertEntity('foo', [{}], {})
    expect(dataSet.foo[0].status).toBe('pending')
  })

  test('throws when a required field has no value, default, or autoGenerate', async () => {
    const definitionRequiringBar = [
      { name: '_id', type: 'string', optional: false, autoGenerate: true },
      { name: 'bar', type: 'string', optional: false, autoGenerate: false }
    ]
    await create('foo', definitionRequiringBar, keys)
    await expect(insertEntity('foo', [{}], {})).rejects.toThrow('Missing required field "bar" for foo')
  })

  test('throws on a duplicate primary key value instead of writing the file', async () => {
    const definitionExplicitId = [
      { name: '_id', type: 'string', optional: false, autoGenerate: false },
      { name: 'bar', type: 'string', optional: true }
    ]
    await create('foo', definitionExplicitId, keys)
    await insertEntity('foo', [{ _id: 'dupe', bar: 'first' }], {})
    await expect(insertEntity('foo', [{ _id: 'dupe', bar: 'second' }], {}))
      .rejects.toThrow('Duplicate value for primary key "_id" on foo')
  })

  test('coerces a value to match its field\'s declared type', async () => {
    const definitionWithInt = [
      { name: '_id', type: 'string', optional: false, autoGenerate: true },
      { name: 'reps', type: 'int', optional: false, autoGenerate: false }
    ]
    await create('foo', definitionWithInt, keys)
    const dataSet = await insertEntity('foo', [{ reps: '10' }], {})
    expect(dataSet.foo[0].reps).toBe(10)
  })

  test('rejects a value that does not match its field\'s declared type', async () => {
    const definitionWithInt = [
      { name: '_id', type: 'string', optional: false, autoGenerate: true },
      { name: 'reps', type: 'int', optional: false, autoGenerate: false }
    ]
    await create('foo', definitionWithInt, keys)
    await expect(insertEntity('foo', [{ reps: 'ten' }], {}))
      .rejects.toThrow('Value "ten" is not a valid int')
  })

  describe('multi-field keys', () => {
    const multiDefinition = [
      { name: '_id', type: 'string', optional: false, autoGenerate: true },
      { name: 'a', type: 'string', optional: true },
      { name: 'b', type: 'string', optional: true }
    ]
    const multiUniqueKeys = [
      { type: 'primary', fields: ['_id'], lookup: 'pk__id.json' },
      { type: 'unique', fields: ['a', 'b'], lookup: 'unique_a_b.json' }
    ]

    test('accepts a row whose composite value is new, even if individual fields repeat', async () => {
      await create('foo', multiDefinition, multiUniqueKeys)
      await insertEntity('foo', [{ a: 'x', b: 'y' }], {})
      const result = await insertEntity('foo', [{ a: 'x', b: 'z' }], {})
      expect(result.foo[0].a).toBe('x')
      expect(result.foo[0].b).toBe('z')
    })

    test('rejects a row whose composite value duplicates an existing one', async () => {
      await create('foo', multiDefinition, multiUniqueKeys)
      await insertEntity('foo', [{ a: 'x', b: 'y' }], {})
      await expect(insertEntity('foo', [{ a: 'x', b: 'y' }], {}))
        .rejects.toThrow('Duplicate value for unique key "a, b" on foo')
    })

    test('indexes a multi-field key as a composite value', async () => {
      await create('foo', multiDefinition, multiUniqueKeys)
      const inserted = await insertEntity('foo', [{ a: 'x', b: 'y' }], {})
      const indexFile = JSON.parse(await readFile(`${databasePath}__indexes/foo/unique_a_b.json`, 'utf8'))
      expect(indexFile).toEqual([{ value: JSON.stringify(['x', 'y']), record: [`${inserted.foo[0]._id}.json`] }])
    })

    test('a genuinely composite (multi-field) primary key works, with a UUID-based filename', async () => {
      const compositePrimaryKeys = [
        { type: 'primary', fields: ['a', 'b'], lookup: 'pk_a_b.json' }
      ]
      await create('foo', multiDefinition, compositePrimaryKeys)
      const inserted = await insertEntity('foo', [{ a: 'x', b: 'y' }], {})
      expect(inserted.foo[0].a).toBe('x')
      expect(inserted.foo[0].b).toBe('y')
      const recordFile = JSON.parse(await readFile(`${databasePath}foo.json`, 'utf8'))
      expect(recordFile.entries).toHaveLength(1)
      // No single-field primary key exists, so the filename falls back to a generated UUID -
      // never derived from the composite key's own field values.
      expect(recordFile.entries[0]).not.toContain('x')
      expect(recordFile.entries[0]).not.toContain('y')
    })
  })

  describe('foreign keys', () => {
    const exerciseDefinition = [
      { name: '_id', type: 'string', optional: false, autoGenerate: true },
      { name: 'name', type: 'string', optional: true, autoGenerate: false }
    ]
    const exerciseKeys = [
      { type: 'primary', fields: ['_id'], lookup: 'pk__id.json' }
    ]
    const workoutDefinition = [
      { name: '_id', type: 'string', optional: false, autoGenerate: true },
      { name: 'exercise_id', type: 'string', optional: true, autoGenerate: false }
    ]
    const workoutKeys = [
      { type: 'primary', fields: ['_id'], lookup: 'pk__id.json' },
      {
        type: 'foreign',
        fields: ['exercise_id'],
        lookup: 'fk_exercise_id.json',
        references: [{ fields: ['exercises._id'], lookup: 'exercises.json' }]
      }
    ]

    test('accepts a foreign key value that exists in the referenced record', async () => {
      await create('exercises', exerciseDefinition, exerciseKeys)
      const exercise = await insertEntity('exercises', [{ name: 'Bench Press' }], {})
      await create('workouts', workoutDefinition, workoutKeys)
      const result = await insertEntity('workouts', [{ exercise_id: exercise.exercises[0]._id }], {})
      expect(result.workouts[0].exercise_id).toBe(exercise.exercises[0]._id)
    })

    test('rejects a foreign key value that does not exist in the referenced record', async () => {
      await create('exercises', exerciseDefinition, exerciseKeys)
      await create('workouts', workoutDefinition, workoutKeys)
      await expect(insertEntity('workouts', [{ exercise_id: 'does-not-exist' }], {}))
        .rejects.toThrow('Foreign key "exercise_id" on workouts references a nonexistent exercises._id = does-not-exist')
    })

    test('skips the check when an optional foreign key field is omitted', async () => {
      await create('exercises', exerciseDefinition, exerciseKeys)
      await create('workouts', workoutDefinition, workoutKeys)
      const result = await insertEntity('workouts', [{}], {})
      expect(result.workouts[0].exercise_id).toBeUndefined()
    })
  })

  describe('null values', () => {
    const nullableDefinition = [
      { name: '_id', type: 'string', optional: false, autoGenerate: true },
      { name: 'note', type: 'string', optional: true, nullable: true },
      { name: 'reps', type: 'int', optional: true }
    ]

    const parentDefinition = [{ name: '_id', type: 'string', optional: false, autoGenerate: true }]
    const childDefinition = [
      { name: '_id', type: 'string', optional: false, autoGenerate: true },
      { name: 'parent_id', type: 'string', optional: true, nullable: true },
      { name: 'code', type: 'string', optional: true, nullable: true }
    ]
    const childKeys = [
      { type: 'primary', fields: ['_id'], lookup: 'pk__id.json' },
      { type: 'unique', fields: ['code'], lookup: 'unique_code.json' },
      { type: 'foreign', fields: ['parent_id'], lookup: 'fk_parent_id.json', references: [{ fields: ['parents._id'], lookup: 'parents.json' }] }
    ]

    test('a null foreign key references nothing, so it is not checked', async () => {
      await create('parents', parentDefinition, keys)
      await create('children', childDefinition, childKeys)
      const result = await insertEntity('children', [{ parent_id: null }], {})
      expect(result.children[0].parent_id).toBeNull()
    })

    test('a nullable unique field can hold null in more than one row, as in SQL', async () => {
      await create('parents', parentDefinition, keys)
      await create('children', childDefinition, childKeys)
      await insertEntity('children', [{ code: null }, { code: null }], {})
      await insertEntity('children', [{ code: 'a' }], {})
      await expect(insertEntity('children', [{ code: 'a' }], {}))
        .rejects.toThrow('Duplicate value for unique key "code" on children')
    })

    test('a composite unique key with a null in it is never a duplicate', async () => {
      await create('foo', [
        { name: '_id', type: 'string', optional: false, autoGenerate: true },
        { name: 'a', type: 'string' },
        { name: 'b', type: 'string', nullable: true }
      ], [...keys, { type: 'unique', fields: ['a', 'b'], lookup: 'unique_a_b.json' }])
      await insertEntity('foo', [{ a: 'x', b: null }, { a: 'x', b: null }], {})
      await insertEntity('foo', [{ a: 'x', b: 'y' }], {})
      await expect(insertEntity('foo', [{ a: 'x', b: 'y' }], {}))
        .rejects.toThrow('Duplicate value for unique key "a, b" on foo')
    })

    test('an explicit null is not replaced by the default, so a field that is not nullable rejects it', async () => {
      await create('foo', [
        { name: '_id', type: 'string', optional: false, autoGenerate: true },
        { name: 'status', type: 'string', useDefault: true, defaultValue: 'pending' }
      ], keys)
      await expect(insertEntity('foo', [{ status: null }], {}))
        .rejects.toThrow('Value "null" is not allowed: the field is not nullable')
    })

    test('stores a real null in a nullable field', async () => {
      await create('foo', nullableDefinition, keys)
      const dataSet = await insertEntity('foo', [{ note: null }], {})
      const inserted = dataSet.foo[0]
      expect(inserted.note).toBeNull()
      const entryFile = JSON.parse(await readFile(`${databasePath}foo/${inserted._id}.json`, 'utf8'))
      expect(entryFile).toHaveProperty('note', null)
    })

    test('a null in an optional field that is not nullable is left out, never stored as null, 0 or "null"', async () => {
      await create('foo', nullableDefinition, keys)
      const dataSet = await insertEntity('foo', [{ reps: null }], {})
      const inserted = dataSet.foo[0]
      expect(inserted).not.toHaveProperty('reps')
      const entryFile = JSON.parse(await readFile(`${databasePath}foo/${inserted._id}.json`, 'utf8'))
      expect(entryFile).not.toHaveProperty('reps')
    })

    test('rejects null in a required field that is not nullable', async () => {
      await create('foo', [...nullableDefinition, { name: 'sets', type: 'int', optional: false }], keys)
      await expect(insertEntity('foo', [{ sets: null }], {}))
        .rejects.toThrow('Value "null" is not allowed: the field is not nullable')
      const recordFile = JSON.parse(await readFile(`${databasePath}foo.json`, 'utf8'))
      expect(recordFile.entries).toEqual([])
    })

    test('applies a null default to a nullable field', async () => {
      await create('foo', [
        { name: '_id', type: 'string', optional: false, autoGenerate: true },
        { name: 'note', type: 'string', nullable: true, useDefault: true, defaultValue: null }
      ], keys)
      const dataSet = await insertEntity('foo', [{}], {})
      expect(dataSet.foo[0]).toHaveProperty('note', null)
    })

    test('a nullable field that is not optional still has to be given', async () => {
      await create('foo', [
        { name: '_id', type: 'string', optional: false, autoGenerate: true },
        { name: 'note', type: 'string', nullable: true }
      ], keys)
      await expect(insertEntity('foo', [{}], {}))
        .rejects.toThrow('Missing required field "note" for foo')
    })
  })
})
