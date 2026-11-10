import { groupBy } from './groupBy'

const rows = [
  { _id: 1, n: 3, date: '2024-06-05' },
  { _id: 2, n: 2, date: '2024-06-05' },
  { _id: 3, n: 3, date: '2024-06-02' },
  { _id: 4, n: 1, date: '2024-06-02' }
]
const ids = (list) => list.map(({ _id }) => _id)

describe('groupBy', () => {
  test('without fields, the rows are returned as they are', () => {
    expect(groupBy(rows, [])).toBe(rows)
  })

  test('groups are a list of field, value and rows, in the order each first appears', () => {
    expect(groupBy(rows, ['date'])).toEqual([
      { field: 'date', value: '2024-06-05', rows: [rows[0], rows[1]] },
      { field: 'date', value: '2024-06-02', rows: [rows[2], rows[3]] }
    ])
  })

  test('a number field keeps the rows\' order (as object keys, 2.x always put them ascending)', () => {
    expect(groupBy(rows, ['n']).map(({ value }) => value)).toEqual([3, 2, 1])
  })

  test('values keep their type: 1 and \'1\' are two groups', () => {
    expect(groupBy([{ v: 1 }, { v: '1' }, { v: 1 }], ['v']).map(({ value, rows }) => [value, rows.length])).toEqual([[1, 2], ['1', 1]])
  })

  test('null is a group of its own, apart from rows missing the field', () => {
    expect(groupBy([{ v: null }, {}, { v: null }, { v: 0 }], ['v'])).toEqual([
      { field: 'v', value: null, rows: [{ v: null }, { v: null }] },
      { field: 'v', missing: true, rows: [{}] },
      { field: 'v', value: 0, rows: [{ v: 0 }] }
    ])
  })

  test('arrays with the same items in the same order are one group', () => {
    expect(groupBy([{ v: [1, 2] }, { v: [1, 2] }, { v: [2, 1] }], ['v']).map(({ rows }) => rows.length)).toEqual([2, 1])
  })

  test('objects with the same keys and values are one group, whatever their key order', () => {
    const grouped = groupBy([{ v: { a: 1, b: { c: 2, d: 3 } } }, { v: { b: { d: 3, c: 2 }, a: 1 } }, { v: { a: 2 } }], ['v'])
    expect(grouped.map(({ rows }) => rows.length)).toEqual([2, 1])
  })

  test('several fields nest: groups by the first, then by the next within each group', () => {
    const grouped = groupBy(rows, ['date', 'n'])
    expect(grouped.map(({ value, groups }) => [value, groups.map(({ value }) => value)])).toEqual([
      ['2024-06-05', [3, 2]],
      ['2024-06-02', [3, 1]]
    ])
    expect(grouped[0]).not.toHaveProperty('rows')
    expect(ids(grouped[1].groups[1].rows)).toEqual([4])
  })
})
