import { create } from './create'
import { drop } from './drop'
import { insertEntity } from '../queries/insertEntity'
import { fileExists, setUp } from 'test-filesystem'
import { configure } from '../utilities/config'

const { writeFile, readFile } = require('fs/promises')

const databasePath = 'drop-database/'
configure({ databasePath })
setUp.setDefaults(databasePath)

beforeEach(setUp.beforeEach)

afterEach(setUp.afterEach)

describe('drop', () => {
  test('returns null for the reserved __RECORDS name, without touching anything', async () => {
    expect(await drop('__RECORDS')).toBeNull()
  })

  test('removes every entry file listed on the record', async () => {
    const recordName = 'foo'
    await create(recordName, [], [])
    // insertEntity is not implemented yet, so simulate a real entry directly: write the data file, and record it
    // on the record's own entries list, exactly as a working insertEntity would.
    const entryFile = 'entry1.json'
    await writeFile(`${databasePath}${recordName}/${entryFile}`, JSON.stringify({ _id: 1 }))
    const recordContent = JSON.parse(await readFile(`${databasePath}${recordName}.json`, 'utf8'))
    recordContent.entries = [entryFile]
    await writeFile(`${databasePath}${recordName}.json`, JSON.stringify(recordContent))

    expect(fileExists(`${databasePath}${recordName}/${entryFile}`)).toBeTruthy()
    await drop(recordName)
    expect(fileExists(`${databasePath}${recordName}/${entryFile}`)).toBeFalsy()
  })

  test('deregisters the record from __RECORDS', async () => {
    await create('foo', [], [])
    await create('bar', [], [])
    await drop('foo')
    const registry = JSON.parse(await readFile(`${databasePath}__RECORDS.json`, 'utf8'))
    expect(registry.entries).toEqual(['bar.json'])
  })

  test('removes the record\'s own definition file and data directory', async () => {
    await create('foo', [], [])
    expect(fileExists(`${databasePath}foo.json`)).toBeTruthy()
    expect(fileExists(`${databasePath}foo`)).toBeTruthy()

    await drop('foo')

    expect(fileExists(`${databasePath}foo.json`)).toBeFalsy()
    expect(fileExists(`${databasePath}foo`)).toBeFalsy()
  })

  test('removes the record\'s own index directory', async () => {
    const definition = [
      { name: '_id', type: 'string', optional: false, autoGenerate: true }
    ]
    const keys = [
      { type: 'primary', fields: ['_id'], lookup: 'pk__id.json' }
    ]
    await create('foo', definition, keys)
    await insertEntity('foo', [{}], {})
    expect(fileExists(`${databasePath}__indexes/foo/pk__id.json`)).toBeTruthy()

    await drop('foo')

    expect(fileExists(`${databasePath}__indexes/foo`)).toBeFalsy()
  })

  test('does not throw when the record has no index directory to remove', async () => {
    await create('foo', [], [])
    await expect(drop('foo')).resolves.not.toThrow()
  })
})

describe('drop() refuses names the query language would', () => {
  test('a path outside the database is refused and nothing is removed', async () => {
    // drop('../drop-outside') would resolve to ./drop-outside.json next to the database folder
    await writeFile('drop-outside.json', JSON.stringify({ path: 'drop-outside', entries: [] }))
    try {
      await expect(drop('../drop-outside')).rejects.toThrow(/Invalid name "\.\.\/drop-outside" in drop\(\)/)
      expect(fileExists('drop-outside.json')).toBeTruthy()
    } finally {
      await require('fs/promises').rm('drop-outside.json', { force: true })
    }
  })

  test.each([['a/b'], [''], [undefined], [42]])('refuses %p', async name => {
    await expect(drop(name)).rejects.toThrow(/Invalid name .* in drop\(\)/)
  })
})
