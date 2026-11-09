import { setUp } from 'test-filesystem'
import { configure } from '../utilities/config'
import { query } from './query'
import fs from 'fs'

const folder = 'several-databases/'
setUp.setDefaults(folder)

beforeEach(async () => {
  await setUp.beforeEach()
  configure({ databasePath: `${folder}single/`, databasesPath: undefined, database: undefined })
})

afterEach(async () => {
  configure({ databasePath: 'database/', databasesPath: undefined, database: undefined })
  await setUp.afterEach()
})

const several = () => configure({ databasesPath: folder })

describe('several databases', () => {
  test('database statements need the folder that holds the databases', async () => {
    await expect(query('create database real')).rejects.toThrow("configure({ databasesPath: 'databases/' }) first")
    await expect(query('show databases')).rejects.toThrow('databasesPath')
  })

  test('create database makes an empty one and lists it; show databases lists them in order', async () => {
    several()
    const [real, copy, listed] = await query('create database real; create database copy; show databases')
    expect([real, copy, listed]).toEqual(['real', 'copy', ['real', 'copy']])
    expect(fs.existsSync(`${folder}real`)).toBe(true)
    expect(JSON.parse(fs.readFileSync(`${folder}__DATABASES.json`, 'utf8'))).toEqual(['real', 'copy'])
    await expect(query('create database real')).rejects.toThrow('Database "real" already exists')
    expect(await query('create database if not exists real')).toEqual([null])
  })

  test('use switches the database for the rest of the call and the calls after it; each has its own records', async () => {
    several()
    await query(`create database real; create database copy;
      use real; create workouts (_id string, reps int, primary key (_id)); insert workouts values (_id = 'w1', reps = 5);
      use copy; create workouts (_id string, reps int, primary key (_id)); insert workouts values (_id = 'c1', reps = 9)`)
    const [[copyRow]] = await query('read workouts')
    expect(copyRow._id).toBe('c1')
    const [, realRows, , copyRows] = await query('use real; read workouts; use copy; read workouts')
    expect(realRows.map(row => row._id)).toEqual(['w1'])
    expect(copyRows.map(row => row._id)).toEqual(['c1'])
    expect(fs.existsSync(`${folder}real/workouts/w1.json`)).toBe(true)
  })

  test('configure({ database }) picks the database as use does', async () => {
    several()
    await query('create database real; use real; create notes (_id string, primary key (_id)); insert notes values _id = \'n1\'')
    configure({ database: undefined })
    configure({ database: 'real' })
    const [rows] = await query('read notes')
    expect(rows).toEqual([{ _id: 'n1' }])
  })

  test('drop database deletes another database, but not the one in use', async () => {
    several()
    await query('create database real; create database copy; use copy; create t (_id string, primary key (_id)); use real')
    await expect(query("insert t values _id = 'x'")).rejects.toThrow('Record "t" doesn\'t exist')
    await expect(query('drop database real')).rejects.toThrow('Can\'t drop the database in use ("real"): use another one first')
    expect(await query('drop database copy; show databases')).toEqual(['copy', ['real']])
    expect(fs.existsSync(`${folder}copy`)).toBe(false)
    await expect(query('drop database copy')).rejects.toThrow('Database "copy" doesn\'t exist')
    expect(await query('drop database if exists copy')).toEqual([null])
    await expect(query('use copy')).rejects.toThrow('Database "copy" doesn\'t exist')
  })

  test('a folder that is there but not listed is named as such, and if not exists lists it', async () => {
    several()
    await query('create database real')
    fs.mkdirSync(`${folder}copied`)
    await expect(query('create database copied')).rejects.toThrow('Database "copied" already exists as a folder that isn\'t listed: create database if not exists copied lists it')
    expect(await query('create database if not exists copied; show databases')).toEqual([null, ['real', 'copied']])
  })

  test('create database lists the name before it makes the folder, so a stop part way leaves a usable database', async () => {
    several()
    const files = require('fs/promises')
    const original = files.mkdir.bind(files)
    const mkdir = jest.spyOn(files, 'mkdir')
    mkdir.mockImplementation(async (location, options) => {
      if (String(location).endsWith('half')) {
        throw new Error('stopped')
      }
      return original(location, options)
    })
    try {
      await expect(query('create database half')).rejects.toThrow('stopped')
    } finally {
      mkdir.mockRestore()
    }
    expect(await query('show databases')).toEqual([['half']])
    expect(fs.existsSync(`${folder}half`)).toBe(false)
    await query("use half; create notes (_id string, primary key (_id)); insert notes values _id = 'n1'")
    expect(fs.existsSync(`${folder}half/notes/n1.json`)).toBe(true)
  })

  test('a record named "database" is still a record', async () => {
    several()
    await query('create database real; use real; create database (a string optional); insert database values a = \'x\'')
    const [rows, records] = await query('read database; show records')
    expect(rows).toEqual([{ a: 'x' }])
    expect(records).toEqual(['database'])
    await query('drop database')
    expect(await query('show records')).toEqual([[]])
  })

  test('malformed database statements say what is expected', async () => {
    several()
    await expect(query('use')).rejects.toThrow()
    await expect(query('use real extra')).rejects.toThrow('Unrecognized query value: extra')
    await expect(query('create database real read t')).rejects.toThrow('Missing ; before: read t')
  })

  test('configure() checks the database name, and needs databasesPath with it', () => {
    expect(() => configure({ databasesPath: folder, database: '../x' })).toThrow('Invalid database name "../x"')
    configure({ databasesPath: undefined })
    expect(() => configure({ database: 'real' })).toThrow('needs the folder that holds the databases')
  })

  test('configure() can\'t switch the database while calls are running', async () => {
    several()
    await query('create database real; create database copy; use real')
    const running = query('show records')
    expect(() => configure({ database: 'copy' })).toThrow("Can't change database while 1 database call(s) are still running or queued")
    await running
    configure({ database: 'copy' })
  })
})
