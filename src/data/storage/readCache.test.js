import { setUp } from 'test-filesystem'
import { configure } from '../utilities/config'
import { query } from '../queries/query'
import { readJson, removeDirectory, removeFile, withReadCache, writeJson, makeDirectory } from './index'
import { copyDatabase } from '../../../test-data/copyDatabase'
import fs from 'fs'

const fsPromises = require('fs/promises')

const databasePath = 'read-cache-database/'
configure({ databasePath })
setUp.setDefaults(databasePath)

beforeEach(setUp.beforeEach)

afterEach(() => {
  jest.restoreAllMocks()
  return setUp.afterEach()
})

/**
 * Count the reads that reach the disk while `task` runs, by path inside the database.
 * @param task
 */
const countReads = async task => {
  const reads = {}
  const readFile = fsPromises.readFile
  jest.spyOn(fsPromises, 'readFile').mockImplementation((location, ...args) => {
    const path = String(location).replace(databasePath, '')
    reads[path] = (reads[path] || 0) + 1
    return readFile(location, ...args)
  })
  const result = await task()
  return { reads, result }
}

describe('withReadCache', () => {
  test('a file read twice during a task is read from disk once', async () => {
    await writeJson('a.json', { a: 1 })
    const { reads } = await countReads(() => withReadCache(async () => {
      expect(await readJson('a.json')).toEqual({ a: 1 })
      expect(await readJson('a.json')).toEqual({ a: 1 })
    }))
    expect(reads).toEqual({ 'a.json': 1 })
  })

  test('outside a task nothing is cached', async () => {
    await writeJson('a.json', { a: 1 })
    const { reads } = await countReads(async () => {
      await readJson('a.json')
      await readJson('a.json')
    })
    expect(reads).toEqual({ 'a.json': 2 })
  })

  test('the cache ends with the task: a change made outside it is read by the next task', async () => {
    await writeJson('a.json', { a: 1 })
    await withReadCache(() => readJson('a.json'))
    fs.writeFileSync(`${databasePath}a.json`, JSON.stringify({ a: 2 }))
    expect(await withReadCache(() => readJson('a.json'))).toEqual({ a: 2 })
  })

  test('each read gets its own copy, so changing what was read changes nothing for the next reader', async () => {
    await writeJson('a.json', { list: [1] })
    await withReadCache(async () => {
      const first = await readJson('a.json')
      first.list.push(2)
      expect(await readJson('a.json')).toEqual({ list: [1] })
    })
  })

  test('a write during the task is what later reads get, without reading the disk', async () => {
    await writeJson('a.json', { a: 1 })
    const { reads } = await countReads(() => withReadCache(async () => {
      await readJson('a.json')
      await writeJson('a.json', { a: 2 })
      expect(await readJson('a.json')).toEqual({ a: 2 })
      await writeJson('b.json', { b: 1 })
      expect(await readJson('b.json')).toEqual({ b: 1 })
    }))
    expect(reads).toEqual({ 'a.json': 1 })
  })

  test('a removed file, or a file in a removed folder, is no longer readable during the task', async () => {
    await makeDirectory('folder')
    await writeJson('a.json', { a: 1 })
    await writeJson('folder/b.json', { b: 1 })
    await withReadCache(async () => {
      await readJson('a.json')
      await readJson('folder/b.json')
      await removeFile('a.json')
      await removeDirectory('folder')
      await expect(readJson('a.json')).rejects.toThrow()
      await expect(readJson('folder/b.json')).rejects.toThrow()
    })
  })

  test('a failed read is not kept: the file is read again once it exists', async () => {
    await withReadCache(async () => {
      await expect(readJson('later.json')).rejects.toThrow()
      fs.writeFileSync(`${databasePath}later.json`, '{"later":true}')
      expect(await readJson('later.json')).toEqual({ later: true })
    })
  })

  test('the cache is per database: another databasePath has none during this task', async () => {
    await writeJson('a.json', { a: 1 })
    await withReadCache(async () => {
      await readJson('a.json')
      configure({ databasePath: 'read-cache-other/' })
      try {
        await expect(readJson('a.json')).rejects.toThrow()
      } finally {
        configure({ databasePath })
      }
    })
  })
})

describe('the read cache in query()', () => {
  beforeEach(() => copyDatabase(databasePath))

  test('a join reads each file once, however many rows it joins', async () => {
    const { reads, result } = await countReads(() => query('read workouts.exercises on workouts.exercise_id = exercises._id'))
    expect(result[0].length).toBe(6)
    expect(result[0].every(row => row.exercises.length === 1)).toBe(true)
    expect(Object.values(reads).every(count => count === 1)).toBe(true)
  })

  test('the queries of one call read their own writes', async () => {
    const [, rows] = await query("update workouts set note = 'cached' where _id = 1; read workouts where _id = 1")
    expect(rows).toEqual([expect.objectContaining({ _id: 1, note: 'cached' })])
  })

  test('the next call reads the disk again', async () => {
    await query('read workouts where _id = 1')
    // The fixture's entry files are named by date, not by _id
    const file = `${databasePath}workouts/2024-06-02-001.json`
    fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file, 'utf8')), note: 'edited by hand' }))
    const [rows] = await query('read workouts where _id = 1')
    expect(rows[0].note).toBe('edited by hand')
  })
})

describe('removing while a read is in flight', () => {
  test('a read that starts while a file is being removed leaves nothing cached once it is gone', async () => {
    await writeJson('a.json', { a: 1 })
    const rm = fsPromises.rm
    await withReadCache(async () => {
      let readDuringRemove
      jest.spyOn(fsPromises, 'rm').mockImplementation(async (...args) => {
        // A read that starts while rm runs still finds the file
        readDuringRemove = readJson('a.json')
        await readDuringRemove
        return rm(...args)
      })
      await removeFile('a.json')
      expect(await readDuringRemove).toEqual({ a: 1 })
      await expect(readJson('a.json')).rejects.toThrow()
    })
  })

  test('the same for a file in a folder being removed', async () => {
    await makeDirectory('folder')
    await writeJson('folder/b.json', { b: 1 })
    const rm = fsPromises.rm
    await withReadCache(async () => {
      jest.spyOn(fsPromises, 'rm').mockImplementation(async (...args) => {
        await readJson('folder/b.json')
        return rm(...args)
      })
      await removeDirectory('folder')
      await expect(readJson('folder/b.json')).rejects.toThrow()
    })
  })
})
