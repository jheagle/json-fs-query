# json-fs-query

A git-native JSON data store for static sites. Your data lives in a folder of plain JSON files, committed with the
rest of the site: readable, diffable and reviewed in pull requests like code. json-fs-query adds what a folder of
files doesn't have on its own:

- **A schema**: field types, required and nullable fields, defaults.
- **Keys enforced**: primary, unique and foreign keys, checked on every write (a delete that would leave a dangling
  reference is refused).
- **A SQL-like query language**: `read workouts where date = '2024-06-02' sort reps desc`, with joins, `group by`,
  `alter`, multi-row inserts, and statements that change nothing if any row fails.
- **Reads straight from static hosting**: in a browser it reads the files over `fetch()` (GitHub Pages, Netlify, any
  CDN), so a site can query its data with no database server. Writes run in Node: a script or a build step.

## When to use it, and when not to

It suits data that's written by you (or your build) and read by your visitors: a portfolio's projects, a blog's
posts, a quiz bank, a workout log, a small catalogue. Small to medium size: hundreds to about ten thousand rows a
record. Data you want to see change in `git diff`, and ship without running anything server-side.

Use SQLite, or a real database server, instead when:

- **Visitors write data.** Writes need file system access, so a browser can only read. Something has to run a server
  to accept writes.
- **Several programs write at once.** Calls are queued within one Node process; two processes writing one folder
  aren't protected from each other.
- **The data is big.** Each row is a file, and a read loads the rows it needs into memory. The benchmarks go up to
  10,000 rows; once the files stop being something you'd read in a diff, SQLite will be faster and smaller.
- **You need what isn't here yet**: transactions across several statements, aggregates (`count`, `sum`), outer joins,
  date and decimal field types, multi-field foreign keys, and `cascade` / `set null` on delete (a referenced row can't
  be deleted while rows point at it, or checks can be turned off with `configure()`). These are planned, not built.

## How fast

At 1,000 rows (a table of 100 parents and one of 1,000 children with a foreign key and an index), before the
performance work (3.1.4) and now. `BENCHMARKS.md` has every run and what each one measures.

| Operation, 1,000 rows | 3.1.4 | Now |
|---|---:|---:|
| Insert 1,000 rows, one `insert` each | 6.5 min | 5.7 s |
| Insert 1,000 rows in one `insert` | - | 0.43 s |
| Read every row | 376 ms | 151 ms |
| Indexed `where` | 7.8 ms | 4.2 ms |
| One join | 5.2 s | 176 ms |
| Two joins | 5.6 s | 177 ms |
| Update one row by key | 402 ms | 157 ms |
| Delete one row by key | 784 ms | 156 ms |
| Browser: read every row | 4.3 s | 689 ms, packed 11 ms |
| Browser: one join | 15.2 s | 732 ms, packed 20 ms |
| Browser: two joins | 26.1 s | 744 ms, packed 33 ms |
| Size of the data | 438 KB | 359 KB |

The browser rows are read from a local server; over a real network each request costs more, which is what packed
tables (see In the browser) are for: one request per record instead of one per row.

## A static site, end to end

A Node script owns the data: it creates the records once and adds rows whenever there are new ones.

```js
// scripts/add-posts.js
const { configure, query, packDatabase } = require('json-fs-query')

configure({ databasePath: 'site/database/' })

await query(`create if not exists authors (_id string auto, name string, primary key (_id));
  create if not exists posts (_id string auto, author_id string, title string, published string,
    primary key (_id), index (published), foreign key (author_id) references authors (_id))`)

const [[author]] = await query("insert authors values name = 'Joshua'")
await query(`insert posts values
  (author_id = '${author._id}', title = 'First post', published = '2026-11-01'),
  (author_id = '${author._id}', title = 'Second post', published = '2026-11-08')`)

await packDatabase()   // one file per record, for the browser
```

Commit `site/database/` and deploy `site/` as usual. The page reads it with no server of its own:

```html
<script src="https://unpkg.com/json-fs-query"></script>
<script>
  jsonFsQuery.configure({ databasePath: 'database/' })
  jsonFsQuery.query("read posts merge posts.author_id with authors._id sort published desc limit 10")
    .then(([posts]) => console.log(posts))   // each post with its author's name as "authors.name"
</script>
```

New posts go in the same way (an `insert`, or a JSON file edited by hand), then `packDatabase()`, commit and deploy. A
test that calls `checkPacked()` (see Packed tables) catches a forgotten `packDatabase()`.

## Install

```shell
npm install json-fs-query
```

## Usage

