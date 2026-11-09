# [json-fs-query](https://www.npmjs.com/package/json-fs-query)

A git-native JSON data store for static sites: a folder of JSON files with a schema, enforced keys and a SQL-like query
string (`read workouts where date = '2024-06-02'`), read straight from static hosting in a browser.

## The modules

Each module of the documentation is a folder of `src/data/`:

* `introspect`: create, drop and describe a JSON-file "table" (and the policies that validate one).
* `queries`: parse a query string and run it - reads, inserts, updates, deletes, joins, `where`, `sortBy`, `groupBy`.
* `storage`: every file read, write, delete and listing (disk in Node, `fetch()` in a browser), the per-call cache and write set.
* `utilities`: shared helpers the queries use - retrieving records/files/indexes and merging join results.

The package's public entry point is `src/index.ts` (`require('json-fs-query')`): `query`, `quote`, `queryStatus`,
`create`, `drop`, `alter`, `describe`, `formatDatabase`, `packDatabase`, `checkPacked`, `configure` and the schema-definition types. Everything else is internal.
