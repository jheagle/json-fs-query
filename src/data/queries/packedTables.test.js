import { setUp } from 'test-filesystem'
import { configure } from '../utilities/config'
import { query } from './query'
import { checkPacked, formatDatabase, packDatabase } from '../introspect'
import fs from 'fs'

const databasePath = 'packed-tables-database/'
configure({ databasePath })
setUp.setDefaults(databasePath)

beforeEach(setUp.beforeEach)

afterEach(async () => {
  configure({ packedReads: undefined, format: 'compact' })
  await setUp.afterEach()
})

const fill = async () => {
  await query(`create parents (_id string, name string, primary key (_id));
    create items (_id string, parent_id string, day string, value int,
      primary key (_id), index (day), foreign key (parent_id) references parents (_id))`)
  for (let parent = 0; parent < 4; parent++) {
    await query(`insert parents values _id = 'p${parent}', name = 'Parent ${parent}'`)
  }
  // 40 rows, 20 a day: more than one round of reads (readConcurrency 16), which is when a packed file is used
  for (let item = 0; item < 40; item++) {
    await query(`insert items values _id = 'i${(item * 7) % 40}', parent_id = 'p${item % 4}', day = 'd${item % 2}', value = ${item}`)
  }
}

const reads = [
  'read items',
  "read items where day = 'd1'",
  "read items where day = 'd1' and value > 5 sort value desc",
  "read items where _id = 'i7'",
  'read items.parents on items.parent_id = parents._id',
  "read items.parents on items.parent_id = parents._id where day = 'd0'",
  "read parents.items on parents._id = items.parent_id where parents.name = 'Parent 2'",
  'read parents.items on parents._id = items.parent_id'
].join(';\n')

const packed = name => JSON.parse(fs.readFileSync(`${databasePath}__packed/${name}.json`, 'utf8'))
const hasPack = name => fs.existsSync(`${databasePath}__packed/${name}.json`)

/** Change a packed file's rows by hand, so a read that uses it can be told apart from one that reads entry files. */
const markPackedRows = name => {
  const content = packed(name)
  content.rows = content.rows.map(row => ({ ...row, fromPack: true }))
  fs.writeFileSync(`${databasePath}__packed/${name}.json`, JSON.stringify(content))
}

/** The entry files of `record` a call reads from disk. */
const entryReads = async (record, task) => {
  const readFile = jest.spyOn(require('fs/promises'), 'readFile')
  try {
    await task()
    return readFile.mock.calls.map(([location]) => String(location))
      .filter(location => location.startsWith(`${databasePath}${record}/`))
  } finally {
    readFile.mockRestore()
  }
}

