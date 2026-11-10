import { semiJoin } from './semiJoin'
import { RowLookups } from './rowLookup'

const side = (rows, full = false) => full ? { rows, lookups: new RowLookups(rows) } : { rows }

/**
 * The step as the join has always computed it: through the source rows in order, each adding the target rows it
 * matches (by where's rules) that aren't in yet.
 */
const reference = (target, source, targetProperty, sourceProperty, comparator, type) => {
  const { where } = require('../queries/where')
  const out = []
  for (const row of source) {
    for (const match of where(target, { property: targetProperty, comparator, value: row[sourceProperty], type })) {
      if (!out.includes(match)) {
        out.push(match)
      }
    }
  }
  return out
}

const workouts = [
  { _id: 1, exercise_id: 1 }, { _id: 2, exercise_id: 2 }, { _id: 3, exercise_id: 3 },
  { _id: 4, exercise_id: 1 }, { _id: 5, exercise_id: 2 }, { _id: 6, exercise_id: '3' }, { _id: 7, exercise_id: null }, { _id: 8 }
]
const exercises = [{ _id: 2 }, { _id: '1' }, { _id: 3 }, { _id: 9 }, { _id: null }]

describe('semiJoin', () => {
  test('target rows come grouped in the order of the source rows they match (the order the join has always had)', () => {
    const rows = semiJoin(side(workouts), side(exercises), 'exercise_id', '_id', '=', 'string')
    expect(rows.map(row => row._id)).toEqual([2, 5, 1, 4, 3, 6])
  })

  test('compares by the declared type: \'1\' and 1 match in a string field, null and missing match nothing', () => {
    const rows = semiJoin(side(exercises), side(workouts), '_id', 'exercise_id', '=', 'string')
    expect(rows.map(row => row._id)).toEqual(['1', 2, 3])
  })

  test('the same result through either lookup, with or without the source being all its rows', () => {
    const cases = [
      // target, source, target field, source field
      [workouts, exercises, 'exercise_id', '_id'],
      [exercises, workouts, '_id', 'exercise_id'],
      [workouts.slice(0, 2), exercises, 'exercise_id', '_id'],
      [exercises.slice(0, 1), workouts, '_id', 'exercise_id']
    ]
    for (const [target, source, targetProperty, sourceProperty] of cases) {
      for (const type of ['string', 'int']) {
        const expected = reference(target, source, targetProperty, sourceProperty, '=', type)
        expect(semiJoin(side(target), side(source), targetProperty, sourceProperty, '=', type)).toEqual(expected)
        expect(semiJoin(side(target, true), side(source, true), targetProperty, sourceProperty, '=', type)).toEqual(expected)
        expect(semiJoin(side(target), side(source, true), targetProperty, sourceProperty, '=', type)).toEqual(expected)
      }
    }
  })

  test('returns the rows themselves, each once', () => {
    const rows = semiJoin(side(workouts), side([{ _id: 1 }, { _id: 1 }]), 'exercise_id', '_id', '=', 'int')
    expect(rows).toEqual([workouts[0], workouts[3]])
    expect(rows[0]).toBe(workouts[0])
  })

  test('other comparators, and types compared loosely, compare row by row as where does', () => {
    for (const [comparator, type] of [['!=', 'int'], ['<', 'int'], ['>=', 'int'], ['=', undefined], ['=', 'object']]) {
      expect(semiJoin(side(workouts), side(exercises), 'exercise_id', '_id', comparator, type))
        .toEqual(reference(workouts, exercises, 'exercise_id', '_id', comparator, type))
    }
  })

  test('nothing matches nothing', () => {
    expect(semiJoin(side([]), side(exercises), 'exercise_id', '_id', '=', 'int')).toEqual([])
    expect(semiJoin(side(workouts), side([]), 'exercise_id', '_id', '=', 'int')).toEqual([])
  })
})
