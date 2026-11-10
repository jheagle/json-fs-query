import { retrieveFiles } from './retrieveFiles'
import { configure, getSetting } from './config'

const defaultConcurrency = getSetting('readConcurrency', 16)

afterEach(() => configure({ readConcurrency: defaultConcurrency }))

/**
 * A fake read that resolves each path after `delays[path]` ms (0 by default), fails the paths in `failing`, and
 * records the order reads started in and the most reads in flight at once.
 */
const fakeRead = ({ delays = {}, failing = [] } = {}) => {
  const stats = { started: [], inFlight: 0, maxInFlight: 0 }
  const read = async path => {
    stats.started.push(path)
    stats.inFlight++
    stats.maxInFlight = Math.max(stats.maxInFlight, stats.inFlight)
    await new Promise(resolve => setTimeout(resolve, delays[path] || 0))
    stats.inFlight--
    if (failing.includes(path)) {
      throw new Error(`Could not read ${path}`)
    }
    return { path }
  }
  return { read, stats }
}

const paths = count => Array.from({ length: count }, (_, position) => `rows/${position}.json`)

describe('retrieveFiles', () => {
  test('resolves to the contents in the order of the paths, whatever order the reads finish in', async () => {
    const { read } = fakeRead({ delays: { 'rows/0.json': 30, 'rows/1.json': 10 } })
    expect(await retrieveFiles(paths(4), read)).toEqual(paths(4).map(path => ({ path })))
  })

  test('has at most readConcurrency reads in flight', async () => {
    configure({ readConcurrency: 3 })
    const { read, stats } = fakeRead({ delays: Object.fromEntries(paths(10).map(path => [path, 5])) })
    await retrieveFiles(paths(10), read)
    expect(stats.maxInFlight).toBe(3)
    expect(stats.started).toEqual(paths(10))
  })

  test('reads one at a time with readConcurrency 1, and treats a limit below 1 or not a number as 1', async () => {
    for (const readConcurrency of [1, 0, -4, NaN]) {
      configure({ readConcurrency })
      const { read, stats } = fakeRead()
      await retrieveFiles(paths(5), read)
      expect(stats.maxInFlight).toBe(1)
    }
  })

  test('fails with the first failing file in path order, even when a later one fails first', async () => {
    configure({ readConcurrency: 4 })
    const { read } = fakeRead({ delays: { 'rows/1.json': 30 }, failing: ['rows/1.json', 'rows/3.json'] })
    await expect(retrieveFiles(paths(8), read)).rejects.toThrow('Could not read rows/1.json')
  })

  test('starts no new reads after one fails, and leaves none running', async () => {
    configure({ readConcurrency: 2 })
    const { read, stats } = fakeRead({ delays: { 'rows/1.json': 20 }, failing: ['rows/0.json'] })
    await expect(retrieveFiles(paths(10), read)).rejects.toThrow('Could not read rows/0.json')
    expect(stats.started).toEqual(['rows/0.json', 'rows/1.json'])
    expect(stats.inFlight).toBe(0)
  })

  test('resolves to an empty list for no paths', async () => {
    const { read, stats } = fakeRead()
    expect(await retrieveFiles([], read)).toEqual([])
    expect(stats.started).toEqual([])
  })
})
