import { query } from '../queries/query'
import { indexHas } from './indexHas'
import { withReadCache } from '../storage'
import { setUp } from 'test-filesystem'
import { configure } from './config'
import fs from 'fs'

const fsPromises = require('fs/promises')

const databasePath = 'index-has-database/'
configure({ databasePath })
setUp.setDefaults(databasePath)

beforeEach(async () => {
  await setUp.beforeEach()
  await query(`create people (_id string, name string, primary key (_id));
    create teams (_id string, code int, lead_id string null, primary key (_id), unique (code), foreign key (lead_id) references people (_id));
    create notes (_id string, text string, primary key (_id));
    create pairs (a string, b int, primary key (a, b))`)
  await query(`insert people values _id = 'p1', name = 'Ana';
    insert people values _id = '4', name = 'Dee';
    insert teams values _id = 't1', code = 10, lead_id = 'p1';
    insert teams values _id = 't2', code = 20, lead_id = null;
    insert pairs values a = 'x', b = 1`)
})

afterEach(() => {
  jest.restoreAllMocks()
  return setUp.afterEach()
})

/**
 * Run `task`, counting the entry files (not record or index files) read, by record.
 * @param task
 */
const entryReads = async task => {
  const reads = {}
  const readFile = fsPromises.readFile
  jest.spyOn(fsPromises, 'readFile').mockImplementation((location, ...args) => {
    const inside = String(location).replace(databasePath, '')
    if (!inside.startsWith('__indexes/') && inside.includes('/')) {
      const record = inside.split('/')[0]
      reads[record] = (reads[record] || 0) + 1
    }
    return readFile(location, ...args)
  })
  const result = await withReadCache(task)
  return { reads, result }
}

describe('indexHas', () => {
  test('answers from the index, by the field\'s declared type', async () => {
    expect(await indexHas('people', '_id', 'p1')).toBe(true)
    expect(await indexHas('people', '_id', 4)).toBe(true)
    expect(await indexHas('people', '_id', 'p9')).toBe(false)
    expect(await indexHas('teams', 'code', '20')).toBe(true)
    expect(await indexHas('teams', 'lead_id', 'p1')).toBe(true)
  })

  test('compares a value stored as another type by the declared type, not loosely', async () => {
    // An id stored as the number 4 in a string field (data written before types were enforced, or by hand)
    const indexDir = `${databasePath}__indexes/people`
    const indexPath = `${indexDir}/${fs.readdirSync(indexDir)[0]}`
    fs.writeFileSync(indexPath, JSON.stringify(JSON.parse(fs.readFileSync(indexPath, 'utf8')).map(entry => entry.value === '4' ? { ...entry, value: 4 } : entry)))
    expect(await indexHas('people', '_id', '4')).toBe(true)
    // as strings '4' and '4.0' differ (loosely, 4 == '4.0')
    expect(await indexHas('people', '_id', '4.0')).toBe(false)
  })

  test('a null equals nothing, not even a stored null', async () => {
    expect(await indexHas('teams', 'lead_id', null)).toBe(false)
  })

  test('a corrupt index file counts as no index: the caller reads the rows', async () => {
    const indexDir = `${databasePath}__indexes/people`
    fs.writeFileSync(`${indexDir}/${fs.readdirSync(indexDir)[0]}`, '{ not json')
    expect(await indexHas('people', '_id', 'p1')).toBeUndefined()
    await expect(query("insert teams values _id = 't3', code = 30, lead_id = 'p9'")).rejects.toThrow('nonexistent people._id = p9')
    await expect(query("insert teams values _id = 't3', code = 30, lead_id = 'p1'")).resolves.toBeDefined()
  })

  test('a key on the field without an index file is passed over for one with it', async () => {
    const recordPath = `${databasePath}teams.json`
    const record = JSON.parse(fs.readFileSync(recordPath, 'utf8'))
    // a hand-added foreign key on lead_id, with no lookup, in front of the real one
    record.keys.unshift({ type: 'foreign', fields: ['lead_id'], references: [{ fields: ['people._id'] }] })
    fs.writeFileSync(recordPath, JSON.stringify(record))
    expect(await indexHas('teams', 'lead_id', 'p1')).toBe(true)
  })

  test('undefined when the field has no single-field index, or its file is gone', async () => {
    expect(await indexHas('people', 'name', 'Ana')).toBeUndefined()
    expect(await indexHas('pairs', 'a', 'x')).toBeUndefined()
    fs.rmSync(`${databasePath}__indexes/people/${fs.readdirSync(`${databasePath}__indexes/people`)[0]}`)
    expect(await indexHas('people', '_id', 'p1')).toBeUndefined()
  })

  test('a record with no rows has none', async () => {
    expect(await indexHas('notes', '_id', 'n1')).toBe(false)
  })
})

