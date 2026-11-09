import { create } from '../introspect/create'
import { insertEntity } from './insertEntity'
import { updateEntity } from './updateEntity'
import { setUp } from 'test-filesystem'
import { configure } from '../utilities/config'

const { readFile } = require('fs/promises')

const databasePath = 'update-entity-database/'
configure({ databasePath })
setUp.setDefaults(databasePath)

beforeEach(setUp.beforeEach)

afterEach(setUp.afterEach)

const definition = [
  { name: '_id', type: 'string', optional: false, autoGenerate: true },
  { name: 'bar', type: 'string', optional: true, autoGenerate: false },
  { name: 'note', type: 'string', optional: true, autoGenerate: false }
]

const keys = [
  { type: 'primary', fields: ['_id'], lookup: 'pk__id.json' }
]

describe('updateEntity', () => {
  test('does nothing when dataSet has no rows to update', async () => {
    await create('foo', definition, keys)
    const result = await updateEntity('foo', { bar: 'changed' }, { foo: [] })
    expect(result).toEqual({ foo: [] })
  })

  test('throws when the record has no primary key', async () => {
    await create('foo', definition, [])
    await expect(updateEntity('foo', { bar: 'x' }, { foo: [{ _id: '1' }] }))
      .rejects.toThrow('Cannot update "foo" without a primary key')
  })

  test('throws when no entry matches the row being updated', async () => {
    await create('foo', definition, keys)
    await expect(updateEntity('foo', { bar: 'x' }, { foo: [{ _id: 'missing' }] }))
      .rejects.toThrow('Could not find entry for foo where "_id" = missing')
  })

  test('merges the given values onto the existing entry file, leaving other fields intact', async () => {
    await create('foo', definition, keys)
    const inserted = await insertEntity('foo', [{ bar: 'one', note: 'keep me' }], {})
    const row = inserted.foo[0]

    const result = await updateEntity('foo', { bar: 'updated' }, { foo: [row] })

    expect(result.foo).toEqual([{ _id: row._id, bar: 'updated', note: 'keep me' }])
    const onDisk = JSON.parse(await readFile(`${databasePath}foo/${row._id}.json`, 'utf8'))
    expect(onDisk).toEqual({ _id: row._id, bar: 'updated', note: 'keep me' })
  })

  test('finds the right file to update even when a filename does not match the primary key', async () => {
    await create('foo', definition, keys)
    const inserted = await insertEntity('foo', [{ bar: 'one' }], {})
    const row = inserted.foo[0]
    const { rename, writeFile } = require('fs/promises')
    await rename(`${databasePath}foo/${row._id}.json`, `${databasePath}foo/custom-name.json`)
    const recordFile = JSON.parse(await readFile(`${databasePath}foo.json`, 'utf8'))
    recordFile.entries = ['custom-name.json']
    await writeFile(`${databasePath}foo.json`, JSON.stringify(recordFile))

    const result = await updateEntity('foo', { bar: 'moved' }, { foo: [row] })
    expect(result.foo[0].bar).toBe('moved')
    const onDisk = JSON.parse(await readFile(`${databasePath}foo/custom-name.json`, 'utf8'))
    expect(onDisk.bar).toBe('moved')
  })

  test('throws when the update would remove a required field', async () => {
    const definitionRequiringBar = [
      { name: '_id', type: 'string', optional: false, autoGenerate: true },
      { name: 'bar', type: 'string', optional: false, autoGenerate: false }
    ]
    await create('foo', definitionRequiringBar, keys)
    const inserted = await insertEntity('foo', [{ bar: 'one' }], {})
    await expect(updateEntity('foo', { bar: undefined }, { foo: [inserted.foo[0]] }))
      .rejects.toThrow('Missing required field "bar" for foo')
  })

  test('moves a changed unique key value to a new index entry', async () => {
    const uniqueDefinition = [
      { name: '_id', type: 'string', optional: false, autoGenerate: true },
      { name: 'email', type: 'string', optional: false, autoGenerate: false }
    ]
    const uniqueKeys = [
      { type: 'primary', fields: ['_id'], lookup: 'pk__id.json' },
      { type: 'unique', fields: ['email'], lookup: 'unique_email.json' }
    ]
    await create('foo', uniqueDefinition, uniqueKeys)
    const inserted = await insertEntity('foo', [{ email: 'old@example.com' }], {})
    const row = inserted.foo[0]

    await updateEntity('foo', { email: 'new@example.com' }, { foo: [row] })

    const emailIndex = JSON.parse(await readFile(`${databasePath}__indexes/foo/unique_email.json`, 'utf8'))
    expect(emailIndex).toEqual([{ value: 'new@example.com', record: [`${row._id}.json`] }])
  })

  test('rejects an update that collides with another record\'s unique value', async () => {
    const uniqueDefinition = [
      { name: '_id', type: 'string', optional: false, autoGenerate: true },
      { name: 'email', type: 'string', optional: false, autoGenerate: false }
    ]
    const uniqueKeys = [
      { type: 'primary', fields: ['_id'], lookup: 'pk__id.json' },
      { type: 'unique', fields: ['email'], lookup: 'unique_email.json' }
    ]
    await create('foo', uniqueDefinition, uniqueKeys)
    const inserted = await insertEntity('foo', [{ email: 'first@example.com' }, { email: 'second@example.com' }], {})

    await expect(updateEntity('foo', { email: 'second@example.com' }, { foo: [inserted.foo[0]] }))
      .rejects.toThrow('Duplicate value for unique key "email" on foo')
  })

  test('coerces a value to match its field\'s declared type', async () => {
    const definitionWithInt = [
      { name: '_id', type: 'string', optional: false, autoGenerate: true },
      { name: 'reps', type: 'int', optional: false, autoGenerate: false }
    ]
    await create('foo', definitionWithInt, keys)
    const inserted = await insertEntity('foo', [{ reps: 10 }], {})
    const result = await updateEntity('foo', { reps: '12' }, { foo: [inserted.foo[0]] })
    expect(result.foo[0].reps).toBe(12)
  })

  test('rejects a value that does not match its field\'s declared type', async () => {
    const definitionWithInt = [
      { name: '_id', type: 'string', optional: false, autoGenerate: true },
      { name: 'reps', type: 'int', optional: false, autoGenerate: false }
    ]
    await create('foo', definitionWithInt, keys)
    const inserted = await insertEntity('foo', [{ reps: 10 }], {})
    await expect(updateEntity('foo', { reps: 'twelve' }, { foo: [inserted.foo[0]] }))
      .rejects.toThrow('Value "twelve" is not a valid int')
  })

  test('does not re-validate a field the update never touches, even if it is already stored with a mismatched type', async () => {
    await create('foo', definition, keys)
    const inserted = await insertEntity('foo', [{ bar: 'one' }], {})
    const row = inserted.foo[0]
    // Simulate data that predates any type checking - _id is declared type "string" but stored
    // as a real number, exactly like the project's own real fixture data.
    const { writeFile } = require('fs/promises')
    await writeFile(`${databasePath}foo/${row._id}.json`, JSON.stringify({ _id: 1, bar: 'one', note: null }))

    const result = await updateEntity('foo', { bar: 'updated' }, { foo: [{ ...row, _id: 1 }] })
    expect(result.foo[0].bar).toBe('updated')
    expect(result.foo[0]._id).toBe(1)
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

    test('accepts changing a foreign key to a value that exists in the referenced record', async () => {
      await create('exercises', exerciseDefinition, exerciseKeys)
      const exercises = await insertEntity('exercises', [{ name: 'Bench Press' }, { name: 'Squat' }], {})
      await create('workouts', workoutDefinition, workoutKeys)
      const inserted = await insertEntity('workouts', [{ exercise_id: exercises.exercises[0]._id }], {})

      const result = await updateEntity('workouts', { exercise_id: exercises.exercises[1]._id }, { workouts: [inserted.workouts[0]] })
      expect(result.workouts[0].exercise_id).toBe(exercises.exercises[1]._id)
    })

    test('rejects changing a foreign key to a value that does not exist in the referenced record', async () => {
      await create('exercises', exerciseDefinition, exerciseKeys)
      const exercises = await insertEntity('exercises', [{ name: 'Bench Press' }], {})
      await create('workouts', workoutDefinition, workoutKeys)
      const inserted = await insertEntity('workouts', [{ exercise_id: exercises.exercises[0]._id }], {})

      await expect(updateEntity('workouts', { exercise_id: 'does-not-exist' }, { workouts: [inserted.workouts[0]] }))
        .rejects.toThrow('Foreign key "exercise_id" on workouts references a nonexistent exercises._id = does-not-exist')
    })

    test('does not re-check an unchanged foreign key value, even if its referenced record was since removed', async () => {
      await create('exercises', exerciseDefinition, exerciseKeys)
      const exercises = await insertEntity('exercises', [{ name: 'Bench Press' }], {})
      await create('workouts', workoutDefinition, workoutKeys)
      const inserted = await insertEntity('workouts', [{ exercise_id: exercises.exercises[0]._id }], {})

      const { rm } = require('fs/promises')
      await rm(`${databasePath}exercises/${exercises.exercises[0]._id}.json`)

      const result = await updateEntity('workouts', { exercise_id: exercises.exercises[0]._id }, { workouts: [inserted.workouts[0]] })
      expect(result.workouts[0].exercise_id).toBe(exercises.exercises[0]._id)
    })
  })

  test('re-updating a row to its own existing unique value does not falsely collide', async () => {
    const uniqueDefinition = [
      { name: '_id', type: 'string', optional: false, autoGenerate: true },
      { name: 'email', type: 'string', optional: false, autoGenerate: false }
    ]
    const uniqueKeys = [
      { type: 'primary', fields: ['_id'], lookup: 'pk__id.json' },
      { type: 'unique', fields: ['email'], lookup: 'unique_email.json' }
    ]
    await create('foo', uniqueDefinition, uniqueKeys)
    const inserted = await insertEntity('foo', [{ email: 'same@example.com' }], {})
    const row = inserted.foo[0]

    const result = await updateEntity('foo', { email: 'same@example.com' }, { foo: [row] })
    expect(result.foo[0].email).toBe('same@example.com')
  })

  describe('multi-field keys', () => {
    const compositePrimaryDefinition = [
      { name: 'a', type: 'string', optional: false },
      { name: 'b', type: 'string', optional: false },
      { name: 'note', type: 'string', optional: true }
    ]
    const compositePrimaryKeys = [
      { type: 'primary', fields: ['a', 'b'], lookup: 'pk_a_b.json' }
    ]

    test('finds the right row by a composite (multi-field) primary key, leaving the other row untouched', async () => {
      await create('foo', compositePrimaryDefinition, compositePrimaryKeys)
      await insertEntity('foo', [{ a: 'x', b: 'y', note: 'first' }, { a: 'x', b: 'z', note: 'second' }], {})

      const result = await updateEntity('foo', { note: 'updated' }, { foo: [{ a: 'x', b: 'y' }] })
      expect(result.foo).toEqual([{ a: 'x', b: 'y', note: 'updated' }])

      const recordFile = JSON.parse(await readFile(`${databasePath}foo.json`, 'utf8'))
      const entryContents = await Promise.all(
        recordFile.entries.map(fileName => readFile(`${databasePath}foo/${fileName}`, 'utf8').then(JSON.parse))
      )
      expect(entryContents).toContainEqual({ a: 'x', b: 'y', note: 'updated' })
      expect(entryContents).toContainEqual({ a: 'x', b: 'z', note: 'second' })
    })

    test('moves a changed multi-field unique key value to a new composite index entry', async () => {
      const multiUniqueDefinition = [
        { name: '_id', type: 'string', optional: false, autoGenerate: true },
        { name: 'a', type: 'string', optional: true },
        { name: 'b', type: 'string', optional: true }
      ]
      const multiUniqueKeys = [
        { type: 'primary', fields: ['_id'], lookup: 'pk__id.json' },
        { type: 'unique', fields: ['a', 'b'], lookup: 'unique_a_b.json' }
      ]
      await create('foo', multiUniqueDefinition, multiUniqueKeys)
      const inserted = await insertEntity('foo', [{ a: 'x', b: 'y' }], {})
      const row = inserted.foo[0]

      await updateEntity('foo', { b: 'z' }, { foo: [row] })

      const indexFile = JSON.parse(await readFile(`${databasePath}__indexes/foo/unique_a_b.json`, 'utf8'))
      expect(indexFile).toEqual([{ value: JSON.stringify(['x', 'z']), record: [`${row._id}.json`] }])
    })

    test('rejects an update whose new composite value collides with another record', async () => {
      const multiUniqueDefinition = [
        { name: '_id', type: 'string', optional: false, autoGenerate: true },
        { name: 'a', type: 'string', optional: true },
        { name: 'b', type: 'string', optional: true }
      ]
      const multiUniqueKeys = [
        { type: 'primary', fields: ['_id'], lookup: 'pk__id.json' },
        { type: 'unique', fields: ['a', 'b'], lookup: 'unique_a_b.json' }
      ]
      await create('foo', multiUniqueDefinition, multiUniqueKeys)
      const inserted = await insertEntity('foo', [{ a: 'x', b: 'y' }, { a: 'x', b: 'z' }], {})

      await expect(updateEntity('foo', { b: 'z' }, { foo: [inserted.foo[0]] }))
        .rejects.toThrow('Duplicate value for unique key "a, b" on foo')
    })
  })

  describe('referential integrity', () => {
    const exerciseDefinition = [
      { name: '_id', type: 'string', optional: false, autoGenerate: true },
      { name: 'name', type: 'string', optional: true }
    ]
    const exerciseKeys = [
      { type: 'primary', fields: ['_id'], lookup: 'pk__id.json' }
    ]
    const workoutDefinition = [
      { name: '_id', type: 'string', optional: false, autoGenerate: true },
      { name: 'exercise_id', type: 'string', optional: true }
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

    afterEach(() => configure({ enforceForeignKeys: true }))

    test('rejects changing a referenced primary key value while a dependent still points at the old one', async () => {
      await create('exercises', exerciseDefinition, exerciseKeys)
      const exercise = await insertEntity('exercises', [{ name: 'Bench Press' }], {})
      await create('workouts', workoutDefinition, workoutKeys)
      await insertEntity('workouts', [{ exercise_id: exercise.exercises[0]._id }], {})

      await expect(updateEntity('exercises', { _id: 'new-id' }, { exercises: [exercise.exercises[0]] }))
        .rejects.toThrow(`Cannot update "exercises" where "_id" = ${exercise.exercises[0]._id} - other records still reference it`)
    })

    test('allows changing an unreferenced field on a record that has dependents', async () => {
      await create('exercises', exerciseDefinition, exerciseKeys)
      const exercise = await insertEntity('exercises', [{ name: 'Bench Press' }], {})
      await create('workouts', workoutDefinition, workoutKeys)
      await insertEntity('workouts', [{ exercise_id: exercise.exercises[0]._id }], {})

      const result = await updateEntity('exercises', { name: 'Incline Bench Press' }, { exercises: [exercise.exercises[0]] })
      expect(result.exercises[0].name).toBe('Incline Bench Press')
    })

    test('allows changing the primary key once the dependent record is gone', async () => {
      await create('exercises', exerciseDefinition, exerciseKeys)
      const exercise = await insertEntity('exercises', [{ name: 'Bench Press' }], {})
      await create('workouts', workoutDefinition, workoutKeys)
      const workout = await insertEntity('workouts', [{ exercise_id: exercise.exercises[0]._id }], {})
      const { deleteEntity } = require('./deleteEntity')
      await deleteEntity('workouts', { workouts: [workout.workouts[0]] })

      const result = await updateEntity('exercises', { _id: 'new-id' }, { exercises: [exercise.exercises[0]] })
      expect(result.exercises[0]._id).toBe('new-id')
    })

    test('allows changing the primary key anyway when enforceForeignKeys is turned off', async () => {
      await create('exercises', exerciseDefinition, exerciseKeys)
      const exercise = await insertEntity('exercises', [{ name: 'Bench Press' }], {})
      await create('workouts', workoutDefinition, workoutKeys)
      await insertEntity('workouts', [{ exercise_id: exercise.exercises[0]._id }], {})

      configure({ enforceForeignKeys: false })
      const result = await updateEntity('exercises', { _id: 'new-id' }, { exercises: [exercise.exercises[0]] })
      expect(result.exercises[0]._id).toBe('new-id')
    })
  })

  describe('null values', () => {
    const nullableDefinition = [
      { name: '_id', type: 'string', optional: false, autoGenerate: true },
      { name: 'note', type: 'string', optional: true, nullable: true },
      { name: 'bar', type: 'string', optional: true }
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

    test('setting a foreign key to null is not checked against the referenced record', async () => {
      await create('parents', parentDefinition, keys)
      const parents = await insertEntity('parents', [{}], {})
      await create('children', childDefinition, childKeys)
      const inserted = await insertEntity('children', [{ parent_id: parents.parents[0]._id }], {})
      const result = await updateEntity('children', { parent_id: null }, { children: [inserted.children[0]] })
      expect(result.children[0].parent_id).toBeNull()
    })

    test('setting a nullable unique field to null does not collide with another null', async () => {
      await create('parents', parentDefinition, keys)
      await create('children', childDefinition, childKeys)
      const inserted = await insertEntity('children', [{ code: null }, { code: 'a' }], {})
      const result = await updateEntity('children', { code: null }, { children: [inserted.children[1]] })
      expect(result.children[0].code).toBeNull()
    })

    test('sets a nullable field to a real null', async () => {
      await create('foo', nullableDefinition, keys)
      const inserted = await insertEntity('foo', [{ note: 'x' }], {})
      const id = inserted.foo[0]._id
      const result = await updateEntity('foo', { note: null }, { foo: [inserted.foo[0]] })
      expect(result.foo[0].note).toBeNull()
      const entryFile = JSON.parse(await readFile(`${databasePath}foo/${id}.json`, 'utf8'))
      expect(entryFile).toHaveProperty('note', null)
    })

    test('null removes an optional field that is not nullable from the row (the only way to clear one)', async () => {
      await create('foo', nullableDefinition, keys)
      const inserted = await insertEntity('foo', [{ bar: 'x' }], {})
      const id = inserted.foo[0]._id
      const result = await updateEntity('foo', { bar: null }, { foo: [inserted.foo[0]] })
      expect(result.foo[0]).not.toHaveProperty('bar')
      const entryFile = JSON.parse(await readFile(`${databasePath}foo/${id}.json`, 'utf8'))
      expect(entryFile).not.toHaveProperty('bar')
    })

    test('rejects null for a required field that is not nullable', async () => {
      await create('foo', [...nullableDefinition, { name: 'sets', type: 'int', optional: false }], keys)
      const inserted = await insertEntity('foo', [{ sets: 3 }], {})
      await expect(updateEntity('foo', { sets: null }, { foo: [inserted.foo[0]] }))
        .rejects.toThrow('Value "null" is not allowed: the field is not nullable')
    })
  })

  describe('all or nothing: every row is checked before any is written', () => {
    const uniqueDefinition = [
      { name: '_id', type: 'string', optional: false, autoGenerate: true },
      { name: 'code', type: 'string', optional: true, nullable: true },
      { name: 'parent_id', type: 'string', optional: true }
    ]
    const uniqueKeys = [
      { type: 'primary', fields: ['_id'], lookup: 'pk__id.json' },
      { type: 'unique', fields: ['code'], lookup: 'unique_code.json' },
      { type: 'foreign', fields: ['parent_id'], lookup: 'fk_parent_id.json', references: [{ fields: ['parents._id'], lookup: 'parents.json' }] }
    ]
    const setUpRows = async () => {
      await create('parents', [{ name: '_id', type: 'string', optional: false, autoGenerate: true }], keys)
      await create('foo', uniqueDefinition, uniqueKeys)
      return (await insertEntity('foo', [{ code: 'a' }, { code: 'b' }, { code: 'c' }], {})).foo
    }
    const stored = async rows => Promise.all(rows.map(row => readFile(`${databasePath}foo/${row._id}.json`, 'utf8').then(JSON.parse)))
    const index = async () => JSON.parse(await readFile(`${databasePath}__indexes/foo/unique_code.json`, 'utf8'))

    test('two rows given the same unique value: rejected, and neither row changes', async () => {
      const rows = await setUpRows()
      const indexBefore = await index()
      await expect(updateEntity('foo', { code: 'x' }, { foo: rows.slice(0, 2) }))
        .rejects.toThrow('Duplicate value for unique key "code" on foo')
      expect((await stored(rows)).map(row => row.code)).toEqual(['a', 'b', 'c'])
      expect(await index()).toEqual(indexBefore)
    })

    test('a row that fails a check after an earlier row passed: the earlier row is not written', async () => {
      await create('nodes', [{ name: '_id', type: 'string' }, { name: 'name', type: 'string', optional: true }], keys)
      await create('refs', [{ name: '_id', type: 'string', autoGenerate: true }, { name: 'node_id', type: 'string' }], [
        ...keys,
        { type: 'foreign', fields: ['node_id'], lookup: 'fk_node_id.json', references: [{ fields: ['nodes._id'], lookup: 'nodes.json' }] }
      ])
      const nodes = (await insertEntity('nodes', [{ _id: 'n1', name: 'one' }, { _id: 'n2', name: 'two' }], {})).nodes
      await insertEntity('refs', [{ node_id: 'n2' }], {})
      // n1 is free to change its key; n2 is still referenced, so the update is refused at the second row
      await expect(updateEntity('nodes', { _id: 'n9' }, { nodes }))
        .rejects.toThrow('Cannot update "nodes" where "_id" = n2 - other records still reference it')
      expect(JSON.parse(await readFile(`${databasePath}nodes/n1.json`, 'utf8'))).toEqual({ _id: 'n1', name: 'one' })
      const pkIndex = JSON.parse(await readFile(`${databasePath}__indexes/nodes/pk__id.json`, 'utf8'))
      expect(pkIndex.map(entry => entry.value)).toEqual(['n1', 'n2'])
    })

    test('a foreign key that does not exist: no row changes, and a real one then applies to every row', async () => {
      const rows = await setUpRows()
      const parents = await insertEntity('parents', [{}], {})
      const parentId = parents.parents[0]._id
      await expect(updateEntity('foo', { parent_id: 'nope' }, { foo: rows }))
        .rejects.toThrow('references a nonexistent parents._id = nope')
      expect((await stored(rows)).map(row => row.parent_id)).toEqual([undefined, undefined, undefined])
      const result = await updateEntity('foo', { parent_id: parentId }, { foo: rows })
      expect(result.foo.map(row => row.parent_id)).toEqual([parentId, parentId, parentId])
    })

    test('a passing update of several rows still writes them all and moves their index entries', async () => {
      const rows = await setUpRows()
      const result = await updateEntity('foo', { code: null }, { foo: rows.slice(0, 2) })
      expect(result.foo).toHaveLength(2)
      expect((await stored(rows)).map(row => row.code)).toEqual([null, null, 'c'])
      expect((await index()).map(entry => entry.value).sort()).toEqual(['c', null].sort())
    })

    test('the same row given twice is updated once, not reported as a duplicate of itself', async () => {
      const rows = await setUpRows()
      const result = await updateEntity('foo', { code: 'x' }, { foo: [rows[0], rows[0]] })
      expect(result.foo).toHaveLength(1)
      expect((await stored(rows)).map(row => row.code)).toEqual(['x', 'b', 'c'])
    })
  })
})
