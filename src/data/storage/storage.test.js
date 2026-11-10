import { setUp } from 'test-filesystem'
import { configure } from '../utilities/config'
import { fileExists, makeDirectory, readJson, removeDirectory, removeFile, storagePath, writeJson } from './index'
import fs from 'fs'

const databasePath = 'storage-database/'
configure({ databasePath })
setUp.setDefaults(databasePath)

beforeEach(setUp.beforeEach)

afterEach(setUp.afterEach)

describe('storage', () => {
  test('storagePath puts the database folder in front of a path inside the database', () => {
    expect(storagePath('users.json')).toBe('storage-database/users.json')
    expect(storagePath()).toBe('storage-database/')
  })

  test('writeJson writes compact JSON by default, which readJson reads back', async () => {
    const content = { path: 'users', entries: ['1.json'] }
    await writeJson('users.json', content)
    expect(fs.readFileSync(`${databasePath}users.json`, 'utf8')).toBe('{"path":"users","entries":["1.json"]}')
    expect(await readJson('users.json')).toEqual(content)
  })

  test('writeJson writes JSON indented by 2 spaces with format pretty, which readJson reads back', async () => {
    const content = { path: 'users', entries: ['1.json'] }
    configure({ format: 'pretty' })
    try {
      await writeJson('users.json', content)
    } finally {
      configure({ format: 'compact' })
    }
    expect(fs.readFileSync(`${databasePath}users.json`, 'utf8')).toBe(JSON.stringify(content, null, 2))
    expect(await readJson('users.json')).toEqual(content)
  })

  test('readJson rejects for a missing file and for invalid JSON', async () => {
    await expect(readJson('missing.json')).rejects.toThrow()
    fs.writeFileSync(`${databasePath}broken.json`, '{ not json')
    await expect(readJson('broken.json')).rejects.toThrow()
  })

  test('makeDirectory creates nested folders and is fine when they exist', async () => {
    await makeDirectory('__indexes/users')
    await makeDirectory('__indexes/users')
    expect(fs.statSync(`${databasePath}__indexes/users`).isDirectory()).toBe(true)
  })

  test('fileExists tells whether a file is there', async () => {
    expect(fileExists('users.json')).toBe(false)
    await writeJson('users.json', {})
    expect(fileExists('users.json')).toBe(true)
  })

  test('removeFile deletes a file, and fails for a missing one', async () => {
    await writeJson('users.json', {})
    await removeFile('users.json')
    expect(fileExists('users.json')).toBe(false)
    await expect(removeFile('users.json')).rejects.toThrow()
  })

  test('removeDirectory deletes a folder and its files, and ignores a missing one', async () => {
    await makeDirectory('users')
    await writeJson('users/1.json', { id: 1 })
    await removeDirectory('users')
    expect(fileExists('users')).toBe(false)
    await expect(removeDirectory('users')).resolves.toBeUndefined()
  })
})
