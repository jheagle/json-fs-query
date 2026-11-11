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
  mockQuery.mockReset()
  mockQuery.mockResolvedValue([])
  jest.spyOn(console, 'log').mockImplementation(() => {})
  jest.spyOn(console, 'error').mockImplementation(() => {})
  jest.spyOn(process, 'exit').mockImplementation(() => {})
})

afterEach(() => {
  jest.restoreAllMocks()
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

  test('-d adds the trailing slash a database folder needs', async () => {
    startCli('-d', 'tasks-db')
    await idle()
    expect(config.getSetting('databasePath')).toBe('tasks-db/')
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
