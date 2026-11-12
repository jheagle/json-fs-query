import { EventEmitter } from 'events'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import * as readline from 'readline'
import { stripVTControlCharacters } from 'util'

jest.mock('readline')

// query() is mocked: these tests cover the CLI's input handling, not the query language
const mockQuery = jest.fn()
jest.mock('../data/queries/query', () => ({ query: (...args) => mockQuery(...args) }))

let cli
// The CLI's own copy of the settings (each session loads a fresh one)
let config

// Whether the next session reads from a terminal (a person typing) or a pipe / file (see pipedCli)
let stdinIsTTY = true
const stdinTTYDescriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY')

/**
 * Load a fresh copy of the CLI against a fake readline interface, so each test drives its own session.
 * @param {...string} args Command-line arguments, as typed after `jfsq`
 * @returns {EventEmitter} The fake interface, emit 'line' on it to simulate the user pressing Enter.
 */
const startCli = (...args) => {
  const rl = new EventEmitter()
  // Like the real interface, prompting after close throws (piped input closes it while queued lines still run)
  rl.closed = false
  rl.prompt = jest.fn(() => {
    if (rl.closed) {
      throw new Error('readline was closed')
    }
  })
  rl.setPrompt = jest.fn()
  rl.close = jest.fn(() => {
    rl.closed = true
    rl.emit('close')
  })
  rl.line = ''
  rl.write = jest.fn()
  readline.createInterface.mockReturnValue(rl)
  const argv = process.argv
  process.argv = ['node', 'jfsq', ...args]
  Object.defineProperty(process.stdin, 'isTTY', { value: stdinIsTTY, configurable: true })
  try {
    jest.isolateModules(() => {
      cli = require('./index')
      config = require('../data/utilities/config')
    })
  } finally {
    process.argv = argv
  }
  return rl
}

/**
 * Wait until the CLI has handled every line emitted so far (lines are queued and run one at a time).
 * @returns {Promise<void>}
 */
const idle = () => cli.whenIdle()

/**
 * Emit each line in order, then wait for the CLI to handle them all.
 * @param {EventEmitter} rl
 * @param {...string} lines
 * @returns {Promise<void>}
 */
const send = (rl, ...lines) => {
  lines.forEach(line => rl.emit('line', line))
  return idle()
}

/**
 * Each query the CLI handed to query(), in order.
 * @returns {Array<string>}
 */
const receivedQueries = () => mockQuery.mock.calls.map(([queryString]) => queryString)

/**
 * Everything written with console.log or console.error, without colour codes.
 * @param {'log'|'error'} method
 * @returns {Array<string>}
 */
const output = method => console[method].mock.calls.map(([message]) => stripVTControlCharacters(String(message)))

/**
 * The prompt most recently set on the interface, without any colour codes.
 * @param {EventEmitter} rl
 * @returns {string}
 */
const lastPrompt = rl => stripVTControlCharacters(rl.setPrompt.mock.lastCall[0])

beforeEach(() => {
  readline.createInterface.mockClear()
  mockQuery.mockReset()
  mockQuery.mockResolvedValue([])
  jest.spyOn(console, 'log').mockImplementation(() => {})
  jest.spyOn(console, 'error').mockImplementation(() => {})
  jest.spyOn(process, 'exit').mockImplementation(() => {})
})

afterEach(() => {
  jest.restoreAllMocks()
  stdinIsTTY = true
  if (stdinTTYDescriptor) {
    Object.defineProperty(process.stdin, 'isTTY', stdinTTYDescriptor)
  } else {
    delete process.stdin.isTTY
  }
  // -q sets the exit code; keep it from failing the test run
  process.exitCode = undefined
})

