jest.mock('browser-or-node', () => ({
  isBrowser: true,
  isNode: false
}))

import { configure } from '../utilities/config'
import { query } from './query'
import fs from 'fs'
import os from 'os'
import path from 'path'

// A database written by hand (writes need Node), served over a fake fetch() that answers a missing file the way a
// static host does: a 404 page that isn't JSON
let folder
let requests

// 20 rows: more than one round of reads (readConcurrency 16), which is when a packed file is used
const rows = Array.from({ length: 20 }, (_, position) => ({ _id: `r${position}`, day: position % 2 ? 'tue' : 'mon', value: position }))
const entries = rows.map(row => `${row._id}.json`)
const record = {
  path: 'items',
  definition: [
    { name: '_id', type: 'string', optional: false, autoGenerate: false },
    { name: 'day', type: 'string', optional: false, autoGenerate: false },
    { name: 'value', type: 'int', optional: false, autoGenerate: false }
  ],
  keys: [
    { type: 'primary', fields: ['_id'], lookup: 'pk__id.json' },
    { type: 'index', fields: ['day'], lookup: 'index_day.json' }
  ],
  entries
}
const indexes = {
  'pk__id.json': rows.map(row => ({ value: row._id, record: [`${row._id}.json`] })),
  'index_day.json': ['mon', 'tue'].map(day => ({ value: day, record: rows.filter(row => row.day === day).map(row => `${row._id}.json`) }))
}

const write = (file, content) => {
  fs.mkdirSync(path.dirname(path.join(folder, file)), { recursive: true })
  fs.writeFileSync(path.join(folder, file), JSON.stringify(content))
}

const writePack = content => write('__packed/items.json', content)
const entryRequests = () => requests.filter(url => url.startsWith('items/'))

beforeEach(() => {
  folder = fs.mkdtempSync(path.join(os.tmpdir(), 'packed-browser-'))
  write('__RECORDS.json', { path: '', definition: [], keys: [], entries: ['items.json'] })
  write('items.json', record)
  rows.forEach(row => write(`items/${row._id}.json`, row))
  Object.entries(indexes).forEach(([lookup, index]) => write(`__indexes/items/${lookup}`, index))
  requests = []
  global.fetch = jest.fn(async url => {
    requests.push(url.replace('db/', ''))
    const file = path.join(folder, url.replace('db/', ''))
    const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '<!DOCTYPE html><title>404</title>'
    return { text: () => Promise.resolve(text) }
  })
  configure({ databasePath: 'db/', relativePath: '', packedReads: undefined })
})

afterEach(() => {
  fs.rmSync(folder, { recursive: true, force: true })
  delete global.fetch
})

describe('packed tables (browser)', () => {
  test('a full read requests the record file and its packed file, not one request per row', async () => {
    writePack({ entries, rows })
    const [found] = await query('read items')
    expect(found).toEqual(rows)
    expect(requests).toEqual(['items.json', '__packed/items.json'])
  })

  test('a lookup of a few rows requests the index and those rows, not the whole packed file', async () => {
    writePack({ entries, rows })
    const [found] = await query("read items where _id = 'r7'")
    expect(found).toEqual([rows[7]])
    expect(requests).toEqual(['items.json', '__indexes/items/pk__id.json', 'items/r7.json'])
  })

  test('without a packed file, reads request the entry files as before', async () => {
    const [found] = await query('read items')
    expect(found).toEqual(rows)
    expect(requests.slice(0, 2)).toEqual(['items.json', '__packed/items.json'])
    expect(entryRequests()).toEqual(entries.map(file => `items/${file}`))
  })

  test('a packed file whose entries no longer match the record is not used', async () => {
    writePack({ entries: entries.slice(0, 19), rows: rows.slice(0, 19) })
    const [found] = await query('read items')
    expect(found).toEqual(rows)
    expect(entryRequests()).toHaveLength(20)
  })

  test('packedReads: false reads the entry files even when there is a packed file', async () => {
    writePack({ entries, rows: rows.map(row => ({ ...row, fromPack: true })) })
    configure({ packedReads: false })
    const [found] = await query('read items')
    expect(found).toEqual(rows)
    expect(requests).not.toContain('__packed/items.json')
  })

  test('a record of a few rows is read from its entry files without asking for a packed file', async () => {
    const small = { ...record, path: 'small', entries: entries.slice(0, 3) }
    write('small.json', small)
    rows.slice(0, 3).forEach(row => write(`small/${row._id}.json`, row))
    const [found] = await query('read small')
    expect(found).toEqual(rows.slice(0, 3))
    expect(requests).toEqual(['small.json', 'small/r0.json', 'small/r1.json', 'small/r2.json'])
  })
})
