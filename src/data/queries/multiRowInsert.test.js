import { setUp } from 'test-filesystem'
import { configure } from '../utilities/config'
import { query } from './query'
import fs from 'fs'

const databasePath = 'multi-row-insert-database/'
configure({ databasePath })
setUp.setDefaults(databasePath)

beforeEach(setUp.beforeEach)

afterEach(async () => {
  configure({ databasePath })
  await setUp.afterEach()
})

const schema = `create kinds (_id string, name string, primary key (_id));
  create staff (_id string, kind_id string, manager_id string null, code string null, team string optional, seat int,
    day string, primary key (_id), unique (code), unique (team, seat), index (day),
    foreign key (kind_id) references kinds (_id), foreign key (manager_id) references staff (_id));
  insert kinds values (_id = 'k1', name = 'One'), (_id = 'k2', name = 'Two')`

const literal = value => value === null ? 'null' : typeof value === 'number' ? String(value) : `'${value}'`
const assignments = row => Object.entries(row).map(([field, value]) => `${field} = ${literal(value)}`).join(', ')
const multiRow = rows => `insert staff values ${rows.map(row => `(${assignments(row)})`).join(', ')}`

/** 30 rows: ids out of order, null and missing optional values, managers inserted earlier in the same list. */
const staffRows = () => Array.from({ length: 30 }, (_, position) => ({
  _id: `s${(position * 7) % 30}`,
  kind_id: position % 3 ? 'k1' : 'k2',
  manager_id: position > 0 && position % 4 ? `s${((position - 1) * 7) % 30}` : null,
  code: position % 5 ? `c${position}` : null,
  ...(position % 2 ? { team: `t${position % 4}` } : {}),
  seat: position,
  day: `d${position % 3}`
}))

/** Every file of a database with its parsed content. */
const files = folder => Object.fromEntries(fs.readdirSync(folder, { recursive: true }).map(String).sort()
  .filter(name => fs.statSync(`${folder}${name}`).isFile())
  .map(name => [name, JSON.parse(fs.readFileSync(`${folder}${name}`, 'utf8'))]))

const snapshot = () => Object.fromEntries(Object.entries(files(databasePath)).map(([name, content]) => [name, JSON.stringify(content)]))