describe('the interactive CLI', () => {
  test('a single line ending in a semicolon is processed as one query', async () => {
    const rl = startCli()
    await send(rl, 'read foo;')
    expect(receivedQueries()).toEqual(['read foo;'])
  })

  test('pressing Enter before the semicolon continues the same query', async () => {
    const rl = startCli()
    await send(rl, 'read foo')
    expect(receivedQueries()).toEqual([])
    expect(lastPrompt(rl)).toBe('         ;> ')

    await send(rl, 'where note = \'hello\';')
    expect(receivedQueries()).toHaveLength(1)
    expect(lastPrompt(rl)).toBe('JSON-Query> ')
  })

  test('the continuation prompt lines up with the main prompt', async () => {
    const rl = startCli()
    await send(rl, 'read foo')
    expect(lastPrompt(rl)).toHaveLength('JSON-Query> '.length)
    expect(lastPrompt(rl).endsWith(';> ')).toBe(true)
  })

  test('continued lines are joined with a newline', async () => {
    const rl = startCli()
    await send(rl, 'read foo')
    await send(rl, '  where note = \'hello\'')
    await send(rl, '  limit 1;')
    expect(receivedQueries()).toEqual(['read foo\n  where note = \'hello\'\n  limit 1;'])
  })

  test('a blank line at the start of a query is ignored', async () => {
    const rl = startCli()
    await idle()
    const prompts = rl.setPrompt.mock.calls.length
    await send(rl, '')
    await send(rl, '   ')
    expect(rl.setPrompt).toHaveBeenCalledTimes(prompts)

    await send(rl, 'read foo;')
    expect(receivedQueries()).toEqual(['read foo;'])
  })

  test('a blank line in the middle of a query will be retained', async () => {
    const rl = startCli()
    await send(rl, 'read foo')
    await send(rl, '')
    await send(rl, 'limit 1;')
    expect(receivedQueries()).toEqual(['read foo\n\nlimit 1;'])
  })

  test('the buffer is reset after each query', async () => {
    const rl = startCli()
    await send(rl, 'read foo;')
    await send(rl, 'read bar;')
    expect(receivedQueries()).toEqual(['read foo;', 'read bar;'])
  })

  test('/exit closes the session in any letter case', async () => {
    const rl = startCli()
    await send(rl, '/EXIT')
    expect(rl.close).toHaveBeenCalled()
    expect(process.exit).toHaveBeenCalledWith(0)
    expect(receivedQueries()).toEqual([])
  })

  test('semi-colon in unclosed string does not close the query', async () => {
    const rl = startCli()
    await send(rl, 'read foo where note = "hello;')
    await send(rl, ' world";')
    expect(receivedQueries()).toEqual(['read foo where note = "hello;\n world";'])
  })

  test('/exit inside unclosed query will just add to query buffer', async () => {
    const rl = startCli()
    await send(rl, 'read foo')
    await send(rl, '/exit')
    await send(rl, ';')
    expect(receivedQueries()).toEqual(['read foo\n/exit\n;'])
  })

  test('a comment with -- does not roll to the next line', async () => {
    const rl = startCli()
    await send(rl, '-- this is a comment;')
    await send(rl, 'and this concludes the input;')
    expect(receivedQueries()).toEqual(['-- this is a comment;\nand this concludes the input;'])
  })

  test('a comment after a semi-colon can be complete', async () => {
    const rl = startCli()
    await send(rl, 'read foo; -- note this is a comment')
    expect(receivedQueries()).toEqual(['read foo; -- note this is a comment'])
  })

  test('prompt will show single quote is still open', async () => {
    const rl = startCli()
    await send(rl, "read foo from bar where note = '")
    expect(lastPrompt(rl)).toBe("         '> ")
  })

  test('prompt will show double quote is still open', async () => {
    const rl = startCli()
    await send(rl, 'read foo from bar where note = "')
    expect(lastPrompt(rl)).toBe('         "> ')
  })

  test('prompt will show parentheses is still open', async () => {
    const rl = startCli()
    await send(rl, 'read foo from bar where status in (')
    expect(lastPrompt(rl)).toBe('         (> ')
  })

  test('prompt will show multi-line comment is still open', async () => {
    const rl = startCli()
    await send(rl, 'read foo from bar where status in /*')
    expect(lastPrompt(rl)).toBe('        /*> ')
  })

  test('prompt will clear when mid query if Ctrl+C is pressed', async () => {
    const rl = startCli()
    await send(rl, 'read foo from bar where status in (')
    expect(lastPrompt(rl)).toBe('         (> ')
    rl.emit('SIGINT')
    await idle()
    expect(lastPrompt(rl)).toBe('JSON-Query> ')
  })

  test('Ctrl+C at the start of a query will exit', async () => {
    const rl = startCli()
    rl.emit('SIGINT')
    await idle()
    expect(rl.close).toHaveBeenCalled()
    expect(process.exit).toHaveBeenCalledWith(0)
  })

  test('Ctrl+C after will clear a query and then exit on the next Ctrl+C', async () => {
    const rl = startCli()
    await send(rl, 'read foo from bar where status in (')
    expect(lastPrompt(rl)).toBe('         (> ')
    rl.emit('SIGINT')
    await idle()
    expect(lastPrompt(rl)).toBe('JSON-Query> ')
    rl.emit('SIGINT')
    await idle()
    expect(rl.close).toHaveBeenCalled()
    expect(process.exit).toHaveBeenCalledWith(0)
  })

  test('Ctrl+C with text typed on the first line clears it instead of exiting', async () => {
    const rl = startCli()
    rl.line = 'read fo'
    rl.emit('SIGINT')
    await idle()
    expect(rl.write).toHaveBeenCalledWith(null, { ctrl: true, name: 'u' })
    expect(rl.close).not.toHaveBeenCalled()
    expect(process.exit).not.toHaveBeenCalled()
  })

  test('the buffer is passed to query() and each result is printed as a table', async () => {
    mockQuery.mockResolvedValue([[{ id: 1, note: 'hello' }], []])
    const rl = startCli()
    await send(rl, 'read foo; read bar;')
    expect(receivedQueries()).toEqual(['read foo; read bar;'])
    expect(output('log')).toContain([
      '+----+-------+',
      '| id | note  |',
      '+----+-------+',
      '| 1  | hello |',
      '+----+-------+',
      '(1 row)',
      ''
    ].join('\n'))
    expect(output('log')).toContain('(0 rows)\n')
  })

  test('a query error is printed and the session returns to the prompt', async () => {
    mockQuery.mockRejectedValueOnce(new Error('Failed to interpret: nonsense'))
    const rl = startCli()
    await send(rl, 'nonsense;')
    expect(output('error')).toEqual(['Error: Failed to interpret: nonsense'])
    expect(process.exit).not.toHaveBeenCalled()
    expect(lastPrompt(rl)).toBe('JSON-Query> ')

    await send(rl, 'read foo;')
    expect(receivedQueries()).toEqual(['nonsense;', 'read foo;'])
  })

  test('lines that arrive while a query runs wait for it, in order', async () => {
    let finishFirst
    mockQuery.mockImplementationOnce(() => new Promise(resolve => {
      finishFirst = () => resolve([['first']])
    }))
    const rl = startCli()
    // Piped input arrives all at once: the second query must not start before the first one finishes
    rl.emit('line', 'read foo;')
    rl.emit('line', 'read bar')
    rl.emit('line', 'limit 1;')
    await new Promise(setImmediate)
    expect(receivedQueries()).toEqual(['read foo;'])

    finishFirst()
    await idle()
    expect(receivedQueries()).toEqual(['read foo;', 'read bar\nlimit 1;'])
  })

  test('the end of piped input waits for the running query before exiting', async () => {
    let finish
    mockQuery.mockImplementationOnce(() => new Promise(resolve => {
      finish = () => resolve([['done']])
    }))
    const rl = startCli()
    rl.emit('line', 'read foo;')
    rl.emit('line', 'read bar;')
    rl.close()
    await new Promise(setImmediate)
    expect(process.exit).not.toHaveBeenCalled()

    finish()
    await idle()
    expect(output('log').join('\n')).toContain('| done  |')
    expect(receivedQueries()).toEqual(['read foo;', 'read bar;'])
    expect(output('error')).toEqual([])
    expect(process.exit).toHaveBeenCalledWith(0)
  })
})

