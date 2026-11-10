jest.mock('browser-or-node', () => ({
  isBrowser: true,
  isNode: false
}))

import { configure } from '../utilities/config'
import { query } from './query'

// A folder of databases served by a static host: a missing file comes back as a 404 page, which isn't JSON
const files = {
  'dbs/__DATABASES.json': ['real', 'copy'],
  'dbs/copy/notes.json': {
    path: 'notes',
    definition: [{ name: '_id', type: 'string', optional: false, autoGenerate: false }],
    keys: [],
    entries: ['n1.json']
  },
  'dbs/copy/notes/n1.json': { _id: 'n1' }
}

beforeEach(() => {
  configure({ databasePath: 'database/', relativePath: '', databasesPath: 'dbs/', database: 'real' })
  global.fetch = jest.fn(async url => ({
    ok: url in files,
    text: () => Promise.resolve(url in files ? JSON.stringify(files[url]) : '<!DOCTYPE html><title>404</title>')
  }))
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  configure({ databasesPath: undefined, database: undefined })
  delete global.fetch
  jest.restoreAllMocks()
})

describe('several databases (browser)', () => {
  test('show databases and use read the list over fetch(), and reads go to the database in use', async () => {
    const [listed, used, rows] = await query('show databases; use copy; read notes')
    expect(listed).toEqual(['real', 'copy'])
    expect(used).toBe('copy')
    expect(rows).toEqual([{ _id: 'n1' }])
  })

  test('use refuses to switch while another call is running in the page, and works once it is done', async () => {
    let finish
    const slow = new Promise(resolve => { finish = resolve })
    const fetch = global.fetch
    global.fetch = jest.fn(async url => url === 'dbs/real/notes.json' ? slow.then(() => fetch(url)) : fetch(url))
    const running = query('read notes').catch(error => error)
    await expect(query('use copy')).rejects.toThrow('Can\'t use "copy" while other calls are running in this page: await them first, or pick the database with configure({ database }) between calls')
    finish()
    await running
    expect(await query('use copy; read notes')).toEqual(['copy', [{ _id: 'n1' }]])
  })

  test('use of a database not in the list says so, and creating or dropping one needs Node', async () => {
    await expect(query('use other')).rejects.toThrow('Database "other" doesn\'t exist (or isn\'t listed in __DATABASES.json)')
    await expect(query('create database other')).rejects.toThrow('only works in Node')
    await expect(query('drop database copy')).rejects.toThrow('only works in Node')
  })
})
