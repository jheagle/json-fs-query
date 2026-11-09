jest.mock('browser-or-node', () => ({
  isBrowser: true,
  isNode: false
}))

import { configure } from '../utilities/config'
import { query } from './query'

const record = {
  path: 'items',
  definition: [{ name: '_id', type: 'string', optional: false, autoGenerate: false }],
  keys: [{ type: 'primary', fields: ['_id'], lookup: 'pk__id.json' }],
  entries: []
}

beforeEach(() => {
  configure({ databasePath: 'db/', relativePath: '' })
  // A static host answers a missing file with a 404 page, which isn't JSON
  global.fetch = jest.fn(async url => ({
    text: () => Promise.resolve(url === 'db/items.json' ? JSON.stringify(record) : '<!DOCTYPE html><title>404</title>')
  }))
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  delete global.fetch
  jest.restoreAllMocks()
})

describe('clearer errors (browser)', () => {
  test('a record that can\'t be read is named as one', async () => {
    await expect(query('read nosuch')).rejects.toThrow('Record "nosuch" doesn\'t exist, or nosuch.json can\'t be read')
  })

  test('an unknown field is an error in a browser too', async () => {
    await expect(query("read items where nosuch = 'x'")).rejects.toThrow('Unknown field "nosuch" in where: items has _id')
  })
})