describe('choosing the database', () => {
  let databases

  beforeAll(() => {
    // A folder holding two databases, as create database makes them
    databases = fs.mkdtempSync(path.join(os.tmpdir(), 'jfsq-cli-'))
    fs.mkdirSync(path.join(databases, 'real'))
    fs.mkdirSync(path.join(databases, 'test'))
  })

  afterAll(() => {
    fs.rmSync(databases, { recursive: true, force: true })
  })

  test('without options the database is database/', async () => {
    const rl = startCli()
    await idle()
    expect(output('log')).toContain('Database: database/\n')
    expect(lastPrompt(rl)).toBe('JSON-Query> ')
  })

  test('-d points the session at another database folder', async () => {
    const rl = startCli('-d', 'tasks-db/')
    await idle()
    expect(config.getSetting('databasePath')).toBe('tasks-db/')
    expect(output('log')).toContain('Database: tasks-db/\n')
    expect(lastPrompt(rl)).toBe('JSON-Query> ')
  })

  test('-d without a trailing slash still means the folder', async () => {
    startCli('-d', 'tasks-db')
    await idle()
    expect(config.activeDatabasePath()).toBe('tasks-db/')
    expect(output('log')).toContain('Database: tasks-db/\n')
  })

  test('--database is the long form of -d', async () => {
    startCli('--database', 'other/')
    await idle()
    expect(config.getSetting('databasePath')).toBe('other/')
  })

  test('--databases with -d picks a database in that folder, and the prompt names it', async () => {
    const rl = startCli('--databases', databases, '-d', 'real')
    await idle()
    expect(config.getSetting('database')).toBe('real')
    expect(output('log')).toContain(`Database: ${databases}/real/\n`)
    expect(lastPrompt(rl)).toBe('real> ')

    // The continuation prompt lines up with the shorter prompt too
    await send(rl, 'read foo')
    expect(lastPrompt(rl)).toBe('   ;> ')
  })

  test('the prompt follows a use in a query', async () => {
    const rl = startCli('--databases', databases, '-d', 'real')
    mockQuery.mockImplementationOnce(async () => {
      config.switchDatabase('test')
      return ['test']
    })
    await send(rl, 'use test;')
    expect(lastPrompt(rl)).toBe('test> ')
  })

  test('--databases without -d leaves no database in use until a use', async () => {
    const rl = startCli('--databases', databases)
    await idle()
    expect(config.getSetting('databasesPath')).toBe(databases)
    expect(config.getSetting('database')).toBeUndefined()
    expect(output('log')).toContain(`Databases: ${databases} (none in use yet: use <name>;)\n`)
    expect(lastPrompt(rl)).toBe('JSON-Query> ')
  })

  test('a database that does not exist ends the session with exit code 1', async () => {
    const rl = startCli('--databases', databases, '-d', 'nope')
    await idle()
    expect(output('error')).toEqual(['Error: Database "nope" doesn\'t exist'])
    expect(rl.close).toHaveBeenCalled()
    expect(process.exit).toHaveBeenCalledWith(1)
    expect(output('log')).not.toContain('\nGoodbye!')
  })

  test('lines piped after a failed start are not run', async () => {
    const rl = startCli('--databases', databases, '-d', 'nope')
    rl.emit('line', 'read workouts;')
    await idle()
    expect(receivedQueries()).toEqual([])
    expect(process.exit).toHaveBeenCalledWith(1)
  })

  test('an invalid database name ends the session with exit code 1', async () => {
    startCli('--databases', databases, '-d', 'not/a/name')
    await idle()
    expect(output('error')[0]).toMatch(/^Error: Invalid database name "not\/a\/name"/)
    expect(process.exit).toHaveBeenCalledWith(1)
  })

  test('an unknown option is refused with exit code 1', () => {
    const stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true)
    // commander exits on its own; process.exit is mocked, so stop the load where a real exit would
    process.exit.mockImplementation(code => {
      throw new Error(`exit ${code}`)
    })
    expect(() => startCli('--nope')).toThrow('exit 1')
    expect(stderr.mock.calls.join('')).toContain("unknown option '--nope'")
  })

  test('lines typed while the session starts wait for it', async () => {
    const rl = startCli('--databases', databases, '-d', 'real')
    rl.emit('line', 'read foo;')
    await idle()
    expect(receivedQueries()).toEqual(['read foo;'])
    expect(config.getSetting('database')).toBe('real')
  })
})

