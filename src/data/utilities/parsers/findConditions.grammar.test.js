import { parser } from '../../queries/parser'

// The examples and errors in FEATURE_WORK.md's Grammar section (feature/where-clauses), each as a test
const whereOf = (text) => parser(`read t ${text}`)[0].where
const c = (property, value = 1, comparator = '=') => ({ property, comparator, value })

describe('where clause grammar', () => {
  describe('precedence: or, then and, then not (loosest first); brackets override it', () => {
    test.each([
      ['where a = 1 or b = 1 and c = 1', { or: [c('a'), { and: [c('b'), c('c')] }] }],
      ['where (a = 1 or b = 1) and c = 1', { and: [{ or: [c('a'), c('b')] }, c('c')] }],
      ['where not a = 1 and b = 1', { and: [{ not: c('a') }, c('b')] }],
      ['where not (a = 1 or b = 1)', { not: { or: [c('a'), c('b')] } }],
      ['where a = 1 and (b = 1 or (c = 1 and not d exists))', { and: [c('a'), { or: [c('b'), { and: [c('c'), { not: c('d', null, 'exists') }] }] }] }],
      ['where a = 1 and b = 1 or c = 1 and d = 1', { or: [{ and: [c('a'), c('b')] }, { and: [c('c'), c('d')] }] }],
      ['where not not a = 1', { not: { not: c('a') } }]
    ])('%s', (text, tree) => {
      expect(whereOf(text)).toEqual(tree)
    })
  })

  describe('flattening: a group of the same kind joins its parent', () => {
    test.each([
      ['where a = 1 and (b = 1 and c = 1)', { and: [c('a'), c('b'), c('c')] }],
      ['where (a = 1 or b = 1) or c = 1', { or: [c('a'), c('b'), c('c')] }],
      ['where ((a = 1))', c('a')],
      ['where a = 1 and (b = 1 or c = 1)', { and: [c('a'), { or: [c('b'), c('c')] }] }]
    ])('%s', (text, tree) => {
      expect(whereOf(text)).toEqual(tree)
    })
  })

  describe('keywords in any case', () => {
    test.each([
      ['WHERE a = 1 AND (b = 1 OR NOT c = 1)', { and: [c('a'), { or: [c('b'), { not: c('c') }] }] }]
    ])('%s', (text, tree) => {
      expect(whereOf(text)).toEqual(tree)
    })
  })

  describe('the expression ends at the next clause keyword outside brackets', () => {
    test('clauses after it', () => {
      const [read] = parser('read t where a = 1 or b = 1 sort a desc limit 2 offset 1')
      expect(read.where).toEqual({ or: [c('a'), c('b')] })
      expect(read.sortClauses).toEqual([{ property: 'a', direction: 'desc' }])
      expect([read.limit, read.offset]).toEqual([2, 1])
    })

    test('and on belongs to the join before it, not the expression', () => {
      const [read] = parser('read t.v on t.x = u.y and on u.z = v.w where a = 1 and (b = 1 or c = 1)')
      expect(read.where).toEqual({ and: [c('a'), { or: [c('b'), c('c')] }] })
      expect(read.joinClauses).toHaveLength(2)
    })

    test('brackets, and/or inside strings or arrays are only values', () => {
      expect(whereOf("where a = '(x or y' and b in ['and', ')']")).toEqual({ and: [c('a', '(x or y'), c('b', ['and', ')'], 'in')] })
    })

    test('fields named like keywords still read as fields', () => {
      expect(whereOf('where not = 1 or exists exists')).toEqual({ or: [c('not'), c('exists', null, 'exists')] })
    })

    test('<> is read too, and comparators in any case', () => {
      expect(whereOf("where a <> 1 and b LIKE 'x%' and c IN [1]")).toEqual({ and: [c('a', 1, '<>'), c('b', 'x%', 'like'), c('c', [1], 'in')] })
    })
  })

  describe('errors', () => {
    test.each([
      // Unbalanced brackets are caught first by the query scanner (scanQuery), before the where clause is read
      ['where (a = 1 or b = 2', 'Unclosed bracket: ( never closed'],
      ['where (a = 1 or b = 2 sort a', 'Unclosed bracket: ( never closed'],
      ['where a = 1)', 'Unexpected ) at position 18: there is nothing to close'],
      ['where a = 1 and', 'Missing a condition after and'],
      ['where or a = 1', 'Missing a condition after where: or a = 1'],
      ['where not', 'Missing a condition after not'],
      ['where a = 1 and not', 'Missing a condition after not'],
      ['where ()', 'Empty brackets in a where clause'],
      ['where a = 1 b = 2', 'Missing and/or before: b = 2'],
      ['where', 'Missing a condition after where'],
      ['where a = 1 or', 'Missing a condition after or'],
      ['where (a = 1 and)', 'Missing a condition after and: )'],
      ['where (not) and a = 1', 'Missing a condition after not: ) and a = 1'],
      // The clause rules come first (see splitClauses): the 2.x forms of a second where, then the order
      ['where a = 1 sort a or where b = 1', '"or where" is no longer supported'],
      ['where a = 1 sort a and where b = 1', '"and where" is no longer supported'],
      ['where a = 1 where b = 1', 'Only one "where" clause is allowed'],
      ['where a = 1 or b = 1 and on t.x = u.y', '"on" can\'t come after "where"'],
      ['limit 2 where a = 1 or b = 1 sort a', '"where" can\'t come after "limit"'],
      // Text after the expression that isn't a condition is left for parseQuery, which refuses it
      ['where a = 1 foo', 'Unexpected "foo" after "where a = 1"']
    ])('%s', (text, message) => {
      expect(() => parser(`read t ${text}`)).toThrow(message)
    })
  })
})
