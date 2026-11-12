import { query } from '../queries/query'
import { withReadCache } from '../storage'
import { setUp } from 'test-filesystem'
import { configure } from './config'

const fsPromises = require('fs/promises')
// The real one, taken once: a second spy in one test would otherwise wrap the first and call itself
const readFile = fsPromises.readFile

const databasePath = 'ranged-read-database/'
configure({ databasePath })
setUp.setDefaults(databasePath)

const ids = Array.from({ length: 20 }, (_, n) => `p${n + 1}`)

beforeEach(async () => {
  await setUp.beforeEach()
  await query('create people (_id string, name string, primary key (_id))')
  for (const id of ids) {
    await query(`insert people values _id = '${id}', name = 'Person ${id.slice(1)}'`)
  }
})

afterEach(() => {
  jest.restoreAllMocks()
  return setUp.afterEach()
})

/**
 * Run `text`, counting the entry files it reads (index files and the record's own file don't count).
 * @param text
 * @return {Promise<{reads: number, rows: Array}>}
 */
const entryReads = async text => {
  let reads = 0
  jest.restoreAllMocks()
  jest.spyOn(fsPromises, 'readFile').mockImplementation((location, ...args) => {
    const inside = String(location).replace(databasePath, '')
    if (!inside.startsWith('__indexes/') && inside.includes('/')) {
      reads++
    }
    return readFile(location, ...args)
  })
  const [rows] = await withReadCache(() => query(text))
  jest.restoreAllMocks()
  return { reads, rows }
}

const idsOf = rows => rows.map(row => row._id)

describe('a read that keeps rows by position only reads those rows\' files', () => {
  test.each([
    ['limit 1', 1, ['p1']],
    ['limit 3 offset 5', 3, ['p6', 'p7', 'p8']],
    ['offset 18', 2, ['p19', 'p20']],
    ['limit 5 offset 18', 2, ['p19', 'p20']],
    ['limit 5 offset 30', 0, []],
    ['limit 0', 0, []],
  ])('read people %s', async (clauses, expectedReads, expectedIds) => {
    const { reads, rows } = await entryReads(`read people ${clauses}`)
    expect(idsOf(rows)).toEqual(expectedIds)
    expect(reads).toBe(expectedReads)
  })

  test('the rows are the same ones a full read then a limit would keep', async () => {
    const [all] = await query('read people')
    expect(all).toHaveLength(20)
    expect((await entryReads('read people limit 4 offset 7')).rows).toEqual(all.slice(7, 11))
  })

  test('select still shapes the rows', async () => {
    const { reads, rows } = await entryReads('read people select name limit 2')
    expect(rows).toEqual([{ name: 'Person 1' }, { name: 'Person 2' }])
    expect(reads).toBe(2)
  })

  test('positions follow the record\'s order after a delete', async () => {
    await query("delete people where _id = 'p2'")
    const { reads, rows } = await entryReads('read people limit 2')
    expect(idsOf(rows)).toEqual(['p1', 'p3'])
    expect(reads).toBe(2)
  })
})

describe('a read that filters or reorders first still reads every row', () => {
  test('sort: the first row after sorting can be any row', async () => {
    const { reads, rows } = await entryReads('read people sort name desc limit 1')
    // names sort as text: 'Person 9' is last
    expect(idsOf(rows)).toEqual(['p9'])
    expect(reads).toBe(20)
  })

  test('an unindexed where: the matching row can be anywhere', async () => {
    const { reads, rows } = await entryReads("read people where name = 'Person 17' limit 1")
    expect(idsOf(rows)).toEqual(['p17'])
    expect(reads).toBe(20)
  })

  test('group by: limit counts groups, not rows', async () => {
    const { reads, rows } = await entryReads('read people group by name limit 2')
    expect(rows).toHaveLength(2)
    expect(reads).toBe(20)
  })
})