describe('running a query directly (-q)', () => {
  test('-q runs the query, prints the result and exits 0, without opening the prompt', async () => {
    mockQuery.mockResolvedValue([[{ id: 1 }]])
    startCli('-q', 'read foo')
    await idle()
    expect(receivedQueries()).toEqual(['read foo'])
    expect(readline.createInterface).not.toHaveBeenCalled()
    expect(output('log')).toEqual([[
      '+----+',
      '| id |',
      '+----+',
      '| 1  |',
      '+----+',
      '(1 row)',
      ''
    ].join('\n')])
    expect(process.exitCode).toBe(0)
    expect(process.exit).not.toHaveBeenCalled()
  })

  test('--query is the long form, and several queries print one result each', async () => {
    mockQuery.mockResolvedValue([[], []])
    startCli('--query', 'read foo; read bar;')
    await idle()
    expect(receivedQueries()).toEqual(['read foo; read bar;'])
    expect(output('log')).toEqual(['(0 rows)\n', '(0 rows)\n'])
  })

  test('a failing query prints the error and exits 1', async () => {
    mockQuery.mockRejectedValue(new Error('Record "foo" doesn\'t exist'))
    startCli('-q', 'read foo')
    await idle()
    expect(output('error')).toEqual(['Error: Record "foo" doesn\'t exist'])
    expect(output('log')).toEqual([])
    expect(process.exitCode).toBe(1)
  })

  test('the database options apply before the query runs', async () => {
    let databasePath
    mockQuery.mockImplementation(async () => {
      databasePath = config.activeDatabasePath()
      return []
    })
    startCli('-d', 'tasks-db', '-q', 'read tasks')
    await idle()
    expect(databasePath).toBe('tasks-db/')
  })

  test('a database that does not exist exits 1 without running the query', async () => {
    const databases = fs.mkdtempSync(path.join(os.tmpdir(), 'jfsq-cli-'))
    try {
      startCli('--databases', databases, '-d', 'nope', '-q', 'read foo')
      await idle()
      expect(receivedQueries()).toEqual([])
      expect(output('error')).toEqual(['Error: Database "nope" doesn\'t exist'])
      expect(process.exitCode).toBe(1)
    } finally {
      fs.rmSync(databases, { recursive: true, force: true })
    }
  })

  test('an empty -q runs (and fails) rather than opening the prompt', async () => {
    mockQuery.mockRejectedValue(new Error('No query'))
    startCli('-q', '')
    await idle()
    expect(readline.createInterface).not.toHaveBeenCalled()
    expect(process.exitCode).toBe(1)
  })
})

