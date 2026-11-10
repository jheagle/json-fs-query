import { conditionsOf } from '../conditionTree'
import { findConditions } from './findConditions'
import { maskArrays, maskStrings, unmaskStrings } from './maskStrings'

const parse = (query) => {
  const parsed = { where: undefined }
  // parseQuery masks the strings and arrays, then hands each step only its clause's body (see splitClauses)
  const remaining = unmaskStrings(findConditions(parsed, maskArrays(maskStrings(query))), '\'')
  return { parsed, remaining }
}

describe('findConditions', () => {
  test('the where clause is a tree: one condition is itself, several are one and node', () => {
    expect(parse('a = 1').parsed.where).toEqual({ property: 'a', comparator: '=', value: 1 })
    expect(parse("a = 1 and b = 'x' and c is null").parsed.where).toEqual({
      and: [
        { property: 'a', comparator: '=', value: 1 },
        { property: 'b', comparator: '=', value: 'x' },
        { property: 'c', comparator: 'is null', value: null }
      ]
    })
  })

  test('returns the text after the expression, for parseQuery to refuse', () => {
    expect(parse("a = 1 'stray'").remaining).toBe("'stray'")
  })

  test('extracts a quoted string value', () => {
    const { parsed, remaining } = parse("date = '2024-06-02'")
    expect(conditionsOf(parsed.where)).toEqual([{ property: 'date', comparator: '=', value: '2024-06-02' }])
    expect(remaining).toBe('')
  })

  test('extracts an unquoted number as a real number', () => {
    const { parsed } = parse('reps > 10')
    expect(conditionsOf(parsed.where)).toEqual([{ property: 'reps', comparator: '>', value: 10 }])
  })

  test('extracts an array literal as a real array', () => {
    const { parsed } = parse('exercise_id in [1,2,3]')
    expect(conditionsOf(parsed.where)).toEqual([{ property: 'exercise_id', comparator: 'in', value: [1, 2, 3] }])
  })

  test.each(['=', '!=', '>', '<=', 'like'])('refuses a comparison with null (%s), which could never match', (comparator) => {
    expect(() => parse(`note ${comparator} null`)).toThrow(`\`note ${comparator} null\` never matches (null equals nothing, as in SQL): use \`note is null\` or \`note is not null\``)
  })

  test('refuses a null bound in between, which could never match (it used to act as 0)', () => {
    expect(() => parse('n between [null, 5]')).toThrow('`n between` can\'t have a null bound: it would never match')
    expect(() => parse('n BETWEEN [1, null]')).toThrow('can\'t have a null bound')
  })

  test('still accepts null in an in list (it just never matches)', () => {
    expect(conditionsOf(parse('n in [null, 1]').parsed.where)).toEqual([{ property: 'n', comparator: 'in', value: [null, 1] }])
  })

  test.each([
    ['is null', 'is null'],
    ['IS  NOT\tNULL', 'is not null'],
    ['exists', 'exists'],
    ['does not exist', 'does not exist']
  ])('extracts %s, which takes no value', (written, comparator) => {
    const { parsed, remaining } = parse(`note ${written} and reps > 1`)
    expect(conditionsOf(parsed.where)).toEqual([
      { property: 'note', comparator, value: null },
      { property: 'reps', comparator: '>', value: 1 }
    ])
    expect(remaining).toBe('')
  })

  test('reads is null, exists and the rest only as whole words (it used to leave the clause unread)', () => {
    expect(() => parse('note existsx = 1')).toThrow('Missing a condition after where: note existsx = 1')
  })

  test('still reads a field named like the keywords', () => {
    const { parsed } = parse('exists = 1 and is_null exists')
    expect(conditionsOf(parsed.where)).toEqual([
      { property: 'exists', comparator: '=', value: 1 },
      { property: 'is_null', comparator: 'exists', value: null }
    ])
  })

  test('extracts true and false as real booleans', () => {
    const { parsed } = parse('active = true and archived = false')
    expect(conditionsOf(parsed.where)).toEqual([
      { property: 'active', comparator: '=', value: true },
      { property: 'archived', comparator: '=', value: false }
    ])
  })
})