describe('key checks answered from indexes', () => {
  test('an insert reads no entry files for its primary, unique and foreign key checks', async () => {
    const { reads } = await entryReads(() => query("insert teams values _id = 't3', code = 30, lead_id = 'p1'"))
    expect(reads).toEqual({})
  })

  test('the checks still refuse what they refused', async () => {
    await expect(query("insert people values _id = 4, name = 'Again'")).rejects.toThrow('Duplicate value for primary key "_id" on people')
    await expect(query("insert teams values _id = 't3', code = '10', lead_id = null")).rejects.toThrow('Duplicate value for unique key "code" on teams')
    await expect(query("insert teams values _id = 't3', code = 30, lead_id = 'p9'")).rejects.toThrow('Foreign key "lead_id" on teams references a nonexistent people._id = p9')
    await expect(query("delete people where _id = 'p1'")).rejects.toThrow('other records still reference it')
    await expect(query("insert pairs values a = 'x', b = '1'")).rejects.toThrow('Duplicate value for primary key "a, b" on pairs')
  })

  test('a delete with no dependents reads no rows of the referencing record', async () => {
    const { reads } = await entryReads(() => query("delete people where _id = '4'"))
    // (people's own rows are read to find the deleted row's file: a separate improvement)
    expect(reads).not.toHaveProperty('teams')
  })

  test('without the index file, the checks read the rows instead and give the same answers', async () => {
    const removeIndex = (record, field) => fs.rmSync(`${databasePath}__indexes/${record}/${fs.readdirSync(`${databasePath}__indexes/${record}`).find(file => file.includes(field))}`)
    // The referencing record's foreign key index (the where on people still uses people's own index)
    removeIndex('teams', 'lead_id')
    await expect(query("delete people where _id = 'p1'")).rejects.toThrow('other records still reference it')
    removeIndex('people', '_id')
    await expect(query("insert people values _id = 4, name = 'Again'")).rejects.toThrow('Duplicate value for primary key "_id" on people')
    await expect(query("insert teams values _id = 't3', code = 30, lead_id = 'p9'")).rejects.toThrow('nonexistent people._id = p9')
    await expect(query("insert teams values _id = 't3', code = 30, lead_id = '4'")).resolves.toBeDefined()
  })
})

describe('key checks over several rows in one call', () => {
  test('several inserts in one call see each other\'s keys', async () => {
    await expect(query("insert people values _id = 'p8', name = 'One'; insert people values _id = 'p8', name = 'Two'"))
      .rejects.toThrow('Duplicate value for primary key "_id" on people')
    // (the first insert stays written: a call's queries aren't all-or-nothing yet, task 4)
    await expect(query("insert people values _id = 'p7', name = 'One'; insert teams values _id = 't7', code = 70, lead_id = 'p7'"))
      .resolves.toBeDefined()
  })

  test('updating a primary or unique key: to a taken value fails, to a free one works', async () => {
    await expect(query("update people set _id = 'p1' where _id = '4'")).rejects.toThrow('Duplicate value for primary key "_id" on people')
    await expect(query("update teams set code = 10 where _id = 't2'")).rejects.toThrow('Duplicate value for unique key "code" on teams')
    await expect(query("update teams set code = 25 where _id = 't2'")).resolves.toBeDefined()
    await expect(query("insert teams values _id = 't9', code = 20, lead_id = null")).resolves.toBeDefined()
    await expect(query("update people set _id = 'p4' where _id = '4'")).resolves.toBeDefined()
  })

  test('deleting several rows: refused when any is still referenced, allowed once none is', async () => {
    await query("insert people values _id = 'p5', name = 'Eve'")
    await expect(query("delete people where _id in ['p5', 'p1']")).rejects.toThrow('other records still reference it')
    expect((await query('read people'))[0].map(row => row._id)).toEqual(['p1', '4', 'p5'])
    await expect(query("delete people where _id in ['p5', '4']")).resolves.toBeDefined()
    expect((await query('read people'))[0].map(row => row._id)).toEqual(['p1'])
  })
})