describe('help and version', () => {
  /**
   * Load the CLI with these args, catching what commander writes and the exit it asks for.
   * @param {...string} args
   * @returns {{ code: number, stdout: string }}
   */
  const runToExit = (...args) => {
    const stdout = jest.spyOn(process.stdout, 'write').mockImplementation(() => true)
    // A second spyOn in the same test returns the same mock: start each run from no calls
    stdout.mockClear()
    process.exit.mockImplementation(code => {
      throw new Error(`exit ${code}`)
    })
    let code
    try {
      startCli(...args)
    } catch (error) {
      code = Number(error.message.replace('exit ', ''))
    }
    return { code, stdout: stdout.mock.calls.join('') }
  }

  test('-v and --version print the package version', () => {
    const { version } = require('../../package.json')
    expect(runToExit('-v')).toEqual({ code: 0, stdout: `${version}\n` })
    expect(runToExit('--version')).toEqual({ code: 0, stdout: `${version}\n` })
  })

  test('-h lists every option, with examples', () => {
    const { code, stdout } = runToExit('-h')
    expect(code).toBe(0)
    for (const option of ['-q, --query <query>', '-d, --database <path>', '--databases <folder>', '-v, --version', '-h, --help', 'Examples:', 'type /help']) {
      expect(stdout).toContain(option)
    }
  })
})

