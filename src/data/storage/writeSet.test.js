import { setUp } from 'test-filesystem'
import { configure } from '../utilities/config'
import { fileExists, makeDirectory, readJson, removeDirectory, removeFile, withReadCache, withWriteSet, writeJson } from './index'
import fs from 'fs'

const databasePath = 'write-set-database/'
configure({ databasePath })
setUp.setDefaults(databasePath)

beforeEach(setUp.beforeEach)

afterEach(setUp.afterEach)

const onDisk = path => fs.existsSync(`${databasePath}${path}`)
const diskJson = path => JSON.parse(fs.readFileSync(`${databasePath}${path}`, 'utf8'))
const temporaryFiles = () => fs.readdirSync(databasePath, { recursive: true }).filter(name => String(name).endsWith('.tmp'))

describe('withWriteSet', () => {
  test('writes reach storage only when the task finishes, and reads during it see them', async () => {
    await withWriteSet(async () => {
      await makeDirectory('users')
      await writeJson('users/1.json', { id: 1 })
      expect(onDisk('users/1.json')).toBe(false)
      expect(fileExists('users/1.json')).toBe(true)
      expect(await readJson('users/1.json')).toEqual({ id: 1 })
    })
    expect(diskJson('users/1.json')).toEqual({ id: 1 })
  })

  test('fileExists sees a folder made during the task, and one holding a file written during it', async () => {
    await withWriteSet(async () => {
      await makeDirectory('users')
      await makeDirectory('__indexes/users')
      await writeJson('posts.json', {})
      expect(fileExists('users')).toBe(true)
      expect(fileExists('__indexes')).toBe(true)
      expect(onDisk('users')).toBe(false)
      await removeDirectory('users')
      expect(fileExists('users')).toBe(false)
    })
    expect(onDisk('users')).toBe(false)
    expect(onDisk('__indexes/users')).toBe(true)
  })

  test('a task that throws changes nothing in storage', async () => {
    await writeJson('users.json', { entries: ['1.json'] })
    await makeDirectory('users')
    await writeJson('users/1.json', { id: 1 })
    await expect(withWriteSet(async () => {
      await writeJson('users/2.json', { id: 2 })
      await writeJson('users.json', { entries: ['1.json', '2.json'] })
      await removeFile('users/1.json')
      await makeDirectory('posts')
      throw new Error('the third row is a duplicate')
    })).rejects.toThrow('the third row is a duplicate')
    expect(diskJson('users.json')).toEqual({ entries: ['1.json'] })
    expect(onDisk('users/1.json')).toBe(true)
    expect(onDisk('users/2.json')).toBe(false)
    expect(onDisk('posts')).toBe(false)
  })

  test('a file written many times is written to storage once, with its last content', async () => {
    const writeFile = jest.spyOn(require('fs/promises'), 'writeFile')
    try {
      await withWriteSet(async () => {
        for (let count = 1; count <= 5; count++) {
          await writeJson('users.json', { count })
        }
      })
      expect(writeFile).toHaveBeenCalledTimes(1)
    } finally {
      writeFile.mockRestore()
    }
    expect(diskJson('users.json')).toEqual({ count: 5 })
  })

  test('a deleted file reads as missing during the task and is gone after it', async () => {
    await writeJson('users.json', { id: 1 })
    await withWriteSet(async () => {
      await removeFile('users.json')
      expect(fileExists('users.json')).toBe(false)
      await expect(readJson('users.json')).rejects.toThrow('ENOENT')
      await expect(removeFile('users.json')).rejects.toThrow('ENOENT')
      expect(onDisk('users.json')).toBe(true)
    })
    expect(onDisk('users.json')).toBe(false)
  })

  test('removeFile fails at once, inside a task too, for a file that does not exist', async () => {
    await expect(withWriteSet(() => removeFile('missing.json'))).rejects.toThrow('ENOENT')
  })

  test('a file written after being deleted in the same task is kept', async () => {
    await writeJson('users.json', { version: 1 })
    await withWriteSet(async () => {
      await removeFile('users.json')
      await writeJson('users.json', { version: 2 })
    })
    expect(diskJson('users.json')).toEqual({ version: 2 })
  })

  test('a removed folder hides its files during the task and drops what the task wrote in it', async () => {
    await makeDirectory('users')
    await writeJson('users/1.json', { id: 1 })
    await withWriteSet(async () => {
      await writeJson('users/2.json', { id: 2 })
      await removeDirectory('users')
      expect(fileExists('users/1.json')).toBe(false)
      await expect(readJson('users/2.json')).rejects.toThrow('ENOENT')
      expect(onDisk('users/1.json')).toBe(true)
    })
    expect(onDisk('users')).toBe(false)
  })

  test('a task inside another joins the outer one', async () => {
    await expect(withWriteSet(async () => {
      await withWriteSet(() => writeJson('inner.json', { inner: true }))
      expect(onDisk('inner.json')).toBe(false)
      throw new Error('outer fails')
    })).rejects.toThrow('outer fails')
    expect(onDisk('inner.json')).toBe(false)
  })

  test('the read cache gets the committed content, and keeps the old content after a failed task', async () => {
    await writeJson('users.json', { version: 1 })
    await withReadCache(async () => {
      expect(await readJson('users.json')).toEqual({ version: 1 })
      await expect(withWriteSet(async () => {
        await writeJson('users.json', { version: 2 })
        throw new Error('fails')
      })).rejects.toThrow('fails')
      expect(await readJson('users.json')).toEqual({ version: 1 })
      await withWriteSet(() => writeJson('users.json', { version: 3 }))
      expect(await readJson('users.json')).toEqual({ version: 3 })
    })
  })

  test('a folder removed and then written into in the same task keeps only the new content', async () => {
    await makeDirectory('users')
    await writeJson('users/old.json', { old: true })
    await withWriteSet(async () => {
      await removeDirectory('users')
      await makeDirectory('users')
      await writeJson('users/new.json', { new: true })
      expect(fileExists('users/old.json')).toBe(false)
    })
    expect(fs.readdirSync(`${databasePath}users`)).toEqual(['new.json'])
  })

  test('a failed rename removes its temporary file and throws the rename error', async () => {
    const files = require('fs/promises')
    const rename = jest.spyOn(files, 'rename').mockRejectedValueOnce(new Error('rename failed'))
    try {
      await expect(writeJson('users.json', { id: 1 })).rejects.toThrow('rename failed')
    } finally {
      rename.mockRestore()
    }
    expect(temporaryFiles()).toEqual([])
    expect(onDisk('users.json')).toBe(false)
  })

  test('a failed clean-up after a failed rename still throws the rename error', async () => {
    const files = require('fs/promises')
    const rename = jest.spyOn(files, 'rename').mockRejectedValueOnce(new Error('rename failed'))
    const rm = jest.spyOn(files, 'rm').mockRejectedValueOnce(new Error('rm failed'))
    try {
      await expect(writeJson('users.json', { id: 1 })).rejects.toThrow('rename failed')
    } finally {
      rename.mockRestore()
      rm.mockRestore()
    }
  })

  test('writes leave no temporary files behind, inside a task or not', async () => {
    await writeJson('a.json', { a: 1 })
    await withWriteSet(() => writeJson('b.json', { b: 1 }))
    expect(temporaryFiles()).toEqual([])
    expect(diskJson('a.json')).toEqual({ a: 1 })
    expect(diskJson('b.json')).toEqual({ b: 1 })
  })
})
