import { setUp } from 'test-filesystem'
import { configure } from '../utilities/config'
import { listFiles, makeDirectory, removeDirectory, removeFile, withWriteSet, writeJson } from './index'

const databasePath = 'list-files-database/'
configure({ databasePath })
setUp.setDefaults(databasePath)

beforeEach(setUp.beforeEach)

afterEach(setUp.afterEach)

const fill = async () => {
  await writeJson('__RECORDS.json', {})
  await writeJson('users.json', {})
  await makeDirectory('users')
  await writeJson('users/1.json', {})
  await writeJson('users/2.json', {})
  await makeDirectory('__indexes/users')
  await writeJson('__indexes/users/pk__id.json', [])
}

describe('listFiles', () => {
  test('lists every file in the database, in its folders too, as sorted paths inside the database', async () => {
    await fill()
    expect(await listFiles()).toEqual(['__RECORDS.json', '__indexes/users/pk__id.json', 'users.json', 'users/1.json', 'users/2.json'])
  })

  test('lists one folder, and nothing for a folder that does not exist', async () => {
    await fill()
    expect(await listFiles('users')).toEqual(['users/1.json', 'users/2.json'])
    expect(await listFiles('posts')).toEqual([])
  })

  test('works the same for a databasePath written as ./folder/', async () => {
    await fill()
    configure({ databasePath: `./${databasePath}` })
    try {
      expect(await listFiles('users')).toEqual(['users/1.json', 'users/2.json'])
      expect(await listFiles()).toHaveLength(5)
    } finally {
      configure({ databasePath })
    }
  })

  test('counts what the running statement wrote, deleted and removed', async () => {
    await fill()
    await withWriteSet(async () => {
      await writeJson('users/3.json', {})
      await removeFile('users/1.json')
      await removeDirectory('__indexes')
      expect(await listFiles()).toEqual(['__RECORDS.json', 'users.json', 'users/2.json', 'users/3.json'])
      expect(await listFiles('users')).toEqual(['users/2.json', 'users/3.json'])
    })
  })
})
