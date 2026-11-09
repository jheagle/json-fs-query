import { setUp } from 'test-filesystem'
import { configure } from '../utilities/config'
import { query } from './query'
import { alter, packDatabase } from '../introspect'
import fs from 'fs'

const databasePath = 'alter-fields-database/'
configure({ databasePath })
setUp.setDefaults(databasePath)

beforeEach(setUp.beforeEach)

afterEach(setUp.afterEach)

const fill = () => query(`create kinds (_id string, name string, primary key (_id));
  create items (_id string, kind_id string, day string, code string optional, note string optional null,
    primary key (_id), index (day), unique (code), foreign key (kind_id) references kinds (_id));
  insert kinds values (_id = 'k1', name = 'One'), (_id = 'k2', name = 'Two');
  insert items values (_id = 'i1', kind_id = 'k1', day = 'mon', code = 'a', note = 'x'),
    (_id = 'i2', kind_id = 'k2', day = 'tue', note = null),
    (_id = 'i3', kind_id = 'k1', day = 'mon')`)

const row = id => JSON.parse(fs.readFileSync(`${databasePath}items/${id}.json`, 'utf8'))
const fields = async name => (await query(`describe ${name}`))[0].definition.map(field => field.name)

/** Every file of the database with its text, to check a refused change wrote nothing. */
const snapshot = () => Object.fromEntries(fs.readdirSync(databasePath, { recursive: true }).map(String).sort()
  .filter(name => fs.statSync(`${databasePath}${name}`).isFile())
  .map(name => [name, fs.readFileSync(`${databasePath}${name}`, 'utf8')]))

const refused = async (text, message) => {
  const before = snapshot()
  await expect(query(text)).rejects.toThrow(message)
  expect(snapshot()).toEqual(before)
}

describe('alter add', () => {
  test('an optional field is added to the definition and leaves the rows alone', async () => {
    await fill()
    const [definition] = await query('alter items add sets int optional')
    expect(definition.map(field => field.name)).toContain('sets')
    expect(row('i1')).not.toHaveProperty('sets')
    await query("insert items values _id = 'i4', kind_id = 'k1', day = 'wed', sets = 3")
    const [[found]] = await query('read items where sets = 3')
    expect(found._id).toBe('i4')
  })

  test('a field with a default fills it in on every existing row', async () => {
    await fill()
    await query("alter items add status string default 'open'")
    expect(['i1', 'i2', 'i3'].map(id => row(id).status)).toEqual(['open', 'open', 'open'])
    const [[inserted]] = await query("insert items values _id = 'i4', kind_id = 'k1', day = 'wed'")
    expect(inserted.status).toBe('open')
  })

  test('an auto field gives every existing row its own id', async () => {
    await fill()
    await query('alter items add ref string auto')
    const refs = ['i1', 'i2', 'i3'].map(id => row(id).ref)
    expect(new Set(refs).size).toBe(3)
  })

  test('a required field without a default is refused while there are rows, and fine without', async () => {
    await fill()
    await refused('alter items add sets int', 'Can\'t add required field "sets" to items: its 3 row(s) have no value for it (give it a default, or make it optional)')
    await query('create empty (_id string, primary key (_id))')
    await query('alter empty add sets int')
    expect(await fields('empty')).toEqual(['_id', 'sets'])
  })

  test('an existing name, and a default that does not fit, are refused', async () => {
    await fill()
    await refused('alter items add day string optional', 'Field "day" already exists on items')
    await refused("alter items add sets int default 'lots'", 'Invalid default for field "sets" of items')
  })
})

describe('alter drop', () => {
  test('removes the field from the definition and every row, and it is then unknown', async () => {
    await fill()
    await query('alter items drop note')
    expect(await fields('items')).not.toContain('note')
    expect(row('i1')).not.toHaveProperty('note')
    expect(row('i2')).not.toHaveProperty('note')
    await expect(query("read items where note = 'x'")).rejects.toThrow('Unknown field "note" in where')
  })

  test('is refused while a key uses the field, or another record references it', async () => {
    await fill()
    await refused('alter items drop day', 'Can\'t drop "day" from items: its index key (day) uses it')
    await refused('alter items drop _id', 'Can\'t drop "_id" from items: its primary key (_id) uses it')
    await refused('alter kinds drop _id', 'Can\'t drop "_id" from kinds: its primary key (_id) uses it')
    await query('create labels (_id string, kind_name string, primary key (_id), foreign key (kind_name) references kinds (name))')
    await refused('alter kinds drop name', 'Can\'t drop "name" from kinds: labels\'s foreign key "kind_name" references it')
  })

  test('an unknown field is refused', async () => {
    await fill()
    await refused('alter items drop nosuch', 'Unknown field "nosuch" in alter: items has')
  })
})

