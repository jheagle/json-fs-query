# Benchmarks

`npm run benchmark` (after `npm run build`) times json-fs-query's common operations on a scratch database shaped like a
real app's: `kinds` (10 rows) <- `parents` (size / 10, a foreign key to kinds) <- `children` (size rows, a foreign key
to parents and an index on `day`). Reads are timed in Node and in Chromium over `fetch()` from a local server. See
`scripts/benchmark.cjs` for exactly what each row measures.

Every task in the performance epic (`FEATURE_WORK.md`) adds its run here, on the same machine, so the effect of each
change is measured rather than assumed. Times vary a little between runs; compare orders of magnitude, not single
milliseconds.

## What the baseline shows

- **Inserts get slower as the table grows**: 45 ms per row at 100 rows, 389 ms per row at 1,000 (each insert rewrites
  the record file and every index, and those grow with the table). 1,000 inserts take 6.5 minutes.
- **Joins are the worst case**: one join over 1,000 rows takes 5.2 s in Node and 15 s in a browser, because the joined
  record's index and entry files are read again for every row. Two joins take 26 s in a browser.
- **Reads go one file at a time**: reading all 1,000 rows is 0.4 s in Node and 4.3 s in a browser (1,000 sequential
  requests).
- **Indexed lookups are already fine**: 8 ms in Node, 55 ms in a browser at 1,000 rows.
- **Many small files**: 438 KB of data in 1,119 files.

### Baseline: 3.1.4, before the epic (2026-11-06, Node v24.21.0, 11th Gen Intel(R) Core(TM) i5-1135G7 @ 2.40GHz)

| Operation | 100 rows | 1000 rows |
|---|---:|---:|
| insert each | 4.5 s | 388.8 s |
| insert per row | 45 ms | 389 ms |
| read all | 35 ms | 376 ms |
| indexed where | 3.6 ms | 7.8 ms |
| join 1 | 145 ms | 5.2 s |
| join 2 | 244 ms | 5.6 s |
| update 1 by key | 38 ms | 402 ms |
| update many by index | 25 ms | 3.2 s |
| delete 1 by key | 77 ms | 784 ms |
| browser read all | 594 ms | 4.3 s |
| browser indexed where | 34 ms | 55 ms |
| browser join 1 | 1.7 s | 15.2 s |
| browser join 2 | 2.4 s | 26.1 s |
| files on disk | 129 | 1,119 |
| bytes of data | 50 KB | 438 KB |


### task 2: storage module (2026-11-06, Node v24.21.0, 11th Gen Intel(R) Core(TM) i5-1135G7 @ 2.40GHz)

No behaviour change was intended, and none shows: the Node numbers are within run-to-run variation of the baseline. The
browser rows came out up to 2x faster than the baseline, but the browser code path is the same `fetch()` call. Run back
to back at 300 rows, the code before and after this task matched (browser join 1: 2.3 s before, 2.2 s after; browser
read all: 782 ms and 712 ms), so the gap is the machine's state between the two runs. Compare later tasks against
this run as well as the baseline.

| Operation | 100 rows | 1000 rows |
|---|---:|---:|
| insert each | 4.4 s | 363.1 s |
| insert per row | 44 ms | 363 ms |
| read all | 39 ms | 320 ms |
| indexed where | 4.2 ms | 9.6 ms |
| join 1 | 153 ms | 3.3 s |
| join 2 | 214 ms | 4.0 s |
| update 1 by key | 35 ms | 332 ms |
| update many by index | 29 ms | 2.7 s |
| delete 1 by key | 77 ms | 655 ms |
| browser read all | 558 ms | 2.1 s |
| browser indexed where | 27 ms | 43 ms |
| browser join 1 | 1.6 s | 8.9 s |
| browser join 2 | 1.9 s | 13.2 s |
| files on disk | 129 | 1,119 |
| bytes of data | 50 KB | 438 KB |

### task 3: read cache (2026-11-06, Node v24.21.0, 11th Gen Intel(R) Core(TM) i5-1135G7 @ 2.40GHz)