describe('multi-row insert', () => {
  test('one statement of many rows leaves the same files and returns the same rows as one insert per row', async () => {
    const rows = staffRows()
    await query(schema)
    const [inserted] = await query(multiRow(rows))
    const together = files(databasePath)

    const separate = `${databasePath}separately/`
    configure({ databasePath: separate })
    await query(schema)
    const one = []
    for (const row of rows) {
      one.push(...(await query(`insert staff values ${assignments(row)}`))[0])
    }
    expect(inserted).toEqual(one)
    expect(files(separate)).toEqual(Object.fromEntries(Object.entries(together).filter(([name]) => !name.startsWith('separately/'))))
  })

  test('writes the record file and each index once for the whole statement', async () => {
    await query(schema)
    const writeFile = jest.spyOn(require('fs/promises'), 'writeFile')
    try {
      await query(multiRow(staffRows()))
      const written = writeFile.mock.calls.map(([location]) => String(location).replace(/\.[0-9a-f-]{36}\.tmp$/, '').replace(databasePath, ''))
      expect(written.filter(name => !name.startsWith('staff/'))).toEqual([
        'staff.json',
        '__indexes/staff/pk__id.json',
        '__indexes/staff/unique_code.json',
        '__indexes/staff/unique_team_seat.json',
        '__indexes/staff/index_day.json',
        '__indexes/staff/fk_kind_id.json',
        '__indexes/staff/fk_manager_id.json'
      ])
      expect(written.filter(name => name.startsWith('staff/'))).toHaveLength(30)
    } finally {
      writeFile.mockRestore()
    }
  })

  test.each([
    ['primary key', { _id: 's1' }, 'Duplicate value for primary key "_id" on staff'],
    ['unique key', { _id: 'x1', code: 'a' }, 'Duplicate value for unique key "code" on staff'],
    ['composite unique key', { _id: 'x1', code: 'z', team: 't', seat: 1 }, 'Duplicate value for unique key "team, seat" on staff']
  ])('a duplicate %s between rows of one statement fails it and writes nothing', async (_, changes, message) => {
    await query(schema)
    const before = snapshot()
    const first = { _id: 's1', kind_id: 'k1', manager_id: null, code: 'a', team: 't', seat: 1, day: 'd0' }
    const middle = { _id: 's2', kind_id: 'k1', manager_id: null, code: 'b', seat: 2, day: 'd0' }
    await expect(query(multiRow([first, middle, { ...first, ...changes }]))).rejects.toThrow(message)
    expect(snapshot()).toEqual(before)
  })

  test('null and missing values never collide on a unique key, in one statement too', async () => {
    await query(schema)
    const [inserted] = await query(multiRow([1, 2, 3].map(seat => ({ _id: `s${seat}`, kind_id: 'k1', manager_id: null, code: null, seat, day: 'd0' }))))
    expect(inserted).toHaveLength(3)
  })

  test('a row can reference one inserted before it in the statement, not one after it', async () => {
    await query(schema)
    const boss = { _id: 'boss', kind_id: 'k1', manager_id: null, code: null, seat: 1, day: 'd0' }
    const worker = { _id: 'worker', kind_id: 'k1', manager_id: 'boss', code: null, seat: 2, day: 'd0' }
    await expect(query(multiRow([worker, boss])))
      .rejects.toThrow('Foreign key "manager_id" on staff references a nonexistent staff._id = boss')
    const [inserted] = await query(multiRow([boss, worker]))
    expect(inserted.map(row => row._id)).toEqual(['boss', 'worker'])
  })

  test('generated ids are unique across the rows of one statement', async () => {
    await query('create notes (_id string auto, text string, primary key (_id))')
    const [inserted] = await query(`insert notes values ${Array.from({ length: 50 }, (_, position) => `(text = 'n${position}')`).join(', ')}`)
    expect(new Set(inserted.map(row => row._id)).size).toBe(50)
    const [read] = await query('read notes')
    expect(read).toHaveLength(50)
  })

  test('a composite key compares each field by its type, against stored rows and earlier rows in the statement', async () => {
    await query('create pairs (a string, n int, note string optional, primary key (a, n))')
    await query("insert pairs values (a = 'x', n = 1), (a = 'x', n = 2)")
    // n is an int, so '1' is the stored 1; a is a string, so 1 is '1'
    await expect(query("insert pairs values (a = 'y', n = 5), (a = 'x', n = '1')")).rejects.toThrow('Duplicate value for primary key "a, n" on pairs')
    await expect(query("insert pairs values (a = 1, n = 7), (a = '1', n = 7)")).rejects.toThrow('Duplicate value for primary key "a, n" on pairs')
    const [inserted] = await query("insert pairs values (a = 'x', n = 3), (a = 'y', n = 1)")
    expect(inserted).toHaveLength(2)
    const [rows] = await query('read pairs')
    expect(rows).toHaveLength(4)
  })

  test('a key whose index file is missing is checked against every stored row, read once for the statement', async () => {
    await query(schema)
    await query(multiRow(staffRows()))
    fs.rmSync(`${databasePath}__indexes/staff/pk__id.json`)
    fs.rmSync(`${databasePath}__indexes/kinds/pk__id.json`)
    const before = snapshot()
    await expect(query(multiRow([
      { _id: 'new1', kind_id: 'k1', manager_id: null, code: 'n1', seat: 100, day: 'd0' },
      { _id: 's7', kind_id: 'k1', manager_id: null, code: 'n2', seat: 101, day: 'd0' }
    ]))).rejects.toThrow('Duplicate value for primary key "_id" on staff')
    await expect(query(multiRow([{ _id: 'new1', kind_id: 'nope', manager_id: null, code: 'n1', seat: 100, day: 'd0' }])))
      .rejects.toThrow('Foreign key "kind_id" on staff references a nonexistent kinds._id = nope')
    expect(snapshot()).toEqual(before)
    const [inserted] = await query(multiRow([
      { _id: 'new1', kind_id: 'k2', manager_id: 's7', code: 'n1', seat: 100, day: 'd0' },
      { _id: 'new2', kind_id: 'k1', manager_id: 'new1', code: 'n2', seat: 101, day: 'd0' }
    ]))
    expect(inserted.map(row => row._id)).toEqual(['new1', 'new2'])
  })

  test('the rows of one statement are checked against the rows already stored', async () => {
    await query(schema)
    await query(multiRow([{ _id: 's1', kind_id: 'k1', manager_id: null, code: 'a', seat: 1, day: 'd0' }]))
    const before = snapshot()
    await expect(query(multiRow([
      { _id: 's2', kind_id: 'k1', manager_id: 's1', code: 'b', seat: 2, day: 'd0' },
      { _id: 's3', kind_id: 'k1', manager_id: null, code: 'a', seat: 3, day: 'd0' }
    ]))).rejects.toThrow('Duplicate value for unique key "code" on staff')
    expect(snapshot()).toEqual(before)
  })
})
