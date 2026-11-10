import { setUp } from 'test-filesystem'
import { configure } from '../utilities/config'
import { query } from './query'
import fs from 'fs'

const databasePath = 'clearer-errors-database/'
configure({ databasePath })
setUp.setDefaults(databasePath)

beforeEach(setUp.beforeEach)

afterEach(setUp.afterEach)

const fill = () => query(`create exercises (_id string, name string, primary key (_id));
  create muscles (_id string, name string, primary key (_id));
  create exercise_muscle (exercise_id string, muscle_id string, primary key (exercise_id, muscle_id),
    foreign key (exercise_id) references exercises (_id), foreign key (muscle_id) references muscles (_id));
  create workouts (_id string, exercise_id string, date string, reps int, note string optional,
    primary key (_id), index (date), foreign key (exercise_id) references exercises (_id));
  insert exercises values (_id = 'e1', name = 'Squat');
  insert muscles values (_id = 'm1', name = 'Quads');
  insert exercise_muscle values (exercise_id = 'e1', muscle_id = 'm1');
  insert workouts values (_id = 'w1', exercise_id = 'e1', date = '2026-11-01', reps = 5)`)

const workoutFields = '_id, exercise_id, date, reps, note'

describe('clearer errors', () => {
  test('a join without the record to join says how to name it', async () => {
    await fill()
    await expect(query('read workouts on workouts.exercise_id = exercises._id'))
      .rejects.toThrow('"on" needs the record to join, after the one read: read workouts.<record> on ...')
  })

  test.each([
    'read nosuch',
    'insert nosuch values a = 1',
    'update nosuch set a = 1',
    'delete nosuch where a = 1',
    'read workouts.nosuch on workouts.exercise_id = nosuch._id'
  ])('a record that does not exist is named as one: %s', async text => {
    await fill()
    await expect(query(text)).rejects.toThrow(/Record "nosuch" doesn't exist/)
  })

  test('a condition on a record that is not in the query says so', async () => {
    await fill()
    await expect(query('read workouts where nosuch.a = 1'))
      .rejects.toThrow('nosuch is not part of this query (nosuch.a): conditions can use the fields of workouts')
  })

  test.each([
    ["insert workouts values _id = 'w2', exercise_id = 'e1', date = 'x', reps = 1, extra = 1", `Unknown field "extra" in insert: workouts has ${workoutFields}`],
    ["insert workouts values (_id = 'w2', exercise_id = 'e1', date = 'x', reps = 1), (_id = 'w3', exercise_id = 'e1', date = 'x', rep = 1)", 'Unknown field "rep" in insert'],
    ["update workouts set nosuch = 1 where _id = 'w1'", `Unknown field "nosuch" in set: workouts has ${workoutFields}`],
    ["read workouts where nosuch = 'x'", `Unknown field "nosuch" in where: workouts has ${workoutFields}`],
    ["read workouts where reps > 1 and (date = 'x' or nosuch = 1)", 'Unknown field "nosuch" in where'],
    ["delete workouts where nosuch = 'x'", 'Unknown field "nosuch" in where'],
    ['read workouts sort nosuch asc', 'Unknown field "nosuch" in sort'],
    ['read workouts group by nosuch', 'Unknown field "nosuch" in group by'],
    ['read workouts select date, nosuch', 'Unknown field "nosuch" in select'],
    ['read workouts.exercises on workouts.exercise_id = exercises.nosuch', 'Unknown field "nosuch" in on: exercises has _id, name'],
    ['read workouts.exercises on workouts.nosuch = exercises._id', 'Unknown field "nosuch" in on: workouts has'],
    ["read workouts.exercises on workouts.exercise_id = exercises._id where exercises.nosuch = 'x'", 'Unknown field "nosuch" in where: exercises has _id, name'],
    ['read workouts.muscles on workouts.exercise_id = exercises._id and on exercises._id = exercise_muscle.nosuch and on exercise_muscle.muscle_id = muscles._id',
      'Unknown field "nosuch" in on: exercise_muscle has exercise_id, muscle_id'],
    ['read workouts.exercises on workouts.exercise_id = exercises._id merge workouts.nosuch with exercises._id', 'Unknown field "nosuch" in merge']
  ])('an unknown field is an error, naming it and the fields there are: %s', async (text, message) => {
    await fill()
    const before = fs.readFileSync(`${databasePath}workouts.json`, 'utf8')
    await expect(query(text)).rejects.toThrow(message)
    expect(fs.readFileSync(`${databasePath}workouts.json`, 'utf8')).toBe(before)
  })

  test('an unknown field in set or insert fails before any row is read', async () => {
    await fill()
    const readFile = jest.spyOn(require('fs/promises'), 'readFile')
    try {
      await expect(query('update workouts set nosuch = 1 where reps > 0')).rejects.toThrow('Unknown field "nosuch" in set')
      await expect(query("insert workouts values _id = 'w9', nosuch = 1")).rejects.toThrow('Unknown field "nosuch" in insert')
      const rowsRead = readFile.mock.calls.map(([location]) => String(location)).filter(location => location.includes('workouts/'))
      expect(rowsRead).toEqual([])
    } finally {
      readFile.mockRestore()
    }
  })

  test('select <record>.<field> picks the queried record\'s field, and a merged record\'s', async () => {
    await fill()
    const [own, merged] = await query(`read workouts select workouts.date, reps as r;
      read workouts select date, exercises.name merge workouts.exercise_id with exercises._id`)
    expect(own).toEqual([{ 'workouts.date': '2026-11-01', r: 5 }])
    expect(merged).toEqual([{ date: '2026-11-01', 'exercises.name': 'Squat' }])
  })

  test('select can\'t pick one field of a joined record\'s rows, and says what can', async () => {
    await fill()
    await expect(query('read workouts.exercises select date, exercises.name on workouts.exercise_id = exercises._id'))
      .rejects.toThrow('Can\'t select "exercises.name": a joined record\'s rows are a list under its name (select exercises), and its fields are on each row only when merged (merge ... with exercises.<field>)')
  })

  test('a field the record defines is fine even when no row has it, and select can name the joined record', async () => {
    await fill()
    const [missing, joined] = await query(`read workouts where note does not exist;
      read workouts.exercises select date, exercises on workouts.exercise_id = exercises._id`)
    expect(missing.map(row => row._id)).toEqual(['w1'])
    expect(joined[0].exercises).toEqual([{ _id: 'e1', name: 'Squat' }])
  })
})