Each file is read once per `query()` call. Against task 2's run from the same day, at 1,000 rows: inserts 363 -> 196 ms
per row (each insert's unique and foreign key checks read the same tables more than once), update many by index
2.7 s -> 341 ms, one join 3.3 -> 2.3 s and two joins 4.0 -> 2.3 s in Node, and in a browser one join 8.9 -> 3.6 s and
two joins 13.2 -> 3.6 s. A one-join read now reads each file once (1,102 reads, was 3,104).

The joins are still slow because of CPU work, not reads: profiled, 1.7 s of the 2.3 s is the join cloning every loaded
row once for each row it joins, which grows with the square of the row count. That is the next task, the join engine.
Indexed where's 17 ms is noise of this run: timed back to back on the same 1,000-row database, it was 9 ms before the
cache and 10 ms after.

| Operation | 100 rows | 1000 rows |
|---|---:|---:|
| insert each | 2.3 s | 196.3 s |
| insert per row | 23 ms | 196 ms |
| read all | 33 ms | 310 ms |
| indexed where | 3.4 ms | 17 ms |
| join 1 | 59 ms | 2.3 s |
| join 2 | 58 ms | 2.3 s |
| update 1 by key | 34 ms | 306 ms |
| update many by index | 21 ms | 341 ms |
| delete 1 by key | 66 ms | 590 ms |
| browser read all | 227 ms | 2.1 s |
| browser indexed where | 11 ms | 45 ms |
| browser join 1 | 271 ms | 3.6 s |
| browser join 2 | 280 ms | 3.6 s |
| files on disk | 129 | 1,119 |
| bytes of data | 50 KB | 438 KB |

### task 3b: join engine (2026-11-06, Node v24.21.0, 11th Gen Intel(R) Core(TM) i5-1135G7 @ 2.40GHz)

One join for every row, from lookups built once (it used to copy every loaded row for each row joined). Against task
3, at 1,000 rows: one join 2.3 s -> 468 ms and two joins 2.3 s -> 480 ms in Node; in a browser one join 3.6 -> 2.5 s and
two joins 3.6 -> 2.4 s, now no more than reading the rows (browser read all: 2.7 s in this run), so what's left there
is the sequential requests (task 5). This run was a little slower overall (read all 371 ms, 310 ms in task 3's), so
compare the joins with read all rather than with each other. Indexed `where` + join reads only the joined rows the
queried rows reach again, through the index: `read parents.children on parents._id = children.parent_id where _id =
'p3'` reads 15 files in 14 ms (the fixed ordinary join on `main`, #115, reads 1,004 files in 392 ms).

| Operation | 100 rows | 1000 rows |
|---|---:|---:|
| insert each | 2.6 s | 204.3 s |
| insert per row | 26 ms | 204 ms |
| read all | 35 ms | 371 ms |
| indexed where | 3.7 ms | 9.5 ms |
| join 1 | 39 ms | 468 ms |
| join 2 | 44 ms | 480 ms |
| update 1 by key | 36 ms | 384 ms |
| update many by index | 21 ms | 423 ms |
| delete 1 by key | 68 ms | 758 ms |
| browser read all | 258 ms | 2.7 s |
| browser indexed where | 11 ms | 50 ms |
| browser join 1 | 253 ms | 2.5 s |
| browser join 2 | 304 ms | 2.4 s |
| files on disk | 129 | 1,119 |
| bytes of data | 50 KB | 438 KB |

### task 3c: key checks through indexes (2026-11-06, Node v24.21.0, 11th Gen Intel(R) Core(TM) i5-1135G7 @ 2.40GHz)

Primary, unique and foreign key checks (and the dependents check on delete and update) are answered from the key's
index instead of reading every row. Inserts are no longer quadratic: 196 -> 6.5 ms per row at 1,000 rows (389 ms in the
baseline) and nearly the same at 100 (5.4 ms), so 1,000 inserts take 6.5 s instead of 196 s (6.5 minutes in the
baseline). One insert reads 6 files instead of 1,105. This run is on the epic without task 3b (its own PR), so the joins
are at task 3's level. Next in sight: updating or deleting one row by key still reads every row to find its file.

| Operation | 100 rows | 1000 rows |
|---|---:|---:|
| insert each | 540 ms | 6.5 s |
| insert per row | 5.4 ms | 6.5 ms |
| read all | 35 ms | 343 ms |
| indexed where | 3.0 ms | 7.0 ms |
| join 1 | 67 ms | 2.5 s |
| join 2 | 68 ms | 2.5 s |
| update 1 by key | 38 ms | 335 ms |
| update many by index | 24 ms | 347 ms |
| delete 1 by key | 74 ms | 695 ms |
| browser read all | 263 ms | 2.3 s |
| browser indexed where | 11 ms | 50 ms |
| browser join 1 | 307 ms | 4.1 s |
| browser join 2 | 322 ms | 3.9 s |
| files on disk | 129 | 1,119 |
| bytes of data | 50 KB | 438 KB |

### task 3d: a row's file through the primary key index (2026-11-06, Node v24.21.0, 11th Gen Intel(R) Core(TM) i5-1135G7 @ 2.40GHz)

`update` and `delete` find each row's file through the primary key index instead of reading every row. Update many by
index: 341 -> 20 ms at 1,000 rows (3c's run). The "1 by key" rows include the `read children limit 1` that picks the
row, which reads every row (about 300 ms: `limit` doesn't stop reading early), so they hide the change. Timed alone on
the same database, updating one row by key takes 7 ms (3 reads) and deleting one 10 ms (8 reads, 341 ms and 1,007 reads
before). This run is on the epic with 3b but without 3c (its own PR), so inserts are at task 3's level.

| Operation | 100 rows | 1000 rows |
|---|---:|---:|
| insert each | 2.3 s | 196.5 s |
| insert per row | 23 ms | 196 ms |
| read all | 31 ms | 307 ms |
| indexed where | 2.8 ms | 7.9 ms |
| join 1 | 37 ms | 341 ms |
| join 2 | 37 ms | 366 ms |
| update 1 by key | 39 ms | 314 ms |
| update many by index | 3.6 ms | 20 ms |
| delete 1 by key | 42 ms | 328 ms |
| browser read all | 241 ms | 2.1 s |
| browser indexed where | 11 ms | 42 ms |
| browser join 1 | 249 ms | 2.3 s |
| browser join 2 | 283 ms | 2.3 s |
| files on disk | 129 | 1,119 |
| bytes of data | 50 KB | 438 KB |

### 3b, 3c and 3d together (2026-11-06, Node v24.21.0, 11th Gen Intel(R) Core(TM) i5-1135G7 @ 2.40GHz)

The first run with all three on the epic, which is what 3.2.0 ships. Against the baseline at 1,000 rows: inserts take 6.6 s
instead of 6.5 minutes (6.6 ms per row instead of 389), one join takes 0.37 s instead of 5.2 s, and updating many rows by
index takes 26 ms. The browser rows vary by up to a second between runs (join 1 was 3.9 s on the run before this one):
they are still 1,000 sequential requests, which the parallel reads task addresses.

| Operation | 100 rows | 1000 rows |
|---|---:|---:|
| insert each | 608 ms | 6.6 s |
| insert per row | 6.1 ms | 6.6 ms |
| read all | 36 ms | 366 ms |
| indexed where | 3.7 ms | 6.9 ms |
| join 1 | 50 ms | 371 ms |
| join 2 | 47 ms | 391 ms |
| update 1 by key | 43 ms | 360 ms |
| update many by index | 4.9 ms | 26 ms |
| delete 1 by key | 46 ms | 392 ms |
| browser read all | 285 ms | 2.9 s |
| browser indexed where | 13 ms | 45 ms |
| browser join 1 | 295 ms | 3.4 s |
| browser join 2 | 474 ms | 2.5 s |
| files on disk | 129 | 1,119 |
| bytes of data | 50 KB | 438 KB |

### task 4: write set, all-or-nothing statements (2026-11-06, Node v24.21.0, 11th Gen Intel(R) Core(TM) i5-1135G7 @ 2.40GHz)

Each statement's writes are collected and put in storage once it succeeds (each file once, written to a temporary file
and renamed), or not at all when it fails. No change in these numbers, as expected: every statement here writes one row,
and the temporary file and rename cost nothing measurable. The batching shows on statements that write many rows: a
20-row insert writes its record file and each index once instead of 20 times (tested in `allOrNothing.test.js`), which
the query language can only do once multi-row insert (task 8) lands.

| Operation | 100 rows | 1000 rows |
|---|---:|---:|
| insert each | 508 ms | 6.3 s |
| insert per row | 5.1 ms | 6.3 ms |
| read all | 31 ms | 309 ms |
| indexed where | 3.4 ms | 7.3 ms |
| join 1 | 36 ms | 323 ms |
| join 2 | 38 ms | 333 ms |
| update 1 by key | 30 ms | 293 ms |
| update many by index | 3.1 ms | 22 ms |
| delete 1 by key | 36 ms | 302 ms |
| browser read all | 228 ms | 2.1 s |
| browser indexed where | 13 ms | 41 ms |
| browser join 1 | 252 ms | 2.2 s |
| browser join 2 | 266 ms | 2.2 s |
| files on disk | 129 | 1,119 |
| bytes of data | 50 KB | 438 KB |

### task 5: parallel reads (2026-11-06, Node v24.21.0, 11th Gen Intel(R) Core(TM) i5-1135G7 @ 2.40GHz)

Entry files are read `readConcurrency` (default 16) at a time instead of one after another, for full reads, indexed
`where` and the rows a join reads. At 1,000 rows: a full read is 0.15 s in Node (0.31 s in task 4's run) and 0.68 s in a
browser (2.1 s); one join 0.72 s in a browser (2.2 s; 15 s in the baseline). Update and delete by key get faster too,
since the `read children limit 1` they start with is a full read.

| Operation | 100 rows | 1000 rows |
|---|---:|---:|
| insert each | 500 ms | 6.0 s |
| insert per row | 5.0 ms | 6.0 ms |
| read all | 14 ms | 149 ms |
| indexed where | 2.6 ms | 4.2 ms |
| join 1 | 18 ms | 172 ms |
| join 2 | 21 ms | 176 ms |
| update 1 by key | 20 ms | 147 ms |
| update many by index | 3.1 ms | 19 ms |
| delete 1 by key | 23 ms | 161 ms |
| browser read all | 97 ms | 677 ms |
| browser indexed where | 9.8 ms | 19 ms |
| browser join 1 | 97 ms | 716 ms |
| browser join 2 | 107 ms | 730 ms |
| files on disk | 129 | 1,119 |
| bytes of data | 50 KB | 438 KB |

How many at once (1,000 rows, median of 3; the benchmark's local server is HTTP/1.1, where Chromium opens 6
connections per host, so the browser levels off from about 8; HTTP/2 hosts such as GitHub Pages aren't capped that way):

| readConcurrency | Node read all | Node join 1 | browser read all | browser join 1 |
|---:|---:|---:|---:|---:|
| 1 | 286 ms | 338 ms | 1,977 ms | 2,193 ms |
| 4 | 156 ms | 177 ms | 771 ms | 840 ms |
| 8 | 152 ms | 169 ms | 676 ms | 757 ms |
| 16 | 151 ms | 168 ms | 664 ms | 761 ms |
| 32 | 146 ms | 166 ms | 674 ms | 767 ms |
| 64 | 144 ms | 155 ms | 689 ms | 781 ms |

### task 6: compact JSON (2026-11-06, Node v24.21.0, 11th Gen Intel(R) Core(TM) i5-1135G7 @ 2.40GHz)

Files are written compact by default (`format: 'pretty'` keeps them indented). The data is 18% smaller: 359 KB instead of
438 KB at 1,000 rows (39 KB instead of 50 KB at 100). Times are unchanged within noise: with this many small files,
each file's read (and in a browser, its request) costs more than parsing the whitespace, so the size win shows on the
wire and on disk, not in these timings. Fewer files is task 7.

| Operation | 100 rows | 1000 rows |
|---|---:|---:|
| insert each | 507 ms | 5.9 s |
| insert per row | 5.1 ms | 5.9 ms |
| read all | 18 ms | 147 ms |
| indexed where | 6.7 ms | 4.4 ms |
| join 1 | 20 ms | 167 ms |
| join 2 | 21 ms | 181 ms |
| update 1 by key | 17 ms | 152 ms |
| update many by index | 3.7 ms | 18 ms |
| delete 1 by key | 23 ms | 162 ms |
| browser read all | 109 ms | 697 ms |
| browser indexed where | 11 ms | 20 ms |
| browser join 1 | 90 ms | 712 ms |
| browser join 2 | 109 ms | 719 ms |
| files on disk | 129 | 1,119 |
| bytes of data | 39 KB | 359 KB |

### task 7: packed tables (2026-11-06, Node v24.21.0, 11th Gen Intel(R) Core(TM) i5-1135G7 @ 2.40GHz)

`packDatabase()` writes each record's rows into one file (`__packed/<record>.json`), and a browser reads a record from
it in one request when a read needs more rows than one round of requests (16) and the packed file matches the record
(Node keeps reading the entry files). The new "browser packed" rows are the same reads after packing: at 1,000 rows a
full read takes 17 ms instead of 0.83 s, and two joins 48 ms instead of 0.92 s (26 s in the baseline). Packing 1,000 rows
takes about a quarter of a second. Files and bytes are counted before packing.

| Operation | 100 rows | 1000 rows |
|---|---:|---:|
| insert each | 558 ms | 6.9 s |
| insert per row | 5.6 ms | 6.9 ms |
| read all | 22 ms | 160 ms |
| indexed where | 3.5 ms | 4.6 ms |
| join 1 | 20 ms | 185 ms |
| join 2 | 22 ms | 187 ms |
| update 1 by key | 19 ms | 159 ms |
| update many by index | 3.5 ms | 20 ms |
| delete 1 by key | 25 ms | 208 ms |
| browser read all | 144 ms | 830 ms |
| browser indexed where | 14 ms | 27 ms |
| browser join 1 | 130 ms | 860 ms |
| browser join 2 | 147 ms | 918 ms |
| pack | 69 ms | 270 ms |
| browser packed read all | 18 ms | 17 ms |
| browser packed indexed where | 20 ms | 15 ms |
| browser packed join 1 | 39 ms | 26 ms |
| browser packed join 2 | 55 ms | 48 ms |
| files on disk | 129 | 1,119 |
| bytes of data | 39 KB | 359 KB |

### task 8: multi-row insert (2026-11-06, Node v24.21.0, 11th Gen Intel(R) Core(TM) i5-1135G7 @ 2.40GHz)

`insert children values (...), (...), ...` inserts many rows in one statement: each index is read once, every row is
checked against them and the rows before it, and the record file and each index are written once. The new "insert all
in one statement" row inserts the same rows as "insert each" into a database of its own: at 1,000 rows 0.48 s instead of
6.7 s one at a time (6.5 minutes in the baseline). It stays linear: timed separately, one statement of 5,000 rows takes
3.3 s and 10,000 rows 6.3 s (0.63 ms per row, almost all of it writing the entry files). Getting there also needed a
parser fix: masking the strings of a query rebuilt the whole query once per string, so parsing a 10,000-row insert took
18 s; it now takes 0.3 s.

Keys no index answers (a composite key such as a link table's `primary key (a_id, b_id)`, or an index file that's
missing) are checked against the stored rows read once per statement, instead of once per inserted row: 500 links into
a table of 5,000 take 1.4 s (13.6 s when each row looked at every stored row), 200 into 1,000 take 0.45 s (1.1 s).

| Operation | 100 rows | 1000 rows |
|---|---:|---:|
| insert each | 571 ms | 6.7 s |
| insert per row | 5.7 ms | 6.7 ms |
| read all | 18 ms | 164 ms |
| indexed where | 3.1 ms | 5.5 ms |
| join 1 | 20 ms | 181 ms |
| join 2 | 22 ms | 181 ms |
| update 1 by key | 20 ms | 163 ms |
| update many by index | 3.6 ms | 22 ms |
| delete 1 by key | 25 ms | 214 ms |
| insert all in one statement | 55 ms | 478 ms |
| browser read all | 124 ms | 829 ms |
| browser indexed where | 12 ms | 24 ms |
| browser join 1 | 130 ms | 849 ms |
| browser join 2 | 141 ms | 981 ms |
| pack | 63 ms | 252 ms |
| browser packed read all | 17 ms | 13 ms |
| browser packed indexed where | 21 ms | 14 ms |
| browser packed join 1 | 57 ms | 25 ms |
| browser packed join 2 | 79 ms | 42 ms |
| files on disk | 129 | 1,119 |
| bytes of data | 39 KB | 359 KB |

### tasks 9-12, the README's numbers (2026-11-09, Node v24.21.0, 11th Gen Intel(R) Core(TM) i5-1135G7 @ 2.40GHz)

Tasks 9-12 (null in optional fields, clearer errors, `alter`, several databases) don't change how files are read or
written, and this run (on the epic after #129) matches task 8's within run-to-run noise. These are the numbers the
README's "How fast" table quotes.

| Operation | 100 rows | 1000 rows |
|---|---:|---:|
| insert each | 822 ms | 5.7 s |
| insert per row | 8.2 ms | 5.7 ms |
| read all | 17 ms | 151 ms |
| indexed where | 3.7 ms | 4.2 ms |
| join 1 | 20 ms | 176 ms |
| join 2 | 25 ms | 177 ms |
| update 1 by key | 20 ms | 157 ms |
| update many by index | 5.9 ms | 18 ms |
| delete 1 by key | 26 ms | 156 ms |
| insert all in one statement | 56 ms | 432 ms |
| browser read all | 94 ms | 689 ms |
| browser indexed where | 9.6 ms | 21 ms |
| browser join 1 | 88 ms | 732 ms |
| browser join 2 | 103 ms | 744 ms |
| pack | 26 ms | 166 ms |
| browser packed read all | 8.9 ms | 11 ms |
| browser packed indexed where | 9.7 ms | 11 ms |
| browser packed join 1 | 20 ms | 20 ms |
| browser packed join 2 | 32 ms | 33 ms |
| files on disk | 129 | 1,119 |
| bytes of data | 39 KB | 359 KB |
