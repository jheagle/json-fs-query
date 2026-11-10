import { selectFields } from './selectFields'

describe('selectFields', () => {
  const dataSet = [
    { _id: 1, reps: 10, date: '2024-06-02' },
    { _id: 2, reps: 12, date: '2024-06-05' }
  ]

  test('returns the dataSet unchanged when no select clauses are given', () => {
    expect(selectFields(dataSet, [])).toEqual(dataSet)
  })

  test('shapes each row down to just the selected properties', () => {
    expect(selectFields(dataSet, [{ property: 'date', alias: undefined }, { property: 'reps', alias: undefined }])).toEqual([
      { date: '2024-06-02', reps: 10 },
      { date: '2024-06-05', reps: 12 }
    ])
  })

  test('renames a selected property to its alias', () => {
    expect(selectFields(dataSet, [{ property: 'reps', alias: 'repetitions' }])).toEqual([
      { repetitions: 10 },
      { repetitions: 12 }
    ])
  })

  test('shapes each row within grouped (groupBy) results at any depth, keeping each group\'s field and value', () => {
    const grouped = [
      { field: 'date', value: '2024-06-02', rows: [{ _id: 1, reps: 10, date: '2024-06-02' }] },
      { field: 'date', missing: true, groups: [{ field: 'reps', value: 12, rows: [{ _id: 2, reps: 12 }] }] }
    ]
    expect(selectFields(grouped, [{ property: '_id', alias: 'id' }], true)).toEqual([
      { field: 'date', value: '2024-06-02', rows: [{ id: 1 }] },
      { field: 'date', missing: true, groups: [{ field: 'reps', value: 12, rows: [{ id: 2 }] }] }
    ])
  })
})