```js
const { create, query, drop } = require('json-fs-query')

await create('workouts', [
  { name: '_id', type: 'string', optional: false, autoGenerate: true },
  { name: 'reps', type: 'int', optional: false },
  { name: 'date', type: 'string', optional: false }
], [
  { type: 'primary', fields: ['_id'], lookup: 'pk__id.json' }
])

await query("insert workouts values reps = 10, date = '2024-06-02'")
const rows = await query("read workouts where date = '2024-06-02'")
await query("update workouts set reps = 12 where date = '2024-06-02'")
await query("delete workouts where date = '2024-06-02'")

await drop('workouts')
```

### Fields: `optional`, `nullable` and defaults

A field is required and can't be `null` unless its definition says otherwise. The two flags are separate, because
JSON can leave a key out or store it as `null`:

| Definition | Left out | `null` |
|---|---|---|
| `{ name: 'note', type: 'string' }` | error | error |
| `{ name: 'note', type: 'string', optional: true }` | allowed | same as left out |
| `{ name: 'note', type: 'string', nullable: true }` | error | stored as `null` |
| `{ name: 'note', type: 'string', optional: true, nullable: true }` | allowed | stored as `null` |

An optional field that isn't nullable can never hold `null`, so a `null` given for it means "no value": `insert ...
note = null` stores the row without `note` (a default fills it in, as for a field left out), and `update ... set
note = null` removes `note` from the rows it changes, which is how an optional field is cleared (not a field of the
primary key: rows are found by it). As in SQL, a default only fills in a field when a row is inserted, so clearing a
field with a default leaves it out rather than setting the default. Nullable fields store `null`, and required fields
that aren't nullable reject it.

`useDefault: true, defaultValue: …` fills in a field that is left out. `create()` checks the default against the
field's type (a `null` default needs `nullable: true`) and throws if it doesn't fit. Primary key fields can't be
nullable, or optional unless they're `auto` (a row has to have its key: its file is named by it). Each key needs a non-empty `fields` list naming defined fields, and unknown key properties are rejected.
As in SQL, a `null` is never a duplicate in a unique key (any number of rows can hold it), and
a `null` foreign key isn't checked against the record it references.

## Writing queries

`query()` takes one query, or several separated by `;`, and resolves to one result per query:

```js
const [workouts, exercises] = await query("read workouts where date = '2024-06-02'; read exercises;")
```

The `;` after the last (or only) query is optional. A `;` inside a string, a comment or brackets doesn't end a query.

Keywords (`where`, `and`, `sort`, `limit`, `create`, `show records`...), command words (`read`, `insert`, `update`,
`delete`), sort directions (`asc`, `desc`) and comparators can be written in any case: `READ t` and `sort a ASC` work.
Record and field names are case-sensitive.

Every record and field a query names must exist, as in SQL. A field means the queried record's own unless it's written
`<record>.<field>`, and it has to be one that record defines (it doesn't have to be stored in every row: an optional
field is fine). Otherwise the query fails before reading or writing anything, naming what's wrong and what's there:
`Record "workout" doesn't exist`, or `Unknown field "rep" in where: workouts has _id, exercise_id, date, reps`. In
`select`, the joined record's name stands for its rows, `<record>.<field>` picks the queried record's own field (named
as written: use `as` to rename it) or a merged record's, and a joined record's single field is an error, since its rows
are a list (merge it to put its fields on each row).

### Inserting several rows

One `insert` can add many rows: put each row's values in brackets, separated by commas.

```sql
insert workouts values (reps = 10, date = '2024-06-02'), (reps = 12, date = '2024-06-03'), (reps = 8, date = '2024-06-04')
```

It resolves to the inserted rows, in order. Each row is checked against the rows already stored and the rows before it
in the statement (so two rows with the same primary or unique key fail, and a row's foreign key can point at a row
earlier in the same insert). The statement is all or nothing: if any row fails, none is written. Every index is read once
and the record file and each index are written once, so this is far faster than one `insert` per row: 1,000 rows take
about half a second, against about 7 seconds one at a time (see `BENCHMARKS.md`). One row without brackets
(`insert workouts values reps = 10, date = '2024-06-02'`) works as before.

### Strings

Strings use single or double quotes. A string closes only with the quote it opened with, so the other quote is just
a character inside it:

```sql
insert notes values text = "it's done"
insert notes values text = 'say "hi"'
```

Inside a string, a backslash escapes the next character: `\'`, `\"` and `\\` are a quote and a backslash, `\n` and
`\t` are a newline and a tab, and any other `\x` is just `x`. Escapes are read left to right, so `'\\\''` is a
backslash followed by a quote:

```sql
insert notes values text = 'it\'s done'
insert files values path = 'C:\\temp'
```

An unclosed string, or mismatched quotes (`'abc"`), is an error rather than a guess. Keywords, commas and `;` inside a
string are only text: `where note = 'x sort b limit 1'` compares against that whole text.