describe('packed tables', () => {
  test('packDatabase writes each record\'s entries, rows (in the record\'s order) and indexes into one compact file', async () => {
    await fill()
    expect(await packDatabase()).toEqual({ records: 2, rows: 44 })
    const items = packed('items')
    const record = JSON.parse(fs.readFileSync(`${databasePath}items.json`, 'utf8'))
    expect(Object.keys(items)).toEqual(['entries', 'rows'])
    expect(items.entries).toEqual(record.entries)
    expect(items.rows).toEqual(record.entries.map(file => JSON.parse(fs.readFileSync(`${databasePath}items/${file}`, 'utf8'))))
    expect(fs.readFileSync(`${databasePath}__packed/items.json`, 'utf8')).not.toContain('\n')
  })

  test('reads using packed files return exactly what reading the entry files returns', async () => {
    await fill()
    const fromFiles = await query(reads)
    await packDatabase()
    configure({ packedReads: true })
    expect(await query(reads)).toEqual(fromFiles)
  })

  test('a read of more rows than one round of reads takes them from the packed file, not the entry files', async () => {
    await fill()
    await packDatabase()
    configure({ packedReads: true })
    expect(await entryReads('items', () => query("read items; read items where day = 'd1'"))).toEqual([])
  })

  test('a lookup of a few rows reads their entry files, not the whole packed file', async () => {
    await fill()
    await packDatabase()
    markPackedRows('items')
    configure({ packedReads: true })
    let found
    expect(await entryReads('items', async () => { [found] = await query("read items where _id = 'i7'") }))
      .toEqual([`${databasePath}items/i7.json`])
    expect(found[0].fromPack).toBeUndefined()
  })

  test('a file an index lists but the record does not is still read from its entry file', async () => {
    await fill()
    await packDatabase()
    configure({ packedReads: true })
    // An index edited by hand to list a file the record and its packed file don't have
    fs.writeFileSync(`${databasePath}items/stray.json`, JSON.stringify({ _id: 'stray', parent_id: 'p0', day: 'd1', value: 500 }))
    const index = JSON.parse(fs.readFileSync(`${databasePath}__indexes/items/index_day.json`, 'utf8'))
    index.find(entry => entry.value === 'd1').record.push('stray.json')
    fs.writeFileSync(`${databasePath}__indexes/items/index_day.json`, JSON.stringify(index))
    let found
    expect(await entryReads('items', async () => { [found] = await query("read items where day = 'd1'") }))
      .toEqual([`${databasePath}items/stray.json`])
    expect(found).toHaveLength(21)
    expect(found.map(row => row._id)).toContain('stray')
  })

  test('Node reads the entry files by default, even when there is a packed file', async () => {
    await fill()
    await packDatabase()
    markPackedRows('items')
    const [rows] = await query('read items')
    expect(rows.some(row => row.fromPack)).toBe(false)
    configure({ packedReads: true })
    const [packedRows] = await query('read items')
    expect(packedRows.every(row => row.fromPack)).toBe(true)
  })

  test('a packed file that no longer matches its record\'s entries is not used', async () => {
    await fill()
    await packDatabase()
    markPackedRows('items')
    // Added by hand, as an edit in git would: a new entry file and its name in the record file
    fs.writeFileSync(`${databasePath}items/extra.json`, JSON.stringify({ _id: 'extra', parent_id: 'p0', day: 'd0', value: 99 }))
    const record = JSON.parse(fs.readFileSync(`${databasePath}items.json`, 'utf8'))
    record.entries.push('extra.json')
    fs.writeFileSync(`${databasePath}items.json`, JSON.stringify(record))
    configure({ packedReads: true })
    const [rows] = await query('read items')
    expect(rows).toHaveLength(41)
    expect(rows.some(row => row.fromPack)).toBe(false)
  })

  test('insert, update and delete through json-fs-query remove the record\'s packed file', async () => {
    await fill()
    for (const change of [
      "insert items values _id = 'new', parent_id = 'p0', day = 'd0', value = 1",
      "update items set value = 0 where day = 'd1'",
      "delete items where _id = 'i7'"
    ]) {
      await packDatabase()
      await query(change)
      expect(hasPack('items')).toBe(false)
      expect(hasPack('parents')).toBe(true)
    }
  })

  test('an update or delete that matches no row keeps the packed file', async () => {
    await fill()
    await packDatabase()
    await query("update items set value = 0 where day = 'none'; delete items where _id = 'none'")
    expect(hasPack('items')).toBe(true)
  })

  test('a failing write keeps the packed file', async () => {
    await fill()
    await packDatabase()
    await expect(query("insert items values _id = 'i0', parent_id = 'p0', day = 'd0', value = 1")).rejects.toThrow('Duplicate value')
    expect(hasPack('items')).toBe(true)
  })

  test('drop removes the record\'s packed file, and packDatabase removes packed files of records that are gone', async () => {
    await fill()
    await packDatabase()
    await query('drop items; drop parents')
    expect(hasPack('items')).toBe(false)
    await fill()
    await packDatabase()
    fs.writeFileSync(`${databasePath}__packed/gone.json`, '{}')
    expect(await packDatabase()).toEqual({ records: 2, rows: 44 })
    expect(hasPack('gone')).toBe(false)
  })

  test('checkPacked reports missing, stale and orphaned packed files without changing anything', async () => {
    await fill()
    expect(await checkPacked()).toEqual({ stale: ['parents', 'items'], orphaned: [] })
    await packDatabase()
    expect(await checkPacked()).toEqual({ stale: [], orphaned: [] })
    // A row edited by hand, and a packed file for no record
    const row = JSON.parse(fs.readFileSync(`${databasePath}items/i7.json`, 'utf8'))
    fs.writeFileSync(`${databasePath}items/i7.json`, JSON.stringify({ ...row, value: 1000 }))
    fs.writeFileSync(`${databasePath}__packed/gone.json`, '{}')
    expect(await checkPacked()).toEqual({ stale: ['items'], orphaned: ['__packed/gone.json'] })
    expect(hasPack('gone')).toBe(true)
  })

  test('checkPacked counts a packed file as current in either format', async () => {
    await fill()
    await packDatabase()
    await formatDatabase('pretty')
    expect(await checkPacked()).toEqual({ stale: [], orphaned: [] })
  })

  test('packDatabase writes nothing when a row cannot be read', async () => {
    await fill()
    fs.rmSync(`${databasePath}items/i7.json`)
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      await expect(packDatabase()).rejects.toThrow('Could not read entity i7.json')
    } finally {
      error.mockRestore()
    }
    expect(fs.existsSync(`${databasePath}__packed`)).toBe(false)
  })
})
