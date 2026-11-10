import { query } from './query'
import { readFile, writeFile } from 'fs/promises'
import { create } from '../introspect/create'
import { setUp } from 'test-filesystem'
import { configure } from '../utilities/config'
import { copyDatabase } from '../../../test-data/copyDatabase'

const databasePath = 'query-database/'
configure({ databasePath })
setUp.setDefaults(databasePath)

beforeEach(
  () => setUp.beforeEach()
    .then(() => copyDatabase(databasePath))
)

afterEach(setUp.afterEach)

describe('query', () => {
  test('it deletes matching rows, resolved via an indexed condition', async () => {
    const deleted = await query('delete workouts where date = \'2024-06-05\'')
    expect(deleted[0]).toHaveLength(3)

    const remaining = await query('read workouts')
    expect(remaining[0]).toHaveLength(3)
    expect(remaining[0].every(row => row.date === '2024-06-02')).toBe(true)
  })

  test('a read resolved via an indexed condition, with no join at all, does not add a stray "undefined" key', async () => {
    const [rows] = await query('read workouts where exercise_id = 1 sort date desc limit 1')
    expect(rows).toHaveLength(1)
    expect(rows[0]).not.toHaveProperty('undefined')
    expect(Object.keys(rows[0]).sort()).toEqual(
      ['_id', 'date', 'exercise_id', 'note', 'order', 'reps', 'sets', 'weight_effort'].sort()
    )
  })

  test('a read whose indexed condition genuinely matches nothing returns nothing, not every row', async () => {
    const result = await query('read workouts where exercise_id = 999')
    expect(result[0]).toEqual([])
  })

  test('a delete whose indexed condition genuinely matches nothing deletes nothing, not every row', async () => {
    const deleted = await query('delete workouts where exercise_id = 999')
    expect(deleted[0]).toEqual([])

    const remaining = await query('read workouts')
    expect(remaining[0]).toHaveLength(6)
  })

  test('an update whose indexed condition genuinely matches nothing updates nothing, not every row', async () => {
    const updated = await query("update workouts set note = 'should never apply' where exercise_id = 999")
    expect(updated[0]).toEqual([])

    const unaffected = await query('read workouts')
    expect(unaffected[0].every(row => row.note !== 'should never apply')).toBe(true)
  })

  test('it inserts a new row via a values clause', async () => {
    const inserted = await query("insert workouts values _id = 99, exercise_id = 1, order = 0, date = '2024-06-10'")
    expect(inserted[0]).toHaveLength(1)
    expect(inserted[0][0]).toMatchObject({ _id: '99', exercise_id: '1', order: 0, date: '2024-06-10' })

    const readBack = await query("read workouts where date = '2024-06-10'")
    expect(readBack[0]).toHaveLength(1)
  })

  test('it updates matching rows via a set clause, resolved via an indexed condition', async () => {
    const updated = await query("update workouts set reps = 20 where date = '2024-06-05'")
    expect(updated[0]).toHaveLength(3)
    expect(updated[0].every(row => row.reps === 20)).toBe(true)

    const readBack = await query("read workouts where date = '2024-06-05'")
    expect(readBack[0].every(row => row.reps === 20)).toBe(true)
  })

  test('it reads with where', async () => {
    const queryString = 'read workouts where date = \'2024-06-02\''
    const result = await query(queryString)
    expect(result).toEqual([
      [
        {
          _id: 1,
          exercise_id: 1,
          weight_effort: '115lbs',
          reps: 10,
          sets: 3,
          note: '',
          order: 0,
          date: '2024-06-02'
        },
        {
          _id: 2,
          exercise_id: 2,
          weight_effort: '155lbs',
          reps: 10,
          sets: 3,
          note: '',
          order: 1,
          date: '2024-06-02'
        },
        {
          _id: 3,
          exercise_id: 3,
          weight_effort: '155lbs',
          reps: 10,
          sets: 3,
          note: '',
          order: 2,
          date: '2024-06-02'
        }
      ]
    ])
  })

  test('it reads with joins and merges', async () => {
    const queryString = 'read workouts.muscles' +
      ' on workouts.exercise_id = exercises._id' +
      ' and on exercises._id = exercise_muscle.exercise_id' +
      ' and on exercise_muscle.muscle_id = muscles._id' +
      ' merge muscles._id with exercise_muscle.muscle_id' +
      ' where date = \'2024-06-02\''
    const result = await query(queryString)
    expect(result).toEqual([
      [
        {
          _id: 1,
          exercise_id: 1,
          weight_effort: '115lbs',
          reps: 10,
          sets: 3,
          note: '',
          order: 0,
          date: '2024-06-02',
          muscles: [
            {
              _id: 11,
              name: 'Pectorals',
              alias: 'chest',
              image: '',
              'exercise_muscle._id': 1,
              'exercise_muscle.exercise_id': 1,
              'exercise_muscle.muscle_rank': 100
            }
          ]
        },
        {
          _id: 2,
          exercise_id: 2,
          weight_effort: '155lbs',
          reps: 10,
          sets: 3,
          note: '',
          order: 1,
          date: '2024-06-02',
          muscles: [
            {
              _id: 8,
              name: 'Hamstrings',
              alias: 'abs',
              image: '',
              'exercise_muscle._id': 2,
              'exercise_muscle.exercise_id': 2,
              'exercise_muscle.muscle_rank': 100
            }
          ]
        },
        {
          _id: 3,
          exercise_id: 3,
          weight_effort: '155lbs',
          reps: 10,
          sets: 3,
          note: '',
          order: 2,
          date: '2024-06-02',
          muscles: [
            {
              _id: 12,
              name: 'Quadriceps',
              alias: 'quads',
              image: '',
              'exercise_muscle._id': 3,
              'exercise_muscle.exercise_id': 3,
              'exercise_muscle.muscle_rank': 100
            }
          ]
        }
      ]
    ])
  })

  test('it reads with joins and no where clause at all - every row, not just an indexed subset, gets joined', async () => {
    const queryString = 'read workouts.exercises on workouts.exercise_id = exercises._id'
    const [rows] = await query(queryString)
    expect(rows).toHaveLength(6)
    rows.forEach(row => {
      expect(row.exercises).toHaveLength(1)
      expect(row.exercises[0]._id).toBe(row.exercise_id)
    })
  })

  describe('group by', () => {
    // The fixture: workouts 1-3 on 2024-06-02 and 4-6 on 2024-06-05, exercise_id 1, 2, 3 on each day
    const summary = (groups) => groups.map(({ value, rows, groups: inner }) =>
      [value, rows ? rows.map(({ _id }) => _id) : summary(inner)])

    test('groups come as a list, in the sorted order, each with its rows in order', async () => {
      const [groups] = await query('read workouts group by date sort date desc, order asc')
      expect(groups.map(({ field, value }) => [field, value])).toEqual([['date', '2024-06-05'], ['date', '2024-06-02']])
      expect(summary(groups)).toEqual([['2024-06-05', [4, 5, 6]], ['2024-06-02', [1, 2, 3]]])
    })

    test('a number field keeps the sort order (2.x always put number keys ascending)', async () => {
      const [groups] = await query('read workouts group by exercise_id sort exercise_id desc, _id')
      expect(summary(groups)).toEqual([[3, [3, 6]], [2, [2, 5]], [1, [1, 4]]])
    })

    test.each([
      ['limit 1', [['2024-06-05', [4, 5, 6]]]],
      ['limit 1 offset 1', [['2024-06-02', [1, 2, 3]]]],
      ['offset 1', [['2024-06-02', [1, 2, 3]]]]
    ])('%s counts groups, not rows (2.x limited the rows, then grouped them)', async (clauses, expected) => {
      const [groups] = await query(`read workouts group by date sort date desc, _id ${clauses}`)
      expect(summary(groups)).toEqual(expected)
    })

    test('rows missing the field are a group of their own, sorted first, counted by limit and shaped by select', async () => {
      // weight_effort is optional: this workout leaves it out
      await query("insert workouts values _id = '7', exercise_id = 2, reps = 8, sets = 3, order = 0, date = '2024-06-09'")
      const [groups] = await query('read workouts select date group by weight_effort sort weight_effort, _id limit 2')
      expect(groups).toEqual([
        { field: 'weight_effort', missing: true, rows: [{ date: '2024-06-09' }] },
        { field: 'weight_effort', value: '115lbs', rows: [{ date: '2024-06-02' }] }
      ])
    })

    test('several fields nest, and select shapes the rows inside (the group fields stay on the groups)', async () => {
      const [groups] = await query('read workouts select _id group by date, weight_effort sort date desc, _id')
      expect(summary(groups)).toEqual([
        ['2024-06-05', [['120lbs', [4]], ['160lbs', [5, 6]]]],
        ['2024-06-02', [['115lbs', [1]], ['155lbs', [2, 3]]]]
      ])
      expect(groups[0].groups[1]).toEqual({ field: 'weight_effort', value: '160lbs', rows: [{ _id: 5 }, { _id: 6 }] })
    })
  })

  test('a multi-field unique key works end-to-end through insert/update query strings', async () => {
    await create('pairs', [
      { name: '_id', type: 'string', optional: false, autoGenerate: true },
      { name: 'a', type: 'string', optional: true },
      { name: 'b', type: 'string', optional: true }
    ], [
      { type: 'primary', fields: ['_id'], lookup: 'pk__id.json' },
      { type: 'unique', fields: ['a', 'b'], lookup: 'unique_a_b.json' }
    ])

    const inserted = await query("insert pairs values a = 'x', b = 'y'")
    expect(inserted[0]).toHaveLength(1)

    await expect(query("insert pairs values a = 'x', b = 'y'"))
      .rejects.toThrow('Duplicate value for unique key "a, b" on pairs')

    const id = inserted[0][0]._id
    await query(`update pairs set b = 'z' where _id = '${id}'`)
    const read = await query('read pairs')
    expect(read[0]).toEqual([{ _id: id, a: 'x', b: 'z' }])
  })

  test('deleting a referenced record via a real query string is rejected while dependents exist', async () => {
    await expect(query('delete exercises where _id = 1'))
      .rejects.toThrow('Cannot delete from "exercises" where "_id" = 1 - other records still reference it')

    const stillThere = await query('read exercises where _id = 1')
    expect(stillThere[0]).toHaveLength(1)
  })

  test('limit caps how many rows a real query string returns', async () => {
    const result = await query('read workouts sort date asc, order asc limit 2')
    expect(result[0]).toHaveLength(2)
    expect(result[0].map(row => row._id)).toEqual([1, 2])
  })

  test('offset skips that many rows, and combines with limit to page through a real query string', async () => {
    const result = await query('read workouts sort date asc, order asc limit 2 offset 2')
    expect(result[0]).toHaveLength(2)
    expect(result[0].map(row => row._id)).toEqual([3, 4])
  })

  test('select shapes a real query string down to just the chosen columns, aliased when given', async () => {
    const result = await query('read workouts select date, reps as repetitions where date = \'2024-06-02\'')
    expect(result[0]).toEqual([
      { date: '2024-06-02', repetitions: 10 },
      { date: '2024-06-02', repetitions: 10 },
      { date: '2024-06-02', repetitions: 10 }
    ])
  })

  test('select, limit and offset all combine on the same real query string', async () => {
    const result = await query('read workouts select _id, date sort date asc, order asc limit 2 offset 1')
    expect(result[0]).toEqual([
      { _id: 2, date: '2024-06-02' },
      { _id: 3, date: '2024-06-02' }
    ])
  })

  test('an inserted id is written as its declared string type, and joins the index entry of the same stored number', async () => {
    const inserted = await query("insert workouts values _id = 99, exercise_id = 2, order = 0, date = '2024-06-10'")
    expect(inserted[0][0]).toMatchObject({ exercise_id: '2' })

    const index = JSON.parse(await readFile(`${databasePath}__indexes/workouts/fk_exercise_id.json`, 'utf8'))
    const entries = index.filter(entry => String(entry.value) === '2')
    expect(entries).toHaveLength(1)
    expect(entries[0].record).toContain('99.json')
  })

  test('a condition compares by the field\'s declared type, matching ids stored as numbers and as strings', async () => {
    await query("insert workouts values _id = 99, exercise_id = 2, order = 0, date = '2024-06-10'")

    const equal = await query('read workouts where exercise_id = 2')
    expect(equal[0].map(row => String(row._id)).sort()).toEqual(['2', '5', '99'])

    // in compared strictly before, so a string list never matched the stored numbers
    const listed = await query('read workouts where exercise_id in ["2"]')
    expect(listed[0].map(row => String(row._id)).sort()).toEqual(['2', '5', '99'])
  })

  test('an int field matches numeric strings in an unindexed in condition', async () => {
    const result = await query('read workouts where reps in ["10"]')
    expect(result[0].length).toBeGreaterThan(0)
    expect(result[0].every(row => row.reps === 10)).toBe(true)
  })
  test('a null literal in a query is stored as a real null in a nullable field, left out of an optional one, and rejected in a required one', async () => {
    await create('notes', [
      { name: '_id', type: 'string', optional: false, autoGenerate: true },
      { name: 'text', type: 'string', optional: true, nullable: true },
      { name: 'count', type: 'int', optional: true },
      { name: 'kind', type: 'string', optional: true, useDefault: true, defaultValue: 'plain' },
      { name: 'owner', type: 'string', optional: false, useDefault: true, defaultValue: 'me' }
    ], [
      { type: 'primary', fields: ['_id'], lookup: 'pk__id.json' }
    ])

    const [[nullable]] = await query('insert notes values text = null')
    expect(nullable.text).toBeNull()

    // An optional field that isn't nullable can't hold null: null means leaving it out, so its default fills it in
    const [[optional]] = await query('insert notes values count = null, kind = null')
    expect(optional).not.toHaveProperty('count')
    expect(optional.kind).toBe('plain')
    const [[stored]] = await query(`read notes where _id = '${optional._id}'`)
    expect(stored).not.toHaveProperty('count')

    await expect(query('insert notes values owner = null'))
      .rejects.toThrow('Value "null" is not allowed: the field is not nullable')
  })

  test('reads negative, decimal and exponent numbers end to end', async () => {
    const above = await query('read workouts where reps > -1')
    expect(above[0]).toHaveLength(6)

    // main read 1.5 as the field 5 of a record 1, and failed with "Could not read 5.json"
    await expect(query("insert workouts values _id = 98, reps = 1.5, order = 0, date = '2024-06-10', exercise_id = 1"))
      .rejects.toThrow('Value "1.5" is not a valid int')

    const [[inserted]] = await query("insert workouts values _id = 99, weight_effort = 2.5e1, reps = -3, order = 0, date = '2024-06-10', exercise_id = 1")
    expect(inserted).toMatchObject({ weight_effort: '25', reps: -3 })
    const [found] = await query('read workouts where reps < 0')
    expect(found.map(row => String(row._id))).toEqual(['99'])
  })

  test('refuses a whole number too large to store exactly, instead of storing it rounded', async () => {
    await expect(query("insert workouts values _id = 98, reps = 9007199254740993, order = 0, date = '2024-06-10', exercise_id = 1"))
      .rejects.toThrow('9007199254740993 is too large to store exactly')
    const [rows] = await query("read workouts where date = '2024-06-10'")
    expect(rows).toEqual([])
  })

  describe('null and missing, through an index and without one', () => {
    beforeEach(async () => {
      await query('create scores (_id string auto, name string, n int optional null, m int optional null, primary key (_id), index (n))')
      for (const row of ["name = 'five', n = 5, m = 5", "name = 'zero', n = 0, m = 0", "name = 'null', n = null, m = null", "name = 'missing'"]) {
        await query(`insert scores values ${row}`)
      }
    })
    const names = async (text) => (await query(text))[0].map(row => row.name).sort()

    // n has an index (the condition is answered from the index file first), m doesn't
    test.each(['n', 'm'])('%s: ordering never matches null or missing', async (field) => {
      expect(await names(`read scores where ${field} < 6`)).toEqual(['five', 'zero'])
      expect(await names(`read scores where ${field} between [-1, 5]`)).toEqual(['five', 'zero'])
      expect(await names(`read scores where ${field} != 5`)).toEqual(['zero'])
    })

    test.each(['n', 'm'])('%s: is null, is not null, exists, does not exist', async (field) => {
      expect(await names(`read scores where ${field} is null`)).toEqual(['null'])
      expect(await names(`read scores where ${field} is not null`)).toEqual(['five', 'zero'])
      expect(await names(`read scores where ${field} exists`)).toEqual(['five', 'null', 'zero'])
      expect(await names(`read scores where ${field} does not exist`)).toEqual(['missing'])
    })

    test('= null is an error that points to is null', async () => {
      await expect(query('read scores where n = null')).rejects.toThrow('use `n is null` or `n is not null`')
    })

    test('sorts missing, then null, then the values', async () => {
      const [rows] = await query('read scores sort n asc')
      expect(rows.map(row => row.name)).toEqual(['missing', 'null', 'zero', 'five'])
    })

    test('update and delete use the same rules', async () => {
      await query("update scores set name = 'was null' where m is null")
      expect(await names('read scores where m is null')).toEqual(['was null'])
      await query('delete scores where n does not exist')
      expect(await names('read scores')).toEqual(['five', 'was null', 'zero'])
    })

    // three-valued logic: a comparison on null or missing is unknown, and only a true where clause keeps a row
    test.each(['n', 'm'])('%s: not / and / or keep a row only when the whole clause is true', async (field) => {
      expect(await names(`read scores where not ${field} = 5`)).toEqual(['zero'])
      expect(await names(`read scores where not (${field} = 5)`)).toEqual(await names(`read scores where ${field} != 5`))
      expect(await names(`read scores where not (${field} < 6)`)).toEqual([])
      expect(await names(`read scores where ${field} = 5 or ${field} = 0`)).toEqual(['five', 'zero'])
      expect(await names(`read scores where ${field} = 5 or ${field} is null`)).toEqual(['five', 'null'])
      // true or unknown = true (null), false or unknown = unknown (missing)
      expect(await names(`read scores where ${field} > 0 or name = 'null'`)).toEqual(['five', 'null'])
      // false and unknown = false, so not (...) keeps missing; true and unknown = unknown, so null is dropped
      expect(await names(`read scores where not (${field} > 0 and name = 'null')`)).toEqual(['five', 'missing', 'zero'])
      expect(await names(`read scores where not (${field} = 5 or name = 'missing')`)).toEqual(['zero'])
      // a null in an in list: no match is unknown, so not (...) keeps nothing that isn't matched
      expect(await names(`read scores where ${field} in [5, null]`)).toEqual(['five'])
      expect(await names(`read scores where not (${field} in [5, null])`)).toEqual([])
      expect(await names(`read scores where not (${field} in [5])`)).toEqual(['zero'])
      // an indexed condition (n) narrows the rows, the not still applies
      expect(await names(`read scores where ${field} >= 0 and not (${field} = 5)`)).toEqual(['zero'])
    })

    test('update and delete with or / not', async () => {
      await query("update scores set name = 'changed' where n = 5 or m is null")
      expect(await names('read scores')).toEqual(['changed', 'changed', 'missing', 'zero'])
      await query('delete scores where not (n exists) or n = 0')
      expect(await names('read scores')).toEqual(['changed', 'changed'])
    })
  })

  describe('update and delete with a condition on another entity\'s field', () => {
    const join = 'workouts.exercises on workouts.exercise_id = exercises._id'
    const count = async () => (await query('read workouts'))[0].length

    // exercises._id is indexed: it used to be dropped once its index had narrowed the exercises, and the delete then
    // hit every workout
    // update and delete take no joined record since 3.0.0 (see splitClauses); the conditions are still checked without one
    test.each([
      ['delete workouts where exercises._id = 1', 'delete can only use conditions on workouts\'s own fields, not exercises._id'],
      ["delete workouts where exercises.name = 'Bench Press'", 'not exercises.name'],
      ["delete workouts where date = '2024-06-02' and exercises._id = 1", 'not exercises._id'],
      ['update workouts set reps = 1 where exercises._id = 1', 'update can only use conditions on workouts\'s own fields, not exercises._id'],
      [`delete ${join} where exercises._id = 1`, 'A joined record (workouts.exercises) isn\'t allowed in a delete query'],
      [`update ${join} set reps = 1 where exercises._id = 1`, 'A joined record (workouts.exercises) isn\'t allowed in an update query']
    ])('%s is refused and changes nothing', async (text, message) => {
      await expect(query(text)).rejects.toThrow(message)
      expect(await count()).toBe(6)
      const [rows] = await query('read workouts where reps = 1')
      expect(rows).toEqual([])
    })

    test('the entity\'s own fields, written with its name, are still allowed', async () => {
      await query("delete workouts where workouts.date = 'none'")
      expect(await count()).toBe(6)
    })
  })

  describe('several indexed conditions (date has an index, exercise_id a foreign key index)', () => {
    const ids = async (text) => (await query(text))[0].map(row => String(row._id)).sort()

    test('every indexed condition must match, in either order (each used to replace the one before)', async () => {
      expect(await ids("read workouts where date = '2024-06-02' and exercise_id = 1")).toEqual(['1'])
      expect(await ids("read workouts where exercise_id = 1 and date = '2024-06-02'")).toEqual(['1'])
      expect(await ids("read workouts where exercise_id = 1 and date = '2024-06-05'")).toEqual(['4'])
      expect(await ids("read workouts where exercise_id = 1 and date = '2024-06-09'")).toEqual([])
    })

    test('an indexed and an unindexed condition together', async () => {
      expect(await ids("read workouts where date = '2024-06-05' and reps = 10 and exercise_id in [2, 3]")).toEqual(['5', '6'])
    })

    test('update changes only the rows every condition matches', async () => {
      await query("update workouts set note = 'x' where date = '2024-06-02' and exercise_id = 1")
      expect(await ids("read workouts where note = 'x'")).toEqual(['1'])
    })

    test.each([
      ['read', "read workouts where date = '2024-06-09' and reps = 10"],
      ['update', "update workouts set note = 'x' where date = '2024-06-09' and reps = 10"],
      ['delete', "delete workouts where date = '2024-06-09' and reps = 10"]
    ])('%s: an indexed condition matching nothing, with an unindexed one, matches nothing (it used to match every row with reps 10)', async (command, text) => {
      expect((await query(text))[0]).toEqual([])
      expect(await ids('read workouts')).toEqual(['1', '2', '3', '4', '5', '6'])
      expect(await ids("read workouts where note = 'x'")).toEqual([])
    })

    test('delete removes only the rows every condition matches (it used to delete every row with exercise_id 1)', async () => {
      await query("delete workouts where date = '2024-06-02' and exercise_id = 1")
      expect(await ids('read workouts')).toEqual(['2', '3', '4', '5', '6'])
    })
  })

  describe('a field that is part of a composite index', () => {
    beforeEach(async () => {
      await query('create both (_id string auto, name string, x int, y int, primary key (_id), index (x), index (x, y))')
      await query('create composite (_id string auto, name string, x int, y int, primary key (_id), index (x, y))')
      for (const record of ['both', 'composite']) {
        for (const [name, x, y] of [['one', 1, 1], ['two', 1, 2], ['three', 2, 1]]) {
          await query(`insert ${record} values name = '${name}', x = ${x}, y = ${y}`)
        }
      }
    })
    const names = async (text) => (await query(text))[0].map(row => row.name).sort()

    // The composite index holds ["1",1]-style values, so it can't answer a condition on x or y alone: it used to be
    // picked anyway (it came last) and matched nothing
    test.each(['both', 'composite'])('%s: conditions on either field find their rows', async (record) => {
      expect(await names(`read ${record} where x = 1`)).toEqual(['one', 'two'])
      expect(await names(`read ${record} where y = 1`)).toEqual(['one', 'three'])
      expect(await names(`read ${record} where x = 1 and y = 2`)).toEqual(['two'])
    })
  })

  describe('an index only narrows the rows: every condition still applies', () => {
    // A stale index entry (a crash between writing a row and its index can leave one) lists row 4, dated 2024-06-05,
    // under 2024-06-02. The index picks it as a candidate, but the condition itself is still checked on it.
    beforeEach(async () => {
      const file = `${databasePath}__indexes/workouts/index_date.json`
      const index = JSON.parse(await readFile(file, 'utf8'))
      index.find(entry => entry.value === '2024-06-02').record.push('2024-06-05-001.json')
      await writeFile(file, JSON.stringify(index))
    })
    const ids = async (text) => (await query(text))[0].map(row => String(row._id)).sort()

    test('read', async () => {
      expect(await ids("read workouts where date = '2024-06-02'")).toEqual(['1', '2', '3'])
    })

    test('two indexed conditions: the stale row survives the intersection, then the condition drops it', async () => {
      // row 4 has exercise_id 1, so it is in both indexes' answers
      expect(await ids("read workouts where date = '2024-06-02' and exercise_id = 1")).toEqual(['1'])
    })

    test('an indexed and an unindexed condition', async () => {
      expect(await ids("read workouts where date = '2024-06-02' and reps = 10")).toEqual(['1', '2', '3'])
    })

    test('update and delete touch only rows the condition really matches', async () => {
      await query("update workouts set note = 'x' where date = '2024-06-02'")
      expect(await ids("read workouts where note = 'x'")).toEqual(['1', '2', '3'])
      await query("delete workouts where date = '2024-06-02'")
      expect(await ids('read workouts')).toEqual(['4', '5', '6'])
    })
  })

  describe('conditions on a joined entity (an inner join, see joinedConditions.test.js)', () => {
    const joined = async (text) => (await query(text))[0].map(row => [String(row._id), row.exercises.map(exercise => String(exercise._id))])

    // Until the where-clauses epic, this returned every main row, the others with no joined rows
    test('an indexed condition on a joined field keeps only the rows with a matching joined row', async () => {
      expect(await joined('read workouts.exercises on workouts.exercise_id = exercises._id where exercises._id = 1')).toEqual([
        ['1', ['1']], ['4', ['1']]
      ])
    })

    test('an indexed condition matching nothing, with a join, returns nothing', async () => {
      expect(await joined("read workouts.exercises on workouts.exercise_id = exercises._id where date = '2024-06-09'")).toEqual([])
    })
  })

  describe('ordering by the declared type, through an index and without one', () => {
    beforeEach(async () => {
      await query('create typed (_id string auto, s string, i int, si string, ii int, primary key (_id), index (si), index (ii))')
      for (const [s, i] of [['9', 9], ['10', 10], ['2', 2]]) {
        await query(`insert typed values s = '${s}', i = ${i}, si = '${s}', ii = ${i}`)
      }
    })
    const values = async (text, field) => (await query(text))[0].map(row => row[field])
    const sorted = async (text, field) => (await values(text, field)).sort()

    // si and ii have an index (the condition is answered from the index file first), s and i don't
    test.each(['s', 'si'])('%s: a string field compares as text, whether the literal is 2 or \'2\'', async (field) => {
      for (const literal of ['2', "'2'"]) {
        expect(await sorted(`read typed where ${field} > ${literal}`, field)).toEqual(['9'])
        expect(await sorted(`read typed where ${field} < ${literal}`, field)).toEqual(['10'])
        expect(await sorted(`read typed where ${field} between [1, ${literal}]`, field)).toEqual(['10', '2'])
      }
    })

    test.each(['s', 'si'])('%s: a string field sorts as text', async (field) => {
      expect(await values(`read typed sort ${field}`, field)).toEqual(['10', '2', '9'])
      expect(await values(`read typed sort ${field} desc`, field)).toEqual(['9', '2', '10'])
    })

    test('a string field sorts as text even when its values are stored as numbers (the sort clause gets the field\'s type)', async () => {
      // test-data's _id is declared string: rows 1-6 are stored as numbers, an inserted one as text ('10')
      await query("insert workouts values _id = 10, exercise_id = 1, order = 0, date = '2024-06-10'")
      const [rows] = await query('read workouts sort _id')
      expect(rows.map(row => String(row._id))).toEqual(['1', '10', '2', '3', '4', '5', '6'])
    })

    test.each(['i', 'ii'])('%s: an int field compares and sorts as numbers, whether the literal is 2 or \'2\'', async (field) => {
      for (const literal of ['2', "'2'"]) {
        expect((await values(`read typed where ${field} > ${literal} sort ${field}`, field))).toEqual([9, 10])
        expect(await values(`read typed where ${field} between [${literal}, 9]`, field)).toHaveLength(2)
      }
      expect(await values(`read typed sort ${field}`, field)).toEqual([2, 9, 10])
    })
  })
})
