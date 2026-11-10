import { findInsertValues } from './findInsertValues'
import { maskArrays, maskStrings, unmaskStrings } from './maskStrings'

const parse = (query) => {
  const parsed = {}
  // parseQuery masks the strings and arrays, then hands each step only its clause's body (see splitClauses)
  const remaining = unmaskStrings(findInsertValues(parsed, maskArrays(maskStrings(query))), '\'')
  return { parsed, remaining }
}

describe('findInsertValues', () => {
  test('extracts a single row, wrapped in a one-element array', () => {
    const { parsed, remaining } = parse("reps = 12, date = '2024-06-02'")
    expect(parsed.insertValues).toEqual([{ reps: 12, date: '2024-06-02' }])
    expect(remaining).toBe('')
  })

  test('extracts every literal shape', () => {
    const { parsed } = parse('active = true, tags = [1,2,3], note = null')
    expect(parsed.insertValues).toEqual([{ active: true, tags: [1, 2, 3], note: null }])
  })

  test('extracts several rows, each in brackets and separated by commas, in order', () => {
    const { parsed, remaining } = parse("(reps = 12, date = '2024-06-02'), (reps = 10, date = '2024-06-03'),(reps = -1)")
    expect(parsed.insertValues).toEqual([
      { reps: 12, date: '2024-06-02' },
      { reps: 10, date: '2024-06-03' },
      { reps: -1 }
    ])
    expect(remaining).toBe('')
  })

  test('reads one row in brackets as one row', () => {
    expect(parse('(reps = 12)').parsed.insertValues).toEqual([{ reps: 12 }])
  })

  test('keeps brackets and commas inside strings and arrays as part of the value', () => {
    const { parsed } = parse("(note = 'set (warm-up), then work', tags = [1, 2]), (note = '), (')")
    expect(parsed.insertValues).toEqual([{ note: 'set (warm-up), then work', tags: [1, 2] }, { note: '), (' }])
  })

  test('leaves what follows the last row for the parser to report', () => {
    expect(parse('(reps = 12) (reps = 13)').remaining).toBe('(reps = 13)')
    expect(parse('(reps = 12),').remaining).toBe(',')
  })

  test('leaves the body untouched, with an empty insertValues, when it has no assignment', () => {
    const { parsed, remaining } = parse("date '2024-06-02'")
    expect(parsed.insertValues).toEqual([])
    expect(remaining).toBe("date '2024-06-02'")
  })
})
