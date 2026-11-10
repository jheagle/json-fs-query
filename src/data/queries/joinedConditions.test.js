import { query } from './query'
import { joinEntity } from './joinEntity'
import { parser } from './parser'
import { getConditionIndexedList } from '../utilities/getConditionIndexedList'
import { setUp } from 'test-filesystem'
import { configure } from '../utilities/config'
import { copyDatabase } from '../../../test-data/copyDatabase'
import fs from 'fs'

const databasePath = 'joined-conditions-database/'
configure({ databasePath })
setUp.setDefaults(databasePath)

beforeEach(
  () => setUp.beforeEach()
    .then(() => copyDatabase(databasePath))
)

afterEach(setUp.afterEach)

// test-data: exercises 1 Bench Press, 2 Deadlift, 3 Squat; workouts 1-3 on 2024-06-02 and 4-6 on 2024-06-05, each on
// exercise 1, 2, 3 in turn. Indexed: exercises._id, workouts.date, workouts.exercise_id.
const workoutsJoin = 'read workouts.exercises on workouts.exercise_id = exercises._id'
const exercisesJoin = 'read exercises.workouts on exercises._id = workouts.exercise_id'
const musclesJoin = 'read workouts.muscles on workouts.exercise_id = exercises._id' +
  ' and on exercises._id = exercise_muscle.exercise_id and on exercise_muscle.muscle_id = muscles._id'

/**
 * Each row's _id with the _ids of its joined rows.
 * @param text
 * @param joined
 */
const pairs = async (text, joined) => (await query(text))[0]
  .map(row => [String(row._id), row[joined].map(joinedRow => String(joinedRow._id))])

describe('conditions on a joined entity\'s fields: an inner join, evaluated per pair', () => {
  test('a row keeps the joined rows the clause is true for, and is dropped with none', async () => {
    expect(await pairs(`${workoutsJoin} where exercises.name = 'Bench Press'`, 'exercises')).toEqual([['1', ['1']], ['4', ['1']]])
    // several joined rows per row: each keeps only its matching ones
    expect(await pairs(`${exercisesJoin} where workouts.date = '2024-06-02'`, 'workouts')).toEqual([['1', ['1']], ['2', ['2']], ['3', ['3']]])
  })

  test('mixed with the row\'s own fields, through and / or / not', async () => {
    expect(await pairs(`${workoutsJoin} where exercises.name like 'S%' and date = '2024-06-05'`, 'exercises')).toEqual([['6', ['3']]])
    // Squat keeps both workouts through its own name, the others only the 2024-06-05 one
    expect(await pairs(`${exercisesJoin} where name = 'Squat' or workouts.date = '2024-06-05'`, 'workouts'))
      .toEqual([['1', ['4']], ['2', ['5']], ['3', ['3', '6']]])
    expect(await pairs(`${exercisesJoin} where not (workouts.date = '2024-06-02')`, 'workouts')).toEqual([['1', ['4']], ['2', ['5']], ['3', ['6']]])
    expect(await pairs(`${exercisesJoin} where not (name = 'Squat' or workouts._id < 3)`, 'workouts')).toEqual([['1', ['4']], ['2', ['5']]])
  })

  test('the same rows through an index (exercises._id) and without one (exercises.name)', async () => {
    expect(await pairs(`${workoutsJoin} where exercises._id = 1`, 'exercises'))
      .toEqual(await pairs(`${workoutsJoin} where exercises.name = 'Bench Press'`, 'exercises'))
    expect(await pairs(`${workoutsJoin} where exercises._id = 1 or exercises._id = 3`, 'exercises'))
      .toEqual(await pairs(`${workoutsJoin} where exercises.name = 'Bench Press' or exercises.name = 'Squat'`, 'exercises'))
    expect(await pairs(`${workoutsJoin} where date = '2024-06-02' and exercises._id = 2`, 'exercises')).toEqual([['2', ['2']]])
  })

  test('an indexed condition on a joined field that matches nothing returns nothing', async () => {
    // it used to reload every joined row, returning every workout with its exercise
    expect(await pairs(`${workoutsJoin} where exercises._id = 99`, 'exercises')).toEqual([])
  })

  test('a missing joined field is unknown, as on the row itself (no exercise has a `level` field)', async () => {
    // level is defined (optional), but no exercise has one: a field the record didn't define would be an error
    const recordFile = `${databasePath}exercises.json`
    const record = JSON.parse(fs.readFileSync(recordFile, 'utf8'))
    record.definition.push({ name: 'level', type: 'string', optional: true })
    fs.writeFileSync(recordFile, JSON.stringify(record))
    const ids = async (text) => (await pairs(text, 'exercises')).map(([id]) => id)
    expect(await ids(`${workoutsJoin} where exercises.level = 'x'`)).toEqual([])
    // not unknown is unknown: still nothing
    expect(await ids(`${workoutsJoin} where not (exercises.level = 'x')`)).toEqual([])
    // false and unknown is false, so not (...) keeps them
    expect(await ids(`${workoutsJoin} where not (exercises.level = 'x' and exercises._id = 99)`)).toEqual(['1', '2', '3', '4', '5', '6'])
    expect(await ids(`${workoutsJoin} where exercises.level does not exist and exercises._id = 2`)).toEqual(['2', '5'])
    expect(await ids(`${workoutsJoin} where exercises.level exists`)).toEqual([])
  })

  test('the joined entity at the end of a longer join', async () => {
    expect(await pairs(`${musclesJoin} where muscles.alias = 'chest'`, 'muscles')).toEqual([['1', ['11']], ['4', ['11']]])
  })

  test('without a joined condition, rows keep every joined row as before', async () => {
    expect(await pairs(`${workoutsJoin} where date = '2024-06-02'`, 'exercises')).toEqual([['1', ['1']], ['2', ['2']], ['3', ['3']]])
  })
})

