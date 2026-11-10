// Simulates exactly what the browser bundle produces: build-tools.config.json's browser.ignore
// replaces 'fs' and 'fs/promises' with an empty object, since a real browser has no filesystem.
// Write functions stay present in the bundle (same public API shape) but throw if actually called
// there, with a message that says why (they used to fail with "... is not a function").
jest.mock('fs/promises', () => ({}))
jest.mock('fs', () => ({}))
jest.mock('browser-or-node', () => ({ isNode: false, isBrowser: true }))

import { create } from './create'

describe('create (browser)', () => {
  test('throws a clear error instead of silently doing nothing when fs is unavailable', async () => {
    await expect(create('foo', [], [])).rejects.toThrow('create() only works in Node: in a browser, json-fs-query can only read the database (over fetch())')
  })
})
