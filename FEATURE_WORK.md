# Feature work: performance, storage and usability

Epic branch: `feature/performance`. Each task is its own branch and PR into this branch; tick it here after it merges.
Before this merges to `main`, this file is copied into the epic PR's description and deleted.

## Why

Importing Joshua's real workout history into workout-planner (2026-11-06) was the first real-sized use, and it showed
json-fs-query isn't usable at that size yet:

| Measured on the imported workout database (1,452 workouts, 119 exercises, 1,871 files) | Time |
|---|---|
| Insert 1,446 rows (one `insert` per row) | ~13 min |
| `read workouts` (every row) | 0.5 s |
| `read workouts.exercises on workouts.exercise_id = exercises._id` (one join) | ~10 s |
| workout-planner's muscle-priority query (3 joins) | 9-11 s, was 0.05 s with 6 workouts |
| Same query, any indexed `where` on one record | 3-13 ms (fine) |

**Causes**, from the code:
- **Nothing is cached.** Every lookup reads its file from disk again. A join re-reads the joined record's index and
  entry files once per row: 1,452 lookups for 119 exercises.
- **Nothing is batched.** Inserting a row reads the record file and the indexes it checks, writes the entry, then
  rewrites the whole record file and reads and rewrites every index file. That's ~6 whole-file operations per row on
  files that grow with the table, so total work grows with the square of the row count. A multi-row insert still writes
  once per row.
- **Reads are sequential.** A full read awaits each entry file in turn: in a browser, 1,452 HTTP requests one after
  another.
- **Many small files.** 866 KB of data takes 8.1 MB on disk (each file uses a whole 4 KB block).

**Pretty or compact JSON** (measured on the same database): compact is 14-20% smaller and parses ~7% faster; gzip on the
wire (GitHub Pages does it) almost erases the difference (indexes 127 KB pretty vs 125 KB compact). So compact files are
a small, real win and the default here (an IDE shows them formatted); a `pretty` setting keeps readable diffs for anyone
reviewing data in pull requests. The big wins are fewer file operations and fewer files.

## Goals

- workout-planner with the full history: the import in seconds, muscle priority well under a second.
- Measured before and after every change: a benchmark script, with the numbers kept in `BENCHMARKS.md`.
- Positioning (README): **a git-native JSON data store for static sites**. Data lives as readable, diffable files in
  git, with a schema, keys and foreign keys enforced, a SQL-like query language, and reads straight from static hosting
  (no server).
- No change to what queries return. Old databases (pretty files, array indexes) keep working; files are rewritten in
  the new format as they change, or all at once with a command.

## Work split (in order)

### Measure

- [x] **1. Benchmark script + baseline.** `npm run benchmark`: builds a scratch database with a realistic shape (a parent
  record and a child record with a primary key, an index and a foreign key) at several sizes (100, 1,000, 5,000 rows), and
  times insert (one row per query, and many rows in one query), full read, indexed `where`, a one-join and a two-join
  read, update and delete; reads also in a real browser over `fetch()` (Playwright, from js-build-tools). Writes a
  markdown table; `BENCHMARKS.md` keeps the baseline and each task's result.
  Baseline (3.1.4, 1,000 rows): insert 389 ms per row, one join 5.2 s in Node / 15 s in a browser, two joins 26 s in a
  browser, full read 4.3 s in a browser, indexed `where` 8 ms / 55 ms. Playwright is pinned to `~1.64.1`, the version
  whose browsers are installed on this machine (1.65 wants a newer Chromium build and fails to launch).

### One storage layer (the existing "gather fs into one storage module" task)

- [x] **2. Storage module.** Every file read, write, delete and listing (create, drop, insert, update, delete, indexes,
  registry, `fetch` in the browser) goes through `src/data/storage/`. No behaviour change; this is the seam for 3-5,
  for transactions later, and for the swappable storage layer idea. Done in #113: benchmark unchanged, as intended.
  No `listFiles` yet, since nothing lists a folder today; it comes with its first use (6).
- [x] **3. Per-query read cache.** Inside one `query()` call (the existing database lock already scopes it), each file
  is read once and kept in memory; writes in the same call update the cache. Fixes joins re-reading the same files.
  Indexes are held in memory as maps (value -> entry files) instead of arrays searched with `find`.
  The maps moved to 3b: profiled after the cache, index lookups cost nothing measurable, the joins themselves do.
- [x] **3b. Join engine.** Profiled after 3, 1.7 s of a 2.3 s one-join read (1,000 rows) is `joinEntity` cloning every
  loaded row once per row it joins (and `getJoinIndexedList`, the `where` + join path, cloning the loaded indexes per
  row): it grows with the square of the row count. Replace both with one join: for `=`, a map (typed value -> joined
  rows) built once per `on` clause, then each row looks up its matches (other comparators scan, without cloning).
  Indexes only decide which files are read. Same results as today: typed comparison, null never matching, joined-row
  order, independent copies of joined rows. Built so the join type is one decision in one place (what a row with no
  match gets), the base for the outer / left / right joins epic (TASKS.md), which then only adds the types.
  Found while characterizing joins: on `main`, the index path for `where` + join crashed on joins through a linking
  record and returned only the first row's matches on multi-step joins; fixed on `main` first (#115) by removing it.
- [x] **3c. Key checks through indexes.** One insert into a 1,000-row table reads all 1,000 rows and all 100 parent
  rows: `keyUnique` (primary / unique keys, and `auto` ids) and `foreignKeyExists` read the whole table though those
  keys have indexes, and `hasDependents` (delete) does the same. Answer them from the key's index (one file), held as a
  map for repeated lookups in one call. This is what makes an import grow with the square of its size.
