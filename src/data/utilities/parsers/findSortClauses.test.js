import { findSortClauses } from './findSortClauses'

// parseQuery hands each step only its clause's body (see splitClauses)
const parse = (body) => {
  const parsed = { sortClauses: [] }
  const remaining = findSortClauses(parsed, body)
  return { parsed, remaining }
}

describe('findSortClauses', () => {
  test.each([
    ['asc', 'ASC', 'Asc'],
    ['desc', 'DESC', 'Desc']
  ])('%s gives the same clause in any case', (lower, ...others) => {
    const expected = parse(`n ${lower}`)
    expect(expected.parsed.sortClauses).toEqual([{ property: 'n', direction: lower }])
    for (const word of others) {
      expect(parse(`n ${word}`)).toEqual(expected)
    }
  })

  test('lowercases the direction of every rule, and keeps the field name as written', () => {
    expect(parse('Name DESC, other Asc, third').parsed.sortClauses).toEqual([
      { property: 'Name', direction: 'desc' },
      { property: 'other', direction: 'asc' },
      { property: 'third', direction: 'asc' }
    ])
  })

  test('a word that is not a direction is not taken as one', () => {
    const { parsed, remaining } = parse('a b')
    expect(parsed.sortClauses).toEqual([{ property: 'a', direction: 'asc' }])
    expect(remaining).toBe('b')
  })
})