### Building a query from values: `quote()`

To put any text into a query (such as user input), wrap it with `quote()`. It escapes the backslash and the quote, so
the query reads back exactly the text given:

```js
const { query, quote } = require('json-fs-query')

const name = "Farmer's walk"
await query(`insert exercises values name = ${quote(name)}`)
await query(`read exercises where name = ${quote(name)}`)
```

`quote(value, '"')` wraps in double quotes instead.

### Numbers

A number may be negative, have a fraction and an exponent: `12`, `-3`, `1.5`, `2.5e-4`. They work the same in
`values`, `set`, `where`, arrays and defaults:

```sql
read workouts where reps > -1
update workouts set weight = 102.5 where _id = 4
```

A whole number past 9007199254740991 (`Number.MAX_SAFE_INTEGER`), however it is written (`1e20`,
`9007199254740993.0`), is an error rather than being stored rounded: quote it to keep it as text. A fraction is stored as the nearest double, as in JSON.

### Arrays

Arrays are JSON-style, and their strings can use either quote. They can be nested, and are used by `in` and
`between`, or stored as a value:

```sql
read workouts where exercise_id in [3, 5, 8]
read workouts where reps between [8, 12]
read exercises where name in ['bench press', "farmer's walk"]
insert routines values days = ['mon', 'thu'], sets = [[3, 10], [3, 8]]
```

### Comments

`-- to the end of the line` and `/* anything, over several lines */`. A `--` starts a comment only at the start of a
line or after whitespace or a `;`, since names can contain `-` (`my--table` is a name). Comment markers inside a
string are just text.

```sql
-- this week's sessions
read workouts where date = '2024-06-02' /* the Sunday */;
```

### Where clauses: `and`, `or`, `not` and brackets

A `where` clause is one condition, or several joined with `and` / `or`, each of which can be negated with `not`.
Brackets group them, nested to any depth:

```sql
read workouts where date = '2024-06-02' and (exercise_id = 1 or exercise_id = 3)
read exercises where not (name like 'bench%' or name like 'squat%')
```

`not` binds tightest, then `and`, then `or`, as in SQL. So `a or b and c` means `a or (b and c)`. Use brackets
for anything else:

| Where clause | Means |
|---|---|
| `where a = 1 or b = 2 and c = 3` | `a = 1 or (b = 2 and c = 3)` |
| `where (a = 1 or b = 2) and c = 3` | as written |
| `where not a = 1 and b = 2` | `(not a = 1) and b = 2` |
| `where not (a = 1 or b = 2)` | neither |

The comparators are `=`, `!=` (or `<>`), `>`, `>=`, `<`, `<=`, `in [...]`, `between [low, high]` and `like` (`%`
matches any text, `_` one character, ignoring case). `is null`, `is not null`, `exists` and `does not exist` test
for null and missing fields (see below). In a where clause, the keywords (`where`, `and`, `or`, `not`, `is null`...) and comparators (`IN`, `LIKE`) can be
written in any case (see the casing note under Writing queries).

A query has one where clause: join every condition inside it. The 2.x forms of a second where (`and where`,
`or where`, or another `where`) are errors since 3.0, with a hint to use `and` / `or` instead.

Mistakes are errors that point at the place: an unclosed or unexpected bracket, an operator with nothing after it
(`where a = 1 and`), empty brackets, or two conditions with nothing between them (`where a = 1 b = 2`).

Indexes make a where clause faster but never change its result. An indexed condition only narrows which rows are
read, and the whole clause is then checked on each of them. That works through `and` and through an `or` whose
every branch is indexed. A `not` reads every row.

### Comparing by the field's type

Conditions compare by the field's declared type, whatever type the stored value or the literal has: in a `string`
or `int` field, `'3'` and `3` are equal. Ordering (`>`, `>=`, `<`, `<=`, `between`) and `sort` follow it too: a
`string` field orders as text, so `'10'` comes before `'9'` (even ids stored as numbers), and an `int` field as
numbers. A field with no declared type, or an `object` or `array` one, compares the stored values as they are.
`like` only matches values stored as text.

### Null and missing fields

A field can be missing (left out) or hold `null`, and both are their own cases, as in SQL: they match no
comparison (`=`, `!=`, `<`, `between`, `in`, `like`...), and a `null` never equals anything, not even another
`null`. These test for them instead:

| Condition | Matches when the field |
|---|---|
| `where note is null` | is there and holds `null` |
| `where note is not null` | is there and holds a value |
| `where note exists` | is there (`null` counts) |
| `where note does not exist` | is missing |

