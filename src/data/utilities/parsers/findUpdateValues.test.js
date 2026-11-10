import { findUpdateValues } from './findUpdateValues'
import { maskArrays, maskStrings, unmaskStrings } from './maskStrings'

const parse = (query) => {
  const parsed = {}
  // parseQuery masks the strings and arrays, then hands each step only its clause's body (see splitClauses)
  const remaining = unmaskStrings(findUpdateValues(parsed, maskArrays(maskStrings(query))), '\'')
  return { parsed, remaining }
}

describe('findUpdateValues', () => {
  test('extracts a single assignment', () => {
    const { parsed, remaining } = parse('reps = 12')
    expect(parsed.updateValues).toEqual({ reps: 12 })
    expect(remaining).toBe('')
  })

  test('extracts multiple comma-separated assignments', () => {
    const { parsed } = parse("reps = 12, note = 'done'")
    expect(parsed.updateValues).toEqual({ reps: 12, note: 'done' })
  })

  test('leaves the text after the last assignment', () => {
    const { parsed, remaining } = parse("reps = 12 'stray'")
    expect(parsed.updateValues).toEqual({ reps: 12 })
    expect(remaining).toBe("'stray'")
  })

  test('extracts every literal shape', () => {
    const { parsed } = parse('active = true, archived = false, note = null, tags = [1,2,3]')
    expect(parsed.updateValues).toEqual({ active: true, archived: false, note: null, tags: [1, 2, 3] })
  })

  test('leaves the body untouched, with an empty updateValues, when it has no assignment', () => {
    const { parsed, remaining } = parse("date '2024-06-02'")
    expect(parsed.updateValues).toEqual({})
    expect(remaining).toBe("date '2024-06-02'")
  })
})
