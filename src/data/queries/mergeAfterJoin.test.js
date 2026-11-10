import { setUp } from 'test-filesystem'
import { configure } from '../utilities/config'
import { query } from './query'

const databasePath = 'merge-after-join-database/'
configure({ databasePath })
setUp.setDefaults(databasePath)

beforeEach(() => setUp.beforeEach().then(() => query(`create authors (_id string, name string, primary key (_id));
  create books (_id string, author_id string, title string, primary key (_id), foreign key (author_id) references authors (_id));
  insert authors values (_id = 'a1', name = 'Atwood'), (_id = 'a2', name = 'King');
  insert books values (_id = 'b1', author_id = 'a1', title = 'Surfacing'), (_id = 'b2', author_id = 'a1', title = "Cat's Eye"),
    (_id = 'b3', author_id = 'a1', title = 'Alias Grace'), (_id = 'b4', author_id = 'a2', title = 'It')`)))

afterEach(setUp.afterEach)

describe('merge after a join', () => {
  test('merging on a field many joined rows share keeps every joined row (each was replaced by the first)', async () => {
    const titles = rows => rows.map(row => [row.name, row.books.map(book => book.title)])
    const [joined] = await query('read authors.books on authors._id = books.author_id')
    const [merged] = await query('read authors.books on authors._id = books.author_id merge authors._id with books.author_id')
    expect(titles(merged)).toEqual([['Atwood', ['Surfacing', "Cat's Eye", 'Alias Grace']], ['King', ['It']]])
    expect(titles(merged)).toEqual(titles(joined))
  })
})
