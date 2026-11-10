import { setUp } from 'test-filesystem'
import { configure } from '../utilities/config'
import { query } from '../queries/query'
import { formatDatabase } from './index'
import fs from 'fs'

const databasePath = 'format-database-database/'
configure({ databasePath })
setUp.setDefaults(databasePath)

beforeEach(setUp.beforeEach)

afterEach(async () => {
  configure({ format: 'compact' })
  await setUp.afterEach()
})

/** Every file of the database with its text. */
const snapshot = () => Object.fromEntries(fs.readdirSync(databasePath, { recursive: true }).map(String).sort()
  .filter(name => fs.statSync(`${databasePath}${name}`).isFile())
  .map(name => [name, fs.readFileSync(`${databasePath}${name}`, 'utf8')]))

const fill = () => query(`create kinds (_id string, name string, primary key (_id));
  create items (_id string, kind_id string, day string, primary key (_id), index (day),
    foreign key (kind_id) references kinds (_id));
  insert kinds values _id = 'k1', name = 'Kind 1';
  insert items values _id = 'i1', kind_id = 'k1', day = 'mon';
  insert items values _id = 'i2', kind_id = 'k1', day = 'tue'`)

const reads = "read items.kinds on items.kind_id = kinds._id; read items where day = 'tue'"

describe('formatDatabase', () => {
  test('rewrites a compact database as pretty and back, and queries return the same either way', async () => {
    await fill()
    const compact = snapshot()
    const before = await query(reads)
    expect(Object.values(compact).every(text => !text.includes('\n'))).toBe(true)

    expect(await formatDatabase('pretty')).toEqual({ files: 10, rewritten: 10 })
    const pretty = snapshot()
    expect(Object.keys(pretty)).toEqual(Object.keys(compact))
    for (const [name, text] of Object.entries(pretty)) {
      expect(text).toBe(JSON.stringify(JSON.parse(compact[name]), null, 2))
    }
    expect(await query(reads)).toEqual(before)

    expect(await formatDatabase('compact')).toEqual({ files: 10, rewritten: 10 })
    expect(snapshot()).toEqual(compact)
  })

  test('leaves files already in the format alone, so running it again rewrites nothing', async () => {
    await fill()
    expect(await formatDatabase()).toEqual({ files: 10, rewritten: 0 })
    await formatDatabase('pretty')
    expect(await formatDatabase('pretty')).toEqual({ files: 10, rewritten: 0 })
  })

  test('defaults to the configured format', async () => {
    await fill()
    configure({ format: 'pretty' })
    expect((await formatDatabase()).rewritten).toBe(10)
    expect(fs.readFileSync(`${databasePath}items.json`, 'utf8')).toContain('\n  ')
  })

  test('a database written pretty keeps working when new writes are compact', async () => {
    configure({ format: 'pretty' })
    await fill()
    configure({ format: 'compact' })
    await query("insert items values _id = 'i3', kind_id = 'k1', day = 'tue'")
    expect(fs.readFileSync(`${databasePath}items/i1.json`, 'utf8')).toContain('\n  ')
    expect(fs.readFileSync(`${databasePath}items/i3.json`, 'utf8')).not.toContain('\n')
    const [rows] = await query("read items where day = 'tue'")
    expect(rows.map(row => row._id)).toEqual(['i2', 'i3'])
  })

  test('a file that is not valid JSON fails the whole call with its path, and nothing is rewritten', async () => {
    await fill()
    fs.writeFileSync(`${databasePath}items/broken.json`, '{ not json')
    const before = snapshot()
    await expect(formatDatabase('pretty')).rejects.toThrow('Could not format items/broken.json')
    expect(snapshot()).toEqual(before)
  })

  test('only JSON files are touched', async () => {
    await fill()
    fs.writeFileSync(`${databasePath}README.txt`, 'notes')
    expect(await formatDatabase('pretty')).toEqual({ files: 10, rewritten: 10 })
    expect(fs.readFileSync(`${databasePath}README.txt`, 'utf8')).toBe('notes')
  })

  test('rejects an unknown format, as an argument and as a setting', async () => {
    await expect(formatDatabase('tabs')).rejects.toThrow('Unknown format "tabs"')
    expect(() => configure({ format: 'prety' })).toThrow('Unknown format "prety"')
    await fill()
    expect(fs.readFileSync(`${databasePath}items.json`, 'utf8')).not.toContain('\n')
  })

  test('formatDatabase(undefined) uses the configured format', async () => {
    await fill()
    configure({ format: 'pretty' })
    expect(await formatDatabase(undefined)).toEqual({ files: 10, rewritten: 10 })
  })
})