describe('piped input (jfsq < seed.txt)', () => {
  /**
   * Start a session reading from a pipe, as `jfsq < seed.txt` does.
   * @param {...string} args
   * @returns {EventEmitter}
   */
  const pipedCli = (...args) => {
    stdinIsTTY = false
    return startCli(...args)
  }

  /**
   * Feed the lines of a file, then the end of input, and wait for the session to finish.
   * @param {EventEmitter} rl
   * @param {string} text
   * @returns {Promise<void>}
   */
  const pipe = (rl, text) => {
    text.split('\n').forEach(line => rl.emit('line', line))
    rl.close()
    return idle()
  }

  test('runs each query with no banner, prompts or goodbye, and exits 0', async () => {
    mockQuery.mockResolvedValue([[]])
    const rl = pipedCli()
    await pipe(rl, 'insert foo values a = 1;\nread foo\n  where a = 1;')
    expect(receivedQueries()).toEqual(['insert foo values a = 1;', 'read foo\n  where a = 1;'])
    expect(output('log')).toEqual(['(0 rows)\n', '(0 rows)\n'])
    expect(rl.prompt).not.toHaveBeenCalled()
    expect(process.exit).toHaveBeenCalledWith(0)
  })

  test('a failing query is reported, the rest still run, and the exit code is 1', async () => {
    mockQuery
      .mockRejectedValueOnce(new Error('Record "foo" doesn\'t exist'))
      .mockResolvedValue([[]])
    const rl = pipedCli()
    await pipe(rl, 'read foo;\nread bar;')
    expect(receivedQueries()).toEqual(['read foo;', 'read bar;'])
    expect(output('error')).toEqual(['Error: Record "foo" doesn\'t exist'])
    expect(process.exit).toHaveBeenCalledWith(1)
  })

  test('the last query runs even without its closing semicolon', async () => {
    const rl = pipedCli()
    await pipe(rl, 'read foo;\nread bar')
    expect(receivedQueries()).toEqual(['read foo;', 'read bar'])
    expect(process.exit).toHaveBeenCalledWith(0)
  })

  test('comments and blank lines left at the end are not run', async () => {
    const rl = pipedCli()
    await pipe(rl, 'read foo;\n-- the end\n/* really */\n')
    expect(receivedQueries()).toEqual(['read foo;'])
    expect(process.exit).toHaveBeenCalledWith(0)
  })

  test('the database line is not printed, but a bad database still exits 1 without running anything', async () => {
    const databases = fs.mkdtempSync(path.join(os.tmpdir(), 'jfsq-cli-'))
    try {
      const rl = pipedCli('--databases', databases, '-d', 'nope')
      await pipe(rl, 'read foo;')
      expect(receivedQueries()).toEqual([])
      expect(output('log')).toEqual([])
      expect(output('error')).toEqual(['Error: Database "nope" doesn\'t exist'])
      expect(process.exit).toHaveBeenCalledWith(1)
    } finally {
      fs.rmSync(databases, { recursive: true, force: true })
    }
  })

  test('a person typing still gets the banner, prompts and goodbye, and exit 0 after a failed query', async () => {
    mockQuery.mockRejectedValueOnce(new Error('nope'))
    const rl = startCli()
    await send(rl, 'read foo;')
    rl.close()
    await idle()
    expect(output('log')[0]).toBe('JSON Filesystem Query CLI')
    expect(rl.prompt).toHaveBeenCalled()
    expect(output('log')).toContain('\nGoodbye!')
    expect(process.exit).toHaveBeenCalledWith(0)
  })

  test('an unfinished query typed at the prompt is dropped on exit, not run', async () => {
    const rl = startCli()
    await send(rl, 'read foo')
    rl.close()
    await idle()
    expect(receivedQueries()).toEqual([])
  })
})