`where note = null` is an error that points to `is null`, since it could never match. Sorting puts missing first,
then `null`, then the values (`asc`; `desc` is the reverse).

In 2.0 and earlier, a `null` acted as `0` in comparisons and sorting (`where n < 5` matched it), and `= null` matched it.

Inside `and` / `or` / `not`, a comparison on a null or missing field is **unknown**: neither true nor false, as in
SQL. A row is returned only when the whole clause is true:

| | result |
|---|---|
| `not unknown` | unknown |
| `false and unknown` | false |
| `true and unknown` | unknown |
| `true or unknown` | true |
| `false or unknown` | unknown |

So `where not (n = 5)` returns the same rows as `where n != 5`: neither returns a row where `n` is null or missing.
To include them, ask for them: `where n != 5 or n is null`. The same goes for `in` with a `null` in the list:
`n in [5, null]` is `n = 5 or n = null`, so a row it doesn't match is unknown and `not (n in [5, null])` returns
nothing.

### Joins: `on` and `merge`

`read workouts.exercises` reads workouts and attaches the matching exercises to each one as a list, using `on` (add
more with `and on` to go through linking records):

```sql
read workouts.exercises on workouts.exercise_id = exercises._id
read workouts.muscles on workouts.exercise_id = exercises._id
  and on exercises._id = exercise_muscle.exercise_id
  and on exercise_muscle.muscle_id = muscles._id
```

`merge` copies one matching record's fields onto each row instead, named `entity.field`:

```sql
read workouts merge workouts.exercise_id with exercises._id
```

A condition can use the fields of the record being read, the joined record and merged records, written
`entity.field`:

```sql
read workouts.exercises on workouts.exercise_id = exercises._id
  where date = '2024-06-05' and exercises.name like 'b%'
read workouts merge workouts.exercise_id with exercises._id where exercises.name = 'Squat'
```

A condition on the joined record's fields works like SQL's inner join. The clause is checked for each pair of a row
and one of its joined rows. Each row keeps only the joined rows the clause is true for, and a row left with none
isn't returned. That includes a row with no joined rows at all, even when an `or` matches its own fields.
`read exercises.workouts on exercises._id = workouts.exercise_id where workouts.date = '2024-06-02'` returns each
exercise with only that day's workouts.

These are errors:
- a condition on a record that only links the join (`exercise_muscle` above)
- a condition on a record that isn't in the query
- in `update` and `delete`, any condition on another record's fields. They only change the record they name, and
  take no join (see Clause order).

### Clause order

Every clause is optional and can come at most once, in this order (as in SQL):

| Command | Clauses, in order |
|---|---|
| `read <record>[.<joined>]` | `select`, `on`, `merge`, `where`, `group by`, `sort`, `limit`, `offset` |
| `insert <record>` | `values` |
| `update <record>` | `set`, `where` |
| `delete <record>` | `where` |

```sql
read workouts.exercises select date, reps
  on workouts.exercise_id = exercises._id
  where reps > 8 and (exercises.name = 'Squat' or exercises.name = 'Deadlift')
  group by date
  sort date desc
  limit 10 offset 0
```

Two clauses carry on instead of repeating: `and on` adds another join step, and a `merge` straight after another
(with or without `and`) adds another merge.

Anything else is an error that says what's wrong:

| Query | Error |
|---|---|
| `read t limit 1 where a = 1` | `"where" can't come after "limit" (order: select, on, merge, where, group by, sort, limit, offset)` |
| `read t sort a sort b` | `Only one "sort" clause is allowed` |
| `delete t where a = 1 limit 1` | `"limit" isn't allowed in a delete query (allowed: where)` |
| `update t.u set a = 1` | `A joined record (t.u) isn't allowed in an update query` |
| `read t sort a b` | `Unexpected "b" after "sort a"` |

A clause word is still a name where a name has to go: as a clause's first word (`sort limit`), after a comma or `as`
(`select a, offset`), and before a comparator (`where limit = 1`).

### Grouping: `group by`

`group by` splits the rows into groups that share a value. A read with it returns a list of groups instead of rows.
Each group has the field, the value, and its rows, in the order the rows were sorted. For example:

```sql
read workouts select _id, reps group by date sort date desc
```

```js
[
  { field: 'date', value: '2024-06-05', rows: [{ _id: 4, reps: 10 }, { _id: 5, reps: 10 }] },
  { field: 'date', value: '2024-06-02', rows: [{ _id: 1, reps: 10 }] }
]
```

- Rows are grouped on all their fields, before `select`, so you can group by a field you don't select. `select`
  shapes the rows inside each group, and each group keeps its own `field` and `value`.
- `sort` runs first, so it orders the groups and the rows within them. `limit` and `offset` count groups:
  `group by date sort date desc limit 7` is the seven latest dates, with all their rows.
