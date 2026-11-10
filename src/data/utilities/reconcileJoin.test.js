import { reconcileJoin } from './reconcileJoin'

describe('reconcileJoin', () => {
  test('will apply found join with changes', () => {
    const dataSet = {
      workouts: [
        {
          _id: 1,
          exercise_id: 1,
          weight_effort: '115lbs',
          reps: 10,
          sets: 3,
          note: '',
          date: '2024-06-02',
          muscles: [{ _id: 11, name: 'Pectorals', alias: 'chest', image: '' }]
        }
      ],
      muscles: [
        {
          _id: 11,
          name: 'Pectorals',
          alias: 'chest',
          image: '',
          'exercise_muscle._id': 1,
          'exercise_muscle.exercise_id': 1,
          'exercise_muscle.muscle_rank': 100
        },
        { _id: 14, name: 'Triceps', alias: '', image: '' }
      ]
    }
    const entity = 'workouts'
    const index = 0
    const joinEntity = 'muscles'
    const joinProperty = '_id'
    const result = reconcileJoin(dataSet, entity, index, joinEntity, joinProperty)
    expect(result[entity][index][joinEntity][0]).toEqual(dataSet[joinEntity][0])
  })

  test('each joined row gets the merged version of the same row, not the first row with the same merge value', () => {
    const book = (id, title) => ({ _id: id, author_id: 'a1', title })
    const merged = (id, title) => ({ ...book(id, title), 'authors.name': 'Atwood' })
    const dataSet = {
      authors: [{ _id: 'a1', name: 'Atwood', books: [book('b1', 'Surfacing'), book('b2', 'Cats Eye'), book('b3', 'Alias Grace')] }],
      books: [merged('b1', 'Surfacing'), merged('b2', 'Cats Eye'), merged('b3', 'Alias Grace')]
    }
    const result = reconcileJoin(dataSet, 'authors', 0, 'books', 'author_id')
    expect(result.authors[0].books).toEqual([merged('b1', 'Surfacing'), merged('b2', 'Cats Eye'), merged('b3', 'Alias Grace')])
  })

  test('a joined row with no merged version, or without the merge field, is left as it is', () => {
    const dataSet = {
      authors: [{ _id: 'a1', books: [{ _id: 'b9', author_id: 'a1' }, { _id: 'b1' }] }],
      books: [{ _id: 'b1', author_id: 'a1', 'authors.name': 'Atwood' }]
    }
    const result = reconcileJoin(dataSet, 'authors', 0, 'books', 'author_id')
    expect(result.authors[0].books).toEqual([{ _id: 'b9', author_id: 'a1' }, { _id: 'b1' }])
  })
})