describe('output format and markers', () => {
  test('-o json prints each result as JSON', async () => {
    mockQuery.mockResolvedValue([[{ id: 1, note: null }], []])
    startCli('-o', 'json', '-q', 'read foo; read bar;')
    await idle()
    expect(output('log')).toEqual([`${JSON.stringify([{ id: 1, note: null }], null, 2)}\n`, '[]\n'])
  })

  test('--output csv prints CSV', async () => {
    mockQuery.mockResolvedValue([[{ id: 1, note: 'a,b' }]])
    startCli('--output', 'csv', '-q', 'read foo')
    await idle()
    expect(output('log')).toEqual(['id,note\n1,"a,b"\n'])
  })

  test('an unknown -o is refused with exit code 1', () => {
    jest.spyOn(process.stderr, 'write').mockImplementation(() => true)
    process.exit.mockImplementation(code => {
      throw new Error(`exit ${code}`)
    })
    expect(() => startCli('-o', 'xml')).toThrow('exit 1')
    expect(process.stderr.write.mock.calls.join('')).toContain('Allowed choices are table, json, csv, dump')
  })

  test('-o dump is refused before the query runs, so nothing is written', async () => {
    startCli('-o', 'dump', '-q', 'insert foo values a = 1')
    await idle()
    expect(receivedQueries()).toEqual([])
    expect(output('error')[0]).toMatch(/^Error: dump output isn't available yet/)
    expect(process.exitCode).toBe(1)
  })

  test('--null and --missing change the table markers', async () => {
    mockQuery.mockResolvedValue([[{ a: null }, {}]])
    startCli('--null', '(null)', '--missing', '(none)', '-q', 'read foo')
    await idle()
    expect(output('log')[0]).toContain('| (null) |')
    expect(output('log')[0]).toContain('| (none) |')
  })

  test('/output changes the format for the rest of the session, and says what it is', async () => {
    mockQuery.mockResolvedValue([[{ id: 1 }]])
    const rl = startCli()
    await send(rl, '/output csv')
    expect(output('log')).toContain('Output: csv')
    await send(rl, 'read foo;')
    expect(output('log')).toContain('id\n1\n')

    await send(rl, '/OUTPUT')
    expect(output('log').pop()).toBe('Output: csv')
    expect(receivedQueries()).toEqual(['read foo;'])
  })

  test('/output with an unknown format says so and keeps the format', async () => {
    const rl = startCli()
    await send(rl, '/output xml')
    expect(output('error')).toEqual(['Error: Unknown output "xml": use table, json, csv, dump'])
    await send(rl, '/output')
    expect(output('log').pop()).toBe('Output: table')
  })

  test('/output dump refuses each query before it runs', async () => {
    const rl = startCli()
    await send(rl, '/output dump', 'insert foo values a = 1;')
    expect(receivedQueries()).toEqual([])
    expect(output('error')[0]).toMatch(/^Error: dump output isn't available yet/)
  })

  test('/null and /missing change the markers, and say what they are', async () => {
    mockQuery.mockResolvedValue([[{ a: null }, {}]])
    const rl = startCli()
    await send(rl, '/null (null)', '/missing')
    expect(output('log')).toContain('Null shows as: (null)')
    expect(output('log')).toContain('Missing shows as: —')
    await send(rl, 'read foo;')
    expect(output('log').join('\n')).toContain('| (null) |')
  })

  test('an unknown command lists the ones there are', async () => {
    const rl = startCli()
    await send(rl, '/frobnicate')
    expect(output('error')).toEqual(['Error: Unknown command /frobnicate: use /output <table|json|csv|dump>, /null <text>, /missing <text>, /help [topic] or /exit'])
    expect(receivedQueries()).toEqual([])
  })

  test('/help lists the commands and topics, and /help <topic> shows its syntax', async () => {
    const rl = startCli()
    await send(rl, '/help')
    const overview = output('log').pop()
    expect(overview).toContain('/output <table|json|csv|dump>')
    expect(overview).toContain('/exit')
    expect(overview).toMatch(/^ {2}read +read rows/m)

    await send(rl, '/HELP Read')
    expect(output('log').pop()).toMatch(/^read <record>/)
    await send(rl, '/help merge')
    expect(output('log').pop()).toContain('merge <record>.<field> with')
    expect(receivedQueries()).toEqual([])
    expect(output('error')).toEqual([])
  })

  test('/help with an unknown topic names the ones there are', async () => {
    const rl = startCli()
    await send(rl, '/help frobnicate')
    expect(output('error')).toEqual([expect.stringMatching(/^Error: No help for "frobnicate": try read, insert, /)])
  })

  test('the banner mentions /help', () => {
    startCli()
    expect(output('log').join('\n')).toContain('/help')
  })

  test('a query starting with a /* comment is a query, not a command', async () => {
    const rl = startCli()
    await send(rl, '/* first */ read foo;')
    expect(receivedQueries()).toEqual(['/* first */ read foo;'])
  })

  test('a command line inside an unfinished query is part of the query', async () => {
    const rl = startCli()
    await send(rl, 'read foo', '/output csv', ';')
    expect(receivedQueries()).toEqual(['read foo\n/output csv\n;'])
  })

  test('commands in piped input run quietly too, and a bad one makes the exit code 1', async () => {
    stdinIsTTY = false
    mockQuery.mockResolvedValue([[{ id: 1 }]])
    const rl = startCli()
    ;['/output json', 'read foo;', '/nope'].forEach(line => rl.emit('line', line))
    rl.close()
    await idle()
    // Only the result: no "Output: json" in front of it, so the output stays valid for jq
    expect(output('log')).toEqual([`${JSON.stringify([{ id: 1 }], null, 2)}\n`])
    expect(process.exit).toHaveBeenCalledWith(1)
  })
})