- Several fields nest: `group by date, exercise_id` groups by date, then by exercise within each date. An outer group
  has `groups` instead of `rows`.
- A value keeps its type: `1` and `'1'` are two groups, and so are `null` and a missing field. Arrays share a group
  when their items are the same, in order; objects when their keys and values are, in any key order. A group of rows
  missing the field has `missing: true` and no `value` (see Null and missing fields).

There are no aggregates (`count`, `sum`, ...) yet, so a group always lists its rows.

### Creating a record: `create`

The query form of `create()`. Inside the brackets: the fields, then the keys, separated by commas. Everything is
case-insensitive except names.

```sql
create if not exists exercise_muscle (
  _id string auto,
  exercise_id string,
  muscle_id string,
  muscle_rank int,
  note string optional default '',
  replaced_by string null default null,
  primary key (_id),
  index (muscle_id, muscle_rank),
  foreign key (exercise_id) references exercises (_id),
  foreign key (muscle_id) references muscles (_id)
);
```

A field is `<name> <type>`, then any of these, in any order:

| Modifier | Means |
|---|---|
| `optional` | may be left out (see "Fields" above) |
| `null` / `not null` | may hold `null` / may not (the default) |
| `auto` | a UUID is generated on insert for a row that leaves the field out (or gives `null`); a value given for it is kept, as MySQL keeps an explicit `AUTO_INCREMENT` value, and still has to be unique when the field is a key. The type must be `string` |
| `default <value>` | used when the field is left out: a string, a number, an array, `null`, `true` or `false` (so an `object` field can only default to `null` here; `create()` takes any default) |

The types are `string`, `int`, `boolean`, `object` and `array`; any other is an error.

