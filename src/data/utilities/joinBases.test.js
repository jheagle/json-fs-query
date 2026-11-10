import { query } from '../queries/query'
import { setUp } from 'test-filesystem'
import { configure } from './config'
import { joinEntity } from '../queries/joinEntity'

const fsPromises = require('fs/promises')

const databasePath = 'join-bases-database/'
configure({ databasePath })
setUp.setDefaults(databasePath)

beforeEach(async () => {
  await setUp.beforeEach()
  await query(`create authors (_id string, name string, primary key (_id));
    create books (_id string, title string, author_id string null, year int, primary key (_id), index (author_id));
    create awards (_id string, book_year string, primary key (_id), index (book_year));
    create notes (_id string, author_id string, primary key (_id))`)
  await query(`insert authors values _id = 'a1', name = 'Atwood';
    insert authors values _id = 'a2', name = 'Banks';
    insert books values _id = 'b1', title = 'Surfacing', author_id = 'a1', year = 1972;
    insert books values _id = 'b2', title = 'Excession', author_id = 'a2', year = 1996;
    insert books values _id = 'b3', title = 'Oryx', author_id = 'a1', year = 2003;
    insert awards values _id = 'w1', book_year = '1996';
    insert awards values _id = 'w2', book_year = '01996';
    insert notes values _id = 'n1', author_id = 'a2';
    insert notes values _id = 'n2', author_id = 'a1'`)
})

afterEach(() => {
  jest.restoreAllMocks()
  return setUp.afterEach()
})

/**
 * Run `text`, counting the entry files read from each record's folder.
 * @param text
 */
const readsOf = async text => {
  const reads = {}
  const readFile = fsPromises.readFile
  jest.spyOn(fsPromises, 'readFile').mockImplementation((location, ...args) => {
    const [folder] = String(location).replace(databasePath, '').split('/').slice(-2)
    if (String(location).replace(databasePath, '').split('/').length === 2) {
      reads[folder] = (reads[folder] || 0) + 1
    }
    return readFile(location, ...args)
  })
  const [rows] = await query(text)
  return { reads, rows }
}

describe('which rows a join reads', () => {
  test('through an index on the joined field, only the rows the queried rows can reach', async () => {
    const { reads, rows } = await readsOf("read authors.books on authors._id = books.author_id where _id = 'a2'")
    expect(rows.map(row => [row._id, row.books.map(book => book._id)])).toEqual([['a2', ['b2']]])
    expect(reads.books).toBe(1)
  })

  test('without an index, all of the joined record', async () => {
    const { reads, rows } = await readsOf("read authors.notes on authors._id = notes.author_id where _id = 'a2'")
    expect(rows.map(row => [row._id, row.notes.map(note => note._id)])).toEqual([['a2', ['n1']]])
    expect(reads.notes).toBe(2)
  })

  test('fields of two types (int = string) read all rows, so each side still compares by its own type', async () => {
    const { reads, rows } = await readsOf("read books.awards on books.year = awards.book_year where _id = 'b2'")
    // int 1996 = '01996' as an int, but the awards side compares as strings, so only w1
    expect(rows.map(row => [row._id, row.awards.map(award => award._id)])).toEqual([['b2', ['w1']]])
    expect(reads.awards).toBe(2)
  })

  test('...and the other way round, where narrowing by one side\'s type would drop a row the other side matches', async () => {
    const fs = require('fs')
    await query(`create editions (_id string, code string, primary key (_id));
      create prints (_id string, year int, primary key (_id), index (year))`)
    await query(`insert editions values _id = 'e1', code = '1996';
      insert prints values _id = 'p1', year = 1996;
      insert prints values _id = 'p2', year = 1997`)
    // A hand-edited file: p2's year written '01996', the same int as 1996 but another string
    fs.writeFileSync(`${databasePath}prints/p2.json`, JSON.stringify({ _id: 'p2', year: '01996' }))
    const indexPath = `${databasePath}__indexes/prints/${fs.readdirSync(`${databasePath}__indexes/prints`).find(file => file.includes('year'))}`
    const index = JSON.parse(fs.readFileSync(indexPath, 'utf8')).map(entry => entry.value === 1997 ? { ...entry, value: '01996' } : entry)
    fs.writeFileSync(indexPath, JSON.stringify(index))
    // editions.code compares as a string ('1996' matches p1 only), then prints.year as an int (p1 and p2 both 1996)
    const [rows] = await query('read editions.prints on editions.code = prints.year')
    expect(rows.map(row => [row._id, row.prints.map(print => print._id)])).toEqual([['e1', ['p1', 'p2']]])
  })

  test('a narrowed record isn\'t left on the query\'s data (merge reads all its rows); one read in full is, as before', async () => {
    const [[a2]] = await query("read authors where _id = 'a2'")
    const join = [{ propertyA: 'authors._id', comparator: '=', propertyB: 'books.author_id' }]
    const dataSets = await joinEntity('authors', 'books', { authors: [a2] }, join, true)
    expect(dataSets.authors[0].books.map(book => book._id)).toEqual(['b2'])
    expect(dataSets).not.toHaveProperty('books')
    const unindexed = [{ propertyA: 'authors._id', comparator: '=', propertyB: 'notes.author_id' }]
    expect((await joinEntity('authors', 'notes', { authors: [a2] }, unindexed, true)).notes).toHaveLength(2)
  })

  test('merge after a narrowed join', async () => {
    const [rows] = await query("read books.authors on books.author_id = authors._id merge books.author_id with authors._id where author_id = 'a1'")
    expect(rows.map(row => [row._id, row.authors.map(author => author._id), row['authors.name']])).toEqual([['b1', ['a1'], 'Atwood'], ['b3', ['a1'], 'Atwood']])
  })

  test('each row gets its own copies of its joined rows', async () => {
    const [rows] = await query('read books.authors on books.author_id = authors._id')
    const [first, , third] = rows
    expect(first.authors).toEqual(third.authors)
    expect(first.authors[0]).not.toBe(third.authors[0])
    first.authors[0].name = 'changed'
    expect(third.authors[0].name).toBe('Atwood')
  })
})
