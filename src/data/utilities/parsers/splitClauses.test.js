import { clauseOrder, splitClauses } from './splitClauses'
import { maskArrays, maskStrings } from './maskStrings'
import { parser } from '../../queries/parser'

const split = (query) => splitClauses(maskArrays(maskStrings(query)))
const keywords = (query) => split(query).clauses.map(({ keyword }) => keyword)

// A short, valid body for each clause, so a pair of clauses reads as a real query
const bodies = {
  select: 'a',
  on: 't.x = u.y',
  merge: 't.x with v.y',
  where: 'a = 1',
  'group by': 'a',
  sort: 'a',
  limit: '1',
  offset: '1',
  values: 'a = 1',
  set: 'a = 1',
}
const clause = (keyword) => `${keyword} ${bodies[keyword]}`
const head = (command) => (command === 'read' ? 'read t.u' : `${command} t`)
const allClauses = [...new Set(Object.values(clauseOrder).flat())]

const pairs = Object.entries(clauseOrder).flatMap(([command, order]) =>
  order.flatMap((first, index) => order.slice(index + 1).map((second) => [command, first, second])))

describe('splitClauses', () => {
  test('splits a query into its head and each clause\'s body', () => {
    expect(split('read workouts.exercises select date, reps as r on workouts.exercise_id = exercises._id ' +
      'where reps > 8 and (a = 1 or b = 2) group by date sort date desc limit 10 offset 0')).toEqual({
      command: 'read',
      head: 'read workouts.exercises',
      leading: '',
      clauses: [
        { keyword: 'select', body: 'date, reps as r' },
        { keyword: 'on', body: 'workouts.exercise_id = exercises._id' },
        { keyword: 'where', body: 'reps > 8 and (a = 1 or b = 2)' },
        { keyword: 'group by', body: 'date' },
        { keyword: 'sort', body: 'date desc' },
        { keyword: 'limit', body: '10' },
        { keyword: 'offset', body: '0' },
      ],
    })
  })

  test('keeps any text between the head and the first clause', () => {
    expect(split('read t foo bar where a = 1').leading).toBe('foo bar')
  })

  test('leaves anything that doesn\'t start with read, insert, update or delete to the other parsers', () => {
    expect(split('foo t where a = 1')).toBeUndefined()
  })

  test('clause words in any case', () => {
    expect(keywords('READ t SELECT a WHERE a = 1 GROUP BY a SORT a LIMIT 1 OFFSET 1'))
      .toEqual(['select', 'where', 'group by', 'sort', 'limit', 'offset'])
  })

  test.each(pairs)('%s: %s then %s is accepted', (command, first, second) => {
    expect(keywords(`${head(command)} ${clause(first)} ${clause(second)}`)).toEqual([first, second])
  })

  test.each(pairs)('%s: %s after %s is an error naming the order', (command, first, second) => {
    expect(() => split(`${head(command)} ${clause(second)} ${clause(first)}`))
      .toThrow(`"${first}" can't come after "${second}" (order: ${clauseOrder[command].join(', ')})`)
  })

  test.each(Object.entries(clauseOrder).flatMap(([command, order]) =>
    order.filter((keyword) => keyword !== 'merge').map((keyword) => [command, keyword])
  ))('%s: a second %s is an error', (command, keyword) => {
    expect(() => split(`${head(command)} ${clause(keyword)} ${clause(keyword)}`))
      .toThrow(`Only one "${keyword}" clause is allowed`)
  })

  test.each(Object.entries(clauseOrder).flatMap(([command, order]) =>
    allClauses.filter((keyword) => !order.includes(keyword)).map((keyword) => [command, keyword])
  ))('%s: %s is not allowed', (command, keyword) => {
    const article = command === 'read' || command === 'delete' ? 'a' : 'an'
    expect(() => split(`${head(command)} ${clause(keyword)}`))
      .toThrow(`"${keyword}" isn't allowed in ${article} ${command} query (allowed: ${clauseOrder[command].join(', ')})`)
  })

  test.each([
    ['insert t.u values a = 1', 'A joined record (t.u) isn\'t allowed in an insert query'],
    ['update t.u set a = 1', 'A joined record (t.u) isn\'t allowed in an update query'],
    ['delete t.u where a = 1', 'A joined record (t.u) isn\'t allowed in a delete query'],
    ['delete t .u where a = 1', 'A joined record (t .u) isn\'t allowed in a delete query'],
  ])('only read takes a joined record: %s', (query, message) => {
    expect(() => split(query)).toThrow(message)
  })

  describe('carrying on a clause', () => {
    test('and on adds to the on clause', () => {
      expect(split('read t.v on t.x = u.y and on u.z = v.w where a = 1').clauses).toEqual([
        { keyword: 'on', body: 't.x = u.y and on u.z = v.w' },
        { keyword: 'where', body: 'a = 1' },
      ])
    })

    test('a plain second on is a repeat', () => {
      expect(() => split('read t.v on t.x = u.y on u.z = v.w')).toThrow('Only one "on" clause is allowed')
    })

    test('a merge straight after another, with or without and, adds to it', () => {
      expect(keywords('read t merge t.x with u.y merge t.z with v.w and merge t.q with w.e where a = 1'))
        .toEqual(['merge', 'where'])
    })

    test.each(['and', 'or', 'AND'])('%s where after a where is the 2.x form, an error with a hint', (connector) => {
      expect(() => split(`read t where a = 1 ${connector} where b = 2 sort a`))
        .toThrow(`"${connector.toLowerCase()} where" is no longer supported: use and / or inside one where clause`)
    })

    test('a plain second where is a repeat, with the same hint', () => {
      expect(() => split('read t where a = 1 where b = 2'))
        .toThrow('Only one "where" clause is allowed: use and / or inside one where clause')
    })

    test('and where with no where before it is just out of place', () => {
      expect(() => split('read t sort a and where b = 1')).toThrow('"where" can\'t come after "sort"')
    })
  })

  describe('only top-level clause words count', () => {
    test.each([
      ["read t where a = 'x sort b limit 2' and b = 1", ['where']],
      ['read t where a in [1, "limit", 2]', ['where']],
      ['read t where (a = 1 or b = 2) and c = 3', ['where']],
      ['read t where a = 1 and (b = 1 or (c = 1 and d = 2))', ['where']],
      ["insert t values note = 'where x = 1 sort y'", ['values']],
      ['read t sort t.limit, t.offset', ['sort']],
      ['read t select limitless, sorted, offsets', ['select']],
    ])('%s', (query, expected) => {
      expect(keywords(query)).toEqual(expected)
    })
  })

  describe('a clause word where a name must be is a name', () => {
    test.each([
      ['as a clause\'s first word', 'read t sort limit desc limit 5', [['sort', 'limit desc'], ['limit', '5']]],
      ['after group by', 'read t group by sort sort a', [['group by', 'sort'], ['sort', 'a']]],
      ['after a comma', 'read t select a, limit, offset limit 2', [['select', 'a, limit, offset'], ['limit', '2']]],
      ['after as', 'read t select a as limit limit 2', [['select', 'a as limit'], ['limit', '2']]],
      ['before a comparator', 'read t where limit = 1 and sort > 2 or offset is null', [['where', 'limit = 1 and sort > 2 or offset is null']]],
      ['before exists', 'read t where a = 1 and select exists', [['where', 'a = 1 and select exists']]],
      ['as a set field', 'update t set limit = 1, sort = 2 where where = 3', [['set', 'limit = 1, sort = 2'], ['where', 'where = 3']]],
    ])('%s', (name, query, expected) => {
      expect(split(query).clauses.map(({ keyword, body }) => [keyword, body])).toEqual(expected)
    })
  })

  describe('in a full query', () => {
    test('an out-of-order query fails with the order error', () => {
      expect(() => parser('read t limit 1 where a = 1'))
        .toThrow('"where" can\'t come after "limit" (order: select, on, merge, where, group by, sort, limit, offset)')
    })

    test('fields named like clause words still parse in place', () => {
      const [read] = parser('read t select limit, sort where offset = 1 sort limit desc limit 2')
      expect(read.selectClauses.map(({ property }) => property)).toEqual(['limit', 'sort'])
      expect(read.where).toEqual({ property: 'offset', comparator: '=', value: 1 })
      expect(read.sortClauses).toEqual([{ property: 'limit', direction: 'desc' }])
      expect(read.limit).toBe(2)
    })
  })
})