describe('alter rename', () => {
  test('moves the field in the definition, every row, its key and index file', async () => {
    await fill()
    await query('alter items rename day to weekday')
    expect(await fields('items')).toContain('weekday')
    expect(row('i1')).toEqual({ _id: 'i1', kind_id: 'k1', weekday: 'mon', code: 'a', note: 'x' })
    expect(fs.existsSync(`${databasePath}__indexes/items/index_weekday.json`)).toBe(true)
    expect(fs.existsSync(`${databasePath}__indexes/items/index_day.json`)).toBe(false)
    const [monday] = await query("read items where weekday = 'mon'")
    expect(monday.map(found => found._id).sort()).toEqual(['i1', 'i3'])
    await expect(query("read items where day = 'mon'")).rejects.toThrow('Unknown field "day"')
  })

  test('a referenced field is renamed in the foreign keys that reference it, which keep working', async () => {
    await fill()
    await query('alter kinds rename _id to kind_code')
    const items = JSON.parse(fs.readFileSync(`${databasePath}items.json`, 'utf8'))
    expect(items.keys.find(key => key.type === 'foreign').references[0].fields).toEqual(['kinds.kind_code'])
    await expect(query("insert items values _id = 'i4', kind_id = 'nope', day = 'wed'")).rejects.toThrow('references a nonexistent kinds.kind_code = nope')
    await expect(query("delete kinds where kind_code = 'k1'")).rejects.toThrow('other records still reference it')
    const [joined] = await query("read items.kinds on items.kind_id = kinds.kind_code where kinds.name = 'Two'")
    expect(joined.map(found => found._id)).toEqual(['i2'])
  })

  test('a field in a composite key, and one a record\'s own foreign key references, are renamed there too', async () => {
    await query(`create staff (_id string, team string, seat int, boss_id string null,
        primary key (_id), unique (team, seat), foreign key (boss_id) references staff (_id));
      insert staff values (_id = 's1', team = 'red', seat = 1, boss_id = null), (_id = 's2', team = 'red', seat = 2, boss_id = 's1')`)
    await query('alter staff rename team to squad; alter staff rename _id to staff_id')
    const staff = JSON.parse(fs.readFileSync(`${databasePath}staff.json`, 'utf8'))
    expect(staff.keys.map(key => key.lookup)).toEqual(['pk_staff_id.json', 'unique_squad_seat.json', 'fk_boss_id.json'])
    expect(staff.keys.find(key => key.type === 'foreign').references[0].fields).toEqual(['staff.staff_id'])
    await expect(query("insert staff values (staff_id = 's3', squad = 'red', seat = 1, boss_id = null)")).rejects.toThrow('Duplicate value for unique key "squad, seat" on staff')
    await expect(query("insert staff values (staff_id = 's3', squad = 'blue', seat = 1, boss_id = 'nobody')")).rejects.toThrow('references a nonexistent staff.staff_id = nobody')
    const [[inserted]] = await query("insert staff values (staff_id = 's3', squad = 'blue', seat = 1, boss_id = 's2')")
    expect(inserted.boss_id).toBe('s2')
  })

  test('renaming to a field that exists is refused', async () => {
    await fill()
    await refused('alter items rename day to code', 'Can\'t rename "day" on items to "code": a field of that name already exists')
  })
})