| Key | Index file |
|---|---|
| `primary key (a)` | `pk_a.json` |
| `unique (a)` | `unique_a.json` |
| `index (a)` | `index_a.json` |
| `foreign key (a) references other (b)` | `fk_a.json` (other's record file: `other.json`) |

Several fields join with `_`: `index (a, b)` is `index_a_b.json`. Foreign keys are single-field for now.

The result is the new record's definition, as from `create()`. Creating a record that already exists is an error;
with `if not exists` it is left as it is and the result is `null`. A foreign key's record and field must exist
already (or be the record being created).

### Dropping, describing and listing records: `drop`, `describe`, `show records`

```sql
drop exercise_muscle;            -- removes the record, its entries and its indexes
drop if exists exercise_muscle;  -- the same, or nothing if there is no such record
describe exercises;              -- the record's fields and keys
show records;                    -- the name of every record, in the order they were created
```

`drop` resolves to the definition the record had, or `null` with `if exists` for a record that doesn't exist; without
it, that is an error. A record that another record's foreign key references can't be dropped until that one is
(unless `enforceForeignKeys` is turned off, see Configuration). `describe` resolves to `{ path, definition, keys }`
(the `describe()` function gives only the fields), and `show records` to an array of names.

### Changing a record's fields: `alter`

```sql
alter workouts add note string optional                -- a new field (written as in create)
alter workouts add status string default 'planned'     -- existing rows get the default
alter workouts drop note                               -- removed from the definition and every row
alter workouts rename date to day                      -- in every row, its keys and indexes, and foreign keys to it
alter workouts modify status string optional default 'planned'  -- the field's whole new definition
```

Each `alter` makes one change, all or nothing (several, separated by `;`, run in turn), and resolves to the record's
new fields. The `alter()` function takes the same changes as objects, e.g.
`alter('workouts', { action: 'add', field: { name: 'note', type: 'string', optional: true } })`.

- **add**: existing rows get the field's default, or a new id for an `auto` field. A required field with neither is
  refused while the record has rows (they'd be missing it): give it a default, or make it optional.
- **drop**: refused while a key of the record uses the field, or another record's foreign key references it.
- **rename**: a key's index file named after the field moves to the new name; foreign keys that reference the field
  (in any record) are renamed with it.
- **modify**: gives the field's whole new definition, as MySQL's `MODIFY` does: anything it leaves out is cleared, so
  repeat a default to keep it (`modify status string optional` removes `default 'planned'`, as leaving out `optional`
  makes the field required). The type, and whether the field is `auto`, can't change (that's for a later version).
  Making it required fills rows that are missing it from the new default, and is refused without one; making it not
  nullable removes the `null`s when it stays optional, and otherwise fills them from the default. When a key uses the
  field, filled rows go through the same checks as an `update` (a unique key refuses the same default twice).

### Reading a query over several lines: `queryStatus()`

For a prompt which reads a query line by line (like the CLI), `queryStatus()` says whether the text so far is ready to
run, and if not, what it is waiting for: `'` or `"` (a string), `/*` (a comment), `[` or `(` (a bracket), or `;`.
Join the lines with `'\n'`, since a `--` comment ends at the end of its line.

```js
const { queryStatus } = require('json-fs-query')

queryStatus("read notes where text = 'it")   // { complete: false, waitingFor: "'" }
queryStatus('read notes')                    // { complete: false, waitingFor: ';' }
queryStatus('read notes;')                   // { complete: true, waitingFor: '' }
```

### Upgrading from 1.x

- Several queries in one string need a `;` between them: `read a; read b`. Before, they were split on command words,
  which also split a value such as `'please read this'` and stored it as `pleaseread this`.
- Unclosed strings and mismatched quotes are errors.
- A backslash inside a string is an escape: write `\\` for a backslash (or use `quote()`).
- `--` and `/* */` start comments outside strings.
- `null` is only accepted by fields with `nullable: true`, and is stored as a real `null`. Before, a `string` field
  stored the text `"null"` and an `int` field stored `0`.
- `create()` throws for a default that doesn't fit its field's type, and for a nullable primary key field.
- `or where` means `or` (2.3). In 1.x it was read as `and where`, returning the wrong rows, and in 2.0 to 2.2 it was an
  error. Since 3.0 it's an error again: use `or` inside one where clause.
- A select alias needs `as`: `select name as n`. Before, the first field took the next word as its alias, so
  `select name where a = 1` failed and `select name limit 1` lost its limit; `select name n` is now an error.
- Sort fields need a comma between them: `sort a, b desc`. Before, the list ran on into the next clause, so
  `sort a limit 1` sorted by `a`, `limit` and `1` and lost the limit; `sort a b` is now an error.

### Upgrading to 2.3

- `and`, `or`, `not` and brackets in a where clause (above). `or where` works again, now as `or` (until 3.0).
- A condition on a joined record's field works, as an inner join. Before, an unindexed one matched nothing, and an
  indexed one (`exercises._id = 1`) returned every row, most of them with an empty list of joined rows. Only rows
  with a matching joined row are returned now.
- A condition on the read record's own field written with its name (`workouts.date`) works. It matched nothing before.
- A condition on a record that isn't in the query, or only links a join, is an error. Before, it matched nothing or
  failed to read the record.
- Comparators are case-insensitive (`IN`, `LIKE`). Before, only lowercase ones matched anything.
- Command words and sort directions are case-insensitive (`READ t`, `sort a ASC`). Before, `READ t` was an
  error and `sort a ASC` sorted descending.

### Upgrading to 3.0

Queries that worked in 2.x can be errors now (each error names the problem), and a grouped read returns a new shape:

- Clauses come in a fixed order, at most once each (see Clause order). In 2.x any order worked, and a repeated
  clause gave a confusing error or was quietly joined.
- One where clause per query. `and where`, `or where` and a second `where` are errors: write
  `where a = 1 and b = 2` (or `or`).
- Only `read` takes a joined record (`t.u`) and `on`. In 2.x a join on `update` or `delete` did nothing useful: a
  condition on the joined record's fields was refused, and without `on` the join was ignored.
- `sort`, `limit` and `offset` are only for `read`. In 2.x they were accepted on `update` and `delete`, but they ran
  after the change, so they never limited which rows were changed.
- `group by` returns a list of groups (see Grouping), not an object keyed by value. Because 2.x used an object, its
  number keys always came out ascending (whatever the sort), and every key became a string (`null` became
  `"null"`). `limit` and `offset` count groups now: in 2.x they cut the rows before grouping. Several fields
  (`group by a, b`) nest. In 2.x `group by a,b` grouped every row into one `"undefined"` group.
- Text a clause can't read is reported against that clause, as `Unexpected "b" after "sort a"` or
  `Missing a whole number after limit: x`. In 2.x these were `Unrecognized query value: ...`. Check any code that
  matches on that message.

### Upgrading from 3.2

- A field a record doesn't define is an error everywhere a query names one. In 3.2 `insert` dropped it without a word,
  `update ... set` stored it outside the record's definition, and `where`, `sort`, `group by`, `select`, `on` and
  `merge` quietly matched nothing (or left rows unsorted). A field that's only missing from some rows is fine, as long
  as the record defines it.
- `select <record>.<field>` for the queried record picks its field; in 3.2 it gave nothing. For a joined record
  without `merge`, it's an error saying to select the record (its rows) or merge it.
- A record that doesn't exist is `Record "<name>" doesn't exist` (in a browser, `... doesn't exist, or <name>.json
  can't be read`), as `drop` and `describe` already said, instead of `Could not read <name>.json`. A join written
  without the record to join (`read workouts on ...`) says so, instead of `Could not read .json`.

### Upgrading from 3.3

- An `auto` field keeps a value given for it on insert. Before 3.3.1, `insert foo values _id = 'mine', ...` stored the row
  under a new UUID without a word, so copying rows with their ids (or migrating data whose other records point at those
  ids) lost them. A row that leaves the field out, or gives `null`, still gets a new UUID.

## Configuration

`configure()` sets where this package's data lives and how strictly it enforces foreign keys - call it once,
before anything else:

```js
const { configure } = require('json-fs-query')

configure({
  databasePath: 'database/',   // where the JSON files live (default 'database/')
  relativePath: '',            // URL prefix prepended to databasePath when reading via fetch() in a browser
  enforceForeignKeys: true,    // RESTRICT delete/update of a record other entities still reference (default true)
  readConcurrency: 16,         // how many entry files a read has in flight at once (default 16)
  format: 'compact',           // how files are written: 'compact' or 'pretty' (default 'compact')
  packedReads: undefined,      // use packed files (see packDatabase); default true in a browser, false in Node
  databasesPath: undefined,    // a folder holding several databases (see Several databases)
  database: undefined,         // the one of them in use
  fetchOptions: undefined      // passed to every fetch() in a browser, such as { cache: 'no-cache' }
})
```

Turning `enforceForeignKeys` off restores the pre-1.0 behavior (no referential integrity checks at all) - useful if
it doesn't fit a particular workflow, mirroring MySQL's own toggleable `foreign_key_checks`.

Reads fetch several entry files at once, `readConcurrency` at a time, and keep the record's order. In a browser each
file is one request: 16 suits HTTP/2 static hosts (such as GitHub Pages), while over HTTP/1.1 a browser only opens about
6 connections per host anyway. `readConcurrency: 1` reads one file at a time, as every read did before this setting.

`fetchOptions` is given to every `fetch()` a browser read makes, as its second argument. By default reads use the
browser's normal HTTP cache, which suits data that only changes when the site is deployed. When something writes the
files while the page is in use (a local server, say), `{ cache: 'no-cache' }` makes the browser check every file with the
server before using its cached copy: an unchanged file comes back as a short "not modified", a changed one is read again.

### Several databases: `databasesPath`, `use`

One program can keep several databases (say, real data and a test copy) in one folder and switch between them:

```js
configure({ databasesPath: 'databases/', database: 'real' })   // databases/real/ is the one in use
```

```sql
create database copy;             -- a new, empty databases/copy/ (it doesn't switch to it)
use copy;                         -- the rest of this query, and the calls after it, use databases/copy/
show databases;                   -- ['real', 'copy'], in the order they were created
drop database if exists copy;     -- deletes it and everything in it (not the one in use: use another first)
```

`use` does what `configure({ database })` does, and both work in a browser (reading only), for any database listed in
`databases/__DATABASES.json`, the list `create database` and `drop database` keep (a browser can't list a folder).
With `databasesPath` set, calls on all its databases queue together (see Several calls at once), so a `use` part way
through a call is safe. A browser runs calls side by side instead, with one database in use for the page, so there
`use` refuses while another call is running: await it, or switch with `configure({ database })` between calls. A
database folder copied in by hand (to copy a database) isn't listed yet: `create database if not exists <name>` lists
it. Without `databasesPath`, `databasePath` names the one database, as before. A record can still be called
`database`: `create database (...)` and a bare `drop database` act on that record.

### File format: `format` and `formatDatabase()`

Files are written as compact JSON by default: about a fifth smaller than indented JSON, and an editor shows them
formatted anyway. `format: 'pretty'` writes them indented by 2 spaces instead, for reading data in diffs (for example in
pull requests). Either format is always read, so a database can hold both: one written before this setting keeps its
indented files until they change.

`formatDatabase()` rewrites a whole database in one format (the configured one by default), leaving files already in
it alone, and resolves to how many JSON files it found and rewrote:

```js
const { configure, formatDatabase } = require('json-fs-query')

configure({ databasePath: 'database/', format: 'pretty' })
await formatDatabase()           // { files: 1119, rewritten: 1119 }
await formatDatabase('compact')  // back to compact, whatever the setting
```

It reads and checks every file before writing any: one that isn't valid JSON fails the call with its path and nothing
is changed. Node only, like every write.

**Upgrading a database kept in git:** before this setting every file was written indented, so after upgrading each
file turns compact the next time it changes, and diffs mix both. Either run `formatDatabase('compact')` once and commit
the result on its own, or set `format: 'pretty'` to keep writing indented files.

## Several calls at once

Calls to `query()`, `create()`, `drop()`, `describe()`, `formatDatabase()`, `packDatabase()` and `checkPacked()` on
one database (one `databasePath`) run one at a time, in the order they were made, so concurrent requests (for
example in a web server) can't overwrite each other's changes. All the queries in one `query()` string run together,
with no other call in between. This covers one Node process: two processes writing to the same folder (say a server
and a CLI) are not protected from each other.

`configure()` can't point `databasePath` at another folder while calls are still running or queued (it throws:
await them first), since each call reads the setting again at every step. The same folder written another way
(`database/`, `./database`, its absolute path) counts as one database.

## In the browser

A pre-built bundle is included (`browser/jsonFsQuery.js`, `.min.js` - also served directly via
[unpkg](https://unpkg.com/json-fs-query) or [jsDelivr](https://cdn.jsdelivr.net/npm/json-fs-query)) and exposes the
same functions as a global:

```html
<script src="https://unpkg.com/json-fs-query"></script>
<script>
  jsonFsQuery.configure({ databasePath: 'database/', relativePath: 'https://example.com/' })
  jsonFsQuery.query("read workouts where date = '2024-06-02'").then(console.log)
</script>
```

Reads work in the browser via `fetch()` - `create`/`drop`, and any write through `query()` (`insert`/`update`/
`delete`), need real filesystem access and only work in Node. They're still present in the browser build (same
public API either way), but throw if actually called there, rather than being silently unavailable.

### Packed tables: one request per record

Read over `fetch()`, every entry file is one request, so reading 1,000 rows is 1,000 requests. `packDatabase()` writes
each record's rows into one file, `__packed/<record>.json`, and a browser then reads the whole record in one request:
at 1,000 rows a full read takes about 25 ms instead of 1 s (see `BENCHMARKS.md`). Run it in Node as a build step
whenever the data changes, and serve (or commit) the `__packed/` folder with the rest of the database:

```js
const { configure, packDatabase, checkPacked } = require('json-fs-query')

configure({ databasePath: 'database/' })
await packDatabase()   // { records: 4, rows: 1452 }
await checkPacked()    // { stale: [], orphaned: [] } - in a test, to catch a forgotten packDatabase()
```

The entry files stay the copy that's edited and reviewed; a packed file is only ever a copy of them:

- Any `insert`, `update`, `delete` or `drop` through json-fs-query removes that record's packed file in the same
  statement (a statement that changes no rows leaves it), so a browser never reads a packed file in place of a change.
- A packed file is only used while its entries match the record file, so rows added or removed without json-fs-query
  fall back to the entry files.
- A row edited by hand keeps the same entries, so its packed file still looks current and a browser reads the old
  row: run `packDatabase()` after hand edits, and run `checkPacked()` in CI (or a test) so a forgotten one fails the
  build. It reports packed files that don't match their entry files (`stale`), and packed files of records that no
  longer exist (`orphaned`, which `packDatabase()` removes).

A packed file is only read when a read needs more rows than one round of requests (`readConcurrency`, 16 by default).
A lookup of a few rows (an indexed `where` on a key, say) reads the index and those rows as before, so it never
downloads a whole record, and a record of 16 rows or fewer is never asked for a packed file. Indexes stay in their own
files. A larger record without a packed file costs one extra request that comes back as not found, before its entry
files are read as before.

Browsers use packed files by default and Node doesn't (it reads the entry files, which are always current). Change it
with `configure({ packedReads: true })` or `false`.

## Documentation

The reference for every function is in [`docs/`](https://joshuaheagle.com/projects/json-fs-query/docs/index.html) (or open `docs/index.html` locally). It is generated from the TypeScript source, and each module is a folder of `src/data/`:

| Module | What it holds |
| --- | --- |
| `introspect` | Create, drop and describe a JSON-file "table" (and the policies that validate one) |
| `queries` | Parse a query string and run it - reads, inserts, updates, deletes, joins, `where`, `sortBy`, `groupBy` |
| `storage` | Every file read, write, delete and listing (disk in Node, `fetch()` in a browser), the per-call cache and write set |
| `utilities` | Shared helpers the queries use - retrieving records/files/indexes and merging join results |

`src/index.ts` is the package's public entry point - it re-exports `query`, `quote`, `queryStatus`, `create`, `drop`,
`alter`, `describe`, `formatDatabase`, `packDatabase`, `checkPacked`, `configure`, and the schema-definition types (`fieldProperties`, `keyProperties`, etc.) needed to build a `create()` call. Everything else
under `src/data/` is an internal module, reachable but not part of the supported public API.

## Development

```shell
npm install
npm test          # the tests
npm run typecheck # the types
npm run build     # dist/ and browser/ (not committed; npm publish builds them)
npm run docs      # the documentation (docs.to)
```