- [x] **3d. Find a row's file through the primary key index.** `update` / `delete` of one row by key still read every
  row to find its file (`findEntryFile`, `removeMatchingEntries`): 335 / 695 ms at 1,000 rows (3c's run). The primary
  key index lists the file; fall back to the scan when there's no usable index, as 3c does.

**Release point (agreed 2026-11-06):** after 3c (and 3d if it's ready), cherry-pick tasks 1-3d onto a release branch
from `main` as 3.2.0: queries return exactly what 3.1.4 returns (join and write characterization harnesses). Then merge
`main` back into this branch with a real merge commit.
  **Done 2026-11-06:** 3.2.0 published (#120, merge commit; queries checked byte-identical to 3.1.4 with a 52-query
  script), `main` merged back (0b0d048). Results for 3b-3d together are the last run in `BENCHMARKS.md` before task 4.
- [x] **4. Write set: batched, all-or-nothing writes.** A query's writes are collected (path -> new content, or delete)
  and applied once at the end: a 1,000-row insert writes the record file and each index once, not 1,000 times. Every row
  is checked before anything is written, so a failed multi-row insert or update changes nothing (step 3 of the
  transactions spike). Files are written atomically (temporary file, then rename), so a crash never leaves a half-written
  file (step 2 of the spike).
  Done in #121.
- [x] **5. Parallel reads.** Entry files are read concurrently (with a limit), in Node and over `fetch()`.
  Done in #122.

### Formats

- [x] **6. Compact JSON by default.** Generated files (indexes, record files, `__RECORDS.json`) and entry files are
  written compact; `configure({ format: 'pretty' })` keeps them pretty. Reading accepts both. A `json-fs-query format`
  helper (or exported function) rewrites a whole database in the chosen format. That rewrite is the first thing that
  has to list a folder, so it adds `listFiles` to the storage module (later uses: checking a packed table against the
  files on disk in 7, rebuilding a missing `__RECORDS.json` from the record files).
  Done in #123.
- [x] **7. Packed tables for static hosting.** A build step writes each record's rows (and its indexes) into one file;
  the browser reads a whole record in one request when the packed file exists, and falls back to entry files when it
  doesn't. The entry files stay the copy that's edited and reviewed in git.
  Done in #124.

### Usability (found during the workout and blog imports)

- [x] **8. Multi-row insert syntax**, e.g. `insert workouts values (date = '2026-11-01', ...), (date = '2026-11-02', ...)`,
  so a batch is one statement (fast with 4).
  Measured with 4 (one `insertEntity` statement): 1,000 rows 1 s (vs 6.3 s as 1,000 one-row inserts), but 5,000 rows
  15.7 s: each row still reads, parses and re-serializes the growing record file and indexes from the write set, so the
  work is quadratic in memory instead of on disk. With this task, `insertEntity` loads the record and its indexes once
  per statement, checks each row against them plus the statement's earlier rows (as `assertUniqueWithinUpdate` does for
  update), and writes them once.
  Done in #125.
- [x] **9. `null` in an optional field.** Inserting `null` into an optional (not nullable) field fails today; treat it
  as leaving the field out, or say so in the error.
  Done in #126.
- [x] **10. Clearer errors.** A malformed join (`read workouts on ...` without `workouts.<record>`) fails with
  `Could not read .json`; say what's wrong in query terms.
  Done in #127.

### Schema

- [x] **11. `alter` for fields**: add, drop and rename a field, and change whether it's optional or nullable, on an
  existing record (today the only way is editing its JSON by hand). Adding a field with a default fills existing rows;
  dropping one removes it from every entry and from any index or key that uses it (or refuses while a key does).
  Done in #128.
- [x] **12. Several databases, and switching between them.** `create database <name>`, `use <name>`,
  `drop database <name>` and `show databases`, plus `configure()` naming the active one. One program can work with
  several databases (e.g. workout-planner's real data and a test copy) without reconfiguring paths by hand. The browser
  side reads whichever database it's pointed at.
  Done in #129.

### Close

- [x] **13. Docs and positioning.** README opening (what it's for, when to use it, when to use SQLite instead), the
  benchmark numbers, a static-site example.
  Done in #130 (the example checked in Node and in headless Chromium from a static folder).
- [x] **14. Before merging ✱:** re-sync with `main`, full suite, benchmarks against the baseline, workout-planner's full
  history imported and its tests passing, then a release PR.
  Checked 2026-11-09: `main` has nothing the epic lacks (no sync needed); 1,145 tests pass; the benchmark run is the
  last in `BENCHMARKS.md` (one join at 1,000 rows 5.2 s -> 176 ms, browser 15.2 s -> 732 ms, 20 ms packed).
  workout-planner's draft #47 with this build: the real import (116 exercises, 1,446 workouts) takes 16 s (was ~13 min),
  a second run adds nothing and leaves the database byte-identical, `getMusclePriority` takes 0.3 s (was 9-11 s), and
  all 78 tests pass once its 9 seed-data assertions follow the imported data (no timeouts). Files stay compatible both
  ways: 3.2.0 reads and inserts into a database this build wrote.

## Out of scope (tracked separately in TASKS.md)

- The **types epic** (`number` with decimals, dates, decimal/bigint, enum, ...): already planned on its own. Weights in
  workout-planner stay text (`"70.5lbs"`) until then.
- **Transactions** (`begin` / `commit` / `rollback`, a crash journal): 4's write set is the base they build on.
- Aggregates, outer joins, user sessions, the CLI epic.
- **Swappable storage backends** (other stores, encryption, a server with IP and port): task 2's storage module is the
  seam for it, but the backends themselves are their own epic.
- A multi-process lock (two programs writing one database at once).

## Release

Probably a minor version (3.x): queries return what they did, old databases keep working. If 6 or 7 change the files
in a way older versions can't read, that makes it a major (4.0.0); decided when we get there.
