import { setUp } from 'test-filesystem'
import { configure, getSetting } from '../utilities/config'
import { query } from './query'
import fs from 'fs'

const databasePath = 'parallel-reads-database/'
configure({ databasePath })
setUp.setDefaults(databasePath)

const defaultConcurrency = getSetting('readConcurrency', 16)

beforeEach(setUp.beforeEach)

afterEach(async () => {
  configure({ readConcurrency: defaultConcurrency })
  await setUp.afterEach()
})

const fill = async () => {
  await query(`create parents (_id string, name string, primary key (_id));
    create items (_id string, parent_id string, day string, value int,
      primary key (_id), index (day), foreign key (parent_id) references parents (_id))`)
  for (let parent = 0; parent < 5; parent++) {
    await query(`insert parents values _id = 'p${parent}', name = 'Parent ${parent}'`)
  }
  // Ids that don't sort in insert order, so "in the record's order" is really checked
  for (let item = 0; item < 40; item++) {
    await query(`insert items values _id = 'i${(item * 7) % 40}', parent_id = 'p${item % 5}', day = 'd${item % 4}', value = ${item}`)
  }
}

const reads = [
  'read items',
  "read items where day = 'd2'",
  "read items where day = 'd1' and value > 10 sort value desc",
  'read items.parents on items.parent_id = parents._id',
  "read items.parents on items.parent_id = parents._id where day = 'd3'",
  "read items.parents on items.parent_id = parents._id where parents.name = 'Parent 2'"
]

describe('reads with several files in flight', () => {
  test('return exactly what reading one file at a time returns', async () => {
    await fill()
    configure({ readConcurrency: 1 })
    const oneAtATime = await query(reads.join(';\n'))
    configure({ readConcurrency: 16 })
    const parallel = await query(reads.join(';\n'))
    expect(parallel).toEqual(oneAtATime)
    expect(oneAtATime[0].map(row => row._id).slice(0, 4)).toEqual(['i0', 'i7', 'i14', 'i21'])
  })

  // The messages 3.2.0 gives for these (checked against the published package), for every path that reads entry files
  const missingFileCases = [
    ['read items', 'Could not read entity i14.json'],
    ["read items where day = 'd2'", 'Could not read items/i14.json'],
    ["read items where day = 'd3'", 'Could not read items/i21.json'],
    ['read items.parents on items.parent_id = parents._id', 'Could not read entity i14.json'],
    ["read items.parents on items.parent_id = parents._id where parents.name = 'Parent 2'", 'Could not read entity i14.json'],
    ["read parents.items on parents._id = items.parent_id where items.day = 'd0'", 'Could not read entity p3.json']
  ]

  test.each([1, 16])('a missing entry file fails each kind of read with the first missing file, as before (readConcurrency %i)', async readConcurrency => {
    await fill()
    fs.rmSync(`${databasePath}items/i21.json`)
    fs.rmSync(`${databasePath}items/i14.json`)
    fs.rmSync(`${databasePath}parents/p3.json`)
    configure({ readConcurrency })
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      for (const [text, message] of missingFileCases) {
        await expect(query(text)).rejects.toThrow(message)
      }
    } finally {
      error.mockRestore()
    }
  })
})
