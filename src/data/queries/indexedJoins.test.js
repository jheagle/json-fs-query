import { query } from './query'
import { setUp } from 'test-filesystem'
import { configure } from '../utilities/config'

const databasePath = 'indexed-joins-database/'
configure({ databasePath })
setUp.setDefaults(databasePath)

// A where that an index answers, then a join: these used to be joined from the joined records' indexes, ahead of the
// ordinary join, which crashed on joins through a linking record and returned only the first row's matches for others
beforeEach(async () => {
  await setUp.beforeEach()
  await query(`create authors (_id string, name string, primary key (_id));
    create books (_id string, title string, author_id string null, primary key (_id), index (author_id));
    create tags (_id string, label string, primary key (_id));
    create book_tags (_id string, book_id string, tag_id string, primary key (_id), index (book_id));
    create kinds (_id string, primary key (_id));
    create parents (_id string, kind_id string, primary key (_id), index (kind_id));
    create children (_id string, parent_id string, primary key (_id), index (parent_id))`)
  await query(`insert authors values _id = 'a1', name = 'Atwood';
    insert authors values _id = 'a2', name = 'Banks';
    insert authors values _id = 'a5', name = 'Nobody';
    insert books values _id = 'b1', title = 'Surfacing', author_id = 'a1';
    insert books values _id = 'b2', title = 'Oryx', author_id = 'a1';
    insert books values _id = 'b3', title = 'Excession', author_id = 'a2';
    insert tags values _id = 't1', label = 'dystopia';
    insert tags values _id = 't2', label = 'space';
    insert tags values _id = 't3', label = 'classic';
    insert book_tags values _id = 'bt1', book_id = 'b2', tag_id = 't1';
    insert book_tags values _id = 'bt2', book_id = 'b3', tag_id = 't2';
    insert book_tags values _id = 'bt3', book_id = 'b2', tag_id = 't3';
    insert book_tags values _id = 'bt4', book_id = 'b1', tag_id = 't3';
    insert book_tags values _id = 'bt5', book_id = 'b3', tag_id = 't3';
    insert kinds values _id = 'k1';
    insert kinds values _id = 'k2';
    insert parents values _id = 'p1', kind_id = 'k1';
    insert parents values _id = 'p2', kind_id = 'k2';
    insert parents values _id = 'p3', kind_id = 'k1';
    insert children values _id = 'c1', parent_id = 'p1';
    insert children values _id = 'c2', parent_id = 'p2';
    insert children values _id = 'c3', parent_id = 'p3';
    insert children values _id = 'c4', parent_id = 'p3'`)
})

afterEach(setUp.afterEach)

/**
 * Each row's _id with the _ids of its joined rows.
 * @param text
 * @param joined
 */
const pairs = async (text, joined) => (await query(text))[0].map(row => [row._id, row[joined].map(joinedRow => joinedRow._id)])

describe('a join after a where an index answers', () => {
  test('through a linking record (used to throw "Invalid array length")', async () => {
    expect(await pairs("read book_tags.tags on book_tags.tag_id = tags._id where book_id = 'b2'", 'tags'))
      .toEqual([['bt1', ['t1']], ['bt3', ['t3']]])
    expect(await pairs("read books.tags on books._id = book_tags.book_id and on book_tags.tag_id = tags._id where _id = 'b3'", 'tags'))
      .toEqual([['b3', ['t2', 't3']]])
  })

  test('a row whose join finds nothing part way keeps an empty list (used to throw reading undefined)', async () => {
    const tags = ' on authors._id = books.author_id and on books._id = book_tags.book_id and on book_tags.tag_id = tags._id'
    expect(await pairs(`read authors.tags${tags} where _id = 'a5'`, 'tags')).toEqual([['a5', []]])
    expect(await pairs(`read authors.tags${tags} where _id = 'a1'`, 'tags')).toEqual([['a1', ['t1', 't3']]])
  })

  test('every matching row of each step is joined, not only the first one\'s (used to drop the rest)', async () => {
    expect(await pairs("read kinds.children on kinds._id = parents.kind_id and on parents._id = children.parent_id where _id = 'k1'", 'children'))
      .toEqual([['k1', ['c1', 'c3', 'c4']]])
  })

  test('gives what the same join without an index-answered where gives', async () => {
    const join = 'read books.tags on books._id = book_tags.book_id and on book_tags.tag_id = tags._id'
    const all = await pairs(join, 'tags')
    for (const [id, tagIds] of all) {
      expect(await pairs(`${join} where _id = '${id}'`, 'tags')).toEqual([[id, tagIds]])
    }
  })
})
