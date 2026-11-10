// In a browser (simulated as in create.browser.test.js), every write and schema change says it needs Node
jest.mock('fs/promises', () => ({}))
jest.mock('fs', () => ({}))
jest.mock('browser-or-node', () => ({ isNode: false, isBrowser: true }))

import { query, drop } from '../../index'
import { requireNode } from './requireNode'

const message = action => `${action} only works in Node: in a browser, json-fs-query can only read the database (over fetch())`

describe('requireNode (browser)', () => {
  test('throws a clear error naming the action', () => {
    expect(() => requireNode('insert')).toThrow(message('insert'))
  })

  test.each([
    ['insert', "insert members values _id = 'x', name = 'X'"],
    ['update', "update members set name = 'Y' where _id = 'x'"],
    ['delete', "delete members where _id = 'x'"],
    ['create', 'create members (_id string, primary key (_id))'],
    ['drop', 'drop members']
  ])('query("%s ...") rejects with the clear error, before touching any file', async (command, text) => {
    await expect(query(text)).rejects.toThrow(message(`"${command}"`))
  })

  test('drop() rejects with the clear error', async () => {
    await expect(drop('members')).rejects.toThrow(message('drop()'))
  })
})
