import { setUp } from 'test-filesystem'
import { configure } from './config'
import { IndexBuffer } from './indexBuffer'
import { updateIndex } from './updateIndex'
import { indexHas } from './indexHas'
import { readJson, writeJson, makeDirectory } from '../storage'

const databasePath = 'index-buffer-database/'
configure({ databasePath })
setUp.setDefaults(databasePath)

beforeEach(setUp.beforeEach)

afterEach(setUp.afterEach)

/** Add every [value, file] to an IndexBuffer and, one at a time, through updateIndex; resolve to both results. */
const both = async (type, start, additions) => {
  const key = { type: 'index', fields: ['f'], lookup: 'index_f.json' }
  await makeDirectory('__indexes/t')
  await writeJson('__indexes/t/index_f.json', start)
  const buffer = new IndexBuffer(JSON.parse(JSON.stringify(start)), type)
  for (const [value, file] of additions) {
    buffer.add(value, file)
    await updateIndex('t', key, value, file, type)
  }
  return { buffered: JSON.parse(JSON.stringify(buffer.entries)), written: await readJson('__indexes/t/index_f.json') }
}

describe('IndexBuffer', () => {
  test.each([
    ['int values given as numbers and strings', 'int', [[1, 'a.json'], ['1', 'b.json'], [2, 'c.json'], [1, 'a.json']]],
    ['string values given as strings and numbers', 'string', [['7', 'a.json'], [7, 'b.json'], ['x', 'c.json']]],
    ['booleans given as strings', 'boolean', [[true, 'a.json'], ['true', 'b.json'], ['false', 'c.json']]],
    ['null and missing values', 'string', [[null, 'a.json'], [undefined, 'b.json'], [null, 'c.json'], ['v', 'd.json']]],
    ['composite keys (no type, compared with ==)', undefined, [['["a",1]', 'a.json'], ['["a",1]', 'b.json'], ['["b",1]', 'c.json']]],
    ['one value shared by many files', 'string', Array.from({ length: 50 }, (_, position) => ['k0', `${position}.json`])]
  ])('adds values exactly as updateIndex does: %s', async (_, type, additions) => {
    const { buffered, written } = await both(type, [], additions)
    expect(buffered).toEqual(written)
  })

  test('adds to an index that already has entries exactly as updateIndex does', async () => {
    const start = [{ value: 'a', record: ['1.json'] }, { value: 'b', record: ['2.json', '3.json'] }]
    const { buffered, written } = await both('string', start, [['b', '4.json'], ['c', '5.json'], ['a', '1.json'], ['b', '2.json']])
    expect(buffered).toEqual(written)
  })

  test('has() answers as indexHas does, never for null or a missing value', async () => {
    const entries = [{ value: 'a', record: ['1.json'] }, { value: 'empty', record: [] }, { record: ['2.json'] }, { value: null, record: ['3.json'] }]
    await writeJson('t.json', { path: 't', definition: [{ name: 'f', type: 'string' }], keys: [{ type: 'index', fields: ['f'], lookup: 'index_f.json' }], entries: ['1.json'] })
    await makeDirectory('__indexes/t')
    await writeJson('__indexes/t/index_f.json', entries)
    const buffer = new IndexBuffer(entries, 'string')
    for (const value of ['a', 'empty', 'missing', 7]) {
      expect(buffer.has(value)).toBe(await indexHas('t', 'f', value))
    }
    expect(buffer.has(null)).toBe(false)
    expect(buffer.has(undefined)).toBe(false)
  })

  test('has() finds a value listed by a later entry when the first entry for it lists no file', () => {
    const buffer = new IndexBuffer([{ value: 'a', record: [] }, { value: 'a', record: ['1.json'] }], 'string')
    expect(buffer.has('a')).toBe(true)
  })
})
