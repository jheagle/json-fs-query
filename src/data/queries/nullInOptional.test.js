import { setUp } from 'test-filesystem'
import { configure } from '../utilities/config'
import { query } from './query'
import fs from 'fs'

const databasePath = 'null-in-optional-database/'
configure({ databasePath })
setUp.setDefaults(databasePath)

beforeEach(setUp.beforeEach)

afterEach(setUp.afterEach)

// code, day and parent_id are optional and not nullable: they can be missing, never null
const fill = () => query(`create parents (_id string, primary key (_id));
  create items (_id string, code string optional, day string optional, parent_id string optional, note string optional null,
    primary key (_id), unique (code), index (day), foreign key (parent_id) references parents (_id));
  insert parents values (_id = 'p1');
  insert items values (_id = 'i1', code = 'a', day = 'mon', parent_id = 'p1', note = 'x'),
    (_id = 'i2', code = 'b', day = 'mon', parent_id = 'p1', note = 'y'),
    (_id = 'i3', code = null, day = null, parent_id = null, note = null)`)

const stored = id => JSON.parse(fs.readFileSync(`${databasePath}items/${id}.json`, 'utf8'))

describe('null in an optional field that is not nullable', () => {
  test('an insert leaves the field out, in a multi-row insert too, while a nullable field stores null', async () => {
    await fill()
    expect(stored('i3')).toEqual({ _id: 'i3', note: null })
    const [missing, isNull] = await query('read items where code does not exist; read items where note is null')
    expect(missing.map(row => row._id)).toEqual(['i3'])
    expect(isNull.map(row => row._id)).toEqual(['i3'])
  })

  test('an update removes the field from every row it matches, and it then reads as missing, not null', async () => {
    await fill()
    const [updated] = await query("update items set code = null, day = null where parent_id = 'p1'")
    expect(updated.map(row => row._id)).toEqual(['i1', 'i2'])
    updated.forEach(row => expect(row).not.toHaveProperty('code'))
    expect(stored('i1')).toEqual({ _id: 'i1', parent_id: 'p1', note: 'x' })
    const [missing, isNull] = await query('read items where code does not exist; read items where code is null')
    // Sorted: an indexed where gives rows in the order they joined the index value, as in 3.2.0 (not the record's order)
    expect(missing.map(row => row._id).sort()).toEqual(['i1', 'i2', 'i3'])
    expect(isNull).toEqual([])
  })

  test('clearing a unique field on several rows is not a duplicate, and frees the value', async () => {
    await fill()
    await query("update items set code = null where day = 'mon'")
    const [[reused]] = await query("insert items values _id = 'i4', code = 'a'")
    expect(reused.code).toBe('a')
    const [found] = await query("read items where code = 'a'")
    expect(found.map(row => row._id)).toEqual(['i4'])
  })

  test('a cleared indexed field drops out of its index', async () => {
    await fill()
    await query("update items set day = null where _id = 'i1'")
    const [monday] = await query("read items where day = 'mon'")
    expect(monday.map(row => row._id)).toEqual(['i2'])
  })

  test('clearing a foreign key references nothing, and no longer keeps the parent from being deleted', async () => {
    await fill()
    await expect(query("delete parents where _id = 'p1'")).rejects.toThrow('other records still reference it')
    await query("update items set parent_id = null where parent_id = 'p1'")
    await query("delete parents where _id = 'p1'")
    const [parents] = await query('read parents')
    expect(parents).toEqual([])
  })

  test('a field of the primary key can never be cleared, even an optional one', async () => {
    await query('create keyed (k string optional, v string, primary key (k))')
    await query("insert keyed values (k = 'a', v = 'x')")
    await expect(query("update keyed set k = null where k = 'a'")).rejects.toThrow('Cannot clear "k" on keyed: it\'s part of the primary key')
    const [[row]] = await query("read keyed where k = 'a'")
    expect(row).toEqual({ k: 'a', v: 'x' })
  })

  test('clearing a field with a default leaves it out (a default only applies on insert)', async () => {
    await query("create things (_id string, kind string optional default 'plain', primary key (_id))")
    await query("insert things values (_id = 't1', kind = 'fancy')")
    const [[cleared]] = await query("update things set kind = null where _id = 't1'")
    expect(cleared).toEqual({ _id: 't1' })
  })

  test('clearing one field of a composite unique key is never a duplicate, and frees the pair', async () => {
    await query('create seats (_id string, team string optional, seat int, primary key (_id), unique (team, seat))')
    await query("insert seats values (_id = 's1', team = 'red', seat = 1), (_id = 's2', team = 'blue', seat = 1)")
    await query('update seats set team = null where seat = 1')
    const [[reused]] = await query("insert seats values (_id = 's3', team = 'red', seat = 1)")
    expect(reused._id).toBe('s3')
    await expect(query("insert seats values (_id = 's4', team = 'red', seat = 1)")).rejects.toThrow('Duplicate value for unique key "team, seat" on seats')
    const [cleared] = await query('read seats where team does not exist')
    expect(cleared.map(row => row._id).sort()).toEqual(['s1', 's2'])
  })

  test('a nullable field set to null still stores null', async () => {
    await fill()
    await query("update items set note = null where _id = 'i1'")
    expect(stored('i1')).toHaveProperty('note', null)
  })
})
