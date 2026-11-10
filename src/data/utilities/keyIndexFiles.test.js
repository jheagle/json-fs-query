import { query } from '../queries/query'
import { withReadCache } from '../storage'
import { setUp } from 'test-filesystem'
import { configure } from './config'
import fs from 'fs'

const fsPromises = require('fs/promises')
// The real one, taken once: a second spy in one test would otherwise wrap the first and call itself
const readFile = fsPromises.readFile

const databasePath = 'key-index-files-database/'
configure({ databasePath })
setUp.setDefaults(databasePath)

beforeEach(async () => {
  await setUp.beforeEach()
  await query(`create people (_id string, name string, primary key (_id));
    create pairs (a string, b int, label string, primary key (a, b))`)
  for (let n = 1; n <= 20; n++) {
    await query(`insert people values _id = 'p${n}', name = 'Person ${n}'`)
  }
  await query(`insert pairs values a = 'x', b = 1, label = 'one';
    insert pairs values a = 'x', b = 2, label = 'two';
    insert pairs values a = 'y', b = 1, label = 'three'`)
})

afterEach(() => {
  jest.restoreAllMocks()
  return setUp.afterEach()
})

/**
 * Run `text` alone (its rows already found by the where clause's index), counting the entry files it reads.
 * @param text
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
  await withReadCache(() => query(text))
  return reads
}

const indexPath = record => {
  const dir = `${databasePath}__indexes/${record}`
  return `${dir}/${fs.readdirSync(dir).find(file => file.startsWith('pk'))}`
}

const names = async () => (await query('read people'))[0].map(row => row.name)

describe('finding a row\'s file through the primary key index', () => {
  test('update and delete of one row by key read only that row, not all 20', async () => {
    expect(await entryReads("update people set name = 'Changed' where _id = 'p7'")).toBe(1)
    expect(await entryReads("delete people where _id = 'p7'")).toBe(1)
    expect(await names()).toHaveLength(19)
    expect(await names()).not.toContain('Changed')
  })

  test('deleting several rows by key reads only those', async () => {
    expect(await entryReads("delete people where _id in ['p2', 'p4', 'p6']")).toBe(3)
    expect((await query('read people'))[0].map(row => row._id)).toEqual(
      Array.from({ length: 20 }, (_, n) => `p${n + 1}`).filter(id => !['p2', 'p4', 'p6'].includes(id)))
  })

  test('a composite primary key too', async () => {
    await query("update pairs set label = 'changed' where a = 'x' and b = 2")
    await query("delete pairs where a = 'y' and b = 1")
    expect((await query('read pairs'))[0]).toEqual([{ a: 'x', b: 1, label: 'one' }, { a: 'x', b: 2, label: 'changed' }])
  })

  test('an index that misses a row still finds it, by looking at every row', async () => {
    // p5 left out of the primary key index, as a hand edit might
    fs.writeFileSync(indexPath('people'), JSON.stringify(JSON.parse(fs.readFileSync(indexPath('people'), 'utf8')).filter(entry => entry.value !== 'p5')))
    // the index leads nowhere for p5, so only the scan can find its file (without it: "Could not find entry")
    await query("update people set name = 'Five' where name = 'Person 5'")
    await query("delete people where name = 'Five'")
    expect(await names()).toHaveLength(19)
    expect(await names()).not.toContain('Person 5')
  })

  test('an index that points at the wrong file is checked against the file, and the right one found', async () => {
    // p3's entry pointing at p4's file
    fs.writeFileSync(indexPath('people'), JSON.stringify(JSON.parse(fs.readFileSync(indexPath('people'), 'utf8'))
      .map(entry => entry.value === 'p3' ? { ...entry, record: entry.record.map(() => 'p4.json') } : entry)))
    await query("update people set name = 'Three' where name = 'Person 3'")
    expect(await names()).toContain('Three')
    expect(await names()).toContain('Person 4')
    await query("delete people where name = 'Three'")
    expect(await names()).not.toContain('Three')
    expect(await names()).toContain('Person 4')
  })

  test('an unreadable index means looking at every row, with the same result', async () => {
    fs.writeFileSync(indexPath('people'), '{ not json')
    await query("update people set name = 'Nine' where name = 'Person 9'")
    expect(await names()).toContain('Nine')
  })
})