describe('alter modify', () => {
  test('making a field required fills missing rows from the new default, or is refused without one', async () => {
    await fill()
    await refused('alter items modify note string null', 'Can\'t make "note" required on items: 1 row(s) have no value for it (give it a default to fill them in)')
    await query("alter items modify note string null default 'none'")
    expect(['i1', 'i2', 'i3'].map(id => row(id).note)).toEqual(['x', null, 'none'])
  })

  test('making a field not nullable removes its nulls when it stays optional', async () => {
    await fill()
    await query('alter items modify note string optional')
    expect(row('i2')).not.toHaveProperty('note')
    expect(row('i1').note).toBe('x')
  })

  test('making a field required and not nullable is refused while a row holds null, and fills the nulls from a default', async () => {
    await query(`create things (_id string, note string null, primary key (_id));
      insert things values (_id = 't1', note = 'x'), (_id = 't2', note = null)`)
    await refused('alter things modify note string', 'Can\'t make "note" not null on things: 1 row(s) hold null (give it a default to fill them in, or make it optional)')
    await query("alter things modify note string default 'none'")
    const [rows] = await query('read things')
    expect(rows.map(found => found.note)).toEqual(['x', 'none'])
  })

  test('modify gives the whole new definition: a default it doesn\'t repeat is removed', async () => {
    await query("create things (_id string, status string optional default 'planned', primary key (_id))")
    await query('alter things modify status string optional')
    const [[added]] = await query("insert things values _id = 't1'")
    expect(added).toEqual({ _id: 't1' })
    await query("alter things modify status string optional default 'planned'")
    const [[again]] = await query("insert things values _id = 't2'")
    expect(again.status).toBe('planned')
  })

  test('filling a field a key uses on a record with no primary key is refused (rows are found by it)', async () => {
    await query(`create loose (code string optional, unique (code));
      insert loose values (code = 'a'); insert loose values (code = null)`)
    await refused("alter loose modify code string default 'z'", 'Can\'t change "code" on loose\'s rows: a key uses it, and rows are found by the primary key, which loose doesn\'t have')
  })

  test('filling a field a key uses goes through its checks: a unique key rejects the same default twice', async () => {
    await fill()
    await refused("alter items modify code string default 'same'", 'Duplicate value for unique key "code" on items')
  })

  test('filling an indexed field updates its index', async () => {
    await query(`create things (_id string, day string optional, primary key (_id), index (day));
      insert things values (_id = 't1', day = 'mon'), (_id = 't2')`)
    await query("alter things modify day string default 'sun'")
    const [sunday] = await query("read things where day = 'sun'")
    expect(sunday.map(found => found._id)).toEqual(['t2'])
  })

  test('the type, and whether a field is auto, can\'t change', async () => {
    await fill()
    await refused('alter items modify day int', 'Can\'t change the type of "day" on items (string to int)')
    await refused('alter items modify day string auto', 'Can\'t change whether "day" on items is auto')
  })

  test('a primary key field can\'t become nullable', async () => {
    await fill()
    await refused('alter items modify _id string null', 'Primary key field "_id" of items can\'t be nullable')
  })
})

describe('alter', () => {
  test('works from JS too, and changing rows removes the record\'s packed file', async () => {
    await fill()
    await packDatabase()
    await alter('items', { action: 'add', field: { name: 'sets', type: 'int', optional: false, useDefault: true, defaultValue: 1 } })
    expect(row('i1').sets).toBe(1)
    expect(fs.existsSync(`${databasePath}__packed/items.json`)).toBe(false)
    expect(fs.existsSync(`${databasePath}__packed/kinds.json`)).toBe(true)
  })

  test.each([
    ['a rename to a path', 'items', { action: 'rename', name: 'day', to: '../../x' }, '"../../x"'],
    ['a field name with a slash', 'items', { action: 'add', field: { name: 'a/b', type: 'string', optional: true } }, '"a/b"'],
    ['a field with no name', 'items', { action: 'add', field: { type: 'string', optional: true } }, 'undefined'],
    ['a record name that is a path', '../items', { action: 'drop', name: 'day' }, '"../items"']
  ])('the alter() function refuses %s, before reading or writing anything', async (_, record, change, shown) => {
    await fill()
    const before = snapshot()
    await expect(alter(record, change)).rejects.toThrow(`Invalid name ${shown} in alter: names use letters, digits, _ and - only`)
    expect(snapshot()).toEqual(before)
  })

  test.each([
    ['alter items', 'Expected: alter <record> add'],
    ['alter items change day', 'Expected: alter <record> add'],
    ['alter items drop', 'Expected: alter items drop <field>'],
    ['alter items rename day', 'Expected: alter items rename <field> to <name>'],
    ['alter items add day', 'Expected a field (<name> <type> ...)'],
    ['alter nosuch add a string optional', 'Record "nosuch" doesn\'t exist']
  ])('reports a malformed or impossible statement: %s', async (text, message) => {
    await fill()
    await expect(query(text)).rejects.toThrow(message)
  })
})