describe('which entities a condition can name', () => {
  test('the queried entity\'s own fields, with its name', async () => {
    expect(await pairs(`${workoutsJoin} where workouts.date = '2024-06-02'`, 'exercises')).toEqual([['1', ['1']], ['2', ['2']], ['3', ['3']]])
    // indexed (date) and unindexed (reps)
    expect((await query("read workouts where workouts.reps = 10 and workouts.date = '2024-06-05'"))[0].map(row => row._id)).toEqual([4, 5, 6])
  })

  test('a merged entity\'s fields, read from the merged row as before', async () => {
    const [rows] = await query("read workouts merge workouts.exercise_id with exercises._id where exercises.name = 'Squat'")
    expect(rows.map(row => row._id)).toEqual([3, 6])
  })

  test('an entity that only links the join is an error', async () => {
    await expect(query(`${musclesJoin} where exercise_muscle.muscle_rank = 100`))
      .rejects.toThrow('exercise_muscle only links workouts to muscles: a condition can\'t use its fields (exercise_muscle.muscle_rank)')
    await expect(query(`${musclesJoin} where exercises.name = 'Squat'`)).rejects.toThrow('exercises only links workouts to muscles')
  })

  test('an entity that isn\'t in the query is an error, naming the ones that can be used', async () => {
    await expect(query(`${workoutsJoin} where nothere.x = 1`))
      .rejects.toThrow('nothere is not part of this query (nothere.x): conditions can use the fields of workouts, exercises')
    // a joined entity without an on clause isn't joined
    await expect(query("read workouts.exercises where exercises.name = 'Squat'"))
      .rejects.toThrow('exercises is not part of this query (exercises.name): conditions can use the fields of workouts')
  })

  test.each([
    ['delete workouts where exercises._id = 1', 'can only use conditions on workouts\'s own fields'],
    ["update workouts set reps = 1 where date = '2024-06-02' and exercises.name = 'Squat'", 'can only use conditions on workouts\'s own fields'],
    ["delete workouts where date = '2024-06-02' or exercises._id = 1", 'can only use conditions on workouts\'s own fields'],
    // and take no joined record since 3.0.0 (see splitClauses)
    [`delete ${workoutsJoin.replace('read ', '')} where exercises._id = 1`, 'A joined record (workouts.exercises) isn\'t allowed in a delete query'],
    [`update ${workoutsJoin.replace('read ', '')} set reps = 1 where date = '2024-06-02' and exercises.name = 'Squat'`, 'A joined record (workouts.exercises) isn\'t allowed in an update query']
  ])('update and delete only take the entity\'s own fields, and change nothing: %s', async (text, message) => {
    await expect(query(text)).rejects.toThrow(message)
    const [rows] = await query('read workouts')
    expect(rows.map(row => row.reps)).toEqual([10, 10, 10, 10, 10, 10])
  })
})

describe('joinEntity', () => {
  test('joined rows already resolved (to none, by an index) are not reloaded', async () => {
    const joinClauses = [{ propertyA: 'workouts.exercise_id', comparator: '=', propertyB: 'exercises._id' }]
    const reloaded = await joinEntity('workouts', 'exercises', { exercises: [] }, joinClauses, false, false)
    expect(reloaded.workouts[0].exercises).toHaveLength(1)
    const resolved = await joinEntity('workouts', 'exercises', { exercises: [] }, joinClauses, false, true)
    expect(resolved.workouts.every(row => row.exercises.length === 0)).toBe(true)
  })

  test('an indexed condition on a joined field narrows the joined rows read (only when every row must meet it)', async () => {
    const read = async (clause) => {
      const [parsed] = parser(`${workoutsJoin} where ${clause}`)
      const dataSet = { workouts: [] }
      const resolved = new Set()
      await getConditionIndexedList(parsed, {}, dataSet, resolved)
      return resolved.has('exercises') ? dataSet.exercises.map(row => row._id) : undefined
    }
    expect(await read('exercises._id = 1')).toEqual([1])
    expect(await read("date = '2024-06-02' and exercises._id = 99")).toEqual([])
    expect(await read("date = '2024-06-02' or exercises._id = 1")).toBeUndefined()
  })
})
