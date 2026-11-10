import fs from 'fs'
import { setUp } from 'test-filesystem'
import { configure } from '../utilities/config'
import { query } from '../queries/query'

// A record that has never had a row: its keys' indexes exist (empty), and reads through them return no rows
const databasePath = 'empty-indexes-database/'
configure({ databasePath })
setUp.setDefaults(databasePath)

beforeEach(setUp.beforeEach)

afterEach(setUp.afterEach)

describe('a newly created record, before its first insert', () => {
  test('create writes an empty index for each indexed key', async () => {
    await query('create posts (_id string, title string, date string, primary key (_id), index (date))')
    expect(JSON.parse(fs.readFileSync(`${databasePath}__indexes/posts/pk__id.json`, 'utf8'))).toEqual([])
    expect(JSON.parse(fs.readFileSync(`${databasePath}__indexes/posts/index_date.json`, 'utf8'))).toEqual([])
  })

  test('reads through its keys return no rows instead of failing', async () => {
    await query('create posts (_id string, title string, date string, primary key (_id), index (date))')
    const [byId, byDate, all] = await query("read posts where _id = 'x'; read posts where date = '2026-11-05'; read posts sort date")
    expect([byId, byDate, all]).toEqual([[], [], []])
  })

  test('a database made before empty indexes (no index files) still reads an empty record', async () => {
    await query('create posts (_id string, title string, primary key (_id))')
    fs.rmSync(`${databasePath}__indexes`, { recursive: true, force: true })
    const [byId] = await query("read posts where _id = 'x'")
    expect(byId).toEqual([])
  })

  test('the first insert still indexes as before', async () => {
    await query('create posts (_id string, title string, date string, primary key (_id), index (date))')
    await query("insert posts values _id = 'a', title = 'A', date = '2026-11-05'")
    const [byDate] = await query("read posts where date = '2026-11-05'")
    expect(byDate.map(post => post._id)).toEqual(['a'])
    expect(JSON.parse(fs.readFileSync(`${databasePath}__indexes/posts/index_date.json`, 'utf8'))).toEqual([{ value: '2026-11-05', record: ['a.json'] }])
  })
})
