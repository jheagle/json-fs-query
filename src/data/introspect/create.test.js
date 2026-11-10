import { create } from './create'
import { fileExists, setUp } from 'test-filesystem'
import { configure } from '../utilities/config'

const databasePath = 'create-database/'
configure({ databasePath })
setUp.setDefaults(databasePath)

beforeEach(setUp.beforeEach)

afterEach(setUp.afterEach)

describe('create', () => {
  test('create a new record', async () => {
    expect.assertions(3)
    const recordName = 'foo'
    const definition = [
      {
        name: '_id',
        type: 'string',
        optional: false,
        autoGenerate: true
      },
      {
        name: 'bar',
        type: 'string',
        optional: true,
        autoGenerate: false
      }
    ]
    const keys = [
      {
        type: 'primary',
        fields: [
          '_id'
        ],
        lookup: 'pk__id.json'
      }
    ]
    const result = await create(recordName, definition, keys)
    expect(result).toEqual({
      path: recordName,
      definition,
      keys,
      entries: []
    })
    expect(fileExists(`${databasePath}${recordName}.json`)).toBeTruthy()
    expect(fileExists(`${databasePath}${recordName}`)).toBeTruthy()
  })

  test('registers the new record in __RECORDS', async () => {
    await create('foo', [], [])
    const { readFile } = require('fs/promises')
    const registry = JSON.parse(await readFile(`${databasePath}__RECORDS.json`, 'utf8'))
    expect(registry.entries).toContain('foo.json')
  })

  test('creates the database directory itself when it does not already exist', async () => {
    const { rm } = require('fs/promises')
    await rm(databasePath, { recursive: true, force: true })
    expect(fileExists(databasePath)).toBeFalsy()

    await create('foo', [], [])

    expect(fileExists(`${databasePath}foo.json`)).toBeTruthy()
  })
  describe('invalid definitions', () => {
    const primary = [{ type: 'primary', fields: ['_id'], lookup: 'pk__id.json' }]

    test('rejects a default that fails its field\'s type check, creating nothing', async () => {
      await expect(create('foo', [
        { name: '_id', type: 'string', autoGenerate: true },
        { name: 'reps', type: 'int', useDefault: true, defaultValue: 'abc' }
      ], primary)).rejects.toThrow('Invalid default for field "reps" of foo: Value "abc" is not a valid int')
      expect(fileExists(`${databasePath}foo.json`)).toBeFalsy()
      expect(fileExists(`${databasePath}foo`)).toBeFalsy()
    })

    test('rejects a null default on a field that is not nullable', async () => {
      await expect(create('foo', [
        { name: 'note', type: 'string', useDefault: true, defaultValue: null }
      ], [])).rejects.toThrow('Invalid default for field "note" of foo: Value "null" is not allowed: the field is not nullable')
    })

    test('accepts a null default on a nullable field', async () => {
      const result = await create('foo', [
        { name: 'note', type: 'string', nullable: true, useDefault: true, defaultValue: null }
      ], [])
      expect(result.definition[0]).toEqual({ name: 'note', type: 'string', optional: false, autoGenerate: false, nullable: true, default: null })
    })

    test('accepts a default of an unrecognized type, as it accepts the type itself', async () => {
      await expect(create('foo', [
        { name: 'when', type: 'date', useDefault: true, defaultValue: 'today' }
      ], [])).resolves.not.toBeNull()
    })

    test('rejects a nullable primary key field', async () => {
      await expect(create('foo', [
        { name: '_id', type: 'string', nullable: true }
      ], primary)).rejects.toThrow('Primary key field "_id" of foo can\'t be nullable')
    })

    test('rejects an optional primary key field (a row without it would be stored as undefined.json), unless it is auto', async () => {
      await expect(create('foo', [
        { name: '_id', type: 'string', optional: true }
      ], primary)).rejects.toThrow('Primary key field "_id" of foo can\'t be optional')
      await expect(create('bar', [
        { name: 'a', type: 'string' },
        { name: 'b', type: 'string', optional: true }
      ], [{ type: 'primary', fields: ['a', 'b'] }])).rejects.toThrow('Primary key field "b" of bar can\'t be optional')
      await expect(create('baz', [
        { name: '_id', type: 'string', optional: true, autoGenerate: true }
      ], primary)).resolves.not.toBeNull()
    })

    describe('invalid keys', () => {
      const definition = [{ name: '_id', type: 'string' }]
      const expectNothingWritten = () => {
        expect(fileExists(`${databasePath}foo.json`)).toBeFalsy()
        expect(fileExists(`${databasePath}foo`)).toBeFalsy()
        const registry = fileExists(`${databasePath}__RECORDS.json`) ? require('fs').readFileSync(`${databasePath}__RECORDS.json`, 'utf8') : ''
        expect(registry).not.toContain('foo.json')
      }

      test('rejects a key with no fields, creating nothing', async () => {
        await expect(create('foo', definition, [{ type: 'primary' }]))
          .rejects.toThrow('The primary key of foo must have at least one field')
        expectNothingWritten()
      })

      test('rejects a key naming a field that is not in the definition, creating nothing', async () => {
        await expect(create('foo', definition, [{ type: 'unique', fields: ['nope'] }]))
          .rejects.toThrow('The unique key of foo names field "nope", which isn\'t in the definition')
        expectNothingWritten()
      })

      test('rejects an unknown key property, creating nothing', async () => {
        await expect(create('foo', definition, [{ type: 'primary', keys: ['_id'] }]))
          .rejects.toThrow('Unknown property "keys" on primary key of foo; must be type, fields, lookup, references')
        expectNothingWritten()
      })
    })
  })
})

describe('create() refuses names the query language would', () => {
  test.each([
    ['a record name with a path in it', ['../outside', []]],
    ['a record name with a slash', ['a/b', []]],
    ['a field name with a path in it', ['things', [{ name: '../x', type: 'string' }]]],
    ['a field name with a space', ['things', [{ name: 'first name', type: 'string' }]]],
    ['a missing field name', ['things', [{ type: 'string' }]]]
  ])('%s', async (_, [recordName, definition]) => {
    await expect(create(recordName, definition, [])).rejects.toThrow(/Invalid name .* in create\(\)/)
    expect(fileExists(`${databasePath}things.json`)).toBeFalsy()
    expect(fileExists('outside.json')).toBeFalsy()
  })

  test('a key whose index file or reference is a path', async () => {
    const definition = [{ name: '_id', type: 'string' }, { name: 'owner', type: 'string' }]
    await expect(create('things', definition, [{ type: 'primary', fields: ['_id'], lookup: '../../pk.json' }]))
      .rejects.toThrow(/Invalid index file "\.\.\/\.\.\/pk\.json" in create\(\)/)
    await expect(create('things', definition, [{ type: 'foreign', fields: ['owner'], references: [{ lookup: '../people.json', fields: ['people._id'] }] }]))
      .rejects.toThrow(/Invalid index file "\.\.\/people\.json" in create\(\)/)
    await expect(create('things', definition, [{ type: 'foreign', fields: ['owner'], references: [{ lookup: 'people.json', fields: ['../people._id'] }] }]))
      .rejects.toThrow(/Invalid name .* in create\(\) of things/)
    expect(fileExists(`${databasePath}things.json`)).toBeFalsy()
  })

  test('ordinary names with digits, _ and - still work', async () => {
    const created = await create('my_things-2', [{ name: 'first_name-2', type: 'string' }], [])
    expect(created.path).toBe('my_things-2')
  })
})
