#!/usr/bin/env node
/**
 * Benchmark: how long json-fs-query's common operations take as a database grows, in Node and in a real browser.
 *
 *   npm run benchmark                         sizes 100 and 1000, Node and browser
 *   npm run benchmark -- --sizes 100,500      other sizes
 *   npm run benchmark -- --no-browser         Node only
 *   npm run benchmark -- --label "task 3"     a label for this run's table (for BENCHMARKS.md)
 *
 * It measures the built package (dist/ and browser/), so run `npm run build` first. Each size gets a fresh scratch
 * database shaped like a real app's (workout-planner's workouts -> exercises -> muscles):
 *
 *   kinds (10 rows) <- parents (size / 10 rows, a foreign key to kinds) <- children (size rows, a foreign key to
 *   parents, an index on day)
 *
 * and times, in order: inserting every child one query at a time; reading every child; an indexed `where`; a one-join
 * and a two-join read; updating one row by key and many rows by index; deleting one row. The browser reads the same
 * database over fetch() from a local server, then again after packDatabase() (one file per record). Prints a markdown
 * table.
 */
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const rootDir = path.join(__dirname, '..')
const args = process.argv.slice(2)
const option = (name, fallback) => {
  const index = args.indexOf(name)
  return index === -1 ? fallback : args[index + 1]
}
const sizes = option('--sizes', '100,1000').split(',').map(Number)
const label = option('--label', 'run')
const browserToo = !args.includes('--no-browser')

const { configure, query, packDatabase } = require(path.join(rootDir, 'dist/index.js'))

/** Whether this build reads `insert ... values (...), (...)` (earlier builds don't), so older builds can still run. */
const supportsMultiRowInsert = (() => {
  try {
    const { parser } = require(path.join(rootDir, 'dist/data/queries/parser.js'))
    return parser('insert t values (a = 1), (a = 2)')[0].insertValues.length === 2
  } catch (error) {
    return false
  }
})()

const kindCount = 10
const days = 60

/** Milliseconds a function takes. */
const time = async task => {
  const start = process.hrtime.bigint()
  await task()
  return Number(process.hrtime.bigint() - start) / 1e6
}

/**
 * Build the scratch database for one size; returns the insert timings.
 * @param {string} databasePath
 * @param {number} size
 */
const buildDatabase = async (databasePath, size) => {
  configure({ databasePath })
  await query(`create kinds (_id string, name string, primary key (_id));
    create parents (_id string, name string, kind_id string, primary key (_id),
      foreign key (kind_id) references kinds (_id));
    create children (_id string auto, parent_id string, day string, value int, label string null,
      primary key (_id), index (day), foreign key (parent_id) references parents (_id))`)
  const parentCount = Math.max(1, Math.round(size / 10))
  for (let kind = 0; kind < kindCount; kind++) await query(`insert kinds values _id = 'k${kind}', name = 'Kind ${kind}'`)
  for (let parent = 0; parent < parentCount; parent++) {
    await query(`insert parents values _id = 'p${parent}', name = 'Parent ${parent}', kind_id = 'k${parent % kindCount}'`)
  }
  const insertChildren = await time(async () => {
    for (let child = 0; child < size; child++) {
      await query(`insert children values ${childValues(child, parentCount)}`)
    }
  })
  return { insertChildren, parentCount }
}

/** One child row's values, the same in every insert the benchmark times. */
const childValues = (child, parentCount) => {
  const day = `2026-${String(1 + Math.floor((child % days) / 28)).padStart(2, '0')}-${String(1 + (child % 28)).padStart(2, '0')}`
  return `parent_id = 'p${child % parentCount}', day = '${day}', value = ${child}, label = 'row ${child}'`
}

/**
 * Time inserting every child in one statement (`values (...), (...)`), as an import would, into a database of its own
 * built the same way, so the other rows keep timing the same database as in earlier runs.
 * @param {string} databasePath
 * @param {number} size
 */
const insertAllAtOnce = async (databasePath, size) => {
  configure({ databasePath })
  await query(`create kinds (_id string, name string, primary key (_id));
    create parents (_id string, name string, kind_id string, primary key (_id),
      foreign key (kind_id) references kinds (_id));
    create children (_id string auto, parent_id string, day string, value int, label string null,
      primary key (_id), index (day), foreign key (parent_id) references parents (_id))`)
  const parentCount = Math.max(1, Math.round(size / 10))
  await query(`insert kinds values ${Array.from({ length: kindCount }, (_, kind) => `(_id = 'k${kind}', name = 'Kind ${kind}')`).join(', ')}`)
  await query(`insert parents values ${Array.from({ length: parentCount }, (_, parent) =>
    `(_id = 'p${parent}', name = 'Parent ${parent}', kind_id = 'k${parent % kindCount}')`).join(', ')}`)
  const text = `insert children values ${Array.from({ length: size }, (_, child) => `(${childValues(child, parentCount)})`).join(', ')}`
  return time(() => query(text))
}

