import { requireNode } from './requireNode'

describe('requireNode (Node)', () => {
  test('does nothing in Node', () => {
    expect(() => requireNode('insert')).not.toThrow()
  })
})
