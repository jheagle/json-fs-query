jest.mock('browser-or-node', () => ({
  isBrowser: true,
  isNode: false
}))

import { retrieveFile } from './retrieveFile'
import { configure } from './config'

describe('retrieveFile (browser)', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    global.fetch = originalFetch
  })

  test('uses fetch() with relativePath + databasePath instead of reading from disk', async () => {
    configure({ databasePath: 'my-data/', relativePath: 'http://example.com/' })
    const recordContent = { path: 'foo', definition: [], keys: [], entries: [] }
    global.fetch = jest.fn().mockResolvedValue({
      text: () => Promise.resolve(JSON.stringify(recordContent))
    })

    const result = await retrieveFile('foo.json')

    expect(global.fetch).toHaveBeenCalledWith('http://example.com/my-data/foo.json')
    expect(result).toEqual(recordContent)
  })

  test('throws when fetch fails, matching the Node path\'s error behavior', async () => {
    configure({ databasePath: 'my-data/', relativePath: '' })
    global.fetch = jest.fn().mockRejectedValue(new Error('network error'))

    await expect(retrieveFile('missing.json')).rejects.toThrow('Could not read missing.json')
  })
})