/** The read queries timed in both Node and the browser. */
const readQueries = [
  ['read all', 'read children'],
  ['indexed where', "read children where day = '2026-01-05'"],
  ['join 1', 'read children.parents on children.parent_id = parents._id'],
  ['join 2', 'read children.kinds on children.parent_id = parents._id and on parents.kind_id = kinds._id']
]

/**
 * Time the read queries in a real browser (Chromium), reading the database over fetch().
 * @param {string} databasePath
 * @returns {Promise<Object<string, number>|null>}
 */
const browserReads = async databasePath => {
  let partials
  let playwright
  try {
    partials = require('js-build-tools').partials
    playwright = partials.loadPlaywright(rootDir)
  } catch (error) {
    process.stderr.write(` (browser skipped: ${error.message.split('.')[0]})`)
    return null
  }
  const serveDir = path.dirname(databasePath)
  fs.copyFileSync(path.join(rootDir, 'browser/jsonFsQuery.js'), path.join(serveDir, 'jsonFsQuery.js'))
  fs.writeFileSync(path.join(serveDir, 'index.html'), "<!DOCTYPE html><script src='jsonFsQuery.js'></script>")
  const { server, url } = await partials.serveStatic(serveDir)
  const browser = await playwright.chromium.launch()
  try {
    const page = await browser.newPage()
    await page.goto(`${url}/index.html`)
    return await page.evaluate(async ({ queries, database }) => {
      const library = window.jsonFsQuery
      library.configure({ databasePath: `${database}/`, relativePath: '/' })
      const results = {}
      for (const [name, text] of queries) {
        const start = performance.now()
        await library.query(text)
        results[name] = performance.now() - start
      }
      return results
    }, { queries: readQueries, database: path.basename(databasePath) })
  } finally {
    await browser.close()
    server.close()
  }
}

/** Count files and bytes in a folder. */
const folderSize = folder => {
  let files = 0
  let bytes = 0
  const walk = current => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) walk(full)
      else {
        files++
        bytes += fs.statSync(full).size
      }
    }
  }
  walk(folder)
  return { files, bytes }
}

const format = ms => ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms.toFixed(ms < 10 ? 1 : 0)} ms`

const main = async () => {
  const rows = []
  for (const size of sizes) {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'json-fs-query-benchmark-'))
    const databasePath = path.join(scratch, 'database') + '/'
    try {
      process.stderr.write(`${size} rows: inserting...`)
      const { insertChildren } = await buildDatabase(databasePath, size)
      const result = { size, 'insert each': insertChildren, 'insert per row': insertChildren / size }
      process.stderr.write(' reading...')
      for (const [name, text] of readQueries) result[name] = await time(() => query(text))
      result['update 1 by key'] = await time(async () => {
        const [[row]] = await query('read children limit 1')
        await query(`update children set value = 0 where _id = '${row._id}'`)
      })
      result['update many by index'] = await time(() => query("update children set label = 'changed' where day = '2026-01-06'"))
      result['delete 1 by key'] = await time(async () => {
        const [[row]] = await query('read children limit 1')
        await query(`delete children where _id = '${row._id}'`)
      })
      Object.assign(result, folderSize(databasePath))
      if (supportsMultiRowInsert) {
        process.stderr.write(' insert in one statement...')
        result['insert all in one statement'] = await insertAllAtOnce(path.join(scratch, 'bulk') + '/', size)
        configure({ databasePath })
      }
      if (browserToo) {
        process.stderr.write(' browser...')
        const browser = await browserReads(databasePath)
        if (browser) for (const [name, ms] of Object.entries(browser)) result[`browser ${name}`] = ms
        if (browser && packDatabase) {
          // The same reads once every record is packed into one file (counted in files and bytes above without them)
          process.stderr.write(' packing...')
          result.pack = await time(() => packDatabase())
          process.stderr.write(' browser packed...')
          const packed = await browserReads(databasePath)
          if (packed) for (const [name, ms] of Object.entries(packed)) result[`browser packed ${name}`] = ms
        }
      }
      rows.push(result)
      process.stderr.write(' done\n')
    } finally {
      fs.rmSync(scratch, { recursive: true, force: true })
    }
  }

  const columns = Object.keys(rows[0]).filter(key => !['size', 'files', 'bytes'].includes(key))
  const lines = [
    `### ${label} (${new Date().toISOString().slice(0, 10)}, Node ${process.version}, ${os.cpus()[0].model.trim()})`,
    '',
    `| Operation | ${rows.map(row => `${row.size} rows`).join(' | ')} |`,
    `|---|${rows.map(() => '---:').join('|')}|`,
    ...columns.map(column => `| ${column} | ${rows.map(row => column in row ? format(row[column]) : 'n/a').join(' | ')} |`),
    `| files on disk | ${rows.map(row => row.files.toLocaleString('en-CA')).join(' | ')} |`,
    `| bytes of data | ${rows.map(row => `${(row.bytes / 1024).toFixed(0)} KB`).join(' | ')} |`
  ]
  console.log(lines.join('\n'))
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
