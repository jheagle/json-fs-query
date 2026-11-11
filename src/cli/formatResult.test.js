import { stripVTControlCharacters } from 'util'
import { formatResult } from './formatResult'

describe('formatResult', () => {
  test('rows become a table with a row count', () => {
    expect(formatResult([{ id: 1, note: 'hello' }, { id: 22, note: 'hi' }])).toBe([
      '+----+-------+',
      '| id | note  |',
      '+----+-------+',
      '| 1  | hello |',
      '| 22 | hi    |',
      '+----+-------+',
      '(2 rows)'
    ].join('\n'))
  })

  test('one row says row, not rows', () => {
    expect(formatResult([{ id: 1 }]).split('\n').pop()).toBe('(1 row)')
  })

  test('an empty result is (0 rows)', () => {
    expect(formatResult([])).toBe('(0 rows)')
  })

  test('columns are every field, in the order they first appear', () => {
    const table = formatResult([{ a: 1 }, { b: 2, a: 3 }], { legend: false })
    expect(table.split('\n')[1]).toBe('| a | b |')
  })

  test('missing, null and empty each have their own marker, with a legend for missing and null', () => {
    expect(formatResult([{ a: 1, b: null, c: '' }, { a: 2 }])).toBe([
      '+---+------+----+',
      '| a | b    | c  |',
      '+---+------+----+',
      '| 1 | NULL | \'\' |',
      '| 2 | —    | —  |',
      '+---+------+----+',
      '(2 rows)',
      '— missing · NULL null'
    ].join('\n'))
  })

  test('the legend only names the markers the table shows', () => {
    expect(formatResult([{ a: null }]).split('\n').pop()).toBe('NULL null')
    expect(formatResult([{ a: '' }]).split('\n').pop()).toBe('(1 row)')
  })

  test('0, false, [] and {} show as they are, not as markers', () => {
    const table = formatResult([{ n: 0, b: false, list: [], obj: {} }])
    expect(table.split('\n')[3]).toBe('| 0 | false | []   | {}  |')
  })

  test('nested values are compact JSON and line breaks stay on one line', () => {
    const table = formatResult([{ tags: ['a', 'b'], note: 'two\nlines' }])
    expect(table.split('\n')[3]).toBe('| ["a","b"] | two\\nlines |')
  })

  test('the markers can be changed', () => {
    const table = formatResult([{ a: null }, {}], { markers: { null: '(null)', missing: '(missing)' } })
    expect(table).toContain('| (null)    |')
    expect(table).toContain('| (missing) |')
    expect(table.split('\n').pop()).toBe('(missing) missing · (null) null')
  })

  test('colour dims the markers without breaking the alignment', () => {
    const coloured = formatResult([{ a: null, b: 'x' }, { b: 'longer' }], { color: true })
    expect(coloured).toContain('\u001b[2mNULL\u001b[22m')
    expect(stripVTControlCharacters(coloured)).toBe(formatResult([{ a: null, b: 'x' }, { b: 'longer' }]))
  })

  test('no colour codes unless asked for', () => {
    expect(formatResult([{ a: null }, {}])).toBe(stripVTControlCharacters(formatResult([{ a: null }, {}])))
  })

  test('plain values (e.g. show records) are one value column', () => {
    expect(formatResult(['workouts', 'exercises'])).toBe([
      '+-----------+',
      '| value     |',
      '+-----------+',
      '| workouts  |',
      '| exercises |',
      '+-----------+',
      '(2 rows)'
    ].join('\n'))
  })

  test('a grouped read is a heading and a table per group, missing included', () => {
    const result = [
      { field: 'date', value: '2024-06-05', rows: [{ id: 1, date: '2024-06-05' }] },
      { field: 'date', missing: true, rows: [{ id: 2 }, { id: 3 }] }
    ]
    expect(formatResult(result)).toBe([
      'date = 2024-06-05 (1 row)',
      '  +----+------------+',
      '  | id | date       |',
      '  +----+------------+',
      '  | 1  | 2024-06-05 |',
      '  +----+------------+',
      '  (1 row)',
      '',
      'date is missing (2 rows)',
      '  +----+',
      '  | id |',
      '  +----+',
      '  | 2  |',
      '  | 3  |',
      '  +----+',
      '  (2 rows)'
    ].join('\n'))
  })

  test('nested groups are indented headings, and a null group shows the null marker', () => {
    const result = [
      {
        field: 'date',
        value: null,
        groups: [{ field: 'reps', value: 10, rows: [{ id: 1 }] }]
      }
    ]
    expect(formatResult(result)).toBe([
      'date = NULL (1 group)',
      '  reps = 10 (1 row)',
      '    +----+',
      '    | id |',
      '    +----+',
      '    | 1  |',
      '    +----+',
      '    (1 row)'
    ].join('\n'))
  })

  test('rows that only look a bit like groups are still rows', () => {
    const table = formatResult([{ field: 'name', value: 'x' }])
    expect(table.split('\n')[1]).toBe('| field | value |')
  })

  test('an object (describe) prints as JSON', () => {
    const described = { path: 'database/workouts', definition: [], keys: [] }
    expect(formatResult(described)).toBe(JSON.stringify(described, null, 2))
  })

  test('a single value prints as it is, and null as the marker', () => {
    expect(formatResult('workouts')).toBe('workouts')
    expect(formatResult(null)).toBe('NULL')
  })

  test('a list mixing rows and plain values falls back to JSON', () => {
    expect(formatResult([{ a: 1 }, 'b'])).toBe(JSON.stringify([{ a: 1 }, 'b'], null, 2))
  })
})
