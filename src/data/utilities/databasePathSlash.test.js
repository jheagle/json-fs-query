import { query, create, configure } from '../../index'
import { activeDatabasePath } from './config'
import { setUp } from 'test-filesystem'
import fs from 'fs'

// configure({ databasePath }) without its trailing slash: file names were joined straight onto it, so `slash-database`
// read and wrote `slash-databasefoo.json` next to the folder instead of `slash-database/foo.json` inside it, and
// every record looked missing
const folder = 'slash-database/'
setUp.setDefaults(folder)

beforeEach(() => {
  configure({ databasePath: 'slash-database' })
  return setUp.beforeEach()
})

afterEach(setUp.afterEach)

describe('databasePath without a trailing slash', () => {
  test('the database in use is the folder, with its slash', () => {
    expect(activeDatabasePath()).toBe('slash-database/')
  })

  test('records are written inside the folder and read back', async () => {
    const definition = [
      { name: '_id', type: 'string', optional: false, autoGenerate: true },
      { name: 'note', type: 'string', optional: true, autoGenerate: false }
    ]
    await create('foo', definition, [{ type: 'primary', fields: ['_id'], lookup: 'pk__id.json' }])
    await query("insert foo values note = 'hello'")

    expect(fs.existsSync('slash-database/foo.json')).toBe(true)
    expect(fs.existsSync('slash-databasefoo.json')).toBe(false)
    const read = await query('read foo')
    expect(read[0].map(row => row.note)).toEqual(['hello'])
  })

  test('a path that already ends with a slash, and the empty path, are left as they are', () => {
    configure({ databasePath: 'slash-database/' })
    expect(activeDatabasePath()).toBe('slash-database/')
    configure({ databasePath: '' })
    expect(activeDatabasePath()).toBe('')
  })
})
