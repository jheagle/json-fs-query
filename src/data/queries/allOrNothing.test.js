import { setUp } from 'test-filesystem'
import { configure } from '../utilities/config'
import { query } from './query'
import { insertEntity } from './insertEntity'
import { withWriteSet } from '../storage'
import fs from 'fs'

const databasePath = 'all-or-nothing-database/'
configure({ databasePath })
setUp.setDefaults(databasePath)

beforeEach(setUp.beforeEach)

afterEach(setUp.afterEach)

const createTables = () => query(`create kinds (_id string, name string, primary key (_id));
  create items (_id string, kind_id string, code string, day string,
    primary key (_id), unique (code), index (day), foreign key (kind_id) references kinds (_id));
  insert kinds values _id = 'k1', name = 'Kind 1'`)

/** Every file of the database with its text, to compare the whole database before and after. */
const snapshot = () => {
  const files = {}
  for (const name of fs.readdirSync(databasePath, { recursive: true }).map(String).sort()) {
    const location = `${databasePath}${name}`
    if (fs.statSync(location).isFile()) {
      files[name] = fs.readFileSync(location, 'utf8')
    }
  }
  return files
}

describe('each statement is all or nothing', () => {
  test('a multi-row insert whose third row is a duplicate writes none of its rows', async () => {
    await createTables()
    const before = snapshot()
    await expect(withWriteSet(() => insertEntity('items', [
      { _id: 'i1', kind_id: 'k1', code: 'a', day: 'mon' },
      { _id: 'i2', kind_id: 'k1', code: 'b', day: 'mon' },
      { _id: 'i3', kind_id: 'k1', code: 'a', day: 'tue' }
    ], {}))).rejects.toThrow('Duplicate value for unique key "code" on items')
    expect(snapshot()).toEqual(before)
  })

  test('a multi-row insert whose row has a missing foreign key writes none of its rows', async () => {
    await createTables()
    const before = snapshot()
    await expect(withWriteSet(() => insertEntity('items', [
      { _id: 'i1', kind_id: 'k1', code: 'a', day: 'mon' },
      { _id: 'i2', kind_id: 'nope', code: 'b', day: 'mon' }
    ], {}))).rejects.toThrow('Foreign key "kind_id" on items references a nonexistent kinds._id = nope')
    expect(snapshot()).toEqual(before)
  })

  test('a multi-row insert that passes writes every row, its record file and each index once', async () => {
    await createTables()
    const writeFile = jest.spyOn(require('fs/promises'), 'writeFile')
    try {
      await withWriteSet(() => insertEntity('items', Array.from({ length: 20 }, (_, row) =>
        ({ _id: `i${row}`, kind_id: 'k1', code: `c${row}`, day: row % 2 ? 'mon' : 'tue' })), {}))
      const writes = writeFile.mock.calls.map(([location]) => String(location).replace(/\.[0-9a-f-]{36}\.tmp$/, ''))
      const count = path => writes.filter(location => location === `${databasePath}${path}`).length
      expect(count('items.json')).toBe(1)
      expect(count('__indexes/items/pk__id.json')).toBe(1)
      expect(count('__indexes/items/unique_code.json')).toBe(1)
      expect(count('__indexes/items/index_day.json')).toBe(1)
      expect(count('__indexes/items/fk_kind_id.json')).toBe(1)
      // The 20 entries, the record file and the 4 indexes above, nothing else
      expect(writes).toHaveLength(20 + 1 + 4)
    } finally {
      writeFile.mockRestore()
    }
    const [[rows]] = [await query('read items')]
    expect(rows).toHaveLength(20)
    expect((await query("read items where day = 'mon'"))[0]).toHaveLength(10)
  })

  test('the queries of one call before a failing one keep their changes', async () => {
    await createTables()
    await expect(query(`insert items values _id = 'i1', kind_id = 'k1', code = 'a', day = 'mon';
      insert items values _id = 'i2', kind_id = 'k1', code = 'a', day = 'mon'`))
      .rejects.toThrow('Duplicate value for unique key "code" on items')
    const [rows] = await query('read items')
    expect(rows.map(row => row._id)).toEqual(['i1'])
  })

  test('a query reads what the queries before it in the same call wrote', async () => {
    await createTables()
    const [, rows, , after] = await query(`insert items values _id = 'i1', kind_id = 'k1', code = 'a', day = 'mon';
      read items where day = 'mon';
      delete items where _id = 'i1';
      read items`)
    expect(rows.map(row => row._id)).toEqual(['i1'])
    expect(after).toEqual([])
  })

  test('an update of several rows that fails on one row changes none of them', async () => {
    await createTables()
    await query(`insert items values _id = 'i1', kind_id = 'k1', code = 'a', day = 'mon';
      insert items values _id = 'i2', kind_id = 'k1', code = 'b', day = 'mon'`)
    const before = snapshot()
    await expect(query("update items set kind_id = 'nope' where day = 'mon'"))
      .rejects.toThrow('Foreign key "kind_id" on items references a nonexistent kinds._id = nope')
    expect(snapshot()).toEqual(before)
  })

  test('a delete blocked by a dependent row changes nothing', async () => {
    await createTables()
    await query("insert items values _id = 'i1', kind_id = 'k1', code = 'a', day = 'mon'")
    const before = snapshot()
    await expect(query("delete kinds where _id = 'k1'")).rejects.toThrow('other records still reference it')
    expect(snapshot()).toEqual(before)
  })

  test('drop removes its record file before its entries and indexes, so a stop part way never lists missing files', async () => {
    await createTables()
    await query("insert items values _id = 'i1', kind_id = 'k1', code = 'a', day = 'mon'")
    const files = require('fs/promises')
    const rm = jest.spyOn(files, 'rm')
    const rename = jest.spyOn(files, 'rename')
    try {
      await query('drop items')
      const steps = [...rm.mock.calls.map(([location], call) => ({ order: rm.mock.invocationCallOrder[call], step: `rm ${location}` })),
        ...rename.mock.calls.map(([, location], call) => ({ order: rename.mock.invocationCallOrder[call], step: `write ${location}` }))]
        .sort((a, b) => a.order - b.order).map(({ step }) => step.replace(databasePath, ''))
      expect(steps).toEqual(['write __RECORDS.json', 'rm items.json', 'rm items', 'rm __indexes/items'])
    } finally {
      rm.mockRestore()
      rename.mockRestore()
    }
    expect(fs.existsSync(`${databasePath}items`)).toBe(false)
  })

  test('drop and create in one call leave a working, empty record', async () => {
    await createTables()
    await query("insert items values _id = 'i1', kind_id = 'k1', code = 'a', day = 'mon'")
    await query(`drop items;
      create items (_id string, kind_id string, code string, day string,
        primary key (_id), unique (code), index (day), foreign key (kind_id) references kinds (_id));
      insert items values _id = 'i9', kind_id = 'k1', code = 'a', day = 'mon'`)
    const [rows] = await query("read items where code = 'a'")
    expect(rows.map(row => row._id)).toEqual(['i9'])
    expect(fs.existsSync(`${databasePath}items/i1.json`)).toBe(false)
  })
})
