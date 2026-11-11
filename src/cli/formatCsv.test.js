import { formatCsv } from './formatCsv'

describe('formatCsv', () => {
  test('a header line of field names, then a line per row', () => {
    expect(formatCsv([{ id: 1, note: 'hello' }, { id: 2, note: 'hi' }])).toBe('id,note\n1,hello\n2,hi')
  })

  test('columns are every field, in the order they first appear', () => {
    expect(formatCsv([{ a: 1 }, { b: 2, a: 3 }])).toBe('a,b\n1,\n3,2')
  })

  test('null and missing are empty, the empty string is ""', () => {
    expect(formatCsv([{ a: null, b: '' }, {}])).toBe('a,b\n,""\n,')
  })

  test('commas, quotes, line breaks and edge spaces are quoted, quotes doubled', () => {
    expect(formatCsv([{ a: 'x,y', b: 'say "hi"', c: 'two\nlines', d: ' padded' }]))
      .toBe('a,b,c,d\n"x,y","say ""hi""","two\nlines"," padded"')
  })

  test('numbers and booleans as written, objects and arrays as JSON (quoted for their commas and quotes)', () => {
    expect(formatCsv([{ n: 0, b: false, list: [1, 2], obj: { k: 'v' } }]))
      .toBe('n,b,list,obj\n0,false,"[1,2]","{""k"":""v""}"')
  })

  test('a header with a comma is quoted too', () => {
    expect(formatCsv([{ 'a,b': 1 }])).toBe('"a,b"\n1')
  })

  test('an empty result is nothing', () => {
    expect(formatCsv([])).toBe('')
  })

  test('a grouped read is its rows, in group order, nested groups included', () => {
    const result = [
      { field: 'date', value: '2024-06-05', groups: [{ field: 'reps', value: 5, rows: [{ id: 1, date: '2024-06-05', reps: 5 }] }] },
      { field: 'date', missing: true, groups: [{ field: 'reps', value: 8, rows: [{ id: 2, reps: 8 }] }] }
    ]
    expect(formatCsv(result)).toBe('id,date,reps\n1,2024-06-05,5\n2,,8')
  })

  test('plain values (show records) are one value column', () => {
    expect(formatCsv(['workouts', 'tasks'])).toBe('value\nworkouts\ntasks')
  })

  test('an object (describe) is JSON, a single value as it is', () => {
    expect(formatCsv({ path: 'x' })).toBe(JSON.stringify({ path: 'x' }, null, 2))
    expect(formatCsv('real')).toBe('real')
    expect(formatCsv(null)).toBe('')
  })
})
