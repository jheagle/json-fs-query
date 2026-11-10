import { allOf, conditionsOf } from '../utilities/conditionTree'
import { parser } from './parser'

describe('parser', () => {
  test('can parse an update with a set clause and a where clause', () => {
    const query = "update workouts set reps = 12, note = 'done' where date = '2024-06-02'"
    const result = parser(query)
    expect(result).toEqual([
      {
        command: 'update',
        entity: 'workouts',
        joinEntity: undefined,
        selectClauses: [],
        insertValues: [],
        updateValues: { reps: 12, note: 'done' },
        where: allOf([
          {
            property: 'date',
            comparator: '=',
            value: '2024-06-02'
          }
        ]),
        joinClauses: [],
        mergeJoins: [],
        sortClauses: [],
        groupBy: undefined,
        limit: undefined,
        offset: undefined,
      }
    ])
  })

  test('can parse an insert with a values clause', () => {
    const query = "insert workouts values reps = 12, date = '2024-06-02'"
    const result = parser(query)
    expect(result).toEqual([
      {
        command: 'insert',
        entity: 'workouts',
        joinEntity: undefined,
        selectClauses: [],
        insertValues: [{ reps: 12, date: '2024-06-02' }],
        updateValues: {},
        where: undefined,
        joinClauses: [],
        mergeJoins: [],
        sortClauses: [],
        groupBy: undefined,
        limit: undefined,
        offset: undefined,
      }
    ])
  })

  test('can parse simple read', () => {
    const query = 'read workouts' +
      ' where date = \'2024-06-02\''
    const result = parser(query)
    expect(result).toEqual([
      {
        command: 'read',
        entity: 'workouts',
        joinEntity: undefined,
        selectClauses: [],
        insertValues: [],
        updateValues: {},
        where: allOf([
          {
            property: 'date',
            comparator: '=',
            value: '2024-06-02'
          }
        ]),
        joinClauses: [],
        mergeJoins: [],
        sortClauses: [],
        groupBy: undefined,
        limit: undefined,
        offset: undefined,
      }
    ])
  })

  test('can parse read with join', () => {
    const query = 'read workouts.muscles' +
      ' on workouts.exercise_id = exercises._id' +
      ' and on exercises._id = exercise_muscle.exercise_id' +
      ' and on exercise_muscle.muscle_id = muscles._id' +
      ' where muscles.alias = \'chest\''
    const result = parser(query)
    expect(result).toEqual([
      {
        command: 'read',
        entity: 'workouts',
        joinEntity: 'muscles',
        selectClauses: [],
        insertValues: [],
        updateValues: {},
        where: allOf([
          {
            property: 'muscles.alias',
            comparator: '=',
            value: 'chest'
          }
        ]),
        joinClauses: [
          {
            propertyA: 'workouts.exercise_id',
            comparator: '=',
            propertyB: 'exercises._id'
          },
          {
            propertyA: 'exercises._id',
            comparator: '=',
            propertyB: 'exercise_muscle.exercise_id'
          },
          {
            propertyA: 'exercise_muscle.muscle_id',
            comparator: '=',
            propertyB: 'muscles._id'
          }
        ],
        mergeJoins: [],
        sortClauses: [],
        groupBy: undefined,
        limit: undefined,
        offset: undefined,
      }
    ])
  })

  test('can parse read with join and merge', () => {
    const query = 'read workouts.muscles' +
      ' on workouts.exercise_id = exercises._id' +
      ' and on exercises._id = exercise_muscle.exercise_id' +
      ' and on exercise_muscle.muscle_id = muscles._id' +
      ' merge workouts.exercise_id with exercises._id' +
      ' merge exercise_muscle.muscle_id with muscles._id' +
      ' where muscles.alias = \'chest\''
    const result = parser(query)
    expect(result).toEqual([
      {
        command: 'read',
        entity: 'workouts',
        joinEntity: 'muscles',
        selectClauses: [],
        insertValues: [],
        updateValues: {},
        where: allOf([
          {
            property: 'muscles.alias',
            comparator: '=',
            value: 'chest'
          }
        ]),
        joinClauses: [
          {
            propertyA: 'workouts.exercise_id',
            comparator: '=',
            propertyB: 'exercises._id'
          },
          {
            propertyA: 'exercises._id',
            comparator: '=',
            propertyB: 'exercise_muscle.exercise_id'
          },
          {
            propertyA: 'exercise_muscle.muscle_id',
            comparator: '=',
            propertyB: 'muscles._id'
          }
        ],
        mergeJoins: [
          {
            propertyA: 'workouts.exercise_id',
            propertyB: 'exercises._id'
          },
          {
            propertyA: 'exercise_muscle.muscle_id',
            propertyB: 'muscles._id'
          }
        ],
        sortClauses: [],
        groupBy: undefined,
        limit: undefined,
        offset: undefined,
      }
    ])
  })

  test('can parse read with sort clause', () => {
    const query = 'read workouts' +
      ' sort date desc, order'
    const result = parser(query)
    expect(result).toEqual([
      {
        command: 'read',
        entity: 'workouts',
        joinEntity: undefined,
        selectClauses: [],
        insertValues: [],
        updateValues: {},
        where: undefined,
        joinClauses: [],
        mergeJoins: [],
        sortClauses: [
          { property: 'date', direction: 'desc' },
          { property: 'order', direction: 'asc' }
        ],
        groupBy: undefined,
        limit: undefined,
        offset: undefined,
      }
    ])
  })

  test('can parse read with group clause', () => {
    const query = 'read workouts' +
      ' group by date'
    const result = parser(query)
    expect(result).toEqual([
      {
        command: 'read',
        entity: 'workouts',
        joinEntity: undefined,
        selectClauses: [],
        insertValues: [],
        updateValues: {},
        where: undefined,
        joinClauses: [],
        mergeJoins: [],
        sortClauses: [],
        groupBy: ['date'],
        limit: undefined,
        offset: undefined,
      }
    ])
  })

  test('can parse select, limit, and offset', () => {
    const query = 'read workouts.exercises' +
      ' select exercises.name as exercise, workouts.sets as sets, reps' +
      ' on workouts.exercise_id = exercises._id' +
      ' merge workouts.exercise_id with exercises._id' +
      ' limit 2' +
      ' offset 1'
    const result = parser(query)
    expect(result).toEqual([
      {
        command: 'read',
        entity: 'workouts',
        joinEntity: 'exercises',
        selectClauses: [
          {
            property: 'exercises.name',
            alias: 'exercise',
          },
          {
            property: 'workouts.sets',
            alias: 'sets',
          },
          {
            property: 'reps',
            alias: undefined,
          }
        ],
        insertValues: [],
        updateValues: {},
        where: undefined,
        joinClauses: [
          {
            propertyA: 'workouts.exercise_id',
            comparator: '=',
            propertyB: 'exercises._id'
          }
        ],
        mergeJoins: [
          {
            propertyA: 'workouts.exercise_id',
            propertyB: 'exercises._id'
          }
        ],
        sortClauses: [],
        groupBy: undefined,
        limit: 2,
        offset: 1,
      }
    ])
  })

  test('can use queries containing keyword', () => {
    const query = 'read workouts.exercises' +
      ' select exercises.name as exercise, read' +
      ' on workouts.exercise_id = exercises._id' +
      ' merge workouts.exercise_id with exercises._id' +
      ' limit 2' +
      ' offset 1;' +
      ' delete exercises'
    const result = parser(query)
    expect(result).toEqual([
      {
        command: 'read',
        entity: 'workouts',
        joinEntity: 'exercises',
        selectClauses: [
          { property: 'exercises.name', alias: 'exercise' },
          { property: 'read', alias: undefined }
        ],
        insertValues: [],
        updateValues: {},
        where: undefined,
        joinClauses: [
          {
            propertyA: 'workouts.exercise_id',
            comparator: '=',
            propertyB: 'exercises._id'
          }
        ],
        mergeJoins: [
          { propertyA: 'workouts.exercise_id', propertyB: 'exercises._id' }
        ],
        sortClauses: [],
        groupBy: undefined,
        limit: 2,
        offset: 1
      },
      {
        command: 'delete',
        entity: 'exercises',
        joinEntity: undefined,
        selectClauses: [],
        insertValues: [],
        updateValues: {},
        where: undefined,
        joinClauses: [],
        mergeJoins: [],
        sortClauses: [],
        groupBy: undefined,
        limit: undefined,
        offset: undefined
      }
    ])
  })

  test('keeps a value containing a command keyword intact (it used to be split, then glued back without its space)', () => {
    const result = parser("insert notes values text = 'please read this'")
    expect(result[0].insertValues).toEqual([{ text: 'please read this' }])
  })

  test('parses queries separated by ;, with an optional ; at the end', () => {
    const result = parser("read workouts where date = '2024-06-02'; read exercises;")
    expect(result.map(({ command, entity }) => [command, entity])).toEqual([['read', 'workouts'], ['read', 'exercises']])
  })

  test('reports a missing ; between queries', () => {
    expect(() => parser('read workouts read exercises')).toThrow('Failed to interpret: read workouts read exercises (Missing ; before: read exercises)')
  })

  test.each([
    ["read a where x = 'y' read b", 'read b'],
    ['update t set a = 1 read b', 'read b'],
    ["update t set a = 'z' where b = 2 read c", 'read c'],
    ["insert t values a = 1, b = 'w' delete c", 'delete c'],
    ['read a sort x desc limit 2 read b', 'read b']
  ])('reports a missing ; after a query with clauses: %s', (queries, second) => {
    expect(() => parser(queries)).toThrow(`(Missing ; before: ${second})`)
  })

  test('reads a name containing -- as a name, not a comment', () => {
    expect(parser('read my--table')[0].entity).toBe('my--table')
  })

  test('reports which query failed, with the reason', () => {
    expect(() => parser('read workouts; read exercises sort')).toThrow('Failed to interpret query 2 of 2: read exercises sort (Missing a field after sort)')
  })

  describe('strings', () => {
    const only = (queries) => parser(queries)[0]

    test('reads each string of a two-condition where on its own (main read one condition: x\' and b = \'y)', () => {
      expect(conditionsOf(only("read t where a = 'x' and b = 'y'").where).map(({ value }) => value)).toEqual(['x', 'y'])
    })

    test('lets a string hold the other quote', () => {
      expect(only('insert t values name = "it\'s"').insertValues).toEqual([{ name: 'it\'s' }])
      expect(only('insert t values name = \'say "hi"\'').insertValues).toEqual([{ name: 'say "hi"' }])
    })

    test('applies escapes: \\\' is a quote, and \\\\\\\' is a backslash then a quote', () => {
      expect(only("insert t values name = 'it\\'s'").insertValues).toEqual([{ name: 'it\'s' }])
      expect(only("insert t values name = '\\\\\\''").insertValues).toEqual([{ name: '\\\'' }])
    })

    test('keeps keywords, commas and = inside a string out of the other clauses', () => {
      const read = only("read t where a = 'x sort b desc limit 1'")
      expect(conditionsOf(read.where).map(({ value }) => value)).toEqual(['x sort b desc limit 1'])
      expect(read.sortClauses).toEqual([])
      expect(read.limit).toBeUndefined()
      expect(only("update t set note = 'a, b = 2', n = 1").updateValues).toEqual({ note: 'a, b = 2', n: 1 })
    })

    test('reads strings inside an array, with either quote', () => {
      expect(conditionsOf(only('read t where a in ["x","y"]').where)[0].value).toEqual(['x', 'y'])
      expect(conditionsOf(only("read t where a in ['x', 'it\\'s']").where)[0].value).toEqual(['x', 'it\'s'])
    })

    test('rejects mismatched quotes instead of reading them as one string', () => {
      expect(() => parser('insert t values name = \'abc"')).toThrow('Unclosed string')
    })

    test('shows a stray string as it was written in the error', () => {
      expect(() => parser("read t where a = 'x' 'stray'")).toThrow("(Unexpected \"'stray'\" after \"where a = 'x'\")")
    })
  })

  describe('arrays', () => {
    const only = (queries) => parser(queries)[0]

    test('reads two array conditions as two arrays (each used to run to the last ])', () => {
      expect(conditionsOf(only('read t where a in [1,2] and b in [3]').where).map(({ value }) => value)).toEqual([[1, 2], [3]])
    })

    test('reads nested arrays in insert and update (each used to stop at the first ])', () => {
      expect(only('insert t values tags = [1,[2,3]], n = 4').insertValues).toEqual([{ tags: [1, [2, 3]], n: 4 }])
      expect(only('update t set tags = [[1],[2]] where n = 1').updateValues).toEqual({ tags: [[1], [2]] })
    })

    test('keeps decimals, negatives and exponents (a decimal used to lose its fraction)', () => {
      expect(conditionsOf(only('read t where a in [1.5, -2, 1e3]').where)[0].value).toEqual([1.5, -2, 1000])
    })

    test('keeps a ] or a keyword inside a string in an array', () => {
      expect(conditionsOf(only("read t where a in ['x]', 'sort b'] limit 2").where)[0].value).toEqual(['x]', 'sort b'])
      expect(only("read t where a in ['x]', 'sort b'] limit 2").limit).toBe(2)
    })

    test('reports an invalid array clearly', () => {
      expect(() => parser('read t where a in [1,,2]')).toThrow('Invalid array [1,,2]:')
    })
  })

  describe('sort', () => {
    const only = (queries) => parser(queries)[0]

    test('a sort without asc/desc stops before the next clause, so the limit is kept', () => {
      const read = only('read t sort a limit 1')
      expect(read.sortClauses).toEqual([{ property: 'a', direction: 'asc' }])
      expect(read.limit).toBe(1)
    })

    test('several fields, separated by commas, before limit and offset', () => {
      const read = only('read t sort a, b desc, c limit 3 offset 2')
      expect(read.sortClauses).toEqual([
        { property: 'a', direction: 'asc' },
        { property: 'b', direction: 'desc' },
        { property: 'c', direction: 'asc' }
      ])
      expect(read.offset).toBe(2)
      expect(read.limit).toBe(3)
    })

    test('after group by', () => {
      const read = only('read t group by b sort a')
      expect(read.sortClauses).toEqual([{ property: 'a', direction: 'asc' }])
      expect(read.groupBy).toBeDefined()
    })

    test('asc/desc only as a whole word: a field after a comma may start with them', () => {
      expect(only('read t sort a, description').sortClauses).toEqual([
        { property: 'a', direction: 'asc' },
        { property: 'description', direction: 'asc' }
      ])
    })

    test('fields without commas between them are an error, not extra sort fields', () => {
      expect(() => parser('read t sort a b')).toThrow('Unexpected "b" after "sort a"')
    })
  })

  describe('conditions', () => {
    const only = (queries) => parser(queries)[0]

    const hint = 'use and / or inside one where clause (where a = 1 and b = 2)'

    test.each([
      ['read t where a = 1 and where b = 2', `"and where" is no longer supported: ${hint}`],
      ['read t where a = 1 OR WHERE b = 2', `"or where" is no longer supported: ${hint}`],
      ['read t where a = 1 where b = 2', `Only one "where" clause is allowed: ${hint}`],
      ['read t where (a = 1 and where b = 2)', `"and where" is no longer supported: ${hint}`],
      ['read t where c = 3 and (a = 1 OR where b = 2)', `"or where" is no longer supported: ${hint}`]
    ])('the 2.x forms of a second where are errors (3.0): %s', (query, message) => {
      expect(() => parser(query)).toThrow(`(${message})`)
    })

    test('a field named where after and is still a condition (a clause word before a comparator is a name)', () => {
      expect(conditionsOf(only('read t where a = 1 and where = 2').where).map(({ property }) => property)).toEqual(['a', 'where'])
    })

    test('and / or join conditions, in any case', () => {
      const a = { property: 'a', comparator: '=', value: 1 }
      const b = { property: 'b', comparator: '=', value: 2 }
      expect(only('read t where a = 1 OR b = 2').where).toEqual({ or: [a, b] })
      expect(only('read t where a = 1 AND b = 2').where).toEqual({ and: [a, b] })
    })

    test.each(['color', 'brand', 'floor', 'band'])('a join field ending in and/or (%s) keeps its whole name', name => {
      const read = only(`read t.u on t.x = u.${name} where a = 1`)
      expect(read.joinClauses[0].propertyB).toBe(`u.${name}`)
      expect(conditionsOf(read.where)).toEqual([{ property: 'a', comparator: '=', value: 1 }])
    })

    test('where only as a whole word', () => {
      const read = only('read t.u on t.x = u.somewhere where a = 1')
      expect(read.joinClauses[0].propertyB).toBe('u.somewhere')
      expect(conditionsOf(read.where)).toHaveLength(1)
    })

    test('a condition between a join and a sort: all three parse', () => {
      const read = only('read t.u on t.x = u.y where a = 1 and b = 2 sort a')
      expect(read.joinClauses).toEqual([{ propertyA: 't.x', comparator: '=', propertyB: 'u.y' }])
      expect(conditionsOf(read.where).map(({ property }) => property)).toEqual(['a', 'b'])
      expect(read.sortClauses).toEqual([{ property: 'a', direction: 'asc' }])
    })

    test('connectors after a newline or a tab', () => {
      expect(conditionsOf(only('read t where a = 1\nand\tb = 2').where)).toHaveLength(2)
      expect(only('read t where a = 1\nor\tb = 2').where).toEqual({ or: [{ property: 'a', comparator: '=', value: 1 }, { property: 'b', comparator: '=', value: 2 }] })
    })

    test('or where inside a string is just text', () => {
      expect(conditionsOf(only("read t where a = 'x or where b = 2'").where)[0].value).toBe('x or where b = 2')
    })
  })

  describe('select', () => {
    const only = (queries) => parser(queries)[0]

    test.each([
      ['where a = 1', 'where'],
      ['sort a', 'sortClauses'],
      ['limit 1', 'limit'],
      ['group by a', 'groupBy']
    ])('one field before %s: the next clause is not read as its alias', (clause, part) => {
      const read = only(`read t select name ${clause}`)
      expect(read.selectClauses).toEqual([{ property: 'name', alias: undefined }])
      expect(read[part]).toBeTruthy()
    })

    test('aliases with as, on any field, in any case', () => {
      expect(only('read t select a AS x, b, c as y where a = 1').selectClauses).toEqual([
        { property: 'a', alias: 'x' },
        { property: 'b', alias: undefined },
        { property: 'c', alias: 'y' }
      ])
    })

    test('as only as a whole word: a field may start with it', () => {
      expect(only('read t select a, ascent').selectClauses).toEqual([
        { property: 'a', alias: undefined },
        { property: 'ascent', alias: undefined }
      ])
    })

    test('an alias without as is an error, not a silent guess', () => {
      expect(() => parser('read t select name n')).toThrow('Unexpected "n" after "select name"')
    })
  })

  describe('numbers', () => {
    const only = (queries) => parser(queries)[0]

    test.each([
      ['12', 12],
      ['-3', -3],
      ['1.5', 1.5],
      ['-0.25', -0.25],
      ['1e3', 1000],
      ['2.5E-4', 0.00025],
      ['-1e-2', -0.01],
      ['9007199254740991', 9007199254740991]
    ])('reads %s in insert, update and where', (written, value) => {
      expect(only(`insert t values n = ${written}, s = 'x'`).insertValues).toEqual([{ n: value, s: 'x' }])
      expect(only(`update t set n = ${written} where s = 'x'`).updateValues).toEqual({ n: value })
      expect(conditionsOf(only(`read t where n > ${written} and s = 'x'`).where)).toEqual([
        { property: 'n', comparator: '>', value },
        { property: 's', comparator: '=', value: 'x' }
      ])
    })

    test('reads 1.5 as a number, not as the field 5 of a record named 1 (main tried to read 5.json)', () => {
      expect(conditionsOf(only('read t where n = 1.5').where)).toEqual([{ property: 'n', comparator: '=', value: 1.5 }])
      expect(only('insert t values n = 1.5').insertValues).toEqual([{ n: 1.5 }])
    })

    test('still reads a join entity, with or without a space before its dot, next to a decimal', () => {
      expect(only('read workouts.muscles where n = 1.5')).toMatchObject({ joinEntity: 'muscles', where: allOf([{ property: 'n', comparator: '=', value: 1.5 }]) })
      expect(only('read workouts .muscles').joinEntity).toBe('muscles')
      expect(only('read workouts where n = 1.5').joinEntity).toBeUndefined()
    })

    test('still reads name.field (a join\'s field) as a name', () => {
      expect(conditionsOf(only('read t where u.n = 1').where)).toEqual([{ property: 'u.n', comparator: '=', value: 1 }])
    })

    test.each(['1.5.2', '5abc', '1.', '--3', '1e'])('refuses %s, which is not a number', (written) => {
      expect(() => parser(`read t where n = ${written}`)).toThrow('Failed to interpret')
    })

    test('refuses a whole number too large to store exactly, wherever it is written', () => {
      for (const query of [
        'insert t values n = 9007199254740993',
        'update t set n = -9007199254740993',
        'read t where n = 12345678901234567890',
        'read t where n in [1, 9007199254740993]',
        'read t where n = 9007199254740993.0',
        'read t where n = 9007199254740993e0',
        'read t where n = 90071992547409930e-1',
        'insert t values s = 1e20',
        'create t (a string default 9007199254740993.0)'
      ]) {
        expect(() => parser(query)).toThrow('too large to store exactly')
      }
      expect(() => parser('read t where n = 1e999')).toThrow('1e999 is too large')
    })

    test('keeps a large number written as a string, as text', () => {
      expect(only("insert t values n = '9007199254740993'").insertValues).toEqual([{ n: '9007199254740993' }])
    })
  })

  describe('text a clause can\'t read (each clause reads only its own body)', () => {
    test.each([
      ['read t foo bar where a = 1', 'Unexpected "foo bar" after "read t"'],
      ['read t select', 'Missing a field after select'],
      ["read t select a 'x y'", 'Unexpected "\'x y\'" after "select a"'],
      ['read t.u on t.x = u.y junk', 'Unexpected "junk" after "on t.x = u.y"'],
      ['read t.u on t.x = u.y and on junk', 'Unexpected "and on junk" after "on t.x = u.y"'],
      ['read t merge a.x with b.y and merge q', 'Unexpected "and merge q" after "merge a.x with b.y"'],
      ['read t group by', 'Missing a field after group by'],
      ['read t limit x', 'Missing a whole number after limit: x'],
      ['read t limit 5 6', 'Unexpected "6" after "limit 5"'],
      ['read t offset', 'Missing a whole number after offset'],
      ['insert t values', 'Missing an assignment (field = value) after values'],
      ['insert t values a', 'Missing an assignment (field = value) after values: a'],
      ['update t set a = 1 b = 2', 'Unexpected "b = 2" after "set a = 1"'],
      ['readt x', 'Unrecognized query value: readt x']
    ])('%s', (query, message) => {
      expect(() => parser(query)).toThrow(`(${message})`)
    })

    test('several joins and merges, with or without and', () => {
      const read = parser('read t.u on t.x = u.y and on u.z = v.w merge a.x with b.y merge c.z with d.w and merge e.f with g.h')[0]
      expect(read.joinClauses.map(({ propertyA }) => propertyA)).toEqual(['t.x', 'u.z'])
      expect(read.mergeJoins.map(({ propertyA }) => propertyA)).toEqual(['a.x', 'c.z', 'e.f'])
    })

    test.each([['a,b', ['a', 'b']], ['a, b', ['a', 'b']], ['a ,b,c', ['a', 'b', 'c']]])('group by %s: every field, in order (2.x kept only ",b")', (fields, expected) => {
      expect(parser(`read t group by ${fields} sort a`)[0].groupBy).toEqual(expected)
    })

    test('a field named twice in group by is an error', () => {
      expect(() => parser('read t group by a, b, a')).toThrow('("a" is in group by twice)')
    })

    test('group by fields need commas between them', () => {
      expect(() => parser('read t group by a b')).toThrow('(Unexpected "b" after "group by a")')
    })

    test('a field named on after and is a condition (and on used to end the where clause)', () => {
      expect(conditionsOf(parser('read t where a = 1 and on = 2')[0].where).map(({ property }) => property)).toEqual(['a', 'on'])
    })
  })
})
